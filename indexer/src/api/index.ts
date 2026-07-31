import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { desc, eq, count, gt, inArray } from "drizzle-orm";
// @ts-ignore: Could not find declaration file for module 'pg'.
import pg from "pg";
import { cors } from "hono/cors";
import { Transaction } from "ethers";
import { setPixel, clearPixel, sliceRegion, tileStats, clearCache } from "./canvasCache";
import { createClient } from "@supabase/supabase-js";
import { WebSocket as WS } from "ws";
import { compress } from 'hono/compress';
import { createPublicClient, http, parseAbi } from "viem";
import { timingSafeEqual as nodeTimingSafeEqual } from "crypto";
import { polygon, polygonAmoy } from "viem/chains";


const WS_PING_INTERVAL_MS = 20_000; // < timeout idle probable du proxy Railway (heartbeat applicatif Supabase = 25s)

class LoggingWebSocket extends WS {
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols);

    this.on('open', () => {
      // Ping actif au niveau TCP/WS, indépendant du heartbeat applicatif
      // Supabase Realtime (25s) : évite qu'un proxy intermédiaire (edge
      // Railway) ne considère la connexion comme inactive et la coupe en
      // 1006 avant que le heartbeat applicatif n'ait pu s'exécuter.
      this.pingInterval = setInterval(() => {
        if (this.readyState === WS.OPEN) this.ping();
      }, WS_PING_INTERVAL_MS);
    });

    this.on('close', (code, reason) => {
      console.error(`[ws raw close] code=${code} reason=${reason?.toString() || '(empty)'}`);
      if (this.pingInterval) clearInterval(this.pingInterval);
    });
    this.on('error', (err) => {
      console.error('[ws raw error]', err);
    });
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is not set");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
const RECONCILE_CHAIN_ID = Number(process.env.CHAIN_ID ?? '');
if (!RECONCILE_CHAIN_ID) throw new Error("CHAIN_ID is not set — required to select the correct viem chain");
const reconcileChain = RECONCILE_CHAIN_ID === 137 ? polygon : polygonAmoy;

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: LoggingWebSocket as any,
      heartbeatCallback: (status: string) => {
        console.log(`[realtime heartbeat] status=${status} at=${new Date().toISOString()}`);
        if (status === 'disconnected') console.warn('[realtime] heartbeat: connexion down (retry géré par la lib)');
      },
    },
  }
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

// ── Rate limit générique pour les routes de lecture publiques ────────────────
// (/burners, /burners/:address, /airdrop) — jamais atteignable en usage humain
// normal, sert juste à éviter qu'un scraping agressif ou un abus volontaire
// ne sature le pool Postgres (max: 15). Même limite mono-instance que
// sliceRateLimits/rpcRateLimits ci-dessus : à revoir si scaling horizontal.
const readRateLimits = new Map<string, { count: number; resetAt: number }>();
const READ_RATE_WINDOW_MS = 60_000;
const READ_RATE_MAX = 60; // 60 req/min/IP

function checkReadRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = readRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    readRateLimits.set(ip, { count: 1, resetAt: now + READ_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= READ_RATE_MAX) return false;
  entry.count++;
  return true;
}

// Purge périodique, identique au pattern déjà utilisé pour sliceRateLimits.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of readRateLimits) {
    if (now > entry.resetAt) readRateLimits.delete(ip);
  }
}, 60_000);

// ── Rate-limit en mémoire, volontairement PAS via bump_rate_limit ───────────
// bump_rate_limit = une écriture Postgres par appel : ok pour les routes
// signées (paint/lock/profile), plafonnées par nature (signature wallet).
// Contre-productif ici (/rpc, /canvas-slice-binary, /burners*, /airdrop) :
// volume de lecture publique bien plus élevé, on ferait plus de charge DB
// que le problème qu'on évite. Limite connue : dilué en multi-instance
// (mono-instance Railway aujourd'hui) — impact accepté = "scraping un peu
// plus rapide sur données déjà publiques", pas de perte de fonds/sécu.
// Si scaling réel un jour : Redis/Upstash pour ces routes-là, pas Postgres.
const sliceRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkSliceRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = sliceRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    sliceRateLimits.set(ip, { count: 1, resetAt: now + SLICE_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= SLICE_RATE_MAX) return false;
  entry.count++;
  return true;
}

