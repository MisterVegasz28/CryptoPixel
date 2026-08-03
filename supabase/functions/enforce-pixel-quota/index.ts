import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { getClientIp } from "../_shared/security.ts";

const RPC_URL = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
];

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
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o: string) => o.trim());
const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

const RECEIPT_RETRY_ATTEMPTS = 3;
const RECEIPT_RETRY_DELAY_MS = 2000;
const MIN_CONFIRMATIONS = Number(Deno.env.get('MIN_CONFIRMATIONS') ?? '2');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getReceiptWithRetry(txHash: string): Promise<ethers.TransactionReceipt | null> {
  for (let attempt = 1; attempt <= RECEIPT_RETRY_ATTEMPTS; attempt++) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;
      if (confirmations >= MIN_CONFIRMATIONS) return receipt;
      // Miné mais pas encore assez confirmé — on retente au lieu d'accepter tout de suite.
    }
    if (attempt < RECEIPT_RETRY_ATTEMPTS) await sleep(RECEIPT_RETRY_DELAY_MS);
  }
  return null;
}

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

    const receipt = await getReceiptWithRetry(txHash);
    if (!receipt) {
      throw new Error("Transaction not found, not yet mined, or not yet confirmed — please retry in a few seconds.");
    }
    if (receipt.status !== 1) {
      throw new Error("Transaction reverted");
    }

    // Fix : borne de fraîcheur sur la tx, EN PLUS de la vérif from/to.
    // Sans signature EIP-712 dédiée sur cet endpoint (mauvais compromis UX vu la
    // fréquence d'appel), on ferme la fenêtre d'abus "txHash d'une adresse tierce
    // trouvé sur l'explorateur" en exigeant que la tx soit fraîche : un attaquant
    // devrait alors réagir en temps quasi réel à CHAQUE tx de la victime, comme
    // le flux légitime (appelé automatiquement juste après confirmation).
    const ENFORCE_TX_FRESHNESS_SEC = 300; // large marge vs les ~qqs secondes du flux normal
    const txBlock = await provider.getBlock(receipt.blockNumber);
    if (!txBlock || Math.abs(Math.floor(Date.now() / 1000) - Number(txBlock.timestamp)) > ENFORCE_TX_FRESHNESS_SEC) {
      throw new Error("Transaction too old to trigger enforcement.");
    }

    if (receipt.from.toLowerCase() !== painter) {
      throw new Error("Transaction sender mismatch (You did not send this transaction)");
    }
    if (receipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
      throw new Error("Invalid target contract");
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fix : anti-replay vérifié EN PREMIER, avant de consommer le rate-limit
    // global. Un txHash déjà traité (retry frontend, double-clic, etc.) ne
    // doit pas taxer le budget partagé entre tous les utilisateurs.
    const { error: sigError } = await supabase
      .from('used_signatures')
      .insert({ signature_hash: txHash });

    if (sigError) {
      if (sigError.code === '23505') {
        throw new Error("This transaction has already been processed.");
      }
      throw sigError;
    }

    const clientIp = getClientIp(req);
    const { data: ipOk } = await supabase.rpc('bump_rate_limit', {
      p_address: `ip:${clientIp}:enforce`,
      p_window_ms: 60000,
      p_max: 30,
    });
    if (!ipOk) {
      throw new Error("Too many requests from this network, please retry in a moment.");
    }

    const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
      p_address: 'quota:global:enforce',
      p_window_ms: 60000,
      p_max: 500,
    });
    if (!globalOk) {
      throw new Error("Service temporarily busy, please retry in a moment.");
    }

    const { data: ok } = await supabase.rpc('bump_rate_limit', {
      p_address: `quota:${painter}`,
      p_window_ms: 60000,
      p_max: 20,
    });
    if (!ok) {
      throw new Error("Too many requests, retry in a few moments.");
    }

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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("enforce-pixel-quota error:", errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});