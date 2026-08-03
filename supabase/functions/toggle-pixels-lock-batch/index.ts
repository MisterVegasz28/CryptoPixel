
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { getClientIp } from "../_shared/security.ts";

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim());
const CANVAS_W = Number(Deno.env.get('CANVAS_WIDTH') ?? '32000');
const CANVAS_H = Number(Deno.env.get('CANVAS_HEIGHT') ?? '31250');

const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS');
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set — refusing to start");
const CHAIN_ID = Number(Deno.env.get('CHAIN_ID'));
if (!CHAIN_ID) throw new Error("CHAIN_ID is not set — refusing to start");
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set — refusing to start");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — refusing to start");

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    ...(isAllowedOrigin ? { 'Access-Control-Allow-Origin': origin } : {}),
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { address, pixelIds, locked, signature, timestamp } = await req.json();

    if (!address || !Array.isArray(pixelIds) || pixelIds.length === 0 || typeof locked !== 'boolean' || !signature || !timestamp) {
      throw new Error("Parameters missing");
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("Invalid address format");
    }
    if (pixelIds.length > 500) {
      throw new Error("Too many pixels in a single request (max 500)");
    }

    const ID_REGEX = /^(\d+)-(\d+)$/;
    for (const id of pixelIds) {
      if (typeof id !== 'string') {
        throw new Error(`Invalid pixel id: ${id}`);
      }
      const match = id.match(ID_REGEX);
      if (!match) {
        throw new Error(`Invalid pixel id format: ${id}`);
      }
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (x < 0 || x >= CANVAS_W || y < 0 || y >= CANVAS_H) {
        throw new Error(`Pixel out of bounds: ${id}`);
      }
    }

    const painter = address.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) throw new Error("Signature expired");

    const domain = { name: 'CryptoPixel', version: '1', chainId: CHAIN_ID, verifyingContract: CONTRACT_ADDRESS };
    const types = {
      LockBatch: [
        { name: 'painter', type: 'address' },
        { name: 'pixelIds', type: 'string[]' },
        { name: 'locked', type: 'bool' },
        { name: 'timestamp', type: 'uint256' },
      ],
    };
    const value = { painter, pixelIds, locked, timestamp };
    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(domain, types, value, signature);
    } catch (err) {
      throw new Error("Invalid or corrupted cryptographic signature", { cause: err });
    }

    if (recovered.toLowerCase() !== painter) throw new Error("Invalid signature");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { error: sigError } = await supabase
      .from('used_signatures')
      .insert({ signature_hash: signature });
    if (sigError) {
      if (sigError.code === '23505') throw new Error("This signature has already been used, please try again.");
      throw sigError;
    }

    // Fix : rate-limit par IP ajouté, manquant ici alors que présent sur
    // confirm-freeze/enforce-pixel-quota. Une signature reste limitée par
    // wallet, mais sans ce garde-fou une seule IP contrôlant plusieurs
    // wallets pouvait consommer une part disproportionnée du budget
    // partagé quota:global (500/min) — même raisonnement que les autres
    // endpoints signés.
    const clientIp = getClientIp(req);
    const { data: ipOk } = await supabase.rpc('bump_rate_limit', {
      p_address: `ip:${clientIp}:lock-batch`, p_window_ms: 60000, p_max: 30,
    });
    if (!ipOk) throw new Error("Too many requests from this network, please retry in a moment.");

    const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
      p_address: 'quota:global', p_window_ms: 60000, p_max: 500,
    });
    if (!globalOk) throw new Error("Service temporarily busy, please retry in a moment.");

    const { data: rateOk } = await supabase.rpc('bump_rate_limit', {
      p_address: `lock:${painter}`, p_window_ms: 60000, p_max: 30,
    });
    if (!rateOk) throw new Error("Too many requests, retry in a few moments.");

    // Mise à jour de la base de données
    const { data, error } = await supabase
      .from('offchain_canvas')
      .update({ is_locked: locked })
      .eq('painter', painter)
      .in('id', pixelIds)
      .select('id');

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, updated: data?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("lock-pixels error:", errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});