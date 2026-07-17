import { debugLog } from "./api.js";
import { parseDecimalToCents, editEUR, parseINGDate, effDate, effYear, effMonth, sumMonths, dedupHash, slug } from "./lib.js";

// ---- Rekenhart ----
// Alle financiele logica, puur en zonder UI: saldoketen, categoriseren, herkennen van
// spaarrekeningen (savingsCatForTx is de enige bron van waarheid), vermogensmutaties,
// voorschotten/verrekeningen, CSV- en begrotingsimport, en zoeksuggesties.
// Deze module is los te testen: geen React, geen DOM.

function computeRunningSaldo(carryIn, actuals) {
  const out = []; let begin = carryIn;
  for (let i = 0; i < 12; i++) {
    const net = actuals[i].income - actuals[i].expense, end = begin + net;
    out.push({ month: i + 1, begin, ...actuals[i], net, end });
    begin = end;
  }
  return out;
}
// Actueel banksaldo uit de "Saldo na mutatie"-kolom: het saldo na de meest recente transactie.
// Robuust bij meerdere transacties op de laatste dag: het eindsaldo is het saldo dat niet
// het "saldo-ervoor" van een andere transactie van diezelfde dag is.
function bankBalanceFromTxns(txns) {
  const withSaldo = (txns || []).filter((t) => t && t.saldoNaMutatieCents != null);
  if (!withSaldo.length) return null;
  const maxDate = withSaldo.reduce((m, t) => (t.date > m ? t.date : m), "");
  const day = withSaldo.filter((t) => t.date === maxDate);
  if (day.length === 1) return day[0].saldoNaMutatieCents;
  const befores = new Set(day.map((t) => t.saldoNaMutatieCents - t.amountCents));
  const finals = day.filter((t) => !befores.has(t.saldoNaMutatieCents));
  return (finals[0] || day[day.length - 1]).saldoNaMutatieCents;
}
// Controleregel op de "Saldo na mutatie"-kolom: vormen de saldo's een sluitende keten?
// Elke "saldo-ervoor" (saldo − bedrag) hoort het saldo van een andere transactie te zijn,
// op precies één na (het allereerste startsaldo). Meer losse einden = ontbrekende transacties.
function saldoChainGaps(txns) {
  const w = (txns || []).filter((t) => t && t.saldoNaMutatieCents != null);
  if (w.length < 2) return 0;
  const saldos = new Map(), befores = new Map();
  for (const t of w) {
    saldos.set(t.saldoNaMutatieCents, (saldos.get(t.saldoNaMutatieCents) || 0) + 1);
    const b = t.saldoNaMutatieCents - t.amountCents;
    befores.set(b, (befores.get(b) || 0) + 1);
  }
  let unmatched = 0;
  for (const [v, c] of befores) { const s = saldos.get(v) || 0; if (c > s) unmatched += c - s; }
  return Math.max(0, unmatched - 1);
}
// Het écht startsaldo (vóór de eerste geïmporteerde transactie), afgeleid uit de saldo-keten.
// = het "saldo-ervoor" dat zelf géén saldo van een andere transactie is (de start van de keten).
function openingFromChain(txns) {
  const w = (txns || []).filter((t) => t && t.saldoNaMutatieCents != null);
  if (!w.length) return null;
  const saldos = new Set(w.map((t) => t.saldoNaMutatieCents));
  const starts = w.filter((t) => !saldos.has(t.saldoNaMutatieCents - t.amountCents));
  if (starts.length === 1) return starts[0].saldoNaMutatieCents - starts[0].amountCents;
  const earliest = w.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  return earliest.saldoNaMutatieCents - earliest.amountCents;
}
function reconcileImport(items, existingCountByHash) {
  const seen = new Map();
  return items.map((item) => {
    const hash = dedupHash(item);
    const occ = (seen.get(hash) || 0) + 1; seen.set(hash, occ);
    return { item, hash, occurrence: occ, isNew: occ > (existingCountByHash.get(hash) || 0) };
  });
}

