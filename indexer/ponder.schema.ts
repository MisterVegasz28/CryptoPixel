import { onchainTable, index } from "ponder";

export const pixel = onchainTable(
  "pixel",
  (t) => ({
    id: t.text().primaryKey(),
    x: t.integer().notNull(),
    y: t.integer().notNull(),
    color: t.text().notNull(),
    owner: t.text().notNull(),
    isFrozen: t.boolean().notNull(),
    claimedAt: t.integer().notNull().default(0),
    txHash: t.text().notNull().default(""),
  }),
  (table) => ({
    xyIdx: index("idx_pixel_xy").on(table.x, table.y),
  }));

export const globalStats = onchainTable("global_stats", (t) => ({
  id: t.text().primaryKey(),
  totalFrozen: t.bigint().notNull().default(0n),
  totalVolumeWei: t.bigint().notNull().default(0n),
}));

export const burnerStats = onchainTable("burner_stats", (t) => ({
  address: t.text().primaryKey(),
  totalFrozen: t.bigint().notNull().default(0n),
  lastFrozenAt: t.integer().notNull().default(0),
  // Compteur de pixels frozen pour l'éligibilité airdrop (MIN_FROZEN_COUNT = 10)
  // Miroir on-chain de frozenCountByAddress[address] du contrat V5
  frozenCountForAirdrop: t.bigint().notNull().default(0n),
  // true une fois que claim() a été appelé avec succès
  hasClaimedAirdrop: t.boolean().notNull().default(false),
}));

// Suivi global de l'airdrop
export const airdropStats = onchainTable("airdrop_stats", (t) => ({
  id: t.text().primaryKey(), // toujours "global"
  isUnlocked: t.boolean().notNull().default(false),
  totalClaimants: t.integer().notNull().default(0),
}));