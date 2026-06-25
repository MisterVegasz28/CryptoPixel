import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const CANVAS_W = 32000;
const CANVAS_H = 31250;
const REPLAY_WINDOW_SEC = 300;

// ── Config blockchain (RPC direct pour le solde) ────────────────────────────
const RPC_URL = "https://rpc-amoy.polygon.technology";
const CONTRACT_ADDRESS = "0xbDbe95617A775D7291424262B59FDa7961cd948D"; // contrat V4
const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];
const LOCKED_PREMINE_ABI = ["function lockedPremine(address account) view returns (uint256)"];
const AIRDROP_ABI = ["function isAirdropUnlocked() view returns (bool)"];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// CORRECTION CRITIQUE : la signature commite désormais sur x,y directement
// (et non sur un "id" fourni par le client), pour garantir que ce qui est
// signé correspond exactement à ce qui sera écrit en base.
// ⚠️ Le front doit construire le pixelHash de la même façon avant signature.
const buildExpectedMessage = (
  address: string,
  pixels: { x: number; y: number; color: string }[],
  timestamp: number
) => {
  const pixelHash = pixels
    .map(p => `${p.x},${p.y}:${p.color}`)
    .sort()
    .join(",");
  return `CryptoPixel paint\naddress:${address.toLowerCase()}\npixels:${pixelHash}\nt:${timestamp}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { address, pixels, signature, timestamp } = await req.json();

    // ── Validation de base ────────────────────────────────────────────────────
    if (!address || !pixels?.length || !signature || !timestamp) {
      throw new Error("Paramètres manquants");
    }
    if (pixels.length > 500) {
      throw new Error("Trop de pixels en une seule requête (max 500)");
    }

    const painter = address.toLowerCase();

    // ── Vérification des bornes + normalisation de l'id ──────────────────────
    // CORRECTION CRITIQUE : l'id n'est JAMAIS pris depuis le client, il est
    // toujours recalculé depuis x,y. Avant ce fix, un id client arbitraire
    // pouvait créer deux lignes offchain_canvas pour le même (x,y), faussant
    // le compteur de pixels possédés (et donc le calcul du déficit/sacrifice).
    for (const p of pixels) {
      if (p.x < 0 || p.x >= CANVAS_W || p.y < 0 || p.y >= CANVAS_H) {
        throw new Error(`Pixel hors limites: (${p.x}, ${p.y})`);
      }
      p.id = `${p.x}-${p.y}`;
    }

    // ── Anti-replay : timestamp < 5 min ──────────────────────────────────────
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > REPLAY_WINDOW_SEC) {
      throw new Error("Signature expirée, veuillez réessayer");
    }

    // ── Vérification de la signature ─────────────────────────────────────────
    const expectedMessage = buildExpectedMessage(painter, pixels, timestamp);
    try {
      const recovered = ethers.verifyMessage(expectedMessage, signature);
      if (recovered.toLowerCase() !== painter) {
        throw new Error("L'adresse récupérée ne correspond pas au signataire");
      }
    } catch (err) {
      // Intercepte les erreurs mathématiques ou les signatures totalement corrompues
      throw new Error("Signature cryptographique invalide ou corrompue");
    }

    // ── Supabase ──────────────────────────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── Solde PAINT — RPC direct sur la blockchain (plus de dépendance Ponder) ─
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const balanceContract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
    const lockedContract  = new ethers.Contract(CONTRACT_ADDRESS, LOCKED_PREMINE_ABI, provider);
    const airdropContract = new ethers.Contract(CONTRACT_ADDRESS, AIRDROP_ABI, provider);

    const [balanceWei, lockedWei, airdropUnlocked] = await Promise.all([
      balanceContract.balanceOf(painter),
      lockedContract.lockedPremine(painter),
      airdropContract.isAirdropUnlocked(),
    ]);

    // Balance utilisable = balance totale - tokens verrouillés (si airdrop pas encore débloqué)
    const usableWei = airdropUnlocked
      ? balanceWei
      : (balanceWei > lockedWei ? balanceWei - lockedWei : 0n);
    const usableTokens = Number(usableWei / 1000000000000000000n);

    // ── Vérification pixels gelés — via table Ponder `pixel` (rapide) ─────────
    const pixelIds = pixels.map(p => p.id);
    const { data: frozenPixels, error: frozenError } = await supabase
     .from('pixel')
     .select('id, owner')
     .in('id', pixelIds);

    const frozenMap = new Map((frozenPixels || []).map(p => [p.id, p.owner.toLowerCase()]));
const blockedPixels: string[] = [];
const normalPixels: typeof pixels = [];

for (const p of pixels) {
  const frozenOwner = frozenMap.get(p.id);
  if (frozenOwner) {
    blockedPixels.push(p.id); // frozen = bloqué pour tout le monde, sans exception
  } else {
    normalPixels.push(p);
  }
}


    if (blockedPixels.length > 0) {
      throw new Error(`Pixel(s) gelé(s) par quelqu'un d'autre — non modifiables : ${blockedPixels.join(", ")}`);
    }

    // ── Calcul du coût et Sacrifice (Auto-delete des plus anciens) ────────────
    if (normalPixels.length > 0) {
      const normalIds = normalPixels.map(p => p.id);

        const [{ data: ownedRows, error: ownedError }, { data: alreadyOwned }, { data: allFrozenByPainter, error: frozenByPainterError }] = await Promise.all([
        supabase
          .from('offchain_canvas')
          .select('id')
          .eq('painter', painter),
        supabase
          .from('offchain_canvas')
          .select('id')
          .in('id', normalIds)
          .eq('painter', painter),
        supabase
          .from('pixel')
          .select('id, x, y')
          .eq('owner', painter),
      ]);
      if (ownedError) throw ownedError;
      if (frozenByPainterError) throw frozenByPainterError;

      const frozenIdSet = new Set(
  (allFrozenByPainter || []).map(p => p.id ?? `${p.x}-${p.y}`)
  );

// Pixels déjà possédés par ce painter (hors frozen)
const effectiveOwned = (ownedRows || []).filter(r => !frozenIdSet.has(r.id)).length;

// Parmi les pixels envoyés, combien remplacent un pixel d'un AUTRE painter
// (donc coûtent un token, même si la ligne existe déjà en base)
    const repaintOwnPixels = new Set((alreadyOwned || []).map(r => r.id));
    const newPixels = normalPixels.filter(p => !repaintOwnPixels.has(p.id)).length;

// Total après l'opération = ce qu'on possède déjà + les vraiment nouveaux
const totalRequired = effectiveOwned + newPixels;

      // Logique de Sacrifice : Si pas assez de jetons, on supprime les plus anciens
      if (usableTokens < totalRequired) {
        const deficit = totalRequired - usableTokens;

        const { data: candidates, error: fetchDeleteError } = await supabase
          .from('offchain_canvas')
          .select('id')
          .eq('painter', painter)
          .order('updated_at', { ascending: true }) // Les plus vieux d'abord (FIFO)
          .limit(deficit + frozenIdSet.size + 50); // marge pour compenser le filtrage

        if (fetchDeleteError) throw fetchDeleteError;

        const sacrificeable = (candidates || []).filter(p => 
         !frozenIdSet.has(p.id) && !repaintOwnPixels.has(p.id)
        );
        
        console.log(`[debug2] deficit=${deficit} sacrificeable=${sacrificeable.length} frozenIdSet=${frozenIdSet.size}`);

        if (sacrificeable.length < deficit) {
          throw new Error(
            `Solde PAINT insuffisant. Vous avez ${usableTokens} token(s) utilisable(s) ` +
            `et ${frozenIdSet.size} pixel(s) gelé(s) (protégés), mais essayez de posséder ` +
            `${totalRequired} pixel(s) au total.`
          );
        }

        const toDelete = sacrificeable.slice(0, deficit);

        if (toDelete.length > 0) {
          const idsToDelete = toDelete.map(p => p.id);
          const { error: delError } = await supabase
            .from('offchain_canvas')
            .delete()
            .in('id', idsToDelete);

          if (delError) throw delError;
        }
      }
    }

    // ── Upsert ────────────────────────────────────────────────────────────────
    const allToUpsert = normalPixels;
    const { error: upsertError } = await supabase
      .from('offchain_canvas')
      .upsert(allToUpsert.map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        color: p.color,
        painter,
        updated_at: timestamp,
      })));
    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error("paint-pixels error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});