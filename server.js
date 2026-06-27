import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));

/* ---- Configuratie ---- */
const SECRET = process.env.APP_SECRET || "huishoudboekje-vaste-sleutel-v2";

/* ---- De twee gebruikers met hun TIJDELIJKE startwachtwoord ----
   Bij de eerste keer inloggen moet ieder een eigen nieuw wachtwoord kiezen. */
const SEED_USERS = [
  { username: "frank", displayName: "Frank van Alphen", tempPassword: "@chterZoom24!" },
  { username: "kimberley", displayName: "Kimberley Lagendijk", tempPassword: "V00rZoom24!" },
];

/* ---- Wachtwoord-hashing (scrypt, ingebouwd in Node) ---- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, 64);
  return salt.toString("hex") + ":" + dk.toString("hex");
}
function verifyPassword(pw, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(":");
    const dk = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64);
    const a = Buffer.from(hashHex, "hex");
    return a.length === dk.length && crypto.timingSafeEqual(a, dk);
  } catch { return false; }
}

/* ---- Cookie-handtekening (weet WIE er is ingelogd) ---- */
const sign = (username) => crypto.createHmac("sha256", SECRET).update(username).digest("hex");
const cookieFor = (username) =>
  `hh_auth=${username}.${sign(username)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax`;
function currentUser(req) {
  const raw = parseCookies(req).hh_auth || "";
  const i = raw.indexOf(".");
  if (i < 0) return null;
  const username = raw.slice(0, i), sig = raw.slice(i + 1);
  return sig === sign(username) ? username : null;
}
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* ---- Opslag: PostgreSQL indien beschikbaar, anders tijdelijk geheugen ---- */
let pool = null;
let dbReady = false;
let memUsers = null;          // Map username -> {username, displayName, passwordHash, mustChange}
let memState = null;          // {data, updatedBy, updatedAt}
let memLog = [];              // [{username, displayName, action, at}]

if (process.env.DATABASE_URL) {
  const needsSsl = /sslmode=require/i.test(process.env.DATABASE_URL) || process.env.DATABASE_SSL === "true";
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: needsSsl ? { rejectUnauthorized: false } : false, max: 4 });
}

async function initDb() {
  if (pool) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
        id integer PRIMARY KEY DEFAULT 1, data jsonb NOT NULL,
        updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT app_state_single CHECK (id = 1))`);
      await pool.query(`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS updated_by text`);
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        username text PRIMARY KEY, display_name text NOT NULL,
        password_hash text NOT NULL, must_change boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
        id bigserial PRIMARY KEY, username text NOT NULL, display_name text NOT NULL,
        action text NOT NULL, at timestamptz NOT NULL DEFAULT now())`);
      dbReady = true;
      console.log("Verbonden met database — gebruikers, logboek en data worden blijvend opgeslagen.");
    } catch (e) {
      dbReady = false;
      console.error("Database-initialisatie mislukt, val terug op tijdelijk geheugen:", e.message);
    }
  } else {
    console.log("Geen DATABASE_URL — de app draait met tijdelijk geheugen (verdwijnt bij herstart).");
  }
  await ensureSeedUsers();
}

async function ensureSeedUsers() {
  if (dbReady) {
    for (const u of SEED_USERS) {
      await pool.query(
        `INSERT INTO users (username, display_name, password_hash, must_change)
         VALUES ($1, $2, $3, true) ON CONFLICT (username) DO NOTHING`,
        [u.username, u.displayName, hashPassword(u.tempPassword)]
      );
    }
  } else {
    memUsers = new Map();
    for (const u of SEED_USERS)
      memUsers.set(u.username, { username: u.username, displayName: u.displayName, passwordHash: hashPassword(u.tempPassword), mustChange: true });
  }
}

