
// ---- Basisgereedschap ----
// Kleine, pure helpers zonder kennis van de app: geld (centen <-> tekst), datums en
// maandnamen, hashes voor dubbeldetectie, en het lui laden van de Excel-bibliotheek.
// Regel: hier komt niets in dat iets weet van posten, transacties of schermen.
// xlsx wordt alleen geladen wanneer je écht een Excel-bestand kiest (scheelt ~450 kB bij het opstarten).
let _xlsxPromise = null;
const loadXLSX = () => (_xlsxPromise = _xlsxPromise || import("xlsx"));

/**
 * Huishoudboekje — testprototype (fase 2 + 3) in één React-bestand.
 * Gebouwd op je echte Excel-structuur en je echte ING-CSV-formaat.
 * Kern: upload je ING-CSV → de app leidt je transactie-voor-transactie door de
 * regels die je aandacht nodig hebben (categorie kiezen of opmerking toevoegen)
 * via een popup, en leert er regels van zodat het elke keer minder werk wordt.
 * Alle data zit in geheugen (React-state). Bedragen overal in hele centen.
 */

/* ----------------------------------------------------------------- Tokens */
function parseDecimalToCents(input) {
  let s = String(input).trim().replace(/[€\s\u00a0]/g, "");
  if (s === "") return 0;
  const hasComma = s.includes(","), hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // de laatste van de twee is de decimaalscheiding; de andere is duizendtal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot && s.split(".").length > 2) {
    // meerdere punten = duizendtalscheiding (bv. 1.234.567)
    s = s.replace(/\./g, "");
  } // één punt = decimaalpunt: laten staan
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`Kan bedrag niet lezen: "${input}"`);
  return Math.round(v * 100);
}
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatEUR = (c) => eur.format(c / 100);
const editEUR = (c) => (c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function parseINGDate(s) {
  const t = String(s).trim();
  let m;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  if ((m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  if ((m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  throw new Error(`Ongeldige datum: ${s}`);
}
// Een transactie kan optioneel in een andere periode meetellen dan z'n datum (bijv. een 2027-datum die voor 2026 is).
const effDate = (t) => (t && t.periodDate) ? t.periodDate : (t ? t.date : "");
const effYear = (t) => Number(effDate(t).slice(0, 4));
const effMonth = (t) => Number(effDate(t).slice(5, 7));

/* ------------------------------------------------------------- Begroting */
const distributeEven = (avg) => Array.from({ length: 12 }, () => avg);
const sumMonths = (m) => m.reduce((a, b) => a + b, 0);
function checkDistribution(avg, months) {
  const target = avg * 12, actual = sumMonths(months);
  return { ok: actual - target === 0, target, actual, diff: actual - target };
}

/* ----------------------------------------------------------------- Saldo */
const MND_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MND_LANG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
// Kleur per importbatch, zodat je in de lijst herkent welke transacties samen zijn ingelezen.
const BATCH_COLORS = ["#7c3aed", "#0891b2", "#d97706", "#2563eb", "#db2777", "#16a34a", "#9333ea", "#0d9488"];
function batchColor(id) { return id ? BATCH_COLORS[parseInt(fnv1a(String(id)), 16) % BATCH_COLORS.length] : "transparent"; }
// Groepeer transacties per importbatch (nieuwste eerst).
function batchesOf(txns) {
  const m = new Map();
  for (const t of txns || []) {
    if (!t.batchId) continue;
    const e = m.get(t.batchId) || { id: t.batchId, at: t.importedAt || "", count: 0 };
    e.count++;
    if (t.importedAt && (!e.at || t.importedAt > e.at)) e.at = t.importedAt;
    m.set(t.batchId, e);
  }
  return [...m.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
const fmtDateTime = (iso) => { try { const d = new Date(iso); if (isNaN(d)) return ""; return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; } };

/* --------------------------------------------------------------- Dedup */
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const contentKey = (t) => [t.date, String(t.amountCents), norm(t.iban), norm(t.description), norm(t.mutationType)].join("|");
const dedupHash = (t) => fnv1a(contentKey(t));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function fmtWhen(at) {
  try { return new Date(at).toLocaleString("nl-NL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export { _xlsxPromise, loadXLSX, parseDecimalToCents, eur, formatEUR, editEUR, parseINGDate, effDate, effYear, effMonth, distributeEven, sumMonths, checkDistribution, MND_KORT, MND_LANG, BATCH_COLORS, batchColor, batchesOf, fmtDateTime, fnv1a, norm, contentKey, dedupHash, slug, fmtWhen };
