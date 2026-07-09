import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"
import { timingSafeEqual } from "../_shared/security.ts"

const RPC_URL          = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP    = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';
const CONCURRENCY      = 5;

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];

Deno.serve(async (req: Request) => {
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: gotLock } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: 'reconcile-canvas',
      p_ttl_seconds: 300, // marge pour 300 painters x 2 appels RPC blockchain si le réseau est lent
    });
    if (!gotLock) {
      return new Response(JSON.stringify({ skipped: true, reason: 'already running' }), { status: 200 });
    }

    const provider = RPC_URL_BACKUP
      ? new ethers.FallbackProvider([
          { provider: new ethers.JsonRpcProvider(RPC_URL), priority: 1 },
          { provider: new ethers.JsonRpcProvider(RPC_URL_BACKUP), priority: 2 },
        ])
      : new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

    const MAX_PAINTERS_PER_RUN = 300;

    const { data: painterRows, error } = await supabase
      .from('painters')
      .select('address')
      .order('last_reconciled_at', { ascending: true, nullsFirst: true })
      .limit(MAX_PAINTERS_PER_RUN);
    if (error) throw error;

    const painters = (painterRows || []).map(r => r.address);
    let reconciled = 0;
    let errors = 0;

    for (let i = 0; i < painters.length; i += CONCURRENCY) {
      const batch = painters.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (painter) => {
       let success = false;
        try {
          const [balanceWei, lockedWei] = await Promise.all([
            contract.balanceOf(painter),
            contract.lockedPremine(painter),
          ]);
          const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : BigInt(0);
          const usableTokens = Number(usableWei / BigInt(1e18));

          const { error: rpcError } = await supabase.rpc('enforce_quota_atomic', {
            p_painter: painter,
            p_usable_tokens: usableTokens,
          });
          if (rpcError) throw rpcError;

          reconciled++;
          success = true;
        } catch (e) {
          console.error(`[reconcile] failed for ${painter}`, e);
          errors++;
        } finally {
          // Toujours avancer le curseur (succès ou échec) pour éviter
          // qu'un painter en échec permanent bloque la queue en boucle.
          // consecutive_failures permet de repérer les painters jamais
          // réconciliés au lieu de les oublier silencieusement.
          const { error: updateError } = await supabase.rpc('mark_painter_reconciled', {
            p_painter: painter,
            p_success: success,
          });
          if (updateError) {
            console.error(`[reconcile] failed to update cursor for ${painter}`, updateError);
          }
        }
      }));
    }

    await supabase.rpc('release_cron_lock', { p_job_name: 'reconcile-canvas' });

    return new Response(JSON.stringify({ reconciled, errors, total: painters.length }), { status: 200 });
  } catch (error) {
    console.error("reconcile-canvas error:", error.message);
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabase.rpc('release_cron_lock', { p_job_name: 'reconcile-canvas' });
    } catch (_) { /* best effort */ }
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});