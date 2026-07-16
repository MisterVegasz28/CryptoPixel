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
  const isAllowedOrigin = ALLOWED_ORIGINS.includes(origin);
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    ...(isAllowedOrigin ? { 'Access-Control-Allow-Origin': origin } : {}),
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  
  try {
    const { address, txHash } = await req.json();
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address) || !txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error("Missing or invalid parameters");
    }
    const painter = address.toLowerCase();

    // 1. Initialiser le provider RPC en premier
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

    // 2. SÉCURITÉ : Vérification on-chain de la transaction (minée + réussie)
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error("Transaction not found or not yet mined");
    }
    if (receipt.status !== 1) {
      throw new Error("Transaction reverted");
    }
    if (receipt.from.toLowerCase() !== painter) {
      throw new Error("Transaction sender mismatch (You did not send this transaction)");
    }
    if (receipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
      throw new Error("Invalid target contract");
    }

    // 3. Initialiser Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 4. Rate-limit GLOBAL
    const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
      p_address: 'quota:global',
      p_window_ms: 60000,
      p_max: 500,
    });
    if (!globalOk) {
      throw new Error("Service temporarily busy, please retry in a moment.");
    }

    // 5. Anti-Replay : On recycle la table 'used_signatures' pour s'assurer que ce txHash n'est traité qu'une fois
    const { error: sigError } = await supabase
      .from('used_signatures')
      .insert({ signature_hash: txHash });
      
    if (sigError) {
      if (sigError.code === '23505') {
        throw new Error("This transaction has already been processed.");
      }
      throw sigError;
    }

    // 6. Rate-limit LOCAL
    const { data: ok } = await supabase.rpc('bump_rate_limit', {
      p_address: `quota:${painter}`,
      p_window_ms: 60000,
      p_max: 20,
    });
    if (!ok) {
      throw new Error("Too many requests, retry in a few moments.");
    }

    // 7. Calcul du nouveau quota avec le Contract
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
    
    const [balanceWei, lockedWei] = (await Promise.all([
      contract.balanceOf(painter),
      contract.lockedPremine(painter),
    ])) as [bigint, bigint];

    const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;
    const usableTokens = Number(usableWei / 1000000000000000000n);

    // 8. Mise à jour en base de données
    const { data, error } = await supabase.rpc('enforce_quota_atomic', {
      p_painter: painter,
      p_usable_tokens: usableTokens,
    });
    if (error) throw error;
    
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("enforce-pixel-quota error:", errorMessage);
    
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});