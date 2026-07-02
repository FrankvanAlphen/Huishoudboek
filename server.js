import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));

/* ---- Beveiligingsheaders ---- */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env.COOKIE_INSECURE !== "true") res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});

/* ---- Configuratie ---- */
// BELANGRIJK: zet APP_SECRET in Railway op een lange willekeurige waarde.
// Zonder APP_SECRET maken we een tijdelijke willekeurige sleutel (veilig, maar cookies verlopen bij herstart).
const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.APP_SECRET) console.warn("WAARSCHUWING: APP_SECRET is niet gezet. Er is nu een tijdelijke sleutel gemaakt; je moet na elke herstart opnieuw inloggen. Zet APP_SECRET in Railway (Variables) op een lange willekeurige tekst.");
// Cookie standaard alleen via HTTPS (Secure). Voor lokaal testen op http: COOKIE_INSECURE=true.
const COOKIE_SECURE = process.env.COOKIE_INSECURE !== "true";

/* ---- De twee gebruikers met hun TIJDELIJKE startwachtwoord ----
   Bij de eerste keer inloggen moet ieder een eigen nieuw wachtwoord kiezen.
   Tip: zet FRANK_TEMP_PW / KIMBERLEY_TEMP_PW in Railway om de startwachtwoorden niet in de broncode te hebben. */
const SEED_USERS = [
  { username: "frank", displayName: "Frank van Alphen", tempPassword: process.env.FRANK_TEMP_PW || "@chterZoom24!" },
  { username: "kimberley", displayName: "Kimberley Lagendijk", tempPassword: process.env.KIMBERLEY_TEMP_PW || "V00rZoom24!" },
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

/* ---- Sessie-cookie ----
   De cookie bevat: gebruikersnaam.vervaldatum.handtekening.
   De handtekening is óók gebaseerd op (een afgeleide van) het wachtwoord, zodat
   wachtwoord wijzigen automatisch álle oude cookies ongeldig maakt. */
const MAX_AGE = 60 * 60 * 24 * 180; // 180 dagen
const pwTag = (passwordHash) => crypto.createHash("sha256").update(String(passwordHash)).digest("hex").slice(0, 16);
function tokenFor(user) {
  const exp = Date.now() + MAX_AGE * 1000;
  const payload = `${user.username}.${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(`${payload}.${pwTag(user.passwordHash)}`).digest("hex");
  return `${payload}.${sig}`;
}
const cookieFor = (user) =>
  `hh_auth=${tokenFor(user)}; HttpOnly; Path=/; Max-Age=${MAX_AGE}; SameSite=Strict${COOKIE_SECURE ? "; Secure" : ""}`;
const clearCookie = () => `hh_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${COOKIE_SECURE ? "; Secure" : ""}`;
async function currentUser(req) {
  try {
    const raw = parseCookies(req).hh_auth || "";
    const parts = raw.split(".");
    if (parts.length !== 3) return null;
    const [username, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!exp || exp < Date.now()) return null; // verlopen
    const u = await findUser(username);
    if (!u) return null;
    const expected = crypto.createHmac("sha256", SECRET).update(`${username}.${expStr}.${pwTag(u.passwordHash)}`).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return u; // geldig: geef de hele gebruiker terug
  } catch { return null; } // bij twijfel: afwijzen (fail closed)
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
      await pool.query(`ALTER TABLE app_state ADD COLUMN IF NOT EXISTS rev bigint NOT NULL DEFAULT 0`);
      await pool.query(`CREATE TABLE IF NOT EXISTS state_snapshots (
        id bigserial PRIMARY KEY, data jsonb NOT NULL,
        updated_by text, rev bigint, at timestamptz NOT NULL DEFAULT now())`);
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
    const r = await pool.query(`SELECT data, updated_by, updated_at, rev FROM app_state WHERE id = 1`);
    if (!r.rows[0]) return { state: null, rev: 0 };
    return { state: r.rows[0].data, updatedBy: r.rows[0].updated_by, updatedAt: r.rows[0].updated_at, rev: Number(r.rows[0].rev) || 0 };
  }
  return memState ? { state: memState.data, updatedBy: memState.updatedBy, updatedAt: memState.updatedAt, rev: memState.rev || 0 } : { state: null, rev: 0 };
}
// Slaat op met optimistische concurrency: alleen als expectedRev overeenkomt met de huidige rev.
// Bij null expectedRev wordt de check overgeslagen (bijv. eerste seed). Geeft de nieuwe rev terug,
// of { conflict: true, current } als een ander intussen heeft opgeslagen.
async function writeState(data, updatedBy, expectedRev) {
  if (dbReady) {
    const cur = await pool.query(`SELECT rev FROM app_state WHERE id = 1`);
    const curRev = cur.rows[0] ? Number(cur.rows[0].rev) || 0 : 0;
    if (expectedRev != null && cur.rows[0] && curRev !== Number(expectedRev)) {
      const full = await readState();
      return { conflict: true, current: full };
    }
    const newRev = curRev + 1;
    await pool.query(
      `INSERT INTO app_state (id, data, updated_by, updated_at, rev) VALUES (1, $1, $2, now(), $3)
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_by = $2, updated_at = now(), rev = $3`,
      [data, updatedBy, newRev]
    );
    // Snapshot voor herstel; bewaar de laatste 40.
    try {
      await pool.query(`INSERT INTO state_snapshots (data, updated_by, rev) VALUES ($1, $2, $3)`, [data, updatedBy, newRev]);
      await pool.query(`DELETE FROM state_snapshots WHERE id NOT IN (SELECT id FROM state_snapshots ORDER BY id DESC LIMIT 40)`);
    } catch (e) { console.error("Snapshot mislukt:", e.message); }
    return { rev: newRev };
  }
  const curRev = memState ? (memState.rev || 0) : 0;
  if (expectedRev != null && memState && curRev !== Number(expectedRev)) {
    return { conflict: true, current: { state: memState.data, updatedBy: memState.updatedBy, updatedAt: memState.updatedAt, rev: curRev } };
  }
  memState = { data, updatedBy, updatedAt: new Date().toISOString(), rev: curRev + 1 };
  return { rev: curRev + 1 };
}
async function listSnapshots(limit) {
  if (dbReady) {
    const r = await pool.query(`SELECT id, updated_by, rev, at FROM state_snapshots ORDER BY id DESC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({ id: x.id, updatedBy: x.updated_by, rev: Number(x.rev), at: x.at }));
  }
  return [];
}
async function readSnapshot(id) {
  if (dbReady) {
    const r = await pool.query(`SELECT data FROM state_snapshots WHERE id = $1`, [id]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  return null;
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
// vangt fouten uit async-handlers netjes op (anders blijft een verzoek hangen)
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ingelogd? zo niet: 401. Bij twijfel afwijzen.
const requireLogin = ah(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  req.user = u; req.username = u.username;
  next();
});
// ingelogd én startwachtwoord al gewijzigd. Blokkeert data-toegang tot het wachtwoord is gewijzigd.
const requireAuth = ah(async (req, res, next) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: "unauthorized" });
  if (u.mustChange) return res.status(403).json({ error: "must-change" });
  req.user = u; req.username = u.username;
  next();
});

