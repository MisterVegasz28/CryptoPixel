import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

const RPC_URL          = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP    = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o: string) => o.trim());

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const { address, signature, timestamp } = await req.json();
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address) || !signature || !timestamp) {
      throw new Error("Missing or invalid parameters");
    }
    const painter = address.toLowerCase();

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) {
      throw new Error("Signature expired");
    }

    const message = `CryptoPixel enforce-quota\naddress:${painter}\nt:${timestamp}`;
    try {
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== painter) {
        throw new Error("The recovered address does not match the signer");
      }
    } catch (err) {
      // Correction ESLint : on utilise 'err' en tant que cause
      throw new Error("Invalid or corrupted cryptographic signature", { cause: err });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Rate-limit GLOBAL
    const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
      p_address: 'quota:global',
      p_window_ms: 60000,
      p_max: 500,
    });
    if (!globalOk) {
      throw new Error("Service temporarily busy, please retry in a moment.");
    }

    const { error: sigError } = await supabase
      .from('used_signatures')
      .insert({ signature_hash: signature });
    if (sigError) {
      if (sigError.code === '23505') {
        throw new Error("This signature has already been used, please try again.");
      }
      throw sigError;
    }

    const { data: ok } = await supabase.rpc('bump_rate_limit', {
      p_address: `quota:${painter}`,
      p_window_ms: 60000,
      p_max: 20,
    });
    if (!ok) {
      throw new Error("Too many requests, retry in a few moments.");
    }

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
  
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
    
    // Correction Type BigInt strict
    const [balanceWei, lockedWei] = (await Promise.all([
      contract.balanceOf(painter),
      contract.lockedPremine(painter),
    ])) as [bigint, bigint];

    const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
    const usableTokens = Number(usableWei / 1000000000000000000n);

    const { data, error } = await supabase.rpc('enforce_quota_atomic', {
      p_painter: painter,
      p_usable_tokens: usableTokens,
    });
    if (error) throw error;
    
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    
  } catch (error) {
    // Correction Type Unknown pour récupérer le message de l'erreur
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("enforce-pixel-quota error:", errorMessage);
    
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});