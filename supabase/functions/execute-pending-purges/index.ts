import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { timingSafeEqual } from "../_shared/security.ts";

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
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return new Response('Unauthorized', { status: 401 });
  }
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: gotLock } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: 'execute-pending-purges',
      p_ttl_seconds: 120,
    });
    if (!gotLock) {
      return new Response(JSON.stringify({ skipped: true, reason: 'already running' }), { status: 200 });
    }

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
  
    const currentBlock = BigInt(await provider.getBlockNumber());
    const safeBlock = currentBlock > REORG_SAFETY_BLOCKS ? currentBlock - REORG_SAFETY_BLOCKS : 0n;

    const { data: due, error } = await supabase
      .from('pending_purges')
      .select('id, reason')
      .lte('block_number', Number(safeBlock))
      .limit(500);

    if (error) throw error;
    if (!due || due.length === 0) {
      await supabase.rpc('release_cron_lock', { p_job_name: 'execute-pending-purges' });
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
        const { data: purgeResult, error: delErr } = await supabase.rpc('purge_frozen_pixels_atomic', {
          p_ids: toPurge,
        });
        if (delErr) throw delErr;
        toPurge = purgeResult?.purged ?? [];
      }
    }

    // ── Reconciliation quota (solde recalculé maintenant, pas au block de l'event) ──
    let reconciled = 0;
    let reconcileErrors = 0;
    const failedPainters = new Set<string>();
    if (quotaEntries.length > 0) {

      const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
      const painters = [...new Set(quotaEntries.map(d => d.id.replace('quota:', '')))];

      for (let i = 0; i < painters.length; i += CONCURRENCY) {
        const batch = painters.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (painter) => {
          try {
            // Typage explicite du tableau en bigint
            const [balanceWei, lockedWei] = (await Promise.all([
              contract.balanceOf(painter),
              contract.lockedPremine(painter),
            ])) as [bigint, bigint];
            
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
            failedPainters.add(painter);
          }
        }));
      }
    }

    // On ne retire de pending_purges que ce qui a été traité avec succès :
    // freeze purgées/abandonnées (reorg) + quota reconciliés. Les échecs
    // de reconciliation restent en file pour être retentés au prochain run.
    const successfulQuotaIds = quotaEntries
      .filter(d => !failedPainters.has(d.id.replace('quota:', '')))
      .map(d => d.id);
    const idsToDelete = [...toPurge, ...abandoned, ...successfulQuotaIds];
    if (idsToDelete.length > 0) {
      const { error: cleanErr } = await supabase.from('pending_purges').delete().in('id', idsToDelete);
      if (cleanErr) throw cleanErr;
    }

    await supabase.rpc('release_cron_lock', { p_job_name: 'execute-pending-purges' });

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
    // Vérification du type d'erreur pour éviter TS 18046
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("execute-pending-purges error:", errorMessage);
    
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await supabase.rpc('release_cron_lock', { p_job_name: 'execute-pending-purges' });
    } catch { 
      /* Suppression du paramètre _ inutilisé (best effort) */ 
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
});