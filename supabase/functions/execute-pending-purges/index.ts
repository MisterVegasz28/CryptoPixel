import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { timingSafeEqual } from "../_shared/security.ts";
import { fetchBalancesMulticall } from "../_shared/multicall.ts";

const RPC_URL = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP = Deno.env.get('RPC_URL_BACKUP') ?? '';
const REORG_SAFETY_BLOCKS = BigInt(Deno.env.get('REORG_SAFETY_BLOCKS') ?? '20');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const CONCURRENCY = 10;
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
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
const supabasePonder = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { db: { schema: 'ponder_public' } }
);

interface PendingPurgeRow {
  id: string;
  reason: string;
  block_number: number;
  attempts: number;
}

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
      p_job_name: 'execute-pending-purges',
      p_ttl_seconds: 120,
    });
    if (lockError) throw lockError;
    if (!gotLock) {
      return new Response(JSON.stringify({ skipped: true, reason: 'already running' }), { status: 200 });
    }

    const currentBlock = BigInt(await provider.getBlockNumber());
    const safeBlock = currentBlock > REORG_SAFETY_BLOCKS ? currentBlock - REORG_SAFETY_BLOCKS : 0n;
    const { data: due, error } = await supabase
      .from('pending_purges')
      .select('id, reason, block_number, attempts')
      .lte('block_number', Number(safeBlock))
      .limit(500)
      .returns<PendingPurgeRow[]>();

    if (error) throw error;
    if (!due || due.length === 0) {
      await supabase.rpc('release_cron_lock', { p_job_name: 'execute-pending-purges' });
      return new Response(JSON.stringify({ purged: 0, reconciled: 0 }), { status: 200 });
    }

    const freezeEntries = due.filter(d => d.reason !== 'quota_cleanup');
    const quotaEntries = due.filter(d => d.reason === 'quota_cleanup');

    // Nombre de cycles avant d'abandonner définitivement un id "pas encore
    // vu" dans ponder_public.pixel. Laisse le temps à l'indexer de rattraper
    // un backfill ou un redeploy Railway au lieu de conclure trop vite.
    const MAX_ABANDON_ATTEMPTS = 3;

    // ── Purges de freeze ───────────────────────────────────────────────────
    let toPurge: string[] = [];
    let abandoned: string[] = [];
    if (freezeEntries.length > 0) {
      const freezeIds = freezeEntries.map(d => d.id);
      const { data: stillFrozen, error: checkErr } = await supabasePonder
        .from('pixel')
        .select('id')
        .in('id', freezeIds);
      if (checkErr) throw checkErr;

      const confirmedIds = new Set((stillFrozen || []).map(p => p.id));
      toPurge = freezeIds.filter(id => confirmedIds.has(id));
      const notYetConfirmed = freezeEntries.filter(d => !confirmedIds.has(d.id));

      if (toPurge.length > 0) {
        const { data: purgeResult, error: delErr } = await supabase.rpc('purge_frozen_pixels_atomic', {
          p_ids: toPurge,
        });
        if (delErr) throw delErr;
        toPurge = purgeResult?.purged ?? [];
      }

      // Un id "pas encore vu" n'est abandonné qu'après plusieurs tentatives —
      // avant, il était retiré de pending_purges dès le premier échec, ce qui
      // pouvait laisser une ligne offchain_canvas fantôme permanente si
      // l'indexer avait simplement du retard.
      const stillPending: typeof notYetConfirmed = [];
      abandoned = [];
      for (const entry of notYetConfirmed) {
        const attempts = entry.attempts ?? 0;
        if (attempts + 1 >= MAX_ABANDON_ATTEMPTS) {
          abandoned.push(entry.id);
        } else {
          stillPending.push(entry);
        }
      }

      if (stillPending.length > 0) {
        await supabase
          .from('pending_purges')
          .upsert(
            stillPending.map(e => ({
              id: e.id,
              reason: e.reason,
              block_number: e.block_number,
              attempts: (e.attempts ?? 0) + 1,
            })),
            { onConflict: 'id' }
          );
      }
    }

    // ── Reconciliation quota (solde recalculé maintenant, pas au block de l'event) ──
    let reconciled = 0;
    let reconcileErrors = 0;
    const failedPainters = new Set<string>();
    if (quotaEntries.length > 0) {

      const painters = [...new Set(quotaEntries.map(d => d.id.replace('quota:', '')))];
      const balances = await fetchBalancesMulticall(painters, CONTRACT_ADDRESS, provider);
      for (let i = 0; i < painters.length; i += CONCURRENCY) {
        const batch = painters.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async (painter) => {
          try {
            const { balance: balanceWei, locked: lockedWei, ok } = balances.get(painter) ?? { balance: 0n, locked: 0n, ok: false };
            if (!ok) {
              console.warn(`[execute-pending-purges] balance read failed for ${painter}, skipping this cycle`);
              reconcileErrors++;
              failedPainters.add(painter);
              return;
            }
            const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
            const usableTokens = Number(usableWei / 1000000000000000000n);

            const { error: rpcError } = await supabase.rpc('cleanup_excess_pixels_atomic', {
              p_painter: painter,
              p_usable_tokens: usableTokens,
              p_extra_frozen_ids: [],
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
    const errorMessage = error instanceof Error
      ? error.message
      : (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : JSON.stringify(error);
    console.error("execute-pending-purges error:", errorMessage, error);

    try {
      await supabase.rpc('release_cron_lock', { p_job_name: 'execute-pending-purges' });
    } catch {
      /* best effort */
    }

    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
});
