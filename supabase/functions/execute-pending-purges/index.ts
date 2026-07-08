import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const RPC_URL          = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP    = Deno.env.get('RPC_URL_BACKUP') ?? '';
const REORG_SAFETY_BLOCKS = BigInt(Deno.env.get('REORG_SAFETY_BLOCKS') ?? '20');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const CONCURRENCY = 5;
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
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

    const provider = RPC_URL_BACKUP
      ? new ethers.FallbackProvider([
          { provider: new ethers.JsonRpcProvider(RPC_URL), priority: 1 },
          { provider: new ethers.JsonRpcProvider(RPC_URL_BACKUP), priority: 2 },
        ])
      : new ethers.JsonRpcProvider(RPC_URL);
    const currentBlock = BigInt(await provider.getBlockNumber());
    const safeBlock = currentBlock > REORG_SAFETY_BLOCKS ? currentBlock - REORG_SAFETY_BLOCKS : 0n;

    const { data: due, error } = await supabase
      .from('pending_purges')
      .select('id, reason')
      .lte('block_number', Number(safeBlock))
      .limit(500);

    if (error) throw error;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ purged: 0, reconciled: 0 }), { status: 200 });
    }

    const freezeEntries = due.filter(d => d.reason !== 'quota_cleanup');
    const quotaEntries = due.filter(d => d.reason === 'quota_cleanup');

    // ── Purges de freeze (comportement inchangé) ──────────────────────────
    let toPurge: string[] = [];
    let abandoned: string[] = [];
    if (freezeEntries.length > 0) {
      const freezeIds = freezeEntries.map(d => d.id);
      const { data: stillFrozen, error: checkErr } = await supabase
        .from('pixel')
        .select('id')
        .in('id', freezeIds);
      if (checkErr) throw checkErr;

      const confirmedIds = new Set((stillFrozen || []).map(p => p.id));
      toPurge = freezeIds.filter(id => confirmedIds.has(id));
      abandoned = freezeIds.filter(id => !confirmedIds.has(id));

      if (toPurge.length > 0) {
        const { error: delErr } = await supabase.from('offchain_canvas').delete().in('id', toPurge);
        if (delErr) throw delErr;
      }
    }

    // ── Reconciliation quota (solde recalculé maintenant, pas au block de l'event) ──
    let reconciled = 0;
    let reconcileErrors = 0;
    if (quotaEntries.length > 0) {
      const provider = RPC_URL_BACKUP
      ? new ethers.FallbackProvider([
          { provider: new ethers.JsonRpcProvider(RPC_URL), priority: 1 },
          { provider: new ethers.JsonRpcProvider(RPC_URL_BACKUP), priority: 2 },
        ])
      : new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
      const painters = [...new Set(quotaEntries.map(d => d.id.replace('quota:', '')))];

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
            reconciled++;
          } catch (e) {
            console.error(`[execute-pending-purges] quota reconcile failed for ${painter}`, e);
            reconcileErrors++;
          }
        }));
      }
    }

    // Dans tous les cas, les entrées traitées sont retirées de pending_purges
    const allIds = due.map(d => d.id);
    const { error: cleanErr } = await supabase.from('pending_purges').delete().in('id', allIds);
    if (cleanErr) throw cleanErr;

    return new Response(
      JSON.stringify({
        purged: toPurge.length,
        abandoned_due_to_reorg: abandoned.length,
        reconciled,
        reconcile_errors: reconcileErrors,
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error("execute-pending-purges error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
