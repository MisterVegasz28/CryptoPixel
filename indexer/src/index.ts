import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

// ── Config ────────────────────────────────────────────────────────────────────
const RPC_URL = "https://rpc-amoy.polygon.technology";
const CONTRACT_ADDRESS = "0xbDbe95617A775D7291424262B59FDa7961cd948D"; // contrat V4
const CANVAS_W = 32000;

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];
const LOCKED_PREMINE_ABI = ["function lockedPremine(address account) view returns (uint256)"];
const AIRDROP_ABI = ["function isAirdropUnlocked() view returns (bool)"];

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

// Nettoie les pixels offchain en excès pour une adresse donnée, en respectant
// la protection des pixels frozen on-chain (jamais sacrifiés).
async function cleanupExcessPixels(address: string) {
  const painter = address.toLowerCase();

  const usableTokens = await getUsableTokens(painter);

  // CORRECTION CRITIQUE : on récupère la LISTE des ids offchain_canvas (pas
  // juste un count), pour filtrer en JS ceux qui correspondent réellement à
  // un pixel frozen — au lieu de faire `ownedCount - frozenCount` par
  // soustraction arithmétique. Cette soustraction supposait une correspondance
  // 1-pour-1 entre frozen on-chain et lignes offchain_canvas, ce qui est
  // faux si l'upsert post-freeze a échoué ou si un sacrifice antérieur a
  // supprimé la ligne. Cas réel observé : ownedCount=15, frozenCount=11,
  // mais seules 4 lignes sur 15 correspondaient à un id frozen → effectiveOwned
  // arithmétique = 4, effectiveOwned réel = 11.
  const { data: ownedRows, error: ownedError } = await supabaseAdmin
    .from("offchain_canvas")
    .select("id")
    .eq("painter", painter);
  if (ownedError) { console.error("[cleanup] owned fetch error", ownedError); return; }

  // Pixels frozen — jamais sacrifiables ET ne comptent pas dans la limite.
  const { data: frozenRows, error: frozenError } = await supabaseAdmin
    .from("pixel")
    .select("id, x, y")
    .eq("owner", painter);
  if (frozenError) { console.error("[cleanup] frozen fetch error", frozenError); return; }

  const frozenIdSet = new Set(
    (frozenRows || []).map(p => p.id ?? `${p.x}-${p.y}`)
  );

  // Vrai matching id-par-id : pixels off-chain qui ne sont PAS frozen on-chain.
  const effectiveOwned = (ownedRows || []).filter(r => !frozenIdSet.has(r.id)).length;

  if (usableTokens >= effectiveOwned) return; // rien à nettoyer

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

// ── PixelFrozen ──────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:PixelFrozen", async ({ event, context }) => {
  const { pixelId, owner, color } = event.args;
  const { db } = context;
  const addr = owner.toLowerCase();
  const ts = Number(event.block.timestamp);
  const colorHex = "#" + Number(color).toString(16).padStart(6, "0");
  const x = Number(pixelId) % CANVAS_W;
  const y = Math.floor(Number(pixelId) / CANVAS_W);
  const id = `${x}-${y}`;

  // CORRECTION : on vérifie si ce pixel était déjà gelé avant cet event, pour
  // ne pas recompter un freeze déjà comptabilisé en cas de replay/reorg.
  const existing = await db.find(schema.pixel, { id });
  const isNewFreeze = !existing || !existing.isFrozen;

  await db
    .insert(schema.pixel)
    .values({
      id,
      x: Number(pixelId) % CANVAS_W,
      y: Math.floor(Number(pixelId) / CANVAS_W),
      color: colorHex,
      owner: addr,
      isFrozen: true,
      claimedAt: ts,
      txHash: event.transaction.hash,
    })
    .onConflictDoUpdate({
      color: colorHex,
      owner: addr,
      isFrozen: true,
      txHash: event.transaction.hash,
    });

  if (!isNewFreeze) return;

  await db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 1n, totalVolumeWei: 0n })
    .onConflictDoUpdate((current) => ({
      totalFrozen: current.totalFrozen + 1n,
    }));

  await db
    .insert(schema.burnerStats)
    .values({ address: addr, totalFrozen: 1n, lastFrozenAt: ts })
    .onConflictDoUpdate((current) => ({
      totalFrozen: current.totalFrozen + 1n,
      lastFrozenAt: ts,
    }));
});

// ── TokensBought ──────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:TokensBought", async ({ event, context }) => {
  const { cost } = event.args;
  await context.db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 0n, totalVolumeWei: cost })
    .onConflictDoUpdate((current) => ({
     totalVolumeWei: current.totalVolumeWei + cost,
    }));
});

// ── TokensSold ────────────────────────────────────────────────────────────────
ponder.on("CryptoPixel:TokensSold", async ({ event, context }) => {
  const { seller, revenue } = event.args;

  await context.db
    .insert(schema.globalStats)
    .values({ id: "global", totalFrozen: 0n, totalVolumeWei: revenue })
    .onConflictDoUpdate((current) => ({
      totalVolumeWei: current.totalVolumeWei > revenue
        ? current.totalVolumeWei - revenue
        : 0n,
    }));

  // Filet de sécurité : si le solde ne couvre plus les pixels possédés,
  // on nettoie immédiatement (sans attendre un futur paint).
  try {
    await cleanupExcessPixels(seller);
  } catch (err) {
    console.error("[TokensSold cleanup]", err);
  }
});