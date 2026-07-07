import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const RPC_URL = Deno.env.get('RPC_URL');
const REORG_SAFETY_BLOCKS = BigInt(Deno.env.get('REORG_SAFETY_BLOCKS') ?? '20');
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

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
    const currentBlock = BigInt(await provider.getBlockNumber());
    const safeBlock = currentBlock > REORG_SAFETY_BLOCKS ? currentBlock - REORG_SAFETY_BLOCKS : 0n;

    const { data: due, error } = await supabase
      .from('pending_purges')
      .select('id')
      .lte('block_number', Number(safeBlock))
      .limit(500);

    if (error) throw error;
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ purged: 0 }), { status: 200 });
    }

    const ids = due.map(d => d.id);

    // Double-check : le pixel doit TOUJOURS être frozen à l'exécution.
    // Si un reorg a invalidé le freeze entre-temps, l'entrée n'existe
    // plus dans `pixel` (corrigé par Ponder) — on abandonne la purge
    // au lieu de supprimer à tort un pixel jamais réellement frozen.
    const { data: stillFrozen, error: checkErr } = await supabase
      .from('pixel')
      .select('id')
      .in('id', ids);
    if (checkErr) throw checkErr;

    const confirmedIds = new Set((stillFrozen || []).map(p => p.id));
    const toPurge = ids.filter(id => confirmedIds.has(id));
    const abandoned = ids.filter(id => !confirmedIds.has(id));

    if (toPurge.length > 0) {
      const { error: delErr } = await supabase.from('offchain_canvas').delete().in('id', toPurge);
      if (delErr) throw delErr;
    }

    // Dans tous les cas, l'entrée pending_purges est traitée (purgée ou abandonnée)
    const { error: cleanErr } = await supabase.from('pending_purges').delete().in('id', ids);
    if (cleanErr) throw cleanErr;

    return new Response(
      JSON.stringify({ purged: toPurge.length, abandoned_due_to_reorg: abandoned.length }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error("execute-pending-purges error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
