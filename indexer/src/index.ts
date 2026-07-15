import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { WebSocket as WS } from "ws";
import { parseAbi } from "viem";

// ── Config (toutes les valeurs viennent du .env) ──────────────────────────────
const RPC_URL          = process.env.RPC_URL;
const RPC_URL_BACKUP   = process.env.RPC_URL_BACKUP   ?? "";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? "";
const CANVAS_W         = Number(process.env.CANVAS_WIDTH ?? 32000);
const LIVE_THRESHOLD_SEC = Number(process.env.LIVE_THRESHOLD_SEC ?? 300);// au-delà, on considère qu'on est en backfill/replay

if (!RPC_URL) throw new Error("RPC_URL is not set — refusing to start with a public fallback RPC");
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set");

const BALANCE_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
  "function premineHolder() view returns (address)",
]);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {
    realtime: {
      transport: WS as any,
    },
  }
);

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

// APRÈS — ancré au bloc de l'event via context.client (viem)
async function getUsableTokens(
  address: string,
  client: any,       // context.client passé par le handler
  blockNumber: bigint
): Promise<number> {
  const [balanceWeiRaw, lockedWeiRaw] = await Promise.all([
    client.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: BALANCE_ABI,
      functionName: "balanceOf",
      args: [address],
      blockNumber,
    }),
    client.readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: BALANCE_ABI,
      functionName: "lockedPremine",
      args: [address],
      blockNumber,
    }),
  ]);

  const balanceWei = BigInt(balanceWeiRaw as bigint);
  const lockedWei = BigInt(lockedWeiRaw as bigint);
  const usableWei = balanceWei > lockedWei ? balanceWei - lockedWei : 0n;

  return Number(usableWei / 1000000000000000000n);
}

// Cache mémoire : premineHolder est immutable on-chain (fixé au déploiement),
// donc un seul appel RPC suffit pour toute la durée de vie du process.
let cachedPremineHolder: string | null = null;
async function getPremineHolder(): Promise<string> {
  if (cachedPremineHolder) return cachedPremineHolder;
  const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
  const addr: string = await contract.premineHolder();
  cachedPremineHolder = addr.toLowerCase();
  return cachedPremineHolder;
}

async function schedulePurge(id: string, blockNumber: bigint, reason: string) {
  const { error } = await supabaseAdmin
    .from("pending_purges")
    .upsert(
      { id, block_number: Number(blockNumber), reason, created_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) console.error(`[schedulePurge] failed for ${id}`, error);
}

async function cleanupExcessPixels(
  address: string,
  client: any,
  blockNumber: bigint,
  blockTimestamp: bigint,
  extraFrozenIds: string[] = []   // NOUVEAU
) {
  const painter = address.toLowerCase();
  const usableTokens = await getUsableTokens(painter, client, blockNumber);
  const isLive = Math.abs(Date.now() / 1000 - Number(blockTimestamp)) < LIVE_THRESHOLD_SEC;

  const { data: effectiveOwnedRaw, error: countError } = await supabaseAdmin
    .rpc("count_effective_owned", {
      p_painter: painter,
      p_extra_frozen_ids: extraFrozenIds,   // NOUVEAU
    });
  if (countError) { console.error("[cleanup] effective owned count error", countError); return; }
  const effectiveOwned = effectiveOwnedRaw ?? 0;

  console.log(`[cleanup] ${painter}: usableTokens=${usableTokens} effectiveOwned=${effectiveOwned}`);

  if (usableTokens >= effectiveOwned) return;

  if (!isLive) {
    await schedulePurge(`quota:${painter}`, blockNumber, "quota_cleanup");
    return;
  }

  // Un seul appel RPC atomique (advisory lock + count + sacrifice + log + delete
  // dans la même transaction) pour éliminer la race condition entre deux
  // events touchant le même painter dans le même bloc.
  const { data: result, error: cleanupError } = await supabaseAdmin
    .rpc("cleanup_excess_pixels_atomic", {
      p_painter: painter,
      p_usable_tokens: usableTokens,
      p_extra_frozen_ids: extraFrozenIds,
    });
  if (cleanupError) { console.error("[cleanup] atomic cleanup error", cleanupError); return; }

  console.log(`[cleanup] ${painter}: deleted=${result?.deleted ?? 0} lockedSacrificed=${result?.locked_sacrificed ?? 0}`);
}

// ── Helper partagé : upsert d'un pixel frozen ─────────────────────────────────
async function upsertFrozenPixel(
  db: any,
  pixelId: bigint | number,
  owner: string,
  color: bigint | number,
  ts: number,
  txHash: string
) {
  const x = Number(pixelId) % CANVAS_W;
  const y = Math.floor(Number(pixelId) / CANVAS_W);
  const id = `${x}-${y}`;
  const colorHex = "#" + Number(color).toString(16).padStart(6, "0");

  const existing = await db.find(schema.pixel, { id });
  const isNewFreeze = !existing || !existing.isFrozen;

  await db
    .insert(schema.pixel)
    .values({ id, x, y, color: colorHex, owner, isFrozen: true, claimedAt: ts, txHash })
    .onConflictDoUpdate({ color: colorHex, owner, isFrozen: true, txHash });

  if (isNewFreeze) {
    // Table stable (hors schema Ponder dynamique) dédiée au flux Realtime
    // frontend — pixel/ponder_public.pixel changent de schema à chaque
    // redéploiement Railway, Realtime ne peut pas s'y abonner durablement.
    const { error } = await supabaseAdmin
      .from("freeze_events")
      .upsert({ x, y, color: colorHex, owner }, { onConflict: "x,y" });
    if (error) console.error("[freeze_events insert]", error);
  }

  return isNewFreeze;
}

// ── PixelFrozen (freeze unitaire) ─────────────────────────────────────────────
ponder.on("CryptoPixel:PixelFrozen", async ({ event, context }) => {
  const { pixelId, owner, color } = event.args;
  const { db } = context;
  const addr = owner.toLowerCase();
  const ts = Number(event.block.timestamp);

  const isNewFreeze = await upsertFrozenPixel(db, pixelId, addr, color, ts, event.transaction.hash);
  if (!isNewFreeze) return;

  const x = Number(pixelId) % CANVAS_W;
  const y = Math.floor(Number(pixelId) / CANVAS_W);
  const id = `${x}-${y}`;
  await schedulePurge(id, event.block.number, "PixelFrozen");

  // Le freeze peut cibler un pixel jamais peint par owner (donc absent
  // d'offchain_canvas — purgeOffchainCanvas n'aura rien retiré), alors que
  // le burn a bien réduit son solde utilisable de 1. Sans ce contrôle, un
  // déséquilibre "solde < pixels peints" peut apparaître silencieusement.
  // cleanupExcessPixels revérifie l'invariant global et sacrifie le plus
  // ancien pixel peint (hors frozen) si nécessaire.
 try {
  await cleanupExcessPixels(addr, context.client, event.block.number, event.block.timestamp, [id]);
  //                                                                                          ^^^^ NOUVEAU
} catch (err) {
  console.error("[PixelFrozen cleanup]", err);
}

  await db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 1n, totalVolumeWei: 0n })
    .onConflictDoUpdate((current: any) => ({
      totalFrozen: current.totalFrozen + 1n,
    }));

  await db
    .insert(schema.burnerStats)
    .values({ address: addr, totalFrozen: 1n, lastFrozenAt: ts, frozenCountForAirdrop: 1n })
    .onConflictDoUpdate((current: any) => ({
      totalFrozen: current.totalFrozen + 1n,
      lastFrozenAt: ts,
      frozenCountForAirdrop: current.frozenCountForAirdrop + 1n,
    }));
});

