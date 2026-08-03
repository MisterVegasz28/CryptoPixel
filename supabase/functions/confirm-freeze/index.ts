import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { getClientIp } from "../_shared/security.ts";

const CONTRACT_ADDRESS = Deno.env.get('CONTRACT_ADDRESS') ?? '';
const RPC_URL = Deno.env.get('RPC_URL');
const RPC_URL_BACKUP = Deno.env.get('RPC_URL_BACKUP') ?? '';
const CANVAS_W = Number(Deno.env.get('CANVAS_WIDTH') ?? '32000');
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((o: string) => o.trim());
const MIN_CONFIRMATIONS = Number(Deno.env.get('MIN_CONFIRMATIONS') ?? '2');

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

const FREEZE_EVENTS_ABI = [
    "event PixelFrozen(uint32 indexed pixelId, address indexed owner, uint24 color)",
    "event BatchPixelFrozen(address indexed owner, uint32[] pixelIds, uint24[] colors)",
];
const iface = new ethers.Interface(FREEZE_EVENTS_ABI);

const RECEIPT_RETRY_ATTEMPTS = 3;
const RECEIPT_RETRY_DELAY_MS = 2000;
const ENFORCE_TX_FRESHNESS_SEC = 300;

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
        }
        if (attempt < RECEIPT_RETRY_ATTEMPTS) await sleep(RECEIPT_RETRY_DELAY_MS);
    }
    return null;
}

const toPixelKey = (pixelId: number) => {
    const x = pixelId % CANVAS_W;
    const y = Math.floor(pixelId / CANVAS_W);
    return `${x}-${y}`;
};

// Même conversion que côté indexer/frontend : uint24 -> "#rrggbb"
const colorToHex = (color: number) => "#" + color.toString(16).padStart(6, "0");

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

        const txBlock = await provider.getBlock(receipt.blockNumber);
        if (!txBlock || Math.abs(Math.floor(Date.now() / 1000) - Number(txBlock.timestamp)) > ENFORCE_TX_FRESHNESS_SEC) {
            throw new Error("Transaction too old to trigger confirmation.");
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

        // Anti-replay EN PREMIER, avant de consommer le rate-limit partagé.
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
            p_address: `ip:${clientIp}:confirm-freeze`,
            p_window_ms: 60000,
            p_max: 30,
        });
        if (!ipOk) {
            throw new Error("Too many requests from this network, please retry in a moment.");
        }

        const { data: globalOk } = await supabase.rpc('bump_rate_limit', {
            p_address: 'quota:global:confirm-freeze',
            p_window_ms: 60000,
            p_max: 500,
        });
        if (!globalOk) {
            throw new Error("Service temporarily busy, please retry in a moment.");
        }

        const { data: ok } = await supabase.rpc('bump_rate_limit', {
            p_address: `quota:${painter}:confirm-freeze`,
            p_window_ms: 60000,
            p_max: 20,
        });
        if (!ok) {
            throw new Error("Too many requests, retry in a few moments.");
        }

        // Source de vérité : les logs réellement émis par le contrat pour CE
        // txHash — pas ce que le frontend prétend avoir freeze.
        // On capture aussi la couleur ici (pas seulement id/owner), nécessaire
        // pour l'upsert dans freeze_events plus bas.
        const confirmed: { id: string; owner: string; color: string }[] = [];
        for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue;
            let parsed;
            try {
                parsed = iface.parseLog(log);
            } catch {
                continue;
            }
            if (!parsed) continue;

            if (parsed.name === 'PixelFrozen') {
                const { pixelId, owner, color } = parsed.args;
                confirmed.push({
                    id: toPixelKey(Number(pixelId)),
                    owner: owner.toLowerCase(),
                    color: colorToHex(Number(color)),
                });
            } else if (parsed.name === 'BatchPixelFrozen') {
                const { owner, pixelIds, colors } = parsed.args;
                for (let i = 0; i < pixelIds.length; i++) {
                    confirmed.push({
                        id: toPixelKey(Number(pixelIds[i])),
                        owner: owner.toLowerCase(),
                        color: colorToHex(Number(colors[i])),
                    });
                }
            }
        }

        if (confirmed.length === 0) {
            throw new Error("No freeze event found in this transaction");
        }

        // ── pending_frozen_pixels : protège paint-pixels contre la fenêtre
        // de race avant que l'indexer rattrape (voir cleanup_confirmed_pending_frozen).
        const pendingRows = confirmed.map(c => ({ id: c.id, owner: c.owner, tx_hash: txHash }));
        const { error: pendingError } = await supabase
            .from('pending_frozen_pixels')
            .upsert(pendingRows, { onConflict: 'id' });

        if (pendingError) throw pendingError;

        // ── freeze_events : diffuse le freeze à TOUS les joueurs via Realtime,
        // instantanément, sans attendre l'indexer — même principe que
        // enforce-pixel-quota qui écrit directement dans offchain_canvas.
        // L'indexer refera le même upsert plus tard (idempotent, onConflict
        // x,y côté Ponder), donc aucun risque de double-écriture incohérente.
        const freezeEventRows = confirmed.map(c => {
            const [xStr, yStr] = c.id.split('-');
            return { x: Number(xStr), y: Number(yStr), color: c.color, owner: c.owner };
        });
        const { error: freezeEventError } = await supabase
            .from('freeze_events')
            .upsert(freezeEventRows, { onConflict: 'x,y' });

        if (freezeEventError) {
            // Non-bloquant : pending_frozen_pixels (la garde de sécurité) est
            // déjà écrit avec succès. Un échec ici ne dégrade que l'affichage
            // temps réel, pas l'intégrité des données — l'indexer rattrapera
            // de toute façon freeze_events via son propre upsert.
            console.error("[confirm-freeze] freeze_events upsert failed", freezeEventError);
        }

        return new Response(
            JSON.stringify({ success: true, confirmed: confirmed.length }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("confirm-freeze error:", errorMessage);
        return new Response(
            JSON.stringify({ error: errorMessage }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
});