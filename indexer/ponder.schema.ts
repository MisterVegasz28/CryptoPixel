import { onchainTable } from "ponder";

export const pixel = onchainTable("pixel", (t) => ({
  id: t.text().primaryKey(),
  x: t.integer().notNull(),
  y: t.integer().notNull(),
  color: t.text().notNull(),
  owner: t.text().notNull(),
  isFrozen: t.boolean().notNull(),
  claimedAt: t.integer().notNull().default(0),
  txHash: t.text().notNull().default(""),
}));

export const globalStats = onchainTable("global_stats", (t) => ({
  id: t.text().primaryKey(),
  totalClaimed: t.bigint().notNull().default(0n),
  totalFrozen: t.bigint().notNull().default(0n),
  totalVolumeWei: t.bigint().notNull().default(0n),
}));

export const tradeEvent = onchainTable("trade_event", (t) => ({
  id: t.text().primaryKey(),
  type: t.text().notNull(),
  account: t.text().notNull(),
  amount: t.bigint().notNull(),
  costOrRevenue: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// PK = address (comme Supabase)
export const burnerStats = onchainTable("burner_stats", (t) => ({
  address: t.text().primaryKey(),
  totalFrozen: t.bigint().notNull().default(0n),
  lastFrozenAt: t.integer().notNull().default(0),
}));