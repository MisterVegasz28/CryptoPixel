import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim());
const CANVAS_W = Number(Deno.env.get('CANVAS_WIDTH')  ?? '32000');
const CANVAS_H = Number(Deno.env.get('CANVAS_HEIGHT') ?? '31250');

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { address, pixelIds, locked, signature, timestamp } = await req.json();
    if (!address || !Array.isArray(pixelIds) || pixelIds.length === 0 || typeof locked !== 'boolean' || !signature || !timestamp) {
      throw new Error("Parameters missing");
    }
    if (pixelIds.length > 500) throw new Error("Too many pixels in a single request (max 500)");

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

    const idsHash = [...pixelIds].sort().join(",");
    const message = `CryptoPixel lock-batch\naddress:${painter}\npixels:${idsHash}\nlocked:${locked}\nt:${timestamp}`;
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== painter) throw new Error("Invalid signature");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { error: sigError } = await supabase
      .from('used_signatures')
      .insert({ signature_hash: signature });
    if (sigError) {
      if (sigError.code === '23505') {
        throw new Error("This signature has already been used, please try again.");
      }
      throw sigError;
    }

    const { data: rateOk } = await supabase.rpc('bump_rate_limit', {
      p_address: `lock:${painter}`,
      p_window_ms: 60000,
      p_max: 30,
    });
    if (!rateOk) {
      throw new Error("Too many requests, retry in a few moments.");
    }

    const { data, error } = await supabase
      .from('offchain_canvas')
      .update({ is_locked: locked })
      .eq('painter', painter)
      .in('id', pixelIds)
      .select('id');

    if (error) throw error;

    return new Response(JSON.stringify({ success: true, updated: data?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
    });
  }
});