/* --------------------------------------------------------------- Regels */
function matchCondition(tx, c) {
  if (c.field === "amount") {
    const amt = Math.abs(tx.amountCents);
    if (c.operator === "amountRange") {
      if (c.min == null && c.max == null) return false;
      if (c.min != null && amt < c.min) return false;
      if (c.max != null && amt > c.max) return false;
      return true;
    }
    return c.amount != null && amt === c.amount; // exact bedrag
  }
  if (c.operator === "amountRange") { // legacy: bereik op het (getekende) bedrag
    if (c.min != null && tx.amountCents < c.min) return false;
    if (c.max != null && tx.amountCents > c.max) return false;
    return true;
  }
  if (c.value == null) return false;
  const n = String(c.value).toLowerCase();
  const test = (val) => { if (val == null) return false; const h = String(val).toLowerCase(); if (c.operator === "equals") return h === n; if (c.operator === "contains") return h.includes(n); if (c.operator === "startsWith") return h.startsWith(n); return false; };
  if (c.field === "both") return test(tx.name) || test(tx.omschrijving);
  const field = { iban: tx.iban, name: tx.name, description: tx.omschrijving, mededelingen: tx.description, mutationType: tx.mutationType }[c.field];
  return test(field);
}
const ruleMatches = (tx, r) => r.conditions.length > 0 && r.conditions.every((c) => matchCondition(tx, c));
function matchSpaarcode(tx, categories) {
  // Eén bron van waarheid: exact dezelfde matching als de vermogens-afleiding
  // (uitsluitend vermogensrekeningen, via spaarcode of expliciete code in de naam).
  const hit = savingsCatForTx(tx, categories);
  return hit && hit.cat ? { categoryId: hit.cat.id, ruleId: "spaarcode" } : null;
}
// Haal een spaardeposito-/Oranje-spaarrekeningcode uit de mededelingen (bijv. "Oranje spaarrekening M96388351"
// of "Naar Spaardeposito X15431287"). UITSLUITEND deze twee expliciete formuleringen tellen;
// code = optionele letter + 6–10 cijfers. Woorden als "gespaard" of "spaargeld" zijn géén indicatie.
function extractOranjeCode(text) {
  const m = String(text || "").match(/(?:oranje\s+spaarrekening|spaardeposito)\s+([A-Za-z]?\d{6,10})\b/i);
  return m ? m[1].toUpperCase() : null;
}
// Korte typeaanduiding voor de hint (alleen als de code zelf geen omschrijving oplevert).
function savingsKeyword(text) {
  const m = String(text || "").match(/\b(spaardeposito|spaarrekening|spaargeld)\b/i);
  return m ? m[1] : "";
}
// Bepaal de spaarrekening waar een mutatie bij hoort — uitsluitend via een expliciete
// "Oranje spaarrekening"- of "Spaardeposito"-code in de mededelingen.
function extractSavingsAccount(tx) {
  const text = `${tx.name || ""} ${tx.omschrijving || ""} ${tx.description || ""}`;
  const code = extractOranjeCode(text);
  if (code) return { id: code, kind: "code", hint: savingsHint(tx.description || "", code) || savingsKeyword(text) };
  return null;
}
// Korte omschrijving van het rekeningtype dat na de code staat (t/m vóór "Valutadatum").
function savingsHint(desc, code) {
  const s = String(desc || "");
  const i = s.toUpperCase().indexOf(String(code || "").toUpperCase());
  if (i < 0 || !code) return "";
  return s.slice(i + code.length).replace(/valutadatum.*$/i, "").replace(/\s+/g, " ").trim().slice(0, 48).trim();
}
// Spaarrekeningen die in de transacties voorkomen maar (nog) niet aan een spaarpost gekoppeld zijn.
function unknownSavingsCodes(transactions, categories) {
  const known = new Set((categories || []).map((c) => String(c.spaarcode || "").trim().toUpperCase()).filter(Boolean));
  const map = new Map();
  for (const t of transactions || []) {
    const acc = extractSavingsAccount(t);
    if (!acc || known.has(acc.id.toUpperCase())) continue;
    const e = map.get(acc.id) || { code: acc.id, kind: acc.kind, hint: acc.hint || "", count: 0, inCents: 0, outCents: 0 };
    e.count++;
    if (t.amountCents > 0) e.inCents += t.amountCents; else e.outCents += Math.abs(t.amountCents);
    if (!e.hint && acc.hint) e.hint = acc.hint;
    map.set(acc.id, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
// ---- Vermogensmutaties: direct geboekt + afgeleid uit de omschrijving ----
// Een interne overboeking wordt in het grootboek vaak op "Tussenrekening" (of een andere gewone
// post) geboekt; bij ING Oranje Spaarrekeningen en Spaardeposito's is er dan géén tweede
// transactieregel. De vermogensmutatie wordt daarom afgeleid uit de mededelingen.
// Uitsluitend BESTAANDE vermogensrekeningen; er wordt hier nooit iets aangemaakt.

// Zoek de vermogensrekening die bij de mededelingen hoort. Resultaat:
//   { cat }          — gevonden (via het Code/IBAN-veld, of via een expliciete code in de rekeningnaam)
//   { unlinkedCode } — er staat wél een expliciete "Oranje spaarrekening/Spaardeposito <code>" in de
//                      mededelingen, maar geen enkele bestaande vermogensrekening verwijst ernaar
//   null             — geen aanwijzing voor een vermogensrekening
function savingsCatForTx(tx, categories) {
  const savings = (categories || []).filter((c) => c.type === "savings");
  const text = `${tx.name || ""} ${tx.omschrijving || ""} ${tx.description || ""}`;
  const hay = text.toLowerCase();
  for (const c of savings) { const code = String(c.spaarcode || "").trim().toLowerCase(); if (code && hay.includes(code)) return { cat: c }; }
  const code = extractOranjeCode(text);
  if (code) { const m = savings.find((c) => String(c.naam || "").toUpperCase().includes(code)); return m ? { cat: m } : { unlinkedCode: code }; }
  return null;
}
function derivedPotMutation(tx, categories) {
  // Al (deels) rechtstreeks op een vermogensrekening geboekt? Dan telt die directe boeking; niet dubbel afleiden.
  const savingsIds = new Set((categories || []).filter((c) => c.type === "savings").map((c) => c.id));
  if ((tx.allocations || []).some((a) => savingsIds.has(a.categoryId))) return null;
  const hit = savingsCatForTx(tx, categories);
  if (!hit || !hit.cat) return null;
  // Teken bepaalt de richting: geld verlaat de betaalrekening (−) = storting op de spaarrekening;
  // geld komt binnen (+) = opname van de spaarrekening.
  return { categoryId: hit.cat.id, amountCents: tx.amountCents };
}
// Bij/Af per vermogensrekening: directe allocaties op de spaarpost + afgeleide mutaties.
// Conventie (gelijk aan de bestaande): cents < 0 → storting (dep), cents > 0 → opname (wd).
// depDerived/wdDerived = het deel dat uit de mededelingen is afgeleid (voor transparantie in de UI).
function potFlows(transactions, categories) {
  const flows = new Map();
  const bump = (cid, cents, derived) => {
    const f = flows.get(cid) || { dep: 0, wd: 0, depDerived: 0, wdDerived: 0 };
    if (cents < 0) { f.dep += Math.abs(cents); if (derived) f.depDerived += Math.abs(cents); }
    else { f.wd += cents; if (derived) f.wdDerived += cents; }
    flows.set(cid, f);
  };
  const savingsIds = new Set((categories || []).filter((c) => c.type === "savings").map((c) => c.id));
  for (const t of transactions || []) {
    for (const a of (t.allocations || [])) if (savingsIds.has(a.categoryId)) bump(a.categoryId, a.amountCents, false);
    const d = derivedPotMutation(t, categories);
    if (d) bump(d.categoryId, d.amountCents, true);
  }
  return flows;
}
// Mutatie-overzicht per vermogensrekening (voor de uitklap in het Vermogen-tabblad):
// elke regel = één transactie die deze rekening raakt, direct geboekt óf afgeleid uit de
// mededelingen. deltaCents = het effect op de rekening (+ = storting, − = opname).
function potMutations(transactions, categories) {
  const map = new Map();
  const push = (cid, m) => { const a = map.get(cid) || []; a.push(m); map.set(cid, a); };
  const savingsIds = new Set((categories || []).filter((c) => c.type === "savings").map((c) => c.id));
  const catName = (id) => { const c = (categories || []).find((x) => x.id === id); return c ? c.naam.split(":")[0] : ""; };
  for (const t of transactions || []) {
    for (const a of (t.allocations || [])) if (savingsIds.has(a.categoryId)) push(a.categoryId, { txId: t.id, date: effDate(t), name: t.name || "", deltaCents: -a.amountCents, derived: false, via: "" });
    const d = derivedPotMutation(t, categories);
    if (d) { const first = (t.allocations || [])[0]; push(d.categoryId, { txId: t.id, date: effDate(t), name: t.name || "", deltaCents: -d.amountCents, derived: true, via: first ? catName(first.categoryId) : "nog toe te kennen" }); }
  }
  for (const a of map.values()) a.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  return map;
}
// Maandelijks vermogensverloop voor een jaar: per maand het cumulatieve saldo per rekening + totaal.
// Startpunt = startsaldo (opening) + alle mutaties in eerdere jaren; daarna loopt het saldo per maand
// op/af met de netto mutatie van die maand. Zo zie je de curve van je vermogen over het jaar.
function potHistory(transactions, categories, pots, jaartal) {
  const savings = (categories || []).filter((c) => c.type === "savings");
  const potOf = (cid) => (pots || []).find((p) => p.categoryId === cid) || {};
  // Netto mutatie (in cents, + = erbij) per rekening, per maand van dit jaar, plus het saldo vóór dit jaar.
  const monthly = new Map(); // cid -> number[12]
  const before = new Map();  // cid -> saldo aan het begin van dit jaar (na eerdere jaren)
  for (const c of savings) { monthly.set(c.id, Array.from({ length: 12 }, () => 0)); before.set(c.id, potOf(c.id).opening || 0); }
  const apply = (cid, cents, date) => {
    if (!monthly.has(cid)) return;
    const y = Number(String(date).slice(0, 4));
    const m = Number(String(date).slice(5, 7)) - 1;
    // effect op de rekening: storting (bankbedrag < 0) = +, opname (bankbedrag > 0) = −
    const delta = -cents;
    if (y < jaartal) before.set(cid, before.get(cid) + delta);
    else if (y === jaartal && m >= 0 && m < 12) monthly.get(cid)[m] += delta;
  };
  const savingsIds = new Set(savings.map((c) => c.id));
  for (const t of transactions || []) {
    const date = effDate(t);
    for (const a of (t.allocations || [])) if (savingsIds.has(a.categoryId)) apply(a.categoryId, a.amountCents, date);
    const d = derivedPotMutation(t, categories);
    if (d) apply(d.categoryId, d.amountCents, date);
  }
  // Cumulatief per rekening + totaal per maand
  const perAccount = savings.map((c) => {
    const start = before.get(c.id);
    const mths = monthly.get(c.id);
    let run = start;
    const series = mths.map((v) => (run += v));
    return { id: c.id, naam: c.naam.split(":")[0], start, series, end: run };
  });
  const total = Array.from({ length: 12 }, (_, m) => perAccount.reduce((s, a) => s + a.series[m], 0));
  const startTotal = perAccount.reduce((s, a) => s + a.start, 0);
  return { perAccount, total, startTotal, endTotal: total[11] };
}
// Bouwt per binnenkomende transactie een leesbare debugregel en stuurt die naar de server-terminal.
function debugLogImport(txns, categories) {
  try {
    const catName = (id) => { const c = (categories || []).find((x) => x.id === id); return c ? c.naam.split(":")[0] : id; };
    const lines = (txns || []).map((t) => {
      const bedrag = editEUR(Math.abs(t.amountCents));
      const richting = t.amountCents < 0 ? "AF" : "BIJ";
      const post = (t.allocations || []).length ? (t.allocations || []).map((a) => catName(a.categoryId)).join(" + ") : "— (te sorteren)";
      const d = derivedPotMutation(t, categories);
      let vermogen = "geen vermogensmutatie";
      if (d) { const naar = d.amountCents < 0; vermogen = `VERMOGEN: ${catName(d.categoryId)} ${naar ? "+" : "−"}${editEUR(Math.abs(d.amountCents))} (afgeleid uit mededelingen)`; }
      else { const hit = savingsCatForTx(t, categories); if (hit && hit.unlinkedCode) vermogen = `spaarcode ${hit.unlinkedCode} in mededelingen — nog niet gekoppeld, GEEN vermogensmutatie`; }
      return `${effDate(t)} | ${richting} €${bedrag} | ${t.name || "?"} | post: ${post} | ${vermogen} | med: "${(t.description || "").slice(0, 80)}"`;
    });
    debugLog(`import ${lines.length} transactie(s)`, lines);
  } catch {}
}
function categorize(tx, rules, categories) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  const catById = (id) => (categories || []).find((c) => c.id === id);
  let best = null;
  for (const r of rules) { if (r.active && ruleMatches(tx, r) && catAllowed(catById(r.categoryId), sign) && (!best || r.priority < best.priority)) best = r; }
  if (best) return { categoryId: best.categoryId, ruleId: best.id }; // eigen regels (bijv. Tussenrekening) gaan vóór
  const sc = matchSpaarcode(tx, categories); // vangnet: accountcode in de mededelingen
  if (sc) return sc;
  return null;
}
// Mag deze post bij dit bedrag? Inkomsten alleen bij positieve mutaties; verder alles (incl. sparen).
const catAllowed = (c, sign) => !!c && (sign >= 0 || c.type !== "income");
// Supermarkt-/winkelketen herkennen uit de transactienaam (voor de "per winkel"-uitsplitsing).
const SUPERMARKETS = [
  ["albert heijn", "Albert Heijn"], ["ah to go", "Albert Heijn"], ["jumbo", "Jumbo"], ["lidl", "Lidl"], ["aldi", "Aldi"],
  ["hoogvliet", "Hoogvliet"], ["dirk", "Dirk"], ["dekamarkt", "DekaMarkt"], ["vomar", "Vomar"], ["plus ", "PLUS"],
  ["spar", "Spar"], ["coop", "Coop"], ["picnic", "Picnic"], ["crisp", "Crisp"], ["ekoplaza", "Ekoplaza"], ["marqt", "Marqt"],
  ["jan linders", "Jan Linders"], ["poiesz", "Poiesz"], ["nettorama", "Nettorama"], ["boni", "Boni"], ["vakcentrum", "Vakcentrum"],
  ["kruidvat", "Kruidvat"], ["etos", "Etos"], ["trekpleister", "Trekpleister"], ["holland & barrett", "Holland & Barrett"], ["da ", "DA"],
];
function detectChain(name) {
  const n = " " + String(name || "").toLowerCase().replace(/\s+/g, " ") + " ";
  for (const [k, label] of SUPERMARKETS) if (n.includes(k)) return label;
  const first = String(name || "").trim().split(/\s+/)[0] || "Overig";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "Overig";
}
// Verdeel een (deel)terugbetaling evenredig over de posten van een voorschot.
// allocations = de (negatieve) allocaties van het voorschot; resultaat = positieve allocaties die optellen tot magnitude.
function distributeProportional(magnitude, allocations) {
  const list = (allocations || []).filter((a) => a && a.categoryId);
  if (!list.length) return [];
  const mags = list.map((a) => Math.abs(a.amountCents));
  const sum = mags.reduce((x, y) => x + y, 0) || 1;
  let assigned = 0;
  return list.map((a, i) => {
    const v = i === list.length - 1 ? magnitude - assigned : Math.round((magnitude * mags[i]) / sum);
    assigned += v;
    return { categoryId: a.categoryId, amountCents: v };
  });
}
// Koppelingen van een binnenkomend bedrag aan voorschotten. Eén bedrag mag over meerdere tikkies verdeeld worden.
function settlementsOf(tx) {
  if (tx && Array.isArray(tx.settlements)) return tx.settlements;
  if (tx && tx.settledWith) return [{ advanceId: tx.settledWith, amountCents: Math.abs(tx.amountCents) }]; // oude enkele koppeling
  return [];
}
function assignedOf(tx) { return settlementsOf(tx).reduce((s, x) => s + (x.amountCents || 0), 0); }
function unassignedOf(tx) { return Math.max(0, Math.abs((tx && tx.amountCents) || 0) - assignedOf(tx)); }
// Hoeveel van een voorschot is al terugbetaald (som van de gekoppelde delen van binnenkomende bedragen).
function recoveredFor(advanceId, txns) {
  let r = 0;
  for (const t of txns || []) for (const s of settlementsOf(t)) if (s.advanceId === advanceId) r += s.amountCents || 0;
  return r;
}
// Verdeel de allocaties van een binnenkomend bedrag over de gekoppelde voorschotten (netteert per post).
function allocsFromSettlements(settlements, txns) {
  const out = [];
  for (const s of settlements || []) { const adv = (txns || []).find((t) => t.id === s.advanceId); if (adv && (adv.allocations || []).length) for (const a of distributeProportional(s.amountCents, adv.allocations)) out.push(a); }
  return out;
}
// Verwacht terug te ontvangen bedrag van een voorschot (deel mag); standaard het hele bedrag.
function expectedBackOf(adv) { return adv && adv.expectedBackCents != null ? adv.expectedBackCents : Math.abs((adv && adv.amountCents) || 0); }
// Resterend openstaand bedrag van een voorschot.
function remainingOf(adv, txns) { return expectedBackOf(adv) - recoveredFor(adv.id, txns); }
// Unieke bundellabels (hoofdletter-ongevoelig ontdubbeld, eerste schrijfwijze behouden).
function bundleLabels(txns) {
  const seen = new Map();
  for (const t of txns || []) { const raw = (t.bundle || "").trim(); if (!raw) continue; const k = raw.toLowerCase(); if (!seen.has(k)) seen.set(k, raw); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "nl"));
}

/* --------------------------------------------------- Begrotingsmatrix-parser */
/* ---------------------------------------------------------- ING CSV-parser */
function splitCsvLine(line, delim) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === delim && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}
function extractOmschrijving(med) {
  const m = String(med).match(/Omschrijving:\s*(.+?)(?:\s+IBAN:|\s+Kenmerk:|\s+Datum\/Tijd:|\s+Valutadatum:|$)/i);
  return m ? m[1].trim() : "";
}
/** Parse het echte ING-CSV-formaat (puntkomma, geen aanhalingstekens, 11 kolommen). */
function parseINGRows(rows) {
  const clean = (rows || []).filter((r) => r && r.some((x) => String(x).trim() !== ""));
  if (clean.length < 2) return { txns: [], errors: ["Geen transacties gevonden — is dit wel een ING-bestand?"] };
  const header = clean[0].map((h) => String(h).toLowerCase().trim());
  const idx = (f) => header.findIndex((h) => h.includes(f));
  const iDate = idx("datum"), iName = idx("naam"), iTegen = idx("tegenrekening"),
    iAfBij = header.findIndex((h) => h.includes("af bij") || h.includes("af/bij")),
    iBedrag = idx("bedrag"), iMut = idx("mutatiesoort"), iMed = idx("mededeling"),
    iSaldo = header.findIndex((h) => h.includes("saldo na"));
  if (iDate < 0 || iBedrag < 0)
    return { txns: [], errors: ["Kolommen 'Datum' en/of 'Bedrag' niet gevonden. Het Import-tabblad is voor je ING-bankbestand (CSV of Excel). Een begroting hoort op het Begroting-tabblad."] };
  const txns = [], errors = [];
  clean.slice(1).forEach((c, n) => {
    try {
      const raw = parseDecimalToCents(c[iBedrag]);
      const amountCents = iAfBij >= 0
        ? (String(c[iAfBij] || "").toLowerCase().startsWith("a") ? -1 : 1) * Math.abs(raw)
        : raw;
      let saldoNaMutatieCents = null;
      if (iSaldo >= 0 && c[iSaldo] != null && String(c[iSaldo]).trim() !== "") { try { saldoNaMutatieCents = parseDecimalToCents(c[iSaldo]); } catch { saldoNaMutatieCents = null; } }
      txns.push({
        date: parseINGDate(c[iDate]),
        amountCents,
        name: String(c[iName] != null ? c[iName] : ""),
        iban: iTegen >= 0 ? String(c[iTegen] != null ? c[iTegen] : "") : "",
        description: iMed >= 0 ? String(c[iMed] != null ? c[iMed] : "") : "",
        omschrijving: extractOmschrijving(iMed >= 0 ? c[iMed] : "") || String(c[iName] != null ? c[iName] : ""),
        mutationType: String(c[iMut] != null ? c[iMut] : ""),
        saldoNaMutatieCents,
      });
    } catch (e) { errors.push(`Regel ${n + 2}: ${e.message}`); }
  });
  return { txns, errors };
}
function parseINGCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { txns: [], errors: ["Geen transacties gevonden."] };
  const delim = lines[0].includes(";") ? ";" : ",";
  return parseINGRows(lines.map((l) => splitCsvLine(l, delim)));
}

