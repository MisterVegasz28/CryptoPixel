import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

// ── Config (toutes les valeurs viennent du .env) ──────────────────────────────
const RPC_URL          = process.env.RPC_URL          ?? "https://rpc-amoy.polygon.technology";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? "";
const CANVAS_W         = Number(process.env.CANVAS_WIDTH ?? 32000);

const BALANCE_ABI       = ["function balanceOf(address account) view returns (uint256)"];
const LOCKED_PREMINE_ABI = ["function lockedPremine(address account) view returns (uint256)"];
const AIRDROP_ABI        = ["function isAirdropUnlocked() view returns (bool)"];

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
);
const provider = new ethers.JsonRpcProvider(RPC_URL);

async function getUsableTokens(address: string): Promise<number> {
  const balanceContract = new ethers.Contract(CONTRACT_ADDRESS, BALANCE_ABI, provider);
  const lockedContract  = new ethers.Contract(CONTRACT_ADDRESS, LOCKED_PREMINE_ABI, provider);
  const airdropContract = new ethers.Contract(CONTRACT_ADDRESS, AIRDROP_ABI, provider);

  const [balanceWei, lockedWei, airdropUnlocked] = await Promise.all([
    balanceContract.balanceOf(address),
    lockedContract.lockedPremine(address),
    airdropContract.isAirdropUnlocked(),
  ]);

  const usableWei = airdropUnlocked
    ? balanceWei
    : (balanceWei > lockedWei ? balanceWei - lockedWei : 0n);

  return Number(usableWei / 1000000000000000000n);
}

async function cleanupExcessPixels(address: string) {
  const painter = address.toLowerCase();
  const usableTokens = await getUsableTokens(painter);

  const { data: ownedRows, error: ownedError } = await supabaseAdmin
    .from("offchain_canvas")
    .select("id")
    .eq("painter", painter);
  if (ownedError) { console.error("[cleanup] owned fetch error", ownedError); return; }

  const { data: frozenRows, error: frozenError } = await supabaseAdmin
    .from("pixel")
    .select("id, x, y")
    .eq("owner", painter);
  if (frozenError) { console.error("[cleanup] frozen fetch error", frozenError); return; }

  const frozenIdSet = new Set(
    (frozenRows || []).map(p => p.id ?? `${p.x}-${p.y}`)
  );

  const effectiveOwned = (ownedRows || []).filter(r => !frozenIdSet.has(r.id)).length;
  if (usableTokens >= effectiveOwned) return;

  const deficit = effectiveOwned - usableTokens;

  const { data: candidates, error: candError } = await supabaseAdmin
    .from("offchain_canvas")
    .select("id")
    .eq("painter", painter)
    .order("updated_at", { ascending: true })
    .limit(deficit + frozenIdSet.size + 50);
  if (candError) { console.error("[cleanup] candidates error", candError); return; }

  const sacrificeable = (candidates || []).filter(p => !frozenIdSet.has(p.id));
  const toDelete = sacrificeable.slice(0, deficit);

  if (toDelete.length > 0) {
    const ids = toDelete.map(p => p.id);
    const { error: delError } = await supabaseAdmin
      .from("offchain_canvas")
      .delete()
      .in("id", ids);
    if (delError) console.error("[cleanup] delete error", delError);
    else console.log(`[cleanup] ${ids.length} pixel(s) nettoyé(s) pour ${painter}`);
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

// ── PixelFrozen (freeze unitaire) ─────────────────────────────────────────────
ponder.on("CryptoPixel:PixelFrozen", async ({ event, context }) => {
  const { pixelId, owner, color } = event.args;
  const { db } = context;
  const addr = owner.toLowerCase();
  const ts = Number(event.block.timestamp);

  const isNewFreeze = await upsertFrozenPixel(db, pixelId, addr, color, ts, event.transaction.hash);
  if (!isNewFreeze) return;

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