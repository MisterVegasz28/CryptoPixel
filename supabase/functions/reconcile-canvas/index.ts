import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const RPC_URL          = Deno.env.get('RPC_URL') ?? 'https://rpc-amoy.polygon.technology';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';
const CONCURRENCY      = 5;

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];

Deno.serve(async (req: Request) => {
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

    const MAX_PAINTERS_PER_RUN = 300;

const { data: painterRows, error } = await supabase
  .from('offchain_canvas')
  .select('painter')
  .neq('painter', '')
  .order('last_reconciled_at', { ascending: true, nullsFirst: true })
  .limit(MAX_PAINTERS_PER_RUN * 3); // marge avant dédup, plusieurs pixels par painter
if (error) throw error;

const painters = [...new Set((painterRows || []).map(r => r.painter))].slice(0, MAX_PAINTERS_PER_RUN);
    let reconciled = 0;
    let errors = 0;

    for (let i = 0; i < painters.length; i += CONCURRENCY) {
      const batch = painters.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (painter) => {
        try {
          const [balanceWei, lockedWei] = await Promise.all([
            contract.balanceOf(painter),
            contract.lockedPremine(painter),
          ]);
          const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
          const usableTokens = Number(usableWei / 1000000000000000000n);

          const { error: rpcError } = await supabase.rpc('enforce_quota_atomic', {
            p_painter: painter,
            p_usable_tokens: usableTokens,
          });
          if (rpcError) throw rpcError;

          await supabase.from('offchain_canvas')
            .update({ last_reconciled_at: new Date().toISOString() })
            .eq('painter', painter);

          reconciled++;
        } catch (e) {
          console.error(`[reconcile] failed for ${painter}`, e);
          errors++;
        }
      }));
    }

    return new Response(JSON.stringify({ reconciled, errors, total: painters.length }), { status: 200 });
  } catch (error) {
    console.error("reconcile-canvas error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