/* ------------------------------------------------------------ Voorbeeld-CSV */
const SAMPLE_CSV = `Datum;Naam / Omschrijving;Rekening;Tegenrekening;Code;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen;Saldo na mutatie;Tag
20260511;I. Volwater e/o T.L. Zuijderduin via ASN Bank voorheen SNS Betaalverzo;NL30INGB0700166238;NL19SNSB0705717593;IW;Af;15;iDEAL | Wero;Naam: I. Volwater Omschrijving: Pizza IBAN: NL19SNSB0705717593 Kenmerk: 11-05-2026 11:39 Valutadatum: 11-05-2026;451,56;
20260511;La Place Duinrell WASSENAAR NLD;NL30INGB0700166238;;BA;Af;14,45;Betaalautomaat;Pasvolgnr: 901 10-05-2026 10:56 Apple Pay Valutadatum: 11-05-2026;466,56;
20260510;Hr RW Boekestijn,Mw E Knoester;NL30INGB0700166238;NL79INGB0700147896;GT;Bij;21,8;Online bankieren;Naam: Hr RW Boekestijn Omschrijving: Bakker van Maanen IBAN: NL79INGB0700147896 Valutadatum: 10-05-2026;481,01;
20260510;Hr F van Alphen;NL30INGB0700166238;NL79INGB0004934152;GT;Bij;2,95;Online bankieren;Naam: Hr F van Alphen Omschrijving: Retourkosten zara IBAN: NL79INGB0004934152 Valutadatum: 10-05-2026;459,21;
20260510;K. Lagendijk;NL30INGB0700166238;NL58INGB0008475903;GT;Af;48,73;Online bankieren;Naam: K. Lagendijk Omschrijving: Cadeau Pernille IBAN: NL58INGB0008475903 Valutadatum: 10-05-2026;358,8;
20260510;MW K Lagendijk;NL30INGB0700166238;NL58INGB0008475903;GT;Af;250;Online bankieren;Naam: MW K Lagendijk Omschrijving: Cash IBAN: NL58INGB0008475903 Valutadatum: 10-05-2026;407,53;
20260510;Hr F van Alphen;NL30INGB0700166238;NL79INGB0004934152;GT;Af;8,49;Online bankieren;Naam: Hr F van Alphen Omschrijving: Parkeerkosten IBAN: NL79INGB0004934152 Valutadatum: 10-05-2026;657,53;
20260510;Hr F van Alphen;NL30INGB0700166238;NL79INGB0004934152;GT;Af;25,11;Online bankieren;Naam: Hr F van Alphen Omschrijving: Victorinox messen IBAN: NL79INGB0004934152 Valutadatum: 10-05-2026;666,02;
20260510;Plus Moerkapelle MOERKAPELLE NLD;NL30INGB0700166238;;BA;Af;9,98;Betaalautomaat;Pasvolgnr: 901 09-05-2026 17:07 Apple Pay Valutadatum: 10-05-2026;691,13;
20260510;PLUS Moerkapelle MOERKAPELLE NLD;NL30INGB0700166238;;BA;Af;18,16;Betaalautomaat;Pasvolgnr: 900 09-05-2026 16:18 Apple Pay Valutadatum: 10-05-2026;701,11;
20260510;Kosten OranjePakket;NL30INGB0700166238;;DV;Af;4;Diversen;1 apr t/m 30 apr 2026 ING BANK N.V. Valutadatum: 10-05-2026;719,27;
20260510;Kosten tweede rekeninghouder;NL30INGB0700166238;;DV;Af;1,2;Diversen;1 apr t/m 30 apr 2026 ING BANK N.V. Valutadatum: 10-05-2026;723,27;
20260509;BCK*Etos Gouda Bloemen GOUDA NLD;NL30INGB0700166238;;BA;Af;47,97;Betaalautomaat;Pasvolgnr: 901 08-05-2026 12:34 Apple Pay Valutadatum: 09-05-2026;724,47;
20260509;CCV*J P VAN EESTEREN B GOUDA NLD;NL30INGB0700166238;;BA;Af;2,5;Betaalautomaat;Pasvolgnr: 901 08-05-2026 12:08 Apple Pay Valutadatum: 09-05-2026;772,44;
20260508;Hr M Lagendijk;NL30INGB0700166238;NL03INGB0669758485;GT;Bij;15,8;Online bankieren;Naam: Hr M Lagendijk Omschrijving: bol.com IBAN: NL03INGB0669758485 Valutadatum: 08-05-2026;774,94;
20260508;CCV*J P VAN EESTEREN B GOUDA NLD;NL30INGB0700166238;;BA;Af;2,5;Betaalautomaat;Pasvolgnr: 901 07-05-2026 12:17 Apple Pay Valutadatum: 08-05-2026;759,14;
20260508;Albert Heijn 1629 ZOETERMEER NLD;NL30INGB0700166238;;BA;Af;9,37;Betaalautomaat;Pasvolgnr: 900 07-05-2026 12:50 Apple Pay Valutadatum: 08-05-2026;736,65;
20260508;ZEEMAN ZOETERMEER PROM NLD;NL30INGB0700166238;;BA;Af;3,18;Betaalautomaat;Pasvolgnr: 900 07-05-2026 13:01 Apple Pay Valutadatum: 08-05-2026;746,02;
20260508;CCV*Bagels & Beans Zoe NLD;NL30INGB0700166238;;BA;Af;21,3;Betaalautomaat;Pasvolgnr: 900 07-05-2026 12:40 Apple Pay Valutadatum: 08-05-2026;749,2;
20260508;Albert Heijn Online ZAANDAM NLD;NL30INGB0700166238;;BA;Af;68,07;Betaalautomaat;Pasvolgnr: 900 07-05-2026 19:32 Apple Pay Valutadatum: 08-05-2026;770,5;
20260508;HEMA EV0068 Zoetermeer NLD;NL30INGB0700166238;;BA;Af;19,99;Betaalautomaat;Pasvolgnr: 900 07-05-2026 11:49 Apple Pay Valutadatum: 08-05-2026;838,57;
20260508;TMC*StadshartZoetP5Ui1 NLD;NL30INGB0700166238;;BA;Af;3;Betaalautomaat;Pasvolgnr: 900 07-05-2026 13:10 Apple Pay Valutadatum: 08-05-2026;858,56;
20260508;Hr F van Alphen;NL30INGB0700166238;NL79INGB0004934152;GT;Bij;652,05;Online bankieren;Naam: Hr F van Alphen Omschrijving: declaratie jpe IBAN: NL79INGB0004934152 Valutadatum: 08-05-2026;861,56;
20260506;Klarna Bank AB (publ);NL30INGB0700166238;NL73DEUT0265001135;OV;Af;56;Overschrijving;Naam: Klarna Bank Omschrijving: aankoop IBAN: NL73DEUT0265001135 Valutadatum: 06-05-2026;115,51;
20260506;K. Lagendijk;NL30INGB0700166238;NL58INGB0008475903;GT;Af;7,26;Online bankieren;Naam: K. Lagendijk Omschrijving: Begrafenisverzekering IBAN: NL58INGB0008475903 Valutadatum: 06-05-2026;171,51;`;

