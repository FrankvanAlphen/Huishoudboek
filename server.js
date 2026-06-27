import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));

/* ---- Configuratie (met veilige standaarden, zodat de app altijd start) ---- */
const PASSWORD = process.env.APP_PASSWORD || "Huishouden2026";
const SECRET = process.env.APP_SECRET || "hh-secret-" + PASSWORD;
const TOKEN = crypto.createHmac("sha256", SECRET).update("huishoudboekje").digest("hex");

/* ---- Database (optioneel). Geen DATABASE_URL? Dan tijdelijk geheugen. ---- */
let pool = null;
let dbReady = false;
let memoryState = null;

if (process.env.DATABASE_URL) {
  const needsSsl = /sslmode=require/i.test(process.env.DATABASE_URL) || process.env.DATABASE_SSL === "true";
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 4,
  });
}

async function initDb() {
  if (!pool) {
    console.log("Geen DATABASE_URL ingesteld — de app draait met tijdelijk geheugen (data verdwijnt bij herstart).");
    return;
  }
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_state (
         id integer PRIMARY KEY DEFAULT 1,
         data jsonb NOT NULL,
         updated_at timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT app_state_single CHECK (id = 1)
       )`
    );
    dbReady = true;
    console.log("Verbonden met database — data wordt blijvend opgeslagen.");
  } catch (e) {
    dbReady = false;
    console.error("Database-initialisatie mislukt, val terug op tijdelijk geheugen:", e.message);
  }
}

/* ---- Authenticatie via een ondertekend cookie ---- */
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
const isAuthed = (req) => parseCookies(req).hh_auth === TOKEN;
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}

/* ---- API ---- */
app.get("/api/health", (req, res) => res.json({ ok: true, db: dbReady }));

app.get("/api/me", (req, res) => res.json({ authed: isAuthed(req), db: dbReady }));

app.post("/api/login", (req, res) => {
  const given = (req.body && req.body.password) || "";
  if (given === PASSWORD) {
    res.setHeader(
      "Set-Cookie",
      `hh_auth=${TOKEN}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax`
    );
    return res.json({ ok: true, db: dbReady });
  }
  res.status(401).json({ error: "wrong-password" });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", "hh_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/state", requireAuth, async (req, res) => {
  try {
    if (dbReady) {
      const r = await pool.query("SELECT data FROM app_state WHERE id = 1");
      return res.json({ state: r.rows[0] ? r.rows[0].data : null, db: true });
    }
    res.json({ state: memoryState, db: false });
  } catch (e) {
    console.error("State lezen mislukt:", e.message);
    res.json({ state: memoryState, db: false });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  const data = req.body && req.body.state;
  if (data == null) return res.status(400).json({ error: "geen toestand meegegeven" });
  try {
    if (dbReady) {
      await pool.query(
        `INSERT INTO app_state (id, data, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
        [data]
      );
      return res.json({ ok: true, db: true });
    }
    memoryState = data;
    res.json({ ok: true, db: false });
  } catch (e) {
    console.error("State opslaan mislukt:", e.message);
    memoryState = data; // niets verliezen binnen deze sessie
    res.json({ ok: true, db: false });
  }
});

/* ---- Statische frontend + SPA-fallback ---- */
const dist = path.join(__dirname, "dist");
const hasBuild = fs.existsSync(path.join(dist, "index.html"));

if (hasBuild) {
  app.use(express.static(dist));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).json({ error: "not found" });
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).json({ error: "not found" });
    res
      .status(200)
      .send(
        "<h1>Huishoudboekje</h1><p>De frontend-build (map <code>dist</code>) ontbreekt. " +
          "Controleer dat <code>npm run build</code> tijdens de deploy is uitgevoerd.</p>"
      );
  });
}

/* ---- Start ---- */
const PORT = process.env.PORT || 3000;
initDb().finally(() => {
  app.listen(PORT, () => console.log(`Huishoudboekje draait op poort ${PORT}`));
});
