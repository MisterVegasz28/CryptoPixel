import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

const CANVAS_W = Number(Deno.env.get('CANVAS_WIDTH')  ?? '32000');
const CANVAS_H = Number(Deno.env.get('CANVAS_HEIGHT') ?? '31250');
const REPLAY_WINDOW_SEC = 300
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

// Doit rester STRICTEMENT en sync avec COLOR_PALETTE côté indexer (canvas-slice-binary)
// et src/constants/palette.ts côté frontend — même ordre, même casse ignorée.
const COLOR_PALETTE = [
  '#8c00ff', '#7300ff', '#4c00ff',
  '#1500ff', '#0044ff', '#00f2ff',
  '#03ffc4', '#00ff08', '#abff66',
  '#fffb00', '#ff9327', '#ff7300',
  '#ff0000', '#ff00c8', '#ea00ff',
  '#ffffff', '#c2c2c2', '#757575', '#383838', '#202020', '#000000',
  '#ab5236', '#5f2f1d',
  '#006012', '#5e0101', '#090069', '#610069',
  '#e5baff', '#ffb3ba', '#ffffba', '#baffc9', '#bae1ff',
];
const COLOR_INDEX = new Map(COLOR_PALETTE.map((c, i) => [c, i]));

const RPC_URL          = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP    = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim());

// Typage des pixels pour éviter l'erreur "implicit any" plus bas
interface Pixel {
  id?: string;
  x: number;
  y: number;
  color: string;
}

const buildExpectedMessage = (
  address: string,
  pixels: Pixel[],
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
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  ...(isAllowedOrigin ? { 'Access-Control-Allow-Origin': origin } : {}),
};

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { address, pixels, signature, timestamp } = await req.json();

    if (!address || !pixels?.length || !signature || !timestamp) {
      throw new Error("Paramètres manquants");
    }
    if (!Number.isInteger(timestamp)) {
      throw new Error("Invalid timestamp");
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("Invalid address format");
    }
    if (pixels.length > 500) {
      throw new Error("Too many pixels in a single request (max 500)");
    }

    const painter = address.toLowerCase();

    for (const p of pixels) {
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
        throw new Error("Pixel coordinates are invalid");
      }
      if (p.x < 0 || p.x >= CANVAS_W || p.y < 0 || p.y >= CANVAS_H) {
        throw new Error(`Pixel out of bounds: (${p.x}, ${p.y})`);
      }
      if (typeof p.color !== 'string' || !COLOR_REGEX.test(p.color)) {
        throw new Error(`Invalid pixel color: ${p.color}`);
      }
      if (!COLOR_INDEX.has(p.color.toLowerCase())) {
        throw new Error(`Color not in palette: ${p.color}`);
      }
      p.id = `${p.x}-${p.y}`;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > REPLAY_WINDOW_SEC) {
      throw new Error("Signature expired, please try again");
    }

    const expectedMessage = buildExpectedMessage(painter, pixels, timestamp);
    try {
      const recovered = ethers.verifyMessage(expectedMessage, signature);
      if (recovered.toLowerCase() !== painter) {
        throw new Error("The recovered address does not match the signer");
      }
    } catch (err) {
      // Correction ESLint : passage de 'err' en tant que 'cause'
      throw new Error("Invalid or corrupted cryptographic signature", { cause: err });
    }

    const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);
// Client dédié pour les vues Ponder (schema stable, indépendant du
// schema de déploiement qui change à chaque redéploiement Railway).
const supabasePonder = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { db: { schema: 'ponder_public' } }
);

    const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
      p_address: 'quota:global',
      p_window_ms: 60000,
      p_max: 500,
    });
      if (!globalOk) {
      throw new Error("Service temporarily busy, please retry in a moment.");
    }

    const { data: ok } = await supabase.rpc('bump_rate_limit', {
      p_address: `paint:${painter}`,
      p_window_ms: 60000,
      p_max: 60,
    });
    if (!ok) {
      throw new Error("Too many requests, retry in a few moments.");
    }

    const { data: alreadyUsed } = await supabase
      .from('used_signatures')
      .select('signature_hash')
      .eq('signature_hash', signature)
      .maybeSingle();
    if (alreadyUsed) {
      throw new Error("This signature has already been used, please try again.");
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
  
    const balanceContract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

    // Typage strict bigint pour la division
    const [balanceWei, lockedWei] = (await Promise.all([
      balanceContract.balanceOf(painter),
      balanceContract.lockedPremine(painter),
    ])) as [bigint, bigint];

    const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
    const usableTokens = Number(usableWei / 1000000000000000000n);

    const pixelIds = pixels.map((p: Pixel) => p.id);
const { data: frozenPixels, error: frozenError } = await supabasePonder
  .from('pixel')
  .select('id, owner')
  .in('id', pixelIds);

    if (frozenError) throw frozenError;

    const frozenMap = new Map((frozenPixels || []).map(p => [p.id, p.owner.toLowerCase()]));
    const blockedPixels: string[] = [];
    const normalPixels: typeof pixels = [];

    for (const p of pixels) {
      if (frozenMap.has(p.id)) {
        blockedPixels.push(p.id as string);
      } else {
        normalPixels.push(p);
      }
    }

    if (blockedPixels.length > 0) {
      throw new Error(`Pixel frozen by someone else — not changeable : ${blockedPixels.join(", ")}`);
    }

    const normalPixelsForDb = normalPixels.map(p => ({
      ...p,
      color: COLOR_INDEX.get(p.color.toLowerCase())!, // hex -> smallint, cf. migration offchain_canvas.color
    }));

    const { error: rpcError } = await supabase.rpc('paint_pixels_atomic', {
      p_painter: painter,
      p_pixels: normalPixelsForDb,
      p_usable_tokens: usableTokens,
      p_signature_hash: signature,
    });

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("SIGNATURE_ALREADY_USED")) {
        throw new Error("This signature has already been used, please try again.");
      }
      if (msg.includes("FROZEN_PIXELS")) {
        throw new Error("One or more pixels have been frozen by someone else, please try again.");
      }
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        throw new Error("Insufficient PAINT balance for this operation.");
      }
      throw new Error(msg);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    // Cast propre de l'erreur pour la console et le retour JSON
    const errorMessage = error instanceof Error
      ? error.message
      : (error && typeof error === 'object' && 'message' in error)
        ? String((error as { message: unknown }).message)
        : String(error);
    console.error("paint-pixels error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});