/* ---------------------------------------------------------------- Seed */
const SLUITPOST_ID = slug("Gezamenlijke spaarrekening / ING");
function computeSluitpostMonths(categories, lines) {
  const months = Array.from({ length: 12 }, () => 0);
  for (const c of categories) {
    if (c.id === SLUITPOST_ID) continue;
    const l = lines[c.id]; if (!l) continue;
    for (let m = 0; m < 12; m++) months[m] += c.type === "income" ? l.months[m] : -l.months[m];
  }
  return months; // = inkomsten − overige uitgaven, per maand
}
function applySluitpost(categories, lines) {
  const sp = computeSluitpostMonths(categories, lines);
  return { ...lines, [SLUITPOST_ID]: { average: Math.round(sumMonths(sp) / 12), months: sp } };
}
function budgetTotals(categories, lines) {
  let income = 0, outflow = 0;
  for (const c of categories) {
    const l = lines[c.id]; if (!l) continue;
    const annual = sumMonths(l.months);
    if (c.type === "income") income += annual; else outflow += annual;
  }
  return { income, outflow, diff: income - outflow };
}
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function matchCategoryByName(name, categories) {
  const n = normName(name);
  if (!n || n.length < 3) return null;
  let best = null;
  for (const c of categories) {
    if (c.id === SLUITPOST_ID) continue;
    const cn = normName(c.naam);
    if (cn === n) return c;                                                    // exact wint
    if (!best && (cn.startsWith(n) || n.startsWith(cn)) && n.length >= 4) best = c; // ruim
  }
  return best;
}
function cellToCents(v) {
  if (typeof v === "number" && isFinite(v)) return Math.round(v * 100);
  if (typeof v === "string") {
    const t = v.replace(/[€\s]/g, "").trim();
    if (t === "" || t === "-" || !/[0-9]/.test(t)) return null;
    try { return parseDecimalToCents(t); } catch { return null; }
  }
  return null;
}
function parseBudgetRows(rows, categories) {
  const updates = {}, matched = [], unmatched = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    let nameIdx = -1, name = "";
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (typeof v === "string" && v.trim() && !/^[\s€.,\-0-9]+$/.test(v.trim())) { nameIdx = i; name = v.trim(); break; }
    }
    if (nameIdx < 0) continue;
    let avg = null;
    for (let i = nameIdx + 1; i < row.length; i++) { const c = cellToCents(row[i]); if (c != null) { avg = c; break; } }
    if (avg == null) continue;
    const cat = matchCategoryByName(name, categories);
    if (cat) { updates[cat.id] = avg; matched.push(cat.naam); }
    else unmatched.push(name);
  }
  return { updates, matched, unmatched };
}