// ── Transfer (ERC20 standard) ─────────────────────────────────────────────
// 1 PAINT = 1 pixel possédé (sauf freeze qui brûle le PAINT et sort le
// pixel du décompte "effectiveOwned"). Donc dès qu'une adresse voit son
// solde PAINT baisser via un transfert normal, elle doit perdre ses
// pixels offchain en trop — pas seulement lors d'un sellTokens.
//
// On ignore mint (from == address(0), déjà géré par TokensBought) et burn
// (to == address(0), déjà géré par TokensSold / freeze events) pour éviter
// un cleanup redondant : on ne traite que les transferts entre deux
// adresses non-nulles (transfer/transferFrom classiques, airdrop claim,
// sweep premine, etc.)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

ponder.on("CryptoPixel:Transfer", async ({ event, context }) => {
  const { from, to } = event.args;
  const fromAddr = from.toLowerCase();
  const toAddr = to.toLowerCase();

  if (fromAddr === ZERO_ADDRESS) return; // mint (buyTokens)
  if (toAddr === ZERO_ADDRESS) return;   // burn (sellTokens / freezePixel / freezeBatch)
                                          // → déjà géré par TokensSold, ou neutre pour
                                          //   freeze (le pixel devient exempté dans
                                          //   frozenIdSet dès que PixelFrozen est traité)

  const premineHolder = await getPremineHolder();
  if (fromAddr === premineHolder) return;

  try {
    await cleanupExcessPixels(fromAddr, context.client, event.block.number, event.block.timestamp);
  } catch (err) {
    console.error("[Transfer cleanup]", err);
  }
});