/* ---- Rem op inlogpogingen: per IP én per gebruikersnaam (tegen wachtwoord-raden) ---- */
const ipHits = new Map(), userHits = new Map();
function tooMany(map, key, max, windowMs) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now - e.ts > windowMs) { map.set(key, { count: 1, ts: now }); return false; }
  e.count++; return e.count > max;
}
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",").pop().trim() || req.socket.remoteAddress || "?";

/* ---- API ---- */
app.get("/api/health", (req, res) => res.json({ ok: true, db: dbReady }));

app.get("/api/users", ah(async (req, res) => res.json({ users: await listUsers() })));

app.get("/api/me", ah(async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.json({ authed: false, db: dbReady });
  res.json({ authed: true, user: { username: u.username, displayName: u.displayName }, mustChange: u.mustChange, db: dbReady });
}));

app.post("/api/login", ah(async (req, res) => {
  const ip = clientIp(req);
  const { username, password } = req.body || {};
  const uname = String(username || "");
  if (tooMany(ipHits, ip, 15, 5 * 60 * 1000) || tooMany(userHits, uname.toLowerCase(), 10, 10 * 60 * 1000))
    return res.status(429).json({ error: "te-veel-pogingen" });
  const u = await findUser(uname);
  if (!u) { crypto.scryptSync(String(password || ""), Buffer.from("00000000000000000000000000000000", "hex"), 64); return res.status(401).json({ error: "wrong-credentials" }); } // dummy werk: gelijke tijd of de naam nu bestaat of niet
  if (!verifyPassword(password || "", u.passwordHash)) return res.status(401).json({ error: "wrong-credentials" });
  ipHits.delete(ip); userHits.delete(uname.toLowerCase());
  res.setHeader("Set-Cookie", cookieFor(u));
  await addLog(u.username, u.displayName, "ingelogd");
  res.json({ ok: true, user: { username: u.username, displayName: u.displayName }, mustChange: u.mustChange, db: dbReady });
}));