function txYearActuals(transactions, categories, jaartal) {
  const actuals = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
  const catType = {}; for (const c of categories) catType[c.id] = c.type;
  for (const t of transactions) {
    if (effYear(t) !== jaartal) continue;
    const m = effMonth(t);
    for (const a of t.allocations) {
      if (catType[a.categoryId] === "income") actuals[m - 1].income += a.amountCents;
      else actuals[m - 1].expense += -a.amountCents;
    }
  }
  return actuals;
}

const KW_STOP = new Set(["betaling", "ideal", "incasso", "sepa", "overboeking", "via", "van", "naar", "voor", "met", "aan", "the", "and", "een", "bv", "nv", "nld", "prom", "apple", "pay", "google", "contactloos", "betaalautomaat", "pasvolgnr", "kenmerk", "omschrijving", "datum", "tijd", "spoed", "periodiek", "factuur", "klantnummer", "transactie", "name", "ref", "eref", "mandaat", "machtiging"]);
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^a-z0-9&'./ -]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-.'/]+|[-.'/]+$/g, ""))
    .filter((w) => w.length >= 3 && !KW_STOP.has(w) && !/^\d+$/.test(w));
}
function guessKeyword(text) {
  const toks = tokenize(text);
  if (!toks.length) return String(text || "").trim().toLowerCase();
  toks.sort((a, b) => b.length - a.length); // langste woord = vaak de merknaam
  return toks[0];
}
/** Dynamische snelkeuze: eerst de voorspelling (regel + lijkt-op eerdere transacties),
 *  daarna aangevuld met je meest-gebruikte posten. */
