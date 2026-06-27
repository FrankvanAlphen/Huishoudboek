import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";

/**
 * Eenvoudige, vooruit-only migratierunner. Voert elk .sql-bestand uit db/migrations
 * één keer uit (op alfabetische volgorde) binnen een transactie en houdt bij welke
 * migraties zijn toegepast in de tabel schema_migrations.
 */
async function migrate(): Promise<void> {
  const migrationsDir = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const already = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if ((already.rowCount ?? 0) > 0) {
      console.log(`overslaan (al toegepast): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`toegepast: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`migratie mislukt: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("Migraties klaar.");
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    void pool.end();
    process.exit(1);
  });
