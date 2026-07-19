import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { desc, eq, count } from "drizzle-orm";
// @ts-ignore: Could not find declaration file for module 'pg'.
import pg from "pg";
import { cors } from "hono/cors";
import { Transaction } from "ethers";
import { setPixel, clearPixel, sliceRegion, tileStats } from "./canvasCache"; // NOUVEAU
import { createClient } from "@supabase/supabase-js";
import { WebSocket as WS } from "ws";
import { compress } from 'hono/compress';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { realtime: { transport: WS as any } }
);

const app = new Hono();
const ALLOWED_RPC_METHODS = new Set([
  'eth_getBalance',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_chainId',
  'net_version',
  'eth_getBlockByNumber',
  'eth_blockNumber',
  'eth_getTransactionCount',
  'eth_sendRawTransaction', // validée séparément ci-dessous via décodage du destinataire
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
]);
// Méthodes qui doivent obligatoirement cibler CONTRACT_ADDRESS
const CONTRACT_SCOPED_METHODS = new Set(['eth_call', 'eth_estimateGas', 'eth_fillTransaction']);
const MAX_RPC_BATCH = 20;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? '';
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set — required to scope /rpc calls");
const SLICE_RATE_WINDOW_MS = 1_000;
const SLICE_RATE_MAX = 5; // 5 req/s/IP — impossible à atteindre en usage humain normal

// Décode une transaction signée (eth_sendRawTransaction) pour vérifier sa cible.
function extractRawTxTarget(call: any): string | null {
  const raw = call?.params?.[0];
  if (typeof raw !== 'string') return null;
  try {
    const tx = Transaction.from(raw);
    return tx.to ? tx.to.toLowerCase() : null;
  } catch {
    return null;
  }
}
const CANVAS_H = 31250;