// ── BatchPixelFrozen (freeze en lot — V5) ────────────────────────────────────
ponder.on("CryptoPixel:BatchPixelFrozen", async ({ event, context }) => {
  const { owner, pixelIds, colors } = event.args;
  const { db } = context;
  const addr = owner.toLowerCase();
  const ts = Number(event.block.timestamp);

  let newFreezeCount = 0n;

  for (let i = 0; i < pixelIds.length; i++) {
    const isNew = await upsertFrozenPixel(db, pixelIds[i], addr, colors[i], ts, event.transaction.hash);
    if (isNew) newFreezeCount++;
  }

if (newFreezeCount === 0n) return;

  const idsToDelete = pixelIds.map(pid => {
    const x = Number(pid) % CANVAS_W;
    const y = Math.floor(Number(pid) / CANVAS_W);
    return `${x}-${y}`;
  });

// Vérifier quels pixels du batch sont bien visibles, via le MÊME client
  // `db` que celui qui vient de faire l'upsert dans upsertFrozenPixel
  // (au lieu de supabaseAdmin, une connexion distincte sans garantie de
  // voir immédiatement sa propre écriture). C'était la cause du
  // "pas encore visibles, purge partielle" qui pouvait laisser des
  // pixels frozen visibles comme non-frozen côté frontend pendant un
  // temps variable après un freezeBatch.
  const confirmedChecks = await Promise.all(
    idsToDelete.map(async (id) => {
      const row = await db.find(schema.pixel, { id });
      return row && row.isFrozen ? id : null;
    })
  );
  const confirmedIds = confirmedChecks.filter((id): id is string => id !== null);
  const notYetVisible = idsToDelete.filter(id => !confirmedIds.includes(id));
  if (notYetVisible.length > 0) {
    console.warn(`[BatchPixelFrozen] ${notYetVisible.length} pixel(s) pas encore visibles, purge différée programmée`, notYetVisible);
  }
  // On programme TOUS les ids (confirmés ou non) : execute-pending-purges
  // ne les traite qu'après REORG_SAFETY_BLOCKS confirmations et revérifie
  // lui-même leur présence dans `pixel` avant toute suppression — largement
  // le temps qu'il faut à l'indexer pour rattraper un simple retard
  // d'écriture. Avant, les ids "pas encore visibles" étaient abandonnés
  // ici même, laissant une ligne offchain_canvas fantôme permanente.
  await Promise.all(idsToDelete.map(id => schedulePurge(id, event.block.number, "BatchPixelFrozen")));

  // Même raison que PixelFrozen : le batch peut contenir des pixels
  // jamais peints par owner, donc le solde peut baisser plus vite que le
  // nombre de lignes offchain_canvas supprimées par la purge ci-dessus.
 try {
  await cleanupExcessPixels(addr, context.client, event.block.number, event.block.timestamp, idsToDelete);
  //                                                                                          ^^^^^^^^^^^^ NOUVEAU
} catch (err) {
  console.error("[BatchPixelFrozen cleanup]", err);
}
  
  await db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: newFreezeCount, totalVolumeWei: 0n })
    .onConflictDoUpdate((current: any) => ({
      totalFrozen: current.totalFrozen + newFreezeCount,
    }));

  await db
    .insert(schema.burnerStats)
    .values({ address: addr, totalFrozen: newFreezeCount, lastFrozenAt: ts, frozenCountForAirdrop: newFreezeCount })
    .onConflictDoUpdate((current: any) => ({
      totalFrozen: current.totalFrozen + newFreezeCount,
      lastFrozenAt: ts,
      frozenCountForAirdrop: current.frozenCountForAirdrop + newFreezeCount,
    }));
});

// ── AirdropClaimed ────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:AirdropClaimed", async ({ event, context }) => {
  const { claimer } = event.args;
  const { db } = context;
  const addr = claimer.toLowerCase();

  // Marquer l'adresse comme ayant claimé
  await db
    .insert(schema.burnerStats)
    .values({ address: addr, totalFrozen: 0n, lastFrozenAt: 0, frozenCountForAirdrop: 0n, hasClaimedAirdrop: true })
    .onConflictDoUpdate(() => ({
      hasClaimedAirdrop: true,
    }));

  // Incrémenter le compteur global
  await db
    .insert(schema.airdropStats)
    .values({ id: "global", isUnlocked: true, totalClaimants: 1 })
    .onConflictDoUpdate((current: any) => ({
      isUnlocked: true,
      totalClaimants: current.totalClaimants + 1,
    }));
});

// ── AirdropUnlocked ───────────────────────────────────────────────────────────
ponder.on("CryptoPixel:AirdropUnlocked", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.airdropStats)
    .values({ id: "global", isUnlocked: true, totalClaimants: 0 })
    .onConflictDoUpdate(() => ({
      isUnlocked: true,
    }));
});

// ── TokensBought ──────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:TokensBought", async ({ event, context }) => {
  const { cost } = event.args;
  await context.db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 0n, totalVolumeWei: cost })
    .onConflictDoUpdate((current: any) => ({
      totalVolumeWei: current.totalVolumeWei + cost,
    }));
});

// ── TokensSold ────────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:TokensSold", async ({ event, context }) => {
  const { seller, revenue } = event.args;

  await context.db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 0n, totalVolumeWei: revenue })
    .onConflictDoUpdate((current: any) => ({
      totalVolumeWei: current.totalVolumeWei > revenue
        ? current.totalVolumeWei - revenue
        : 0n,
    }));

  try {
    await cleanupExcessPixels(seller, context.client, event.block.number, event.block.timestamp);
  } catch (err) {
    console.error("[TokensSold cleanup]", err);
  }
});