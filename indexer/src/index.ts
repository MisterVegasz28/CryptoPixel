import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { WebSocket as WS } from "ws";

// ── Config (toutes les valeurs viennent du .env) ──────────────────────────────
const RPC_URL          = process.env.RPC_URL          ?? "https://rpc-amoy.polygon.technology";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? "";
const CANVAS_W         = Number(process.env.CANVAS_WIDTH ?? 32000);

const BALANCE_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function lockedPremine(address account) view returns (uint256)",
  "function premineHolder() view returns (address)",
];

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  {
    realtime: {
      transport: WS as any,
    },
  }
);

const provider = new ethers.JsonRpcProvider(RPC_URL);

async function getUsableTokens(address: string): Promise<number> {
  const contract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);

  const [balanceWeiRaw, lockedWeiRaw] = await Promise.all([
    contract.balanceOf(address),
    contract.lockedPremine(address),
  ]);

  const balanceWei = BigInt(balanceWeiRaw);
  const lockedWei = BigInt(lockedWeiRaw);
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

async function cleanupExcessPixels(address: string) {
  const painter = address.toLowerCase();
  const usableTokens = await getUsableTokens(painter);

  const { data: ownedRows, error: ownedError } = await supabaseAdmin
    .from("offchain_canvas")
    .select("id")
    .eq("painter", painter);
  if (ownedError) { console.error("[cleanup] owned fetch error", ownedError); return; }
  if (!ownedRows || ownedRows.length === 0) return;

  const ownedIds = ownedRows.map(r => r.id);
  const { data: frozenRows, error: frozenError } = await supabaseAdmin
    .from("pixel").select("id").in("id", ownedIds);
  if (frozenError) { console.error("[cleanup] frozen fetch error", frozenError); return; }
  const frozenIdSet = new Set((frozenRows || []).map(p => p.id));

  const effectiveOwned = ownedRows.filter(r => !frozenIdSet.has(r.id)).length;

  console.log(`[cleanup] ${painter}: usableTokens=${usableTokens} ownedRows=${ownedRows.length} frozenAmongOwned=${frozenIdSet.size} effectiveOwned=${effectiveOwned}`);

  if (usableTokens >= effectiveOwned) return;

  const deficit = effectiveOwned - usableTokens;

  // Une seule requête, même tri que enforce_quota_atomic : non-lockés
  // d'abord (is_locked asc → false avant true), puis les lockés en
  // dernier recours, du plus ancien au plus récent dans chaque groupe.
  const { data: candidates, error: candError } = await supabaseAdmin
    .from("offchain_canvas")
    .select("id, is_locked")
    .eq("painter", painter)
    .order("is_locked", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(deficit + frozenIdSet.size + 50);
  if (candError) { console.error("[cleanup] candidates error", candError); return; }

  const sacrificeable = (candidates || []).filter(p => !frozenIdSet.has(p.id));
  const toDelete = sacrificeable.slice(0, deficit);
  const lockedSacrificedCount = toDelete.filter(p => p.is_locked).length;

  console.log(`[cleanup] ${painter}: deficit=${deficit} candidates=${(candidates || []).length} sacrificeable=${sacrificeable.length} toDelete=${toDelete.length} lockedSacrificed=${lockedSacrificedCount}`);

  if (toDelete.length > 0) {
    const ids = toDelete.map(p => p.id);
    const { error: delError } = await supabaseAdmin
      .from("offchain_canvas")
      .delete()
      .in("id", ids);
    if (delError) console.error("[cleanup] delete error", delError);
    else console.log(`[cleanup] ${ids.length} pixel(s) nettoyé(s) pour ${painter} (dont ${lockedSacrificedCount} locké(s))`);
  }
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

  return isNewFreeze;
}

// Purge une ligne offchain_canvas résiduelle sur un pixel qui vient d'être
// frozen. AVEC gestion d'erreur explicite désormais : avant, un échec
// silencieux de ce delete (ex: souci réseau/DB transitoire) laissait une
// ligne fantôme dans offchain_canvas pour un pixel pourtant frozen — c'est
// exactement le genre de résidu que le bug de cleanupExcessPixels
// ci-dessus pouvait ensuite supprimer à tort en pensant nettoyer un pixel
// normal. Logguer l'échec permet au moins de le détecter au lieu qu'il
// passe inaperçu.
async function purgeOffchainCanvas(id: string, context: string) {
  const { error } = await supabaseAdmin.from("offchain_canvas").delete().eq("id", id);
  if (error) console.error(`[${context}] purge offchain_canvas error for ${id}`, error);
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
  await purgeOffchainCanvas(id, "PixelFrozen");

  // Le freeze peut cibler un pixel jamais peint par owner (donc absent
  // d'offchain_canvas — purgeOffchainCanvas n'aura rien retiré), alors que
  // le burn a bien réduit son solde utilisable de 1. Sans ce contrôle, un
  // déséquilibre "solde < pixels peints" peut apparaître silencieusement.
  // cleanupExcessPixels revérifie l'invariant global et sacrifie le plus
  // ancien pixel peint (hors frozen) si nécessaire.
  try {
    await cleanupExcessPixels(addr);
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

ponder.on("CryptoPixel:Transfer", async ({ event }) => {
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
    await cleanupExcessPixels(fromAddr);
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
  const { error: purgeErr } = await supabaseAdmin.from("offchain_canvas").delete().in("id", idsToDelete);
  if (purgeErr) console.error("[BatchPixelFrozen] purge offchain_canvas error", purgeErr);

  // Même raison que PixelFrozen : le batch peut contenir des pixels
  // jamais peints par owner, donc le solde peut baisser plus vite que le
  // nombre de lignes offchain_canvas supprimées par la purge ci-dessus.
  try {
    await cleanupExcessPixels(addr);
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
    await cleanupExcessPixels(seller);
  } catch (err) {
    console.error("[TokensSold cleanup]", err);
  }
});