function rankSuggestions(tx, rules, categories, history, max = 4) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  const allow = (cid) => catAllowed(categories.find((x) => x.id === cid), sign);
  const pred = {};
  const addP = (cid, s) => { if (allow(cid)) pred[cid] = (pred[cid] || 0) + s; };
  const r = categorize(tx, rules, categories);
  if (r) addP(r.categoryId, 1000); // harde voorspelling uit een regel of spaarcode
  const myToks = new Set(tokenize((tx.name || "") + " " + (tx.omschrijving || "")));
  const myAmt = tx.amountCents;
  const freq = {};
  for (const h of history || []) {
    if (h.id === tx.id || !h.allocations || h.allocations.length !== 1) continue;
    const cid = h.allocations[0].categoryId;
    if (!allow(cid)) continue;
    freq[cid] = (freq[cid] || 0) + 1; // hoe vaak je deze post gebruikt
    let overlap = 0;
    for (const t of tokenize((h.name || "") + " " + (h.omschrijving || ""))) if (myToks.has(t)) overlap++;
    if (overlap > 0) addP(cid, 10 * overlap); // lijkt op een eerdere transactie
    if (h.amountCents === myAmt) addP(cid, 14); // exact hetzelfde bedrag = sterk signaal (vaste lasten/abonnementen)
    else if (Math.abs(h.amountCents - myAmt) <= 50) addP(cid, 4); // vrijwel hetzelfde bedrag (±€0,50)
  }
  const predicted = Object.entries(pred).sort((a, b) => b[1] - a[1]).map(([cid]) => cid);
  const mostUsed = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([cid]) => cid);
  const out = [];
  for (const cid of [...predicted, ...mostUsed]) { if (!out.includes(cid)) out.push(cid); if (out.length >= max) break; }
  return out;
}

/* ===================================================================== */
/* PAGINA'S                                                              */
/* ===================================================================== */

export { computeRunningSaldo, bankBalanceFromTxns, saldoChainGaps, openingFromChain, reconcileImport, matchCondition, ruleMatches, matchSpaarcode, extractOranjeCode, savingsKeyword, extractSavingsAccount, savingsHint, unknownSavingsCodes, savingsCatForTx, derivedPotMutation, potFlows, potMutations, potHistory, debugLogImport, categorize, catAllowed, SUPERMARKETS, detectChain, distributeProportional, settlementsOf, assignedOf, unassignedOf, recoveredFor, allocsFromSettlements, expectedBackOf, remainingOf, bundleLabels, splitCsvLine, extractOmschrijving, parseINGRows, parseINGCsv, SAMPLE_CSV, SLUITPOST_ID, computeSluitpostMonths, applySluitpost, budgetTotals, normName, matchCategoryByName, cellToCents, parseBudgetRows, txYearActuals, KW_STOP, tokenize, guessKeyword, rankSuggestions };
