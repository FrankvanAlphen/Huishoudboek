import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { pool } from "./db.js";

/** Voert de seed-bestanden uit db/seed uit. De seed zelf is idempotent. */
async function seed(): Promise<void> {
  const seedDir = fileURLToPath(new URL("../../../db/seed", import.meta.url));
  const files = fs
    .readdirSync(seedDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedDir, file), "utf8");
    await pool.query(sql);
    console.log(`seed uitgevoerd: ${file}`);
  }
  console.log("Seed klaar.");
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    void pool.end();
    process.exit(1);
  });
