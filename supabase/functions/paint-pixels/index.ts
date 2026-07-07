import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const CANVAS_W = Number(Deno.env.get('CANVAS_WIDTH')  ?? '32000');
const CANVAS_H = Number(Deno.env.get('CANVAS_HEIGHT') ?? '31250');
const REPLAY_WINDOW_SEC = 300;

const RPC_URL          = Deno.env.get('RPC_URL');
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim());

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
  const origin = req.headers.get('origin') ?? '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { address, pixels, signature, timestamp } = await req.json();

    if (!address || !pixels?.length || !signature || !timestamp) {
      throw new Error("Paramètres manquants");
    }
    if (pixels.length > 500) {
      throw new Error("Trop de pixels en une seule requête (max 500)");
    }

    const painter = address.toLowerCase();

    for (const p of pixels) {
      if (p.x < 0 || p.x >= CANVAS_W || p.y < 0 || p.y >= CANVAS_H) {
        throw new Error(`Pixel hors limites: (${p.x}, ${p.y})`);
      }
      p.id = `${p.x}-${p.y}`;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > REPLAY_WINDOW_SEC) {
      throw new Error("Signature expirée, veuillez réessayer");
    }

    const expectedMessage = buildExpectedMessage(painter, pixels, timestamp);
    try {
      const recovered = ethers.verifyMessage(expectedMessage, signature);
      if (recovered.toLowerCase() !== painter) {
        throw new Error("L'adresse récupérée ne correspond pas au signataire");
      }
    } catch (err) {
      throw new Error("Signature cryptographique invalide ou corrompue");
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: ok } = await supabase.rpc('bump_rate_limit', {
      p_address: `paint:${painter}`,
      p_window_ms: 60000,
      p_max: 60,
    });
    if (!ok) {
      throw new Error("Trop de requêtes, réessayez dans quelques instants.");
    }

    const seenIds = new Set<string>();
    const dedupedPixels: typeof pixels = [];
    for (const p of pixels) {
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      dedupedPixels.push(p);
    }
    pixels.length = 0;
    pixels.push(...dedupedPixels);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const balanceContract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

    const [balanceWei, lockedWei] = await Promise.all([
      balanceContract.balanceOf(painter),
      balanceContract.lockedPremine(painter),
    ]);

    const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
    const usableTokens = Number(usableWei / 1000000000000000000n);

    const pixelIds = pixels.map(p => p.id);
    const { data: frozenPixels, error: frozenError } = await supabase
      .from('pixel')
      .select('id, owner')
      .in('id', pixelIds);

    if (frozenError) throw frozenError;

    const frozenMap = new Map((frozenPixels || []).map(p => [p.id, p.owner.toLowerCase()]));
    const blockedPixels: string[] = [];
    const normalPixels: typeof pixels = [];

    for (const p of pixels) {
      if (frozenMap.has(p.id)) {
        blockedPixels.push(p.id);
      } else {
        normalPixels.push(p);
      }
    }

    if (blockedPixels.length > 0) {
      throw new Error(`Pixel(s) gelé(s) par quelqu'un d'autre — non modifiables : ${blockedPixels.join(", ")}`);
    }

    const { error: rpcError } = await supabase.rpc('paint_pixels_atomic', {
      p_painter: painter,
      p_pixels: normalPixels,
      p_usable_tokens: usableTokens,
      p_signature_hash: signature,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("SIGNATURE_ALREADY_USED")) {
        throw new Error("Cette signature a déjà été utilisée, veuillez réessayer.");
      }
      if (msg.includes("FROZEN_PIXELS")) {
        throw new Error("Un ou plusieurs pixels viennent d'être gelés par quelqu'un d'autre, réessayez.");
      }
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        throw new Error("Solde PAINT insuffisant pour cette opération.");
      }
      throw new Error(msg);
    }

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