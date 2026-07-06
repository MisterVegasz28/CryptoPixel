import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { ethers } from "npm:ethers@6.11.1"
const RPC_URL          = Deno.env.get('RPC_URL')          ?? 'https://rpc-amoy.polygon.technology';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { address } = await req.json();
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("Adresse invalide");
    }
    const painter = address.toLowerCase();
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    // Lecture directe on-chain — c'est TOUJOURS la vraie source de vérité,
    // jamais une valeur envoyée par le client.
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
    const [balanceWei, lockedWei] = await Promise.all([
      contract.balanceOf(painter),
      contract.lockedPremine(painter),
    ]);

    const { data: ok } = await supabase.rpc('bump_rate_limit', {
  p_address: `quota:${painter}`,
  p_window_ms: 60000,
  p_max: 20, // plus permissif que paint-pixels si besoin, à ajuster
});
if (!ok) {
  throw new Error("Trop de requêtes, réessayez dans quelques instants.");
}

    const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
    const usableTokens = Number(usableWei / 1000000000000000000n);
    
    const { data, error } = await supabase.rpc('enforce_quota_atomic', {
      p_painter: painter,
      p_usable_tokens: usableTokens,
    });
    if (error) throw error;
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
  } catch (error) {
    console.error("enforce-pixel-quota error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});