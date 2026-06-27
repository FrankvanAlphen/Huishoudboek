import pg from "pg";
import { config, isProd } from "./config.js";

const { Pool } = pg;

/**
 * Eén gedeelde connection-pool. In fase 1 gebruiken we parameter-queries direct
 * via pg; vanaf fase 2 introduceren we een typed query-laag (Kysely) bovenop
 * dezelfde pool zodra er echte CRUD ontstaat.
 */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Railway-PostgreSQL vereist meestal SSL in productie.
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
});

export async function healthcheckDb(): Promise<boolean> {
  const { rows } = await pool.query<{ ok: number }>("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
