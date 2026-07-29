import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { timingSafeEqual } from "../_shared/security.ts";
import { fetchBalancesMulticall } from "../_shared/multicall.ts";

const RPC_URL = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const CONCURRENCY = 10;
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set — refusing to start, would silently zero every balance");

const provider = RPC_URL_BACKUP
  ? new ethers.FallbackProvider(
    [
      { provider: new ethers.JsonRpcProvider(RPC_URL), priority: 1 },
      { provider: new ethers.JsonRpcProvider(RPC_URL_BACKUP), priority: 2 },
    ],
    undefined,
    { quorum: 1 }
  )
  : new ethers.JsonRpcProvider(RPC_URL);

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return new Response('Unauthorized', { status: 401 });
  }
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { data: gotLock, error: lockError } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: 'reconcile-canvas',
      p_ttl_seconds: 300,
    });
    if (lockError) throw lockError;
    if (!gotLock) {
      return new Response(JSON.stringify({ skipped: true, reason: 'already running' }), { status: 200 });
    }

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

    const balances = await fetchBalancesMulticall(painters, CONTRACT_ADDRESS, provider);

    for (let i = 0; i < painters.length; i += CONCURRENCY) {
      const batch = painters.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (painter) => {
        let success = false;
        try {
          const { balance: balanceWei, locked: lockedWei } = balances.get(painter) ?? { balance: 0n, locked: 0n };
          const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
          const usableTokens = Number(usableWei / 1000000000000000000n);

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
    // Cast propre de l'erreur pour la console et le retour JSON
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("reconcile-canvas error:", errorMessage);

    try {
      await supabase.rpc('release_cron_lock', { p_job_name: 'reconcile-canvas' });
    } catch {
      /* Suppression du paramètre _ inutilisé (best effort) */
    }

    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
});