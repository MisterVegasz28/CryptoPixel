import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { desc, eq, count } from "drizzle-orm";
// @ts-ignore: Could not find declaration file for module 'pg'.
import pg from "pg";
import { cors } from "hono/cors";

// ── API allégée : ne sert plus que le leaderboard et les profils burners ─────
// Le paint, les soldes et le nettoyage de pixels sont gérés côté edge function
// Supabase (RPC direct + sacrifice FIFO). Plus de route /paint ici.
const app = new Hono();

app.use("/*", cors());
app.use("/sql/*", client({ db, schema }));
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// Pool pg — uniquement pour la table offchain burner_profile (non gérée par Ponder)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // En prod, on vérifie le certificat TLS. En dev/local, on tolère un cert
  // auto-signé (Supabase local, tunnels, etc.).
  ssl: process.env.NODE_ENV === "production" ? true : { rejectUnauthorized: false },
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

// On attend l'init de la table avant de servir une requête qui en a besoin,
// sans bloquer le démarrage du serveur (top-level await pas toujours dispo).
let dbReadyPromise: Promise<void> | null = null;
function ensureDb() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDb().catch((err) => {
      console.error("[initDb]", err);
      dbReadyPromise = null; // on retentera au prochain appel
      throw err;
    });
  }
  return dbReadyPromise;
}

// ── GET /burners — leaderboard (nécessite Ponder pour scanner l'historique) ──
app.get("/burners", async (c) => {
  try {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const [stats, [{ value: total }]] = await Promise.all([
      db.select().from(schema.burnerStats)
        .orderBy(desc(schema.burnerStats.totalFrozen))
        .limit(limit).offset(offset),
      db.select({ value: count() }).from(schema.burnerStats),
    ]);

    if (stats.length === 0) return c.json({ burners: [], total });

    const addresses = stats.map((s) => s.address);

    await ensureDb();
    const { rows: profiles } = await pool.query(
      `SELECT * FROM burner_profile WHERE address = ANY($1)`,
      [addresses]
    );
    const profileMap: Record<string, typeof profiles[0]> = {};
    profiles.forEach((p: any) => { profileMap[p.address] = p; });

    const burners = stats.map((stat, index) => {
      const profile = profileMap[stat.address] ?? null;
      return {
        rank: offset + index + 1,
        address: stat.address,
        totalFrozen: stat.totalFrozen.toString(),
        lastFrozenAt: stat.lastFrozenAt,
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

    // CORRECTION CRITIQUE : le message signé doit committer sur TOUT le
    // contenu du profil, pas seulement address+timestamp. Avant ce fix, une
    // signature valide pour un timestamp donné restait valide pour n'importe
    // quel pseudo/message/lien social envoyé dans la même fenêtre de 5 min.
    // ⚠️ Le front doit construire EXACTEMENT le même message avant signature.
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

export default app;