// Même principe, mais pondéré par la taille du batch : 1 appel JSON-RPC = 1 crédit,
// pas 1 requête HTTP = 1 crédit. Budget identique à avant (120 "appels"/min/IP).
const rpcRateLimits = new Map<string, { count: number; resetAt: number }>();
const RPC_RATE_WINDOW_MS = 60_000;
const RPC_RATE_MAX = 120;

function checkRpcRateLimit(ip: string, weight: number): boolean {
  const now = Date.now();
  const entry = rpcRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rpcRateLimits.set(ip, { count: weight, resetAt: now + RPC_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count + weight > RPC_RATE_MAX) return false;
  entry.count += weight;
  return true;
}

// Purge périodique des entrées expirées, sinon la Map grossit indéfiniment
// avec chaque IP unique jamais revue.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of sliceRateLimits) {
    if (now > entry.resetAt) sliceRateLimits.delete(ip);
  }
}, 60_000);

// Décode une transaction signée (eth_sendRawTransaction) pour vérifier sa cible.
function extractRawTxTarget(call: any): string | null {
  const raw = call?.params?.[0];
  if (typeof raw !== 'string') return null;
  try {
    const tx = Transaction.from(raw);
    // Vérifie aussi le chainId de la tx signée, pas seulement la cible.
    const expectedChainId = BigInt(process.env.CHAIN_ID ?? 80002);
    if (tx.chainId !== expectedChainId) return null;
    return tx.to ? tx.to.toLowerCase() : null;
  } catch {
    return null;
  }
}

const CANVAS_H = 31250;
const CANVAS_W = 32000;

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length, 32);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  bufA.copy(pa);
  bufB.copy(pb);
  // nodeTimingSafeEqual exige des buffers de même taille (garanti ici par le
  // padding), donc plus jamais d'early-return sur la longueur : le temps
  // d'exécution est désormais indépendant de la longueur du secret comparé.
  const lengthsMatch = bufA.length === bufB.length;
  const contentsMatch = nodeTimingSafeEqual(pa, pb);
  return lengthsMatch && contentsMatch;
}

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

