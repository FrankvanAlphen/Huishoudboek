import { Kysely, PostgresDialect } from "kysely";
import { pool } from "../db.js";
import type { Database } from "./schema.js";

/**
 * Typed query-laag (Kysely) bovenop dezelfde pg-pool die migratie/seed gebruiken.
 * Vanaf fase 2 verloopt alle CRUD via deze instantie; ruwe SQL blijft alleen voor
 * migraties en de health-check.
 */
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
