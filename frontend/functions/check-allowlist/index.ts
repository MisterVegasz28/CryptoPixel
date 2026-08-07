import type { Handler } from "@netlify/functions";
import { Pool } from "pg";

// Le pool est réutilisé entre invocations tant que la function reste "chaude" (cold start évité)
let pool: Pool;
function getPool() {
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 1,
            ssl: { rejectUnauthorized: false }, // requis pour le pooler Supabase
        });
    }
    return pool;
}

export const handler: Handler = async (event) => {
    const address = event.queryStringParameters?.address?.toLowerCase();

    if (!address || !/^0x[a-f0-9]{40}$/.test(address)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Adresse invalide" }) };
    }

    try {
        const { rows } = await getPool().query(
            "SELECT 1 FROM beta_allowlist WHERE address = $1 LIMIT 1",
            [address]
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ allowed: rows.length > 0 }),
        };
    } catch (err) {
        console.error("check-allowlist error:", err);
        return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur" }) };
    }
};