// ⚠️ DÉPENDANCE D'INFRA ASSUMÉE — relu et accepté en connaissance de cause
// (audit sécu du 29/07/26) : cette confiance dans x-real-ip est valide UNIQUEMENT
// tant que Railway reste le edge frontal direct de ce service. Si un jour un
// CDN/reverse-proxy est ajouté devant Railway, ou si le service est migré
// ailleurs, x-real-ip redevient un header arbitraire contrôlable par
// l'attaquant et TOUT le rate-limiting de /canvas-slice-binary et /rpc tombe
// silencieusement à zéro (pas d'erreur, juste plus de protection). Décision
// prise : ne pas complexifier maintenant (pas de proxy prévu), mais si
// l'infra change un jour, revalider cette fonction AVANT tout déploiement.
function getClientIp(c: import('hono').Context): string {
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

  if (
    ![startX, startY, w, h].every(Number.isFinite) ||
    w <= 0 || h <= 0 || w * h > SLICE_ROW_CAP ||
    startX < 0 || startY < 0 ||
    startX + w > CANVAS_W || startY + h > CANVAS_H
  ) {
    return c.json({ error: "Invalid or out-of-bounds dimensions" }, 400);
  }

  const ip = getClientIp(c);
  if (!checkSliceRateLimit(ip)) {
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
  if (!checkReadRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many requests" }, 429);
  }
  try {
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
  if (!checkReadRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many requests" }, 429);
  }
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
  if (!checkReadRateLimit(getClientIp(c))) {
    return c.json({ error: "Too many requests" }, 429);
  }
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

    // Défense en profondeur : ces champs ne sont aujourd'hui affichés que
    // via du JSX (auto-échappé côté React), mais on refuse dès l'écriture
    // tout caractère de contrôle ou balise HTML pour rester safe si ce
    // contenu est un jour exposé ailleurs (bot Discord, export, SSR...).
    const FORBIDDEN_CHARS_REGEX = /[<>\u0000-\u001F\u007F]/;
    for (const [field, value] of Object.entries({ pseudo, message, instagram, telegram, twitter, discord })) {
      if (typeof value === "string" && FORBIDDEN_CHARS_REGEX.test(value)) {
        return c.json({ error: `${field} contains forbidden characters` }, 400);
      }
    }

    const [stat] = await db
      .select()
      .from(schema.burnerStats)
      .where(eq(schema.burnerStats.address, addr));

    if (!stat) {
      return c.json({ error: "Address has no frozen pixels — not a burner" }, 403);
    }

    const { recoverTypedDataAddress } = await import("viem");
    const domain = {
      name: 'CryptoPixel', version: '1',
      chainId: Number(process.env.CHAIN_ID),
      verifyingContract: CONTRACT_ADDRESS as `0x${string}`,
    };
    const types = {
      Profile: [
        { name: 'painter', type: 'address' },
        { name: 'pseudo', type: 'string' },
        { name: 'message', type: 'string' },
        { name: 'instagram', type: 'string' },
        { name: 'telegram', type: 'string' },
        { name: 'twitter', type: 'string' },
        { name: 'discord', type: 'string' },
        { name: 'timestamp', type: 'uint256' },
      ],
    } as const;
    let recoveredAddr: string;
    try {
      recoveredAddr = await recoverTypedDataAddress({
        domain, types, primaryType: 'Profile',
        message: { painter: addr, pseudo, message, instagram, telegram, twitter, discord, timestamp },
        signature: signature as `0x${string}`,
      });
    } catch {
      return c.json({ error: "Signature verification failed" }, 401);
    }

    if (recoveredAddr.toLowerCase() !== addr) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Fix : anti-replay vérifié EN PREMIER, avant de consommer le rate-limit
    // par adresse — cohérent avec enforce-pixel-quota / paint-pixels.
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

    const { rows: rl } = await pool.query(
      `SELECT bump_rate_limit($1, $2, $3) AS ok`,
      [`profile:${addr}`, 60000, 10]
    );
    if (!rl[0]?.ok) {
      return c.json({ error: "Too many requests, retry in a few moments." }, 429);
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

    // Pondéré par la taille réelle du batch, plus par requête HTTP.
    if (!checkRpcRateLimit(ip, batch.length)) {
      return c.json({ error: 'Too many requests' }, 429);
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

// ── POST /internal/reconcile-balances ──────────────────────────────────────
// Garde-fou du cache de soldes (schema.burnerBalance) : réhydrate un échantillon
// d'adresses actives récentes depuis la vraie source (balanceOf/lockedPremine
// on-chain) et corrige toute divergence détectée. Économise le RPC au quotidien
// (getUsableTokens ne lit plus la chain) tout en gardant un filet de sécurité
// qui s'auto-corrige. Protégé par CRON_SECRET, à appeler via pg_cron.
// lockedPremine n'est PAS vérifié ici : il n'est plus stocké dans le cache
// (voir index.ts) car sa valeur initiale n'a pas d'event associé. Il est
// recalculé à la volée à partir de totalClaimants (airdropStats), lui-même
// fiable car alimenté par l'event AirdropClaimed. Seul `balance` (alimenté
// par Transfer) peut dériver et a donc besoin de ce garde-fou.
const RECONCILE_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

const reconcileClient = createPublicClient({
  chain: reconcileChain,
  transport: http(process.env.ALCHEMY_RPC_URL),
});

// Retry ciblé sur la contention de lock pendant les reorgs Ponder (55P03).
// Ne catch QUE ce code — toute autre erreur remonte immédiatement, sans
// masquer un vrai bug derrière un retry silencieux.
async function withLockTimeoutRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 300 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const code = err?.cause?.code ?? err?.code;
      if (code !== '55P03') throw err; // pas une erreur de lock_timeout → on ne retry pas
      lastErr = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * 2 ** i; // 300ms, 600ms, 1200ms
        console.warn(`[reconcile] lock timeout, retry ${i + 1}/${attempts - 1} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

app.post('/internal/reconcile-balances', async (c) => {
  const secret = c.req.header('x-cron-secret');
  if (!secret || !timingSafeEqualStr(secret, process.env.CRON_SECRET ?? '')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const cutoff = Math.floor(Date.now() / 1000) - 900; // adresses actives ces 15 dernières minutes
    const recent = await withLockTimeoutRetry(() =>
      db
        .select({ address: schema.burnerBalance.address })
        .from(schema.burnerBalance)
        .where(gt(schema.burnerBalance.updatedAt, cutoff))
    );

    let divergences = 0;

    // Multicall3 natif viem : 1 appel réseau pour tout le lot (au lieu d'1 par adresse).
    const realBalances = await reconcileClient.multicall({
      contracts: recent.map(({ address }) => ({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: RECONCILE_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })),
      allowFailure: true,
    });

    const cachedRows = await withLockTimeoutRetry(() =>
      db
        .select()
        .from(schema.burnerBalance)
        .where(inArray(schema.burnerBalance.address, recent.map((r) => r.address)))
    );
    const cachedByAddress = new Map(cachedRows.map((row) => [row.address, row]));

    for (let i = 0; i < recent.length; i++) {
      const { address } = recent[i];
      const result = realBalances[i];
      if (result.status !== 'success') continue;
      const realBalance = result.result as bigint;

      const cached = cachedByAddress.get(address);
      if (cached && cached.balance !== realBalance) {
        divergences++;
        console.error(
          `[reconcile] DIVERGENCE for ${address}: cached=${cached.balance} real=${realBalance}`
        );
        await pool.query(
          `UPDATE burner_balance SET balance = $2 WHERE address = $1`,
          [address, realBalance.toString()]
        );
      }
    }

    return c.json({ checked: recent.length, divergences });
  } catch (err) {
    console.error("[POST /internal/reconcile-balances]", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});
// ── Hydratation du cache canvas + synchro Realtime ────────────────────────────
async function hydrateCache() {
  console.log("[cache] hydrating from DB...");
  const t0 = Date.now();

  clearCache();

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

let lastGoodStatusAt = Date.now();
let disconnectedAt: number | null = null;
let isConnected = false;

async function subscribeCanvasCacheSync() {
  supabaseAdmin
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
        // Mesure le temps de coupure RÉEL (depuis le début de la
        // déconnexion), pas le temps écoulé depuis le dernier SUBSCRIBED
        // confirmé — sinon un blip d'1s après 6h sans coupure déclenche
        // à tort une réhydratation complète de 10s.
        const staleFor = disconnectedAt !== null ? Date.now() - disconnectedAt : 0;
        isConnected = true;
        lastGoodStatusAt = Date.now();
        disconnectedAt = null;
        if (staleFor > 60_000) {
          hydrateCache().catch((err) => console.error('[cache] re-hydration failed', err));
        }
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        isConnected = false;
        if (disconnectedAt === null) disconnectedAt = Date.now();
        // pas de disconnect(), pas de removeChannel, pas de recréation :
        // le Socket phoenix interne gère seul son propre retry + rejoin du channel.
      }
    });
}

await hydrateCache();
await subscribeCanvasCacheSync();

export default app;