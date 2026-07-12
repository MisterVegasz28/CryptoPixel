import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { desc, eq, count } from "drizzle-orm";
// @ts-ignore: Could not find declaration file for module 'pg'.
import pg from "pg";
import { cors } from "hono/cors";

const app = new Hono();
const ALLOWED_RPC_METHODS = new Set([
  'eth_call',
  'eth_getBalance',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_chainId',
  'net_version',
]);

// ── CORS depuis .env ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map(o => o.trim());

app.use('/*', cors({
  origin: (origin, c) => {
    if (c.req.path.startsWith('/rpc')) return origin ?? '*'; // ouvert pour le proxy RPC
    return ALLOWED_ORIGINS.includes(origin) ? origin : null;  // strict pour le reste
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
}));

app.use('/sql/*', (c, next) => { c.header('Cache-Control', 'no-store'); return next(); });
app.use('/graphql', (c, next) => { c.header('Cache-Control', 'no-store'); return next(); });

app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// ── Pool Postgres ─────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS burner_profile (
      address TEXT PRIMARY KEY,
      pseudo TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      instagram TEXT NOT NULL DEFAULT '',
      telegram TEXT NOT NULL DEFAULT '',
      twitter TEXT NOT NULL DEFAULT '',
      discord TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
}

let dbReadyPromise: Promise<void> | null = null;
function ensureDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDb().catch((err) => {
      console.error("[initDb]", err);
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

function getClientIp(c: import('hono').Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

// ── GET /burners ──────────────────────────────────────────────────────────────
app.get("/burners", async (c) => {
  try {
    // DÉPLACEMENT DE LA VALIDATION ICI
    const limitRaw = Number(c.req.query("limit") ?? 100);
    const offsetRaw = Number(c.req.query("offset") ?? 0);

    if (!Number.isFinite(limitRaw) || limitRaw < 0) {
      return c.json({ error: "limit must be a non-negative number" }, 400);
    }
    if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
      return c.json({ error: "offset must be a non-negative number" }, 400);
    }

    const limit = Math.min(limitRaw, 500);
    const offset = offsetRaw;

    const stats = await db.select()
      .from(schema.burnerStats)
      .orderBy(desc(schema.burnerStats.totalFrozen))
      .limit(limit)
      .offset(offset);

    const [{ value: total }] = await db
      .select({ value: count() })
      .from(schema.burnerStats);

    if (stats.length === 0) return c.json({ burners: [], total });

    const addresses = stats.map((s) => s.address);
    await ensureDb();
    const { rows: profiles } = await pool.query(
      `SELECT * FROM burner_profile WHERE address = ANY($1)`,
      [addresses]
    );
    const profileMap: Record<string, any> = {};
    profiles.forEach((p: any) => { profileMap[p.address] = p; });

    const burners = stats.map((stat, index) => {
      const profile = profileMap[stat.address] ?? null;
      return {
        rank: offset + index + 1,
        address: stat.address,
        totalFrozen: stat.totalFrozen.toString(),
        lastFrozenAt: stat.lastFrozenAt,
        frozenCountForAirdrop: stat.frozenCountForAirdrop.toString(),
        hasClaimedAirdrop: stat.hasClaimedAirdrop,
        pseudo: profile?.pseudo ?? "",
        message: profile?.message ?? "",
        instagram: profile?.instagram ?? "",
        telegram: profile?.telegram ?? "",
        twitter: profile?.twitter ?? "",
        discord: profile?.discord ?? "",
      };
    });

    return c.json({ burners, total });
  } catch (err) {
    console.error("[GET /burners]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── GET /burners/:address ─────────────────────────────────────────────────────
app.get("/burners/:address", async (c) => {
  try {
    const address = c.req.param("address").toLowerCase();

    const [stat] = await db
      .select()
      .from(schema.burnerStats)
      .where(eq(schema.burnerStats.address, address));

    if (!stat) return c.json({ error: "Burner not found" }, 404);

    await ensureDb();
    const { rows } = await pool.query(
      `SELECT * FROM burner_profile WHERE address = $1`,
      [address]
    );
    const profile = rows[0] ?? null;

    return c.json({
      address: stat.address,
      totalFrozen: stat.totalFrozen.toString(),
      lastFrozenAt: stat.lastFrozenAt,
      frozenCountForAirdrop: stat.frozenCountForAirdrop.toString(),
      hasClaimedAirdrop: stat.hasClaimedAirdrop,
      pseudo: profile?.pseudo ?? "",
      message: profile?.message ?? "",
      instagram: profile?.instagram ?? "",
      telegram: profile?.telegram ?? "",
      twitter: profile?.twitter ?? "",
      discord: profile?.discord ?? "",
    });
  } catch (err) {
    console.error("[GET /burners/:address]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── GET /airdrop ──────────────────────────────────────────────────────────────
app.get("/airdrop", async (c) => {
  try {
    const [stats] = await db
      .select()
      .from(schema.airdropStats)
      .where(eq(schema.airdropStats.id, "global"));

    return c.json({
      isUnlocked: stats?.isUnlocked ?? false,
      totalClaimants: stats?.totalClaimants ?? 0,
      maxClaimants: 200000,
    });
  } catch (err) {
    console.error("[GET /airdrop]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// ── POST /burners/profile ─────────────────────────────────────────────────────
app.post("/burners/profile", async (c) => {
  try {
    await ensureDb();

    const body = await c.req.json();
    const {
      address, signature, pseudo = "", message = "",
      instagram = "", telegram = "", twitter = "", discord = "",
      timestamp,
    } = body;

    if (!address || !signature || !timestamp) {
      return c.json({ error: "Missing required fields: address, signature, timestamp" }, 400);
    }

    const addr = address.toLowerCase();
    const now = Math.floor(Date.now() / 1000);

    if (Math.abs(now - timestamp) > 300) {
      return c.json({ error: "Signature expired" }, 400);
    }

    if (pseudo.length > 32)   return c.json({ error: "pseudo must be <= 32 characters" }, 400);
    if (message.length > 280) return c.json({ error: "message must be <= 280 characters" }, 400);
    for (const [field, value] of Object.entries({ instagram, telegram, twitter, discord })) {
      if (typeof value === "string" && value.length > 64) {
        return c.json({ error: `${field} must be <= 64 characters` }, 400);
      }
    }

    const [stat] = await db
      .select()
      .from(schema.burnerStats)
      .where(eq(schema.burnerStats.address, addr));

    if (!stat) {
      return c.json({ error: "Address has no frozen pixels — not a burner" }, 403);
    }

    const { recoverMessageAddress } = await import("viem");

    const messageToVerify =
      `CryptoPixel profile update\n` +
      `address: ${addr}\n` +
      `pseudo: ${pseudo}\n` +
      `message: ${message}\n` +
      `instagram: ${instagram}\n` +
      `telegram: ${telegram}\n` +
      `twitter: ${twitter}\n` +
      `discord: ${discord}\n` +
      `timestamp: ${timestamp}`;

    let recoveredAddr: string;
    try {
      recoveredAddr = await recoverMessageAddress({
        message: messageToVerify,
        signature: signature as `0x${string}`,
      });
    } catch {
      return c.json({ error: "Signature verification failed" }, 401);
    }

    if (recoveredAddr.toLowerCase() !== addr) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Rate-limit par adresse
    const { rows: rl } = await pool.query(
      `SELECT bump_rate_limit($1, $2, $3) AS ok`,
      [`profile:${addr}`, 60000, 10]
    );
    if (!rl[0]?.ok) {
      return c.json({ error: "Too many requests, retry in a few moments." }, 429);
    }

    // Anti-replay : la signature ne doit être utilisable qu'une fois
    try {
      await pool.query(
        `INSERT INTO used_signatures (signature_hash) VALUES ($1)`,
        [signature]
      );
    } catch (err: any) {
      if (err.code === '23505') {
        return c.json({ error: "This signature has already been used, please try again." }, 401);
      }
      throw err;
    }

    await pool.query(
      `INSERT INTO burner_profile (address, pseudo, message, instagram, telegram, twitter, discord, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (address) DO UPDATE SET
         pseudo = EXCLUDED.pseudo, message = EXCLUDED.message,
         instagram = EXCLUDED.instagram, telegram = EXCLUDED.telegram,
         twitter = EXCLUDED.twitter, discord = EXCLUDED.discord,
         updated_at = EXCLUDED.updated_at`,
      [addr, pseudo, message, instagram, telegram, twitter, discord, now]
    );

    return c.json({ success: true, address: addr });
  } catch (err) {
    console.error("[POST /burners/profile]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post('/rpc', async (c) => {
  try {
    const ip = getClientIp(c);
    await ensureDb();

    const { rows } = await pool.query(
      `SELECT bump_rate_limit($1, $2, $3) AS ok`,
      [`rpc:${ip}`, 60_000, 30]
    );
    if (!rows[0]?.ok) {
      return c.json({ error: 'Too many requests' }, 429);
    }

    const body = await c.req.json();
    const batch = Array.isArray(body) ? body : [body];

    for (const call of batch) {
      if (!call || typeof call.method !== 'string' || !ALLOWED_RPC_METHODS.has(call.method)) {
        return c.json({ error: `Method not allowed: ${call?.method ?? 'unknown'}` }, 403);
      }
    }

    const res = await fetch(process.env.ALCHEMY_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), // on renvoie le body original (single ou batch)
    });

    const data = await res.json();
    return c.json(data, res.status as 200 | 400 | 500);
  } catch (err) {
    console.error('[POST /rpc]', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;