app.post("/api/change-password", requireLogin, ah(async (req, res) => {
  const newPassword = (req.body && req.body.newPassword) || "";
  if (String(newPassword).length < 8) return res.status(400).json({ error: "te-kort" });
  const newHash = hashPassword(newPassword);
  await setUserPassword(req.username, newHash);
  await addLog(req.username, req.user.displayName, "wachtwoord gewijzigd");
  // geef een verse cookie mee (de oude is nu ongeldig omdat hij aan het oude wachtwoord hing)
  res.setHeader("Set-Cookie", cookieFor({ username: req.username, passwordHash: newHash }));
  res.json({ ok: true });
}));

app.post("/api/logout", ah(async (req, res) => {
  const u = await currentUser(req);
  if (u) await addLog(u.username, u.displayName, "uitgelogd");
  res.setHeader("Set-Cookie", clearCookie());
  res.json({ ok: true });
}));

app.get("/api/state", requireAuth, ah(async (req, res) => {
  try {
    const r = await readState();
    res.json({ state: r.state == null ? null : r.state, updatedBy: r.updatedBy || null, updatedAt: r.updatedAt || null, rev: r.rev || 0, db: dbReady });
  } catch (e) {
    console.error("State lezen mislukt:", e.message);
    res.json({ state: memState ? memState.data : null, rev: memState ? memState.rev || 0 : 0, db: dbReady });
  }
}));

app.put("/api/state", requireAuth, ah(async (req, res) => {
  const data = req.body && req.body.state;
  if (data == null) return res.status(400).json({ error: "geen toestand meegegeven" });
  const expectedRev = req.body && req.body.rev != null ? Number(req.body.rev) : null;
  const by = (req.user && req.user.displayName) || req.username;
  try {
    const result = await writeState(data, by, expectedRev);
    if (result && result.conflict) {
      // Iemand anders (ander apparaat/gebruiker) heeft intussen opgeslagen.
      return res.status(409).json({ conflict: true, current: result.current, db: dbReady });
    }
    res.json({ ok: true, db: dbReady, updatedBy: by, rev: result ? result.rev : undefined });
  } catch (e) {
    console.error("State opslaan mislukt:", e.message);
    memState = { data, updatedBy: by, updatedAt: new Date().toISOString(), rev: (memState ? memState.rev || 0 : 0) + 1 };
    res.json({ ok: true, db: false, updatedBy: by, rev: memState.rev });
  }
}));

// Lijst van herstelpunten (snapshots).
app.get("/api/snapshots", requireAuth, ah(async (req, res) => {
  try { res.json({ snapshots: await listSnapshots(40), db: dbReady }); }
  catch (e) { console.error("Snapshots lezen mislukt:", e.message); res.json({ snapshots: [], db: dbReady }); }
}));
// Eén snapshot ophalen om te herstellen (client zet 'm daarna via PUT terug).
app.get("/api/snapshots/:id", requireAuth, ah(async (req, res) => {
  try { const data = await readSnapshot(Number(req.params.id)); if (data == null) return res.status(404).json({ error: "niet gevonden" }); res.json({ state: data }); }
  catch (e) { console.error("Snapshot lezen mislukt:", e.message); res.status(500).json({ error: "fout" }); }
}));

app.post("/api/log", requireAuth, ah(async (req, res) => {
  const action = String((req.body && req.body.action) || "").slice(0, 300);
  if (action) await addLog(req.username, req.user.displayName, action);
  res.json({ ok: true });
}));

// Debug: zet binnenkomende transactieregels in de server-terminal (zichtbaar in de Railway-logs).
// Puur voor het nalopen van de import/vermogens-afleiding; slaat niets op.
app.post("/api/debug-log", requireAuth, ah(async (req, res) => {
  const label = String((req.body && req.body.label) || "debug").slice(0, 120);
  const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines.slice(0, 500) : [];
  const who = (req.user && req.user.displayName) || req.username;
  console.log(`\n===== DEBUG · ${label} · ${who} · ${new Date().toISOString()} =====`);
  for (const l of lines) console.log("  " + String(l).slice(0, 400));
  console.log(`===== einde debug (${lines.length} regel(s)) =====\n`);
  res.json({ ok: true });
}));

app.get("/api/activity", requireAuth, ah(async (req, res) => res.json({ activity: await getActivity(150) })));

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

/* ---- Foutafhandeling (als laatste) ---- */
app.use((err, req, res, next) => {
  console.error("Onverwachte fout:", err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "server-fout" });
});

/* ---- Start ---- */
const PORT = process.env.PORT || 3000;
initDb().finally(() => app.listen(PORT, () => console.log(`Huishoudboekje draait op poort ${PORT}`)));