async function findUser(username) {
  if (dbReady) {
    const r = await pool.query(`SELECT username, display_name, password_hash, must_change FROM users WHERE username = $1`, [username]);
    if (!r.rows[0]) return null;
    const x = r.rows[0];
    return { username: x.username, displayName: x.display_name, passwordHash: x.password_hash, mustChange: x.must_change };
  }
  return (memUsers && memUsers.get(username)) || null;
}
async function listUsers() {
  if (dbReady) {
    const r = await pool.query(`SELECT username, display_name FROM users ORDER BY display_name`);
    return r.rows.map((x) => ({ username: x.username, displayName: x.display_name }));
  }
  return [...(memUsers ? memUsers.values() : [])].map((u) => ({ username: u.username, displayName: u.displayName }));
}
async function setUserPassword(username, hash) {
  if (dbReady) await pool.query(`UPDATE users SET password_hash = $1, must_change = false WHERE username = $2`, [hash, username]);
  else { const u = memUsers.get(username); if (u) { u.passwordHash = hash; u.mustChange = false; } }
}
async function readState() {
  if (dbReady) {
    const r = await pool.query(`SELECT data, updated_by, updated_at FROM app_state WHERE id = 1`);
    if (!r.rows[0]) return { state: null };
    return { state: r.rows[0].data, updatedBy: r.rows[0].updated_by, updatedAt: r.rows[0].updated_at };
  }
  return memState ? { state: memState.data, updatedBy: memState.updatedBy, updatedAt: memState.updatedAt } : { state: null };
}
async function writeState(data, updatedBy) {
  if (dbReady)
    await pool.query(
      `INSERT INTO app_state (id, data, updated_by, updated_at) VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_by = $2, updated_at = now()`,
      [data, updatedBy]
    );
  else memState = { data, updatedBy, updatedAt: new Date().toISOString() };
}
async function addLog(username, displayName, action) {
  if (dbReady) await pool.query(`INSERT INTO audit_log (username, display_name, action) VALUES ($1, $2, $3)`, [username, displayName, action]);
  else { memLog.unshift({ username, displayName, action, at: new Date().toISOString() }); memLog = memLog.slice(0, 250); }
}
async function getActivity(limit) {
  if (dbReady) {
    const r = await pool.query(`SELECT username, display_name, action, at FROM audit_log ORDER BY at DESC, id DESC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({ username: x.username, displayName: x.display_name, action: x.action, at: x.at }));
  }
  return memLog.slice(0, limit);
}

/* ---- Middleware ---- */
function requireAuth(req, res, next) {
  const username = currentUser(req);
  if (!username) return res.status(401).json({ error: "unauthorized" });
  req.username = username;
  next();
}

/* ---- API ---- */
app.get("/api/health", (req, res) => res.json({ ok: true, db: dbReady }));

app.get("/api/users", async (req, res) => res.json({ users: await listUsers() }));

app.get("/api/me", async (req, res) => {
  const username = currentUser(req);
  if (!username) return res.json({ authed: false, db: dbReady });
  const u = await findUser(username);
  if (!u) return res.json({ authed: false, db: dbReady });
  res.json({ authed: true, user: { username: u.username, displayName: u.displayName }, mustChange: u.mustChange, db: dbReady });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = await findUser(username || "");
  if (!u || !verifyPassword(password || "", u.passwordHash)) return res.status(401).json({ error: "wrong-credentials" });
  res.setHeader("Set-Cookie", cookieFor(u.username));
  await addLog(u.username, u.displayName, "ingelogd");
  res.json({ ok: true, user: { username: u.username, displayName: u.displayName }, mustChange: u.mustChange, db: dbReady });
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const newPassword = (req.body && req.body.newPassword) || "";
  if (String(newPassword).length < 8) return res.status(400).json({ error: "te-kort" });
  const u = await findUser(req.username);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  await setUserPassword(u.username, hashPassword(newPassword));
  await addLog(u.username, u.displayName, "wachtwoord gewijzigd");
  res.json({ ok: true });
});

app.post("/api/logout", async (req, res) => {
  const username = currentUser(req);
  if (username) { const u = await findUser(username); if (u) await addLog(u.username, u.displayName, "uitgelogd"); }
  res.setHeader("Set-Cookie", "hh_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/state", requireAuth, async (req, res) => {
  try {
    const r = await readState();
    res.json({ state: r.state == null ? null : r.state, updatedBy: r.updatedBy || null, updatedAt: r.updatedAt || null, db: dbReady });
  } catch (e) {
    console.error("State lezen mislukt:", e.message);
    res.json({ state: memState ? memState.data : null, db: dbReady });
  }
});

app.put("/api/state", requireAuth, async (req, res) => {
  const data = req.body && req.body.state;
  if (data == null) return res.status(400).json({ error: "geen toestand meegegeven" });
  const u = await findUser(req.username);
  const by = (u && u.displayName) || req.username;
  try {
    await writeState(data, by);
    res.json({ ok: true, db: dbReady, updatedBy: by });
  } catch (e) {
    console.error("State opslaan mislukt:", e.message);
    memState = { data, updatedBy: by, updatedAt: new Date().toISOString() };
    res.json({ ok: true, db: false, updatedBy: by });
  }
});

app.post("/api/log", requireAuth, async (req, res) => {
  const action = String((req.body && req.body.action) || "").slice(0, 300);
  if (action) { const u = await findUser(req.username); if (u) await addLog(u.username, u.displayName, action); }
  res.json({ ok: true });
});

app.get("/api/activity", requireAuth, async (req, res) => res.json({ activity: await getActivity(150) }));

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
    res.status(200).send("<h1>Huishoudboekje</h1><p>De frontend-build (map <code>dist</code>) ontbreekt. Controleer dat <code>npm run build</code> tijdens de deploy is uitgevoerd.</p>");
  });
}

/* ---- Start ---- */
const PORT = process.env.PORT || 3000;
initDb().finally(() => app.listen(PORT, () => console.log(`Huishoudboekje draait op poort ${PORT}`)));