app.use('/*', cors({
  origin: (origin, c) => {
    if (!origin) return null;
    const allowed = [
      'https://cryptopixelv1.netlify.app',
      'https://testnet--cryptopixelv1.netlify.app'
    ];
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  // credentials retiré : aucune route n'utilise de cookies/session,
  // et il ne doit jamais coexister avec un reflet d'origine arbitraire.
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
  max: 15,
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
  // Railway écrase systématiquement X-Real-IP à l'edge avec l'IP réelle
  // du client — contrairement à X-Forwarded-For, qui est une chaîne
  // concaténée qu'un client peut falsifier en y injectant sa propre
  // valeur avant que Railway n'ajoute la sienne.
  return c.req.header('x-real-ip') ?? 'unknown';
}

app.use('/canvas-slice-binary', compress());

// Doit rester en sync avec src/constants/palette.ts (frontend) — même ordre, même casse ignorée
const COLOR_PALETTE = [
  '#8c00ff', '#7300ff', '#4c00ff',
  '#1500ff', '#0044ff', '#00f2ff',
  '#03ffc4', '#00ff08', '#ABFF66',
  '#fffb00', '#ff9327', '#ff7300',
  '#ff0000', '#ff00c8', '#ea00ff',
  '#FFFFFF', '#C2C2C2', '#757575', '#383838', '#202020', '#000000',
  '#AB5236', '#5F2F1D',
  '#006012', '#5e0101', '#090069', '#610069',
  '#e5baff', '#FFB3BA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
].map(c => c.toLowerCase());
const COLOR_INDEX = new Map(COLOR_PALETTE.map((c, i) => [c, i]));
const SLICE_ROW_CAP = 1_000_000; // aligné sur REGION_ROW_CAP frontend

app.get("/canvas-slice-binary", async (c) => {
  const t0 = Date.now();
  const startX = Number(c.req.query('startX'));
  const startY = Number(c.req.query('startY'));
  const w = Number(c.req.query('w'));
  const h = Number(c.req.query('h'));
  const account = (c.req.query('account') ?? '').toLowerCase();

  if (![startX, startY, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || w * h > SLICE_ROW_CAP) {
    return c.json({ error: "Invalid or out-of-bounds dimensions" }, 400);
  }

  const ip = getClientIp(c);
  await ensureDb();
  const { rows } = await pool.query(
    `SELECT bump_rate_limit($1, $2, $3) AS ok`,
    [`slice:${ip}`, SLICE_RATE_WINDOW_MS, SLICE_RATE_MAX]
  );
  if (!rows[0]?.ok) {
    return c.json({ error: "Too many requests" }, 429);
  }

  try {
    const buffer = sliceRegion(startX, startY, w, h, account);
    console.log(`[canvas-slice-binary] buffer built (${buffer.length} bytes) in ${Date.now() - t0}ms`);
    return c.body(new Uint8Array(buffer), 200, { 'Content-Type': 'application/octet-stream' });
  } catch (err) {
    console.error("[GET /canvas-slice-binary]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

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

    if (pseudo.length > 32) return c.json({ error: "pseudo must be <= 32 characters" }, 400);
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
      [`rpc:${ip}`, 60_000, 120]
    );
    if (!rows[0]?.ok) {
      return c.json({ error: 'Too many requests' }, 429);
    }

    const rawText = await c.req.text();
    if (!rawText) {
      return c.json({ error: 'Empty request body' }, 400);
    }
    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const batch = Array.isArray(body) ? body : [body];
    if (batch.length > MAX_RPC_BATCH) {
      return c.json({ error: `Batch too large (max ${MAX_RPC_BATCH})` }, 400);
    }

    for (const call of batch) {
      if (!call || typeof call.method !== 'string') {
        return c.json({ error: `Method not allowed: ${call?.method ?? 'unknown'}` }, 403);
      }

      if (call.method === 'eth_sendRawTransaction') {
        const to = extractRawTxTarget(call);
        if (!to || to !== CONTRACT_ADDRESS.toLowerCase()) {
          return c.json({ error: 'Target contract not allowed' }, 403);
        }
        continue;
      }

      if (CONTRACT_SCOPED_METHODS.has(call.method)) {
        const to = call?.params?.[0]?.to?.toLowerCase?.();
        if (!to || to !== CONTRACT_ADDRESS.toLowerCase()) {
          return c.json({ error: 'Target contract not allowed' }, 403);
        }
        continue;
      }

      if (!ALLOWED_RPC_METHODS.has(call.method)) {
        return c.json({ error: `Method not allowed: ${call.method}` }, 403);
      }
    }

    const res = await fetch(process.env.ALCHEMY_RPC_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return c.json(data, res.status as 200 | 400 | 500);
  } catch (err) {
    console.error('[POST /rpc]', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});
// ── Hydratation du cache canvas + synchro Realtime ────────────────────────────
async function hydrateCache() {
  console.log("[cache] hydrating from DB...");
  const t0 = Date.now();

  const { rows: canvasRows } = await pool.query({
    text: `SELECT x, y, color, painter FROM offchain_canvas`,
    rowMode: 'array',
  });
  for (const [x, y, color, painter] of canvasRows) {
    setPixel(x, y, Number(color), false, painter ?? '');
  }

  const { rows: pixelRows } = await pool.query({
    text: `SELECT x, y, color, owner FROM ponder_public.pixel`,
    rowMode: 'array',
  });
  for (const [x, y, colorHex, owner] of pixelRows) {
    const idx = COLOR_INDEX.get(String(colorHex).toLowerCase()) ?? 0;
    setPixel(x, y, idx, true, owner ?? '');
  }

  const stats = tileStats();
  console.log(`[cache] hydrated ${canvasRows.length + pixelRows.length} pixels in ${Date.now() - t0}ms, tiles=${stats.activeTiles}/${stats.maxTiles}`);
}

await hydrateCache();

// ── Hydratation du cache canvas + synchro Realtime ────────────────────────────
let realtimeChannel: ReturnType<typeof supabaseAdmin.channel> | null = null;
let reconnectAttempts = 0;
let lastGoodStatusAt = Date.now();

function subscribeCanvasCacheSync() {
  if (realtimeChannel) {
    supabaseAdmin.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseAdmin
    .channel('canvas-cache-sync')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'offchain_canvas' }, (payload) => {
      const { x, y, color, painter } = payload.new as any;
      setPixel(x, y, Number(color), false, painter ?? '');
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offchain_canvas' }, (payload) => {
      const { x, y, color, painter } = payload.new as any;
      setPixel(x, y, Number(color), false, painter ?? '');
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'offchain_canvas' }, (payload) => {
      const old = payload.old as any;
      let x = old?.x;
      let y = old?.y;

      if (x == null || y == null) {
        const rawId = old?.id as string | undefined;
        if (rawId) {
          const [xStr, yStr] = rawId.split('-');
          const parsedX = parseInt(xStr, 10);
          const parsedY = parseInt(yStr, 10);
          if (!isNaN(parsedX) && !isNaN(parsedY)) {
            x = parsedX;
            y = parsedY;
          }
        }
      }

      if (x != null && y != null) clearPixel(x, y);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'freeze_events' }, (payload) => {
      const { x, y, color, owner } = payload.new as any;
      const idx = COLOR_INDEX.get(String(color).toLowerCase()) ?? 0;
      setPixel(x, y, idx, true, owner ?? '');
    })
    .subscribe((status) => {
      console.log(`[cache] realtime sync status: ${status}`);

      if (status === 'SUBSCRIBED') {
        reconnectAttempts = 0;
        lastGoodStatusAt = Date.now();
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reconnectAttempts++;
        const delayMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
        console.error(`[cache] realtime sync degraded (${status}), reconnect attempt ${reconnectAttempts} in ${delayMs}ms`);

        const staleFor = Date.now() - lastGoodStatusAt;
        setTimeout(async () => {
          if (staleFor > 60_000) {
            try {
              await hydrateCache();
            } catch (err) {
              console.error('[cache] re-hydration after realtime outage failed', err);
            }
          }
          subscribeCanvasCacheSync();
        }, delayMs);
      }
    });
}

await hydrateCache();
subscribeCanvasCacheSync();

export default app;