import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(o => o.trim());

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
      throw new Error("Paramètres manquants");
    }
    if (pixelIds.length > 500) throw new Error("Trop de pixels en une seule requête (max 500)");

    const painter = address.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) throw new Error("Signature expirée");

    const idsHash = [...pixelIds].sort().join(",");
    const message = `CryptoPixel lock-batch\naddress:${painter}\npixels:${idsHash}\nlocked:${locked}\nt:${timestamp}`;
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== painter) throw new Error("Signature invalide");

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: rateOk } = await supabase.rpc('bump_rate_limit', {
      p_address: `lock:${painter}`,
      p_window_ms: 60000,
      p_max: 30,
    });
    if (!rateOk) {
      throw new Error("Trop de requêtes, réessayez dans quelques instants.");
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