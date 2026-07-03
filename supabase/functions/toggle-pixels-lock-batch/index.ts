import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { address, pixelIds, locked, signature, timestamp } = await req.json();
    if (!address || !Array.isArray(pixelIds) || pixelIds.length === 0 || locked === undefined || !signature || !timestamp) {
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

    // Filtre .eq('painter', painter) : même si des ids étrangers sont
    // envoyés, seuls les pixels appartenant réellement au signataire
    // seront modifiés.
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