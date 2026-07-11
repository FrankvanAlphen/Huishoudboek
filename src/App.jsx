import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { me, getUsers, login as apiLogin, changePassword as apiChangePassword, logout as apiLogout, getState, putState, getActivity, logAction, debugLog, getSnapshots, getSnapshot, uploadAttachment, listAttachments, deleteAttachment, attachmentCounts, attachmentUrl } from "./api.js";
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
const T = {
  bg: "#f4f7f6", panel: "#ffffff", line: "#e3eae9", ink: "#16201e", sub: "#62716e",
  accent: "#0f766e", accentSoft: "#e7f1ef", pos: "#15803d", neg: "#b4232a",
  warn: "#b45309", warnSoft: "#fdf2e2", radius: 10,
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

/* --------------------------------------------------------------- Geld/datum */
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
function computeRunningSaldo(carryIn, actuals) {
  const out = []; let begin = carryIn;
  for (let i = 0; i < 12; i++) {
    const net = actuals[i].income - actuals[i].expense, end = begin + net;
    out.push({ month: i + 1, begin, ...actuals[i], net, end });
    begin = end;
  }
  return out;
}
function computeBudgetDeviation(actualNet, budgetNet) {
  const out = []; let ca = 0, cb = 0;
  for (let i = 0; i < 12; i++) { ca += actualNet[i]; cb += budgetNet[i]; out.push(ca - cb); }
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
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const GROUPS_DEF = ["Inkomsten", "Woonlasten", "Verzekeringen", "Abonnementen", "Boodschappen & dagelijks", "Vervoer", "Zakgeld", "Sparen & reserveringen"];
// [groep, naam, type, noteSuggested]
const CAT_DEFS = [
  ["Inkomsten", "Salaris Frank + auto", "income", false],
  ["Inkomsten", "13e maand + overige Frank", "income", false],
  ["Inkomsten", "Salaris Kimberley / ING", "income", false],
  ["Inkomsten", "13e maand + vakantiegeld + overige Kimberley", "income", false],
  ["Inkomsten", "Hypotheekrenteaftrek", "income", false],
  ["Inkomsten", "Kinderopvangtoeslag", "income", false],
  ["Inkomsten", "Kinderbijslag", "income", false],
  ["Inkomsten", "Overige inkomsten | Lening ABN", "income", false],
  ["Woonlasten", "Hypotheek / ABN-Amro", "expense", false],
  ["Woonlasten", "Gas & Elektra / Vattenfall", "expense", false],
  ["Woonlasten", "Water / Duinwaterbedrijf Dunea", "expense", false],
  ["Woonlasten", "Provinciale belastingen / Zuid-Holland", "expense", false],
  ["Woonlasten", "Gemeentelijke belastingen / Gemeente Zuidplas", "expense", false],
  ["Verzekeringen", "Woon- en aansprakelijkheidsverzekeringen / FBTO", "expense", false],
  ["Verzekeringen", "Overlijdensrisicoverzekering / Dazure", "expense", false],
  ["Verzekeringen", "Zorgverzekering / Ditzo", "expense", false],
  ["Verzekeringen", "Reisverzekering / SNS bank", "expense", false],
  ["Verzekeringen", "Begrafenisverzekering / Dela", "expense", false],
  ["Verzekeringen", "Auto verzekering / Allianz", "expense", false],
  ["Abonnementen", "Internet en TV / Ziggo", "expense", false],
  ["Abonnementen", "Telefonie / Ben en Vodafone", "expense", false],
  ["Abonnementen", "Overige abonnementen / diverse", "expense", false],
  ["Abonnementen", "Netflix", "expense", false],
  ["Abonnementen", "Bankkosten / ING", "expense", false],
  ["Abonnementen", "Spotify", "expense", false],
  ["Abonnementen", "Videoland", "expense", false],
  ["Boodschappen & dagelijks", "Boodschappen: supermarkt, speciaalzaak, drogist", "expense", false],
  ["Boodschappen & dagelijks", "Huis en tuin", "expense", true],
  ["Boodschappen & dagelijks", "Cadeautjes", "expense", true],
  ["Boodschappen & dagelijks", "Uitstapjes/bestellen", "expense", true],
  ["Boodschappen & dagelijks", "Sporten", "expense", false],
  ["Boodschappen & dagelijks", "Kleding; zit in zakgeld", "expense", false],
  ["Boodschappen & dagelijks", "Persoonlijke verzorging: kapper, schoonheid", "expense", true],
  ["Boodschappen & dagelijks", "Maud: kleding, inventaris, verbruik, overige", "expense", true],
  ["Boodschappen & dagelijks", "Kinderdagverblijf", "expense", false],
  ["Boodschappen & dagelijks", "Vakanties", "expense", true],
  ["Vervoer", "Benzine", "expense", false],
  ["Vervoer", "Wegenbelasting", "expense", false],
  ["Vervoer", "Parkeren", "expense", false],
  ["Vervoer", "Onderhoud", "expense", true],
  ["Zakgeld", "Zakgeld Frank", "expense", false],
  ["Zakgeld", "Zakgeld Kimberley", "expense", false],
  ["Sparen & reserveringen", "Tussenrekening: cadeaubonnen, cash geld", "savings", false],
  ["Sparen & reserveringen", "Gezamenlijke spaarrekening / ING", "savings", false],
  ["Sparen & reserveringen", "Woning / ABN", "savings", false],
  ["Sparen & reserveringen", "Vakantie / ING", "savings", false],
  ["Sparen & reserveringen", "Woonbelasting / ING", "savings", false],
  ["Sparen & reserveringen", "Nieuwe Auto --> aflossen auto / ABN", "savings", false],
  ["Sparen & reserveringen", "Eigen risico / ING", "savings", false],
  ["Sparen & reserveringen", "Spaarrekening Maud / ING", "savings", false],
  ["Sparen & reserveringen", "Aandelenrekening", "savings", false],
];

/* ---- Sluitpost: het verschil komt automatisch op Gezamenlijke spaarrekening ---- */
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

function buildSeed() {
  const groups = GROUPS_DEF.map((naam, i) => ({ id: slug(naam), naam, volgorde: i }));
  const categories = CAT_DEFS.map(([g, naam, type, note], i) => ({ id: slug(naam), groupId: slug(g), naam, type, noteSuggested: note, volgorde: i }));
  const cid = (naam) => slug(naam);
  // Oranje (ING) spaarrekeningcodes — die staan in de mededelingen bij een over-/bijschrijving.
  const SPAARCODES = {
    "Gezamenlijke spaarrekening / ING": "H17729888",
    "Tussenrekening: cadeaubonnen, cash geld": "B55030134",
    "Spaarrekening Maud / ING": "A96691295",
    "Eigen risico / ING": "H96319154",
    "Nieuwe Auto --> aflossen auto / ABN": "M96388351",
    "Vakantie / ING": "V54438290",
    "Woonbelasting / ING": "X34919021",
    "Aandelenrekening": "15593447",
  };
  for (const c of categories) if (SPAARCODES[c.naam]) c.spaarcode = SPAARCODES[c.naam];
  // Vaste vs. variabele lasten: woonlasten/verzekeringen/abonnementen zijn standaard 'vast', de rest 'variabel'. Per post aanpasbaar op Posten.
  const VAST_GROUPS = new Set(["woonlasten", "verzekeringen", "abonnementen"]);
  for (const c of categories) if (c.type === "expense") c.vast = VAST_GROUPS.has(c.groupId);

  // Maandgemiddelden (euro's) — uit je begroting. De Gezamenlijke spaarrekening is
  // de sluitpost die de begroting precies op €77.940 laat kloppen.
  const A = {};
  const set = (naam, e) => (A[cid(naam)] = Math.round(e * 100));
  set("Salaris Frank + auto", 3000); set("13e maand + overige Frank", 200);
  set("Salaris Kimberley / ING", 2450); set("13e maand + vakantiegeld + overige Kimberley", 300);
  set("Hypotheekrenteaftrek", 100); set("Kinderopvangtoeslag", 360); set("Kinderbijslag", 85);
  set("Hypotheek / ABN-Amro", 1020); set("Gas & Elektra / Vattenfall", 100); set("Water / Duinwaterbedrijf Dunea", 25);
  set("Provinciale belastingen / Zuid-Holland", 40); set("Gemeentelijke belastingen / Gemeente Zuidplas", 80);
  set("Woon- en aansprakelijkheidsverzekeringen / FBTO", 25); set("Overlijdensrisicoverzekering / Dazure", 10);
  set("Zorgverzekering / Ditzo", 300); set("Reisverzekering / SNS bank", 5); set("Begrafenisverzekering / Dela", 10);
  set("Auto verzekering / Allianz", 40); set("Internet en TV / Ziggo", 75); set("Telefonie / Ben en Vodafone", 35);
  set("Overige abonnementen / diverse", 35); set("Netflix", 13); set("Bankkosten / ING", 5); set("Spotify", 11); set("Videoland", 10);
  set("Boodschappen: supermarkt, speciaalzaak, drogist", 500); set("Huis en tuin", 70); set("Cadeautjes", 140);
  set("Uitstapjes/bestellen", 400); set("Sporten", 25); set("Persoonlijke verzorging: kapper, schoonheid", 25);
  set("Maud: kleding, inventaris, verbruik, overige", 250); set("Kinderdagverblijf", 300); set("Vakanties", 300);
  set("Benzine", 60); set("Wegenbelasting", 40); set("Parkeren", 15); set("Onderhoud", 50);
  set("Zakgeld Frank", 500); set("Zakgeld Kimberley", 500);
  set("Woning / ABN", 580); set("Vakantie / ING", 300); set("Woonbelasting / ING", 120);
  set("Nieuwe Auto --> aflossen auto / ABN", 100); set("Eigen risico / ING", 50); set("Spaarrekening Maud / ING", 85);
  set("Aandelenrekening", 300);

  const lines = {};
  for (const c of categories) { const a = A[c.id] || 0; if (a !== 0 && c.id !== SLUITPOST_ID) lines[c.id] = { average: a, months: distributeEven(a) }; }
  const balanced = applySluitpost(categories, lines); // Gezamenlijke spaarrekening = sluitpost

  const years = [{ id: "2026", jaartal: 2026, carryInCents: 0, status: "open" }];
  const budgets = { "2026": balanced };

  const pots = []; // start leeg: spaarsaldi vul je zelf in op het Vermogen-tabblad

  // Scherpe startset: afgestemd op je eigen terugkerende transacties + gangbare NL-winkels.
  // categorize() is sign-bewust (catAllowed), dus inkomsten-regels pakken alleen + en uitgaven-regels alleen de juiste kant.
  // Persoonsoverboekingen met een duidelijke omschrijving vangen we op het omschrijving-veld.
  let rid = 0;
  const R = (catName, value, prio, field = "both", operator = "contains") =>
    ({ id: "r" + (++rid), categoryId: cid(catName), priority: prio, active: true, conditions: [{ field, operator, value }] });
  const rules = [
    // ---- Inkomsten (pakken via catAllowed alleen positieve bedragen) ----
    R("Kinderbijslag", "kinderbijslag", 18, "both"),
    R("Kinderbijslag", "sociale verzekeringsbank", 18, "both"),
    R("Kinderopvangtoeslag", "kinderopvangtoeslag", 18, "both"),
    R("Hypotheekrenteaftrek", "inkomstenbelasting", 20, "both"),
    R("Hypotheekrenteaftrek", "voorlopige teruggaaf", 20, "both"),

    // ---- Bankkosten ----
    R("Bankkosten / ING", "kosten oranjepakket", 18),
    R("Bankkosten / ING", "kosten tweede rekeninghouder", 18),
    R("Bankkosten / ING", "oranjepakket", 19),

    // ---- Verzekeringen ----
    R("Zorgverzekering / Ditzo", "ditzo", 22),
    R("Auto verzekering / Allianz", "allianz", 22),
    R("Woon- en aansprakelijkheidsverzekeringen / FBTO", "fbto", 22),
    R("Overlijdensrisicoverzekering / Dazure", "dazure", 22),
    R("Begrafenisverzekering / Dela", "dela", 22),
    R("Begrafenisverzekering / Dela", "begrafenisverzekering", 22, "description"),
    R("Reisverzekering / SNS bank", "reisverzekering", 22, "description"),

    // ---- Woonlasten / vaste lasten ----
    R("Hypotheek / ABN-Amro", "hypotheek", 22),
    R("Gas & Elektra / Vattenfall", "vattenfall", 22),
    R("Water / Duinwaterbedrijf Dunea", "dunea", 22),
    R("Gemeentelijke belastingen / Gemeente Zuidplas", "svhw", 24),
    R("Gemeentelijke belastingen / Gemeente Zuidplas", "gemeente zuidplas", 24),
    R("Provinciale belastingen / Zuid-Holland", "provincie zuid-holland", 24),

    // ---- Abonnementen ----
    R("Netflix", "netflix", 24),
    R("Spotify", "spotify", 24),
    R("Videoland", "videoland", 24),
    R("Internet en TV / Ziggo", "ziggo", 24),
    R("Telefonie / Ben en Vodafone", "vodafone", 24),
    R("Telefonie / Ben en Vodafone", "odido", 24),
    R("Telefonie / Ben en Vodafone", "t-mobile", 24),
    R("Telefonie / Ben en Vodafone", "kpn", 24),
    R("Telefonie / Ben en Vodafone", "simyo", 24),
    R("Telefonie / Ben en Vodafone", "youfone", 24),
    R("Overige abonnementen / diverse", "disney", 26),
    R("Overige abonnementen / diverse", "hbo max", 26),
    R("Overige abonnementen / diverse", "prime video", 26),
    R("Overige abonnementen / diverse", "amazon prime", 26),
    R("Overige abonnementen / diverse", "audible", 26),
    R("Overige abonnementen / diverse", "storytel", 26),
    R("Overige abonnementen / diverse", "apple.com/bill", 26),
    R("Overige abonnementen / diverse", "icloud", 26),

    // ---- Boodschappen: supermarkten ----
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "albert heijn", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "plus moerkapelle", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "jumbo", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "lidl", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "aldi", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "dirk", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "hoogvliet", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "picnic", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "spar", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "coop", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "vomar", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "dekamarkt", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "nettorama", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "poiesz", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "jan linders", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "ekoplaza", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "gall", 32),
    // ---- Boodschappen: drogist (post heet expliciet ook 'drogist') ----
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "etos", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "kruidvat", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "trekpleister", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "da drogist", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "holland & barrett", 32),

    // ---- Persoonlijke verzorging (kapper, schoonheid, parfum) ----
    R("Persoonlijke verzorging: kapper, schoonheid", "ici paris", 32),
    R("Persoonlijke verzorging: kapper, schoonheid", "kapsalon", 32),
    R("Persoonlijke verzorging: kapper, schoonheid", "kapper", 32, "description"),

    // ---- Uitstapjes / uit eten / bestellen ----
    R("Uitstapjes/bestellen", "ccv*j p van eesteren", 35), // bedrijfskantine — specifiek, raakt je salaris niet
    R("Uitstapjes/bestellen", "thuisbezorgd", 35),
    R("Uitstapjes/bestellen", "takeaway", 35),
    R("Uitstapjes/bestellen", "uber eats", 35),
    R("Uitstapjes/bestellen", "mcdonald", 35),
    R("Uitstapjes/bestellen", "new york pizza", 35),
    R("Uitstapjes/bestellen", "domino", 35),
    R("Uitstapjes/bestellen", "starbucks", 35),
    R("Uitstapjes/bestellen", "kfc", 35),
    R("Uitstapjes/bestellen", "bagels", 35),
    R("Uitstapjes/bestellen", "la place", 35),
    R("Uitstapjes/bestellen", "burger king", 35),
    R("Uitstapjes/bestellen", "kwalitaria", 35),
    R("Uitstapjes/bestellen", "febo", 35),
    R("Uitstapjes/bestellen", "subway", 35),
    R("Uitstapjes/bestellen", "duinrell", 36),
    R("Uitstapjes/bestellen", "efteling", 36),
    R("Uitstapjes/bestellen", "pathe", 36),
    R("Uitstapjes/bestellen", "bioscoop", 36),

    // ---- Cadeautjes (persoonsoverboeking-omschrijving) ----
    R("Cadeautjes", "cadeau", 38, "description"),

    // ---- Tussenrekening: cash ----
    R("Tussenrekening: cadeaubonnen, cash geld", "cash", 35, "description", "equals"),

    // ---- Benzine ----
    R("Benzine", "shell", 30),
    R("Benzine", "bp ", 30),
    R("Benzine", "esso", 30),
    R("Benzine", "tinq", 30),
    R("Benzine", "tango", 30),
    R("Benzine", "tankstation", 30),
    R("Benzine", "total", 32),
    R("Benzine", "avia", 32),
    R("Benzine", "q8", 32),
    R("Benzine", "gulf", 32),
    R("Benzine", "texaco", 32),
    R("Benzine", "firezone", 32),

    // ---- Parkeren ----
    R("Parkeren", "q-park", 40),
    R("Parkeren", "parkmobile", 40),
    R("Parkeren", "yellowbrick", 40),
    R("Parkeren", "easypark", 40),
    R("Parkeren", "parkbee", 40),
    R("Parkeren", "interparking", 40),
    R("Parkeren", "stadshart", 40),
    R("Parkeren", "parkeren", 44),
    R("Parkeren", "parkeerkosten", 42, "description"),

    // ---- Wegenbelasting ----
    R("Wegenbelasting", "motorrijtuigenbelasting", 28),
    R("Wegenbelasting", "wegenbelasting", 28),

    // ---- Onderhoud auto ----
    R("Onderhoud", "garage", 45),
    R("Onderhoud", "apk", 45),
    R("Onderhoud", "kwik fit", 45),
    R("Onderhoud", "profile", 45),
    R("Onderhoud", "euromaster", 45),
    R("Onderhoud", "carglass", 45),

    // ---- Sporten ----
    R("Sporten", "basic fit", 38),
    R("Sporten", "basic-fit", 38),
    R("Sporten", "sportschool", 38),
    R("Sporten", "anytime fitness", 38),
    R("Sporten", "fit for free", 38),
    R("Sporten", "decathlon", 38),

    // ---- Kleding (zit in zakgeld) ----
    R("Kleding; zit in zakgeld", "zeeman", 40),
    R("Kleding; zit in zakgeld", "primark", 40),
    R("Kleding; zit in zakgeld", "h&m", 40),
    R("Kleding; zit in zakgeld", "zara", 40),
    R("Kleding; zit in zakgeld", "c&a", 40),
    R("Kleding; zit in zakgeld", "wibra", 40),
    R("Kleding; zit in zakgeld", "scapino", 40),
    R("Kleding; zit in zakgeld", "van haren", 40),

    // ---- Kinderdagverblijf ----
    R("Kinderdagverblijf", "kinderdagverblijf", 28),
    R("Kinderdagverblijf", "kinderopvang", 28),
    R("Kinderdagverblijf", "partou", 28),
    R("Kinderdagverblijf", "smallsteps", 28),
    R("Kinderdagverblijf", "kindergarden", 28),

    // ---- Huis en tuin ----
    R("Huis en tuin", "hema", 45),
    R("Huis en tuin", "action", 45),
    R("Huis en tuin", "ikea", 45),
    R("Huis en tuin", "praxis", 45),
    R("Huis en tuin", "gamma", 45),
    R("Huis en tuin", "karwei", 45),
    R("Huis en tuin", "kwantum", 45),
    R("Huis en tuin", "intratuin", 45),
    R("Huis en tuin", "blokker", 45),
    R("Huis en tuin", "xenos", 45),
    R("Huis en tuin", "jysk", 45),
    R("Huis en tuin", "leen bakker", 45),
    R("Huis en tuin", "hornbach", 45),
    R("Huis en tuin", "welkoop", 45),
    R("Huis en tuin", "dille & kamille", 45),
  ];

  return { groups, categories, budgets, years, activeYearId: "2026", pots, rules, transactions: [], tasks: [], openingBalanceCents: null, reviewedBatches: [] };
}

/* ----------------------------------------------------------- UI-bouwstenen */
// Vangt onverwachte render-fouten op zodat één fout niet de hele app wit maakt.
// De data staat veilig op de server; verversen herstelt de weergave.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("UI-fout:", error, info && info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, padding: 20 }}>
        <div style={{ maxWidth: 520, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Er ging iets mis in de weergave</div>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 12 }}>Je gegevens zijn veilig opgeslagen op de server. Ververs de pagina om verder te gaan. Blijft dit gebeuren, noteer dan deze melding: <span style={{ fontFamily: T.mono }}>{String((this.state.error && this.state.error.message) || this.state.error)}</span></div>
          <button onClick={() => window.location.reload()} style={{ border: "none", background: T.accent, color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>Pagina verversen</button>
        </div>
      </div>
    );
  }
}
// Detecteer een smal (telefoon)scherm, zodat de layout zich kan aanpassen.
function useIsMobile(bp = 760) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const icons = {
  overzicht: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  begroting: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  posten: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  import: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  regels: <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></>,
  uitgaven: <><line x1="4" y1="20" x2="4" y2="11" /><line x1="10" y1="20" x2="10" y2="4" /><line x1="16" y1="20" x2="16" y2="14" /></>,
  transacties: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  vermogen: <><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><path d="M16 12h.01" /><path d="M3 9h18" /></>,
};
function Btn({ children, onClick, variant = "primary", disabled, size = "md", title }) {
  const base = { fontFamily: T.sans, fontWeight: 600, border: "1px solid transparent", borderRadius: 8, cursor: disabled ? "default" : "pointer", padding: size === "sm" ? "5px 10px" : "9px 15px", fontSize: size === "sm" ? 13 : 14, lineHeight: 1.2, whiteSpace: "nowrap" };
  const styles = {
    primary: { background: disabled ? "#9ec5c0" : T.accent, color: "#fff" },
    secondary: { background: T.panel, color: T.ink, borderColor: T.line },
    ghost: { background: "transparent", color: T.accent },
    danger: { background: T.panel, color: T.neg, borderColor: "#f0d2d2" },
  };
  return <button title={title} onClick={onClick} disabled={disabled} style={{ ...base, ...styles[variant] }}>{children}</button>;
}
const Card = ({ children, style, ...rest }) => <div {...rest} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: T.radius, ...style }}>{children}</div>;
function Money({ cents, sign = false, bold = false, muted = false, size }) {
  const color = !sign ? (muted ? T.sub : T.ink) : cents > 0 ? T.pos : cents < 0 ? T.neg : T.sub;
  return <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color, fontWeight: bold ? 700 : 500, fontSize: size }}>{formatEUR(cents)}</span>;
}
function MoneyInput({ cents, onChange, width = 110, align = "right" }) {
  const [focused, setFocused] = useState(false);
  const [str, setStr] = useState("");
  const display = focused ? str : (cents != null ? editEUR(cents) : "");
  return <input value={display} inputMode="decimal"
    onFocus={() => { setStr(cents != null ? editEUR(cents) : ""); setFocused(true); }}
    onChange={(e) => { setStr(e.target.value); const t = e.target.value.trim(); if (t === "") return; try { onChange(parseDecimalToCents(t)); } catch {} }}
    onBlur={() => { setFocused(false); const t = str.trim(); if (t === "") onChange(0); else { try { onChange(parseDecimalToCents(t)); } catch {} } }}
    style={{ width, textAlign: align, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, padding: "6px 8px", border: `1px solid ${T.line}`, borderRadius: 7, outline: "none" }} />;
}
// Bedrag dat je van een voorschot terugverwacht, met snelknoppen om de rekening te delen door N personen.
function ExpectedBackEditor({ amountCents, value, onChange }) {
  const full = Math.abs(amountCents);
  const cur = value != null ? value : full;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Verwacht terug:</span>
      <MoneyInput cents={cur} width={100} onChange={onChange} />
      <span style={{ fontSize: 11.5, color: T.sub }}>van {formatEUR(full)}</span>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: T.sub }}>delen door</span>
        {[2, 3, 4, 5, 6].map((n) => (
          <button key={n} onClick={() => onChange(Math.round((full * (n - 1)) / n))} title={`Samen met ${n} personen: jij houdt ${formatEUR(Math.round(full / n))}, je verwacht ${formatEUR(Math.round((full * (n - 1)) / n))} terug`} style={{ border: `1px solid ${T.line}`, background: "#fff", color: T.accent, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>÷{n}</button>
        ))}
      </span>
    </div>
  );
}
const Badge = ({ children, tone = "neutral" }) => {
  const tones = { neutral: [T.accentSoft, T.accent], income: ["#e6f4ec", T.pos], savings: ["#eef0ff", "#4338ca"], expense: ["#f1f5f4", T.sub] };
  const [bg, fg] = tones[tone] || tones.neutral;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{children}</span>;
};
const Banner = ({ tone = "neutral", children }) => {
  const tones = { ok: ["#e8f5ee", T.pos, "#bfe2cd"], warn: [T.warnSoft, T.warn, "#f0dcb8"], neg: ["#fbe9e9", T.neg, "#f0cfcf"], neutral: [T.accentSoft, T.accent, "#cfe5e1"] };
  const [bg, fg, bd] = tones[tone];
  return <div style={{ background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 14 }}>{children}</div>;
};
const Toggle = ({ on, onClick }) => (
  <button onClick={onClick} style={{ width: 38, height: 22, borderRadius: 999, border: "none", cursor: "pointer", background: on ? T.accent : "#cdd6d4", position: "relative" }}>
    <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff" }} />
  </button>
);
// Laat op een transactie zien wat er met het Vermogen gebeurt op basis van de mededelingen:
// groen = de vermogensrekening wordt automatisch bij-/afgeboekt; oranje = er staat een expliciete
// spaarcode in de mededelingen die nog aan geen enkele rekening gekoppeld is.
function VermogenHint({ tx, categories }) {
  const d = derivedPotMutation(tx, categories);
  if (d) {
    const c = (categories || []).find((x) => x.id === d.categoryId);
    const naar = d.amountCents < 0; // geld eraf = storting op de rekening
    return (
      <div style={{ fontSize: 12, background: "#eef7f0", border: "1px solid #cfe6d4", color: "#1f6b3a", borderRadius: 7, padding: "6px 10px" }}>
        Vermogen: <b>{c ? c.naam : "rekening"}</b> wordt {naar ? "verhoogd" : "verlaagd"} met <b>{formatEUR(Math.abs(d.amountCents))}</b> — herkend uit de mededelingen; de post hierboven blijft gewoon staan.
      </div>
    );
  }
  const hit = savingsCatForTx(tx, categories);
  if (hit && hit.unlinkedCode) {
    return (
      <div style={{ fontSize: 12, background: T.warnSoft, border: `1px solid ${T.warn}`, color: "#7a5a12", borderRadius: 7, padding: "6px 10px" }}>
        In de mededelingen staat spaarcode <b style={{ fontFamily: T.mono }}>{hit.unlinkedCode}</b>, maar die is nog aan géén vermogensrekening gekoppeld — het Vermogen-tabblad verwerkt deze overboeking dus <b>niet</b>. Vul de code in bij de juiste rekening (tabblad Vermogen, veld Code/IBAN).
      </div>
    );
  }
  return null;
}
const SectionTitle = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 14px" }}>
    <h2 style={{ fontSize: 17, margin: 0 }}>{children}</h2>{right}
  </div>
);
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 14, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none", fontFamily: T.sans };

/** Betrouwbare, gegroepeerde keuzelijst voor posten. sign<0 = uitgave/sparen, sign>0 = inkomsten. */
function CatSelect({ categories, groups, value, onChange, sign = 0, placeholder = "— kies post —", style }) {
  // uitgave (sign<0): geen inkomstenposten. inkomst (sign>0): álles mag — ook een uitgavepost (teruggave/voorgeschoten) of een spaarpost (opname).
  const allow = (c) => catAllowed(c, sign);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, ...style }}>
      <option value="">{placeholder}</option>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && allow(c));
        if (!cats.length) return null;
        return <optgroup key={g.id} label={g.naam}>{cats.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}</optgroup>;
      })}
    </select>
  );
}

/* Optioneel: laat een transactie in een andere maand/jaar meetellen dan z'n datum. */
function PeriodControl({ tx, years = [], onChange }) {
  const months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const cur = tx.periodDate || tx.date;
  const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  const overridden = !!tx.periodDate;
  const yearOpts = Array.from(new Set([...(years || []).map((yy) => yy.jaartal), Number(tx.date.slice(0, 4))])).sort((a, b) => a - b);
  const set = (yy, mm) => onChange(`${yy}-${String(mm).padStart(2, "0")}-01`);
  const ss = { ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12 };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Telt mee voor</span>
      <select value={m} onChange={(e) => set(y, Number(e.target.value))} style={ss}>{months.map((nm, idx) => <option key={idx} value={idx + 1}>{nm}</option>)}</select>
      <select value={y} onChange={(e) => set(Number(e.target.value), m)} style={ss}>{yearOpts.map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
      {overridden
        ? <button onClick={() => onChange(null)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>↺ datum ({tx.date.slice(8, 10)}-{tx.date.slice(5, 7)}-{tx.date.slice(0, 4)})</button>
        : <span style={{ fontSize: 11, color: T.sub }}>(standaard: de transactiedatum)</span>}
    </div>
  );
}
function PostPicker({ categories, groups, sign = 0, value, onChange, suggestions = [], autoFocus = false }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [focused, setFocused] = useState(false);
  const groupName = (id) => (groups.find((g) => g.id === id) || {}).naam || "";
  const allow = (c) => catAllowed(c, sign);
  const byId = (id) => categories.find((c) => c.id === id);
  const pool = categories.filter(allow);
  const ql = q.trim().toLowerCase();
  const matches = ql ? pool.filter((c) => (c.naam + " " + groupName(c.groupId)).toLowerCase().includes(ql)) : pool;
  const pick = (cid) => { onChange(cid); setQ(""); setFocused(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (matches[hi]) pick(matches[hi].id); }
    else if (e.key === "Escape") { setFocused(false); }
  };
  const sel = value ? byId(value) : null;
  const showList = ql.length > 0; // lijst alleen tonen bij typen, zodat knoppen niet verspringen
  return (
    <div>
      {sel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 11px", background: T.accent, color: "#fff", borderRadius: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Gekozen post:</span>
          <b style={{ fontSize: 14 }}>{sel.naam}</b>
          <button onClick={() => onChange("")} style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,0.6)", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "2px 8px" }}>maak leeg</button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: T.sub, alignSelf: "center" }}>Snelkeuze:</span>
          {suggestions.map((cid) => { const c = byId(cid); if (!c) return null; const on = value === cid;
            return <button key={cid} onClick={() => pick(cid)} style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${on ? T.accent : "#cfe0db"}`, background: on ? T.accent : T.accentSoft, color: on ? "#fff" : T.accent, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{c.naam}</button>; })}
        </div>
      )}
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={onKey}
        placeholder={sel ? "Typ om een andere post te kiezen…" : "Typ om te zoeken (↵ kiest de eerste)…"}
        style={{ ...inputStyle, fontSize: 13, padding: "8px 10px", border: `1px solid ${sel ? T.accent : T.line}` }}
      />
      {showList && (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, marginTop: 6, maxHeight: 230, overflowY: "auto", background: "#fff" }}>
          {matches.length === 0 && <div style={{ padding: "10px 12px", fontSize: 13, color: T.sub }}>Geen post gevonden — pas je zoekterm aan.</div>}
          {matches.map((c, idx) => (
            <button
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); pick(c.id); }}
              onMouseEnter={() => setHi(idx)}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", border: "none", borderTop: idx ? `1px solid ${T.line}` : "none", background: idx === hi ? T.accentSoft : (value === c.id ? "#eef3f1" : "#fff"), padding: "8px 12px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: value === c.id ? 700 : 500 }}>{c.naam}</span>
              <span style={{ fontSize: 11, color: T.sub, whiteSpace: "nowrap" }}>{groupName(c.groupId)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

function Overzicht({ vitals, monthRows, monthly = [], topPostsByMonth = [], teSorteren = 0, onDrill, currentMonth, jaar, openActions, forecast, forecastYear = null, reconciliation = null, agingAdvances = [], openingBalanceCents, bankBalanceCents, saldoGaps = 0, chainOpening = null, freqAlerts = [], topDeviations = [], missingRecurring = [], recurringTotal = 0, recurringPaid = 0, savingsRate = null, vastMonthly = 0, varMonthly = 0, onSetOpeningBalance, onGoto, onReview }) {
  const [reopen, setReopen] = useState(false);
  const [selMonth, setSelMonth] = useState(currentMonth); // gekozen maand voor het maand-resultaatblok
  useEffect(() => { setSelMonth(currentMonth); }, [currentMonth, jaar]);
  const tile = (label, node, sub, onClick) => (
    <Card onClick={onClick} style={{ padding: 18, flex: 1, minWidth: 190, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 700, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>{node}</div>
      {sub && <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
  const mn = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const oa = openActions || { teSorteren: 0, gemarkeerd: 0, count: 0, items: [] };
  const fc = forecast || { accountBalance: 0, remainingOut: 0, remainingInc: 0, projectedEnd: 0, openingSet: false, month: currentMonth };
  const haalt = fc.projectedEnd >= 0;
  const haveBank = bankBalanceCents != null;          // banksaldo bekend uit de geïmporteerde "Saldo na mutatie"-kolom
  const diff = haveBank ? fc.accountBalance - bankBalanceCents : 0; // app minus bank
  const bankMatch = haveBank && diff === 0;
  const openingSet = fc.openingSet;
  const gaps = saldoGaps > 0;
  const canReconcile = chainOpening != null;
  const reconcile = () => { if (canReconcile) onSetOpeningBalance(chainOpening); setReopen(false); };
  const _today = new Date();
  const _daysInMonth = new Date(_today.getFullYear(), _today.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, _daysInMonth - _today.getDate() + 1);
  const perDay = Math.max(0, fc.projectedEnd) / daysLeft;
  return (
    <div>
      <SectionTitle>Overzicht · t/m {mn[currentMonth - 1]} {jaar}</SectionTitle>

      {!openingSet && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14", marginBottom: 4 }}>Stel eerst je startsaldo in</div>
          {canReconcile ? (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Je startsaldo is de stand van je betaalrekening vóór je eerste geïmporteerde transactie. Die haal ik uit de saldokolom van je import: <b>{formatEUR(chainOpening)}</b>. Daarna hoort je startsaldo <b>vast te blijven</b> — nieuwe transacties corrigeren je saldo, niet andersom.</div>
              <Btn onClick={reconcile}>Startsaldo instellen &amp; sluitend maken ({formatEUR(chainOpening)})</Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Vul het saldo van je ING-rekening in zoals het was vóór je eerste transactie. Tip: importeer je ING-bestand met de saldokolom, dan zet ik dit met één knop goed én kan ik controleren of je transacties sluiten.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.sub }}>Startsaldo</span>
                <MoneyInput cents={openingBalanceCents || 0} width={150} onChange={(v) => onSetOpeningBalance(v)} />
              </div>
            </>
          )}
        </Card>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ padding: 18, flex: 2, minWidth: 240, background: "#f3f8f6", border: `1px solid ${T.accent}` }}>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 6 }}>Huidig saldo</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}><Money cents={fc.accountBalance} sign bold size={30} /></div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>startsaldo + alle mutaties</div>
          {openingSet && gaps && (
            <div style={{ marginTop: 10, background: "#fbe9e9", border: `1px solid ${T.neg}`, borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.neg }}>⚠ Je transacties sluiten niet</div>
              <div style={{ fontSize: 12, color: "#7a2a2a", margin: "4px 0 8px" }}>De bankmutaties sluiten op {saldoGaps} plek{saldoGaps > 1 ? "ken" : ""} niet op elkaar aan. Er ontbreken transacties of er staan dubbele in — je startsaldo blijft staan, dit los je op door de ontbrekende periode te importeren of een dubbele te verwijderen.</div>
              <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>
            </div>
          )}
          {openingSet && !gaps && haveBank && (
            bankMatch
              ? <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: T.pos, display: "flex", alignItems: "center", gap: 6 }}>✓ Je saldo sluit met je bank ({formatEUR(bankBalanceCents)})</div>
              : <div style={{ marginTop: 10, fontSize: 12.5, color: T.sub, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>Je bankmutaties sluiten netjes op elkaar aan. Je huidige saldo wijkt {formatEUR(Math.abs(diff))} af van het banksaldo uit je import ({formatEUR(bankBalanceCents)}) — dat kan kloppen als je handmatige (contante) transacties hebt toegevoegd. Klopt dat niet, controleer dan je startsaldo via "opnieuw instellen".</div>
          )}
          {openingSet && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: T.sub }}>Startsaldo <b style={{ fontFamily: T.mono, color: T.ink }}>{formatEUR(openingBalanceCents || 0)}</b> · vast</span>
              <button onClick={() => setReopen((s) => !s)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{reopen ? "annuleren" : "opnieuw instellen"}</button>
            </div>
          )}
          {openingSet && reopen && (
            <div style={{ marginTop: 8, background: T.warnSoft, border: "1px solid #f0dcb8", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ fontSize: 12, color: "#7a5a1a", marginBottom: 8 }}>Normaal hoef je dit niet: je startsaldo hoort vast te blijven en transacties corrigeren je saldo. Wijzig het alleen als je echt opnieuw wil aansluiten.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {canReconcile && <Btn size="sm" onClick={reconcile}>Uit saldo-keten ({formatEUR(chainOpening)})</Btn>}
                <span style={{ fontSize: 12, color: T.sub }}>of handmatig:</span>
                <MoneyInput cents={openingBalanceCents || 0} width={140} onChange={(v) => onSetOpeningBalance(v)} />
              </div>
            </div>
          )}
        </Card>
        <Card style={{ padding: 18, flex: 1, minWidth: 240, background: haalt ? "#eef7f0" : "#fdeeee", border: `1px solid ${haalt ? T.pos : T.neg}` }}>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 6 }}>Red ik het in {mn[fc.month - 1]}?</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: haalt ? T.pos : T.neg }}>{haalt ? "Ja" : "Krap"} · <Money cents={fc.projectedEnd} sign bold size={22} /></div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 8, lineHeight: 1.6 }}>
            Huidig saldo <b>{formatEUR(fc.accountBalance)}</b><br />
            + nog te verwachten inkomsten <b style={{ color: T.pos }}>{formatEUR(fc.remainingInc)}</b><br />
            − nog te verwachten uitgaven <b style={{ color: T.neg }}>{formatEUR(fc.remainingOut)}</b><br />
            = verwacht saldo eind van de maand
          </div>
          {fc.openingSet && fc.projectedEnd > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${haalt ? "#cfe6d3" : "#f3cccc"}`, fontSize: 13 }}>Veilig te besteden: <b>≈ {formatEUR(perDay)} per dag</b> <span style={{ color: T.sub }}>· nog {daysLeft} dag{daysLeft > 1 ? "en" : ""} deze maand</span></div>}
        </Card>
      </div>

      {teSorteren > 0 && (
        <Card style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${T.warn}`, background: T.warnSoft }}>
          <div style={{ fontSize: 13 }}><b>{teSorteren}</b> transactie{teSorteren > 1 ? "s" : ""} nog toe te kennen — loop ze in één keer na.</div>
          <Btn size="sm" onClick={() => onReview && onReview()}>▶ Nalopen starten</Btn>
        </Card>
      )}

      {monthly.length === 12 && (() => {
        const mn2 = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
        const r = monthly[selMonth - 1] || { income: 0, expense: 0, net: 0, budgetNet: 0, toSavings: 0, fromSavings: 0 };
        const prev = selMonth > 1 ? monthly[selMonth - 2] : null;
        const nettoSpaar = r.toSavings - r.fromSavings;          // + = per saldo naar spaar, − = per saldo uit buffer gehaald
        const exclSpaar = r.net + nettoSpaar;                     // resultaat zonder spaarmutaties (huishoud-resultaat)
        // Leesbare inkomsten/uitgaven: haal de spaarbuffer-bewegingen uit de gewone in-/uitgaven,
        // zodat een buffer-opname niet als "negatieve uitgave" verschijnt.
        const zuiverInkomsten = r.income - r.fromSavings;
        const zuiverUitgaven = r.expense - r.toSavings;
        const hasData = r.income !== 0 || r.expense !== 0;
        const monthsWithData = monthly.map((m, i) => (m.income !== 0 || m.expense !== 0 ? i + 1 : null)).filter(Boolean);
        return (
          <Card style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Maand-resultaat</div>
              <select value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600, color: T.ink, background: T.panel, cursor: "pointer" }}>
                {(monthsWithData.length ? monthsWithData : [currentMonth]).map((m) => <option key={m} value={m}>{mn2[m - 1]} {jaar}</option>)}
              </select>
            </div>
            {!hasData ? (
              <div style={{ fontSize: 13, color: T.sub }}>Geen transacties in {mn2[selMonth - 1]}.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 0, flexWrap: "wrap", alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 130, padding: "4px 16px 4px 0" }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Inkomsten</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.pos }}>{formatEUR(zuiverInkomsten)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 130, padding: "4px 16px", borderLeft: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Uitgaven</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.neg }}>{formatEUR(zuiverUitgaven)}</div>
                  </div>
                  <div style={{ flex: 1.2, minWidth: 150, padding: "4px 0 4px 16px", borderLeft: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Over / tekort deze maand</div>
                    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: T.mono, color: exclSpaar >= 0 ? T.pos : T.neg }}>{exclSpaar >= 0 ? "+" : "−"}{formatEUR(Math.abs(exclSpaar))}</div>
                    <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2 }}>
                      {(() => { const vsB = exclSpaar - r.budgetNet; return vsB >= 0 ? <span style={{ color: T.pos }}>{formatEUR(vsB)} beter dan begroot</span> : <span style={{ color: T.neg }}>{formatEUR(Math.abs(vsB))} onder begroting</span>; })()}
                      {prev && (() => { const vsP = exclSpaar - (prev.net + (prev.toSavings - prev.fromSavings)); return <> · {vsP >= 0 ? "+" : "−"}{formatEUR(Math.abs(vsP))} vs vorige maand</>; })()}
                    </div>
                  </div>
                </div>
                {(r.toSavings > 0 || r.fromSavings > 0) && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.line}`, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                    <div style={{ fontSize: 12.5, color: T.sub }}>
                      Spaarbuffer:
                      {r.toSavings > 0 && <> <b style={{ color: T.ink }}>{formatEUR(r.toSavings)}</b> ingelegd</>}
                      {r.toSavings > 0 && r.fromSavings > 0 && " ·"}
                      {r.fromSavings > 0 && <> <b style={{ color: T.ink }}>{formatEUR(r.fromSavings)}</b> opgenomen</>}
                      {" → netto "}
                      <b style={{ color: nettoSpaar >= 0 ? T.pos : "#9a6a14" }}>{nettoSpaar >= 0 ? `${formatEUR(nettoSpaar)} naar spaar` : `${formatEUR(Math.abs(nettoSpaar))} uit buffer`}</b>
                    </div>
                    <div style={{ fontSize: 12.5, color: T.sub, marginLeft: "auto", background: "#f3f8f6", border: `1px solid ${T.line}`, borderRadius: 8, padding: "5px 11px" }}>
                      Betaalrekening deze maand: <b style={{ color: r.net >= 0 ? T.pos : T.neg }}>{r.net >= 0 ? "+" : "−"}{formatEUR(Math.abs(r.net))}</b>
                    </div>
                  </div>
                )}
                {topPostsByMonth[selMonth - 1] && topPostsByMonth[selMonth - 1].length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 4 }}>Grootste uitgaven in {mn2[selMonth - 1]} <span style={{ fontWeight: 400 }}>· klik voor de transacties</span></div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {topPostsByMonth[selMonth - 1].map((p) => (
                        <button key={p.id} onClick={() => onDrill && onDrill({ maand: selMonth, categoryId: p.id })} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12.5, padding: "5px 2px", border: "none", borderTop: `1px solid ${T.line}`, background: "transparent", cursor: "pointer", textAlign: "left", color: T.ink, width: "100%" }}>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.naam}</span>
                          <span style={{ fontFamily: T.mono, flexShrink: 0, color: T.neg }}>{formatEUR(p.cents)} <span style={{ color: T.sub }}>›</span></span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" variant="secondary" onClick={() => onDrill && onDrill({ maand: selMonth })}>Alle transacties van {mn2[selMonth - 1]} bekijken</Btn>
                </div>
              </>
            )}
          </Card>
        );
      })()}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {tile("Gereserveerd vermogen", <Money cents={vitals.vermogen} bold />, `${vitals.potCount} rekeningen · bekijk opbouw`, () => onGoto && onGoto("vermogen"))}
        {savingsRate && tile("Besparingsratio deze maand", <span style={{ color: savingsRate.rate == null ? T.ink : savingsRate.rate >= 0 ? T.pos : T.neg }}>{savingsRate.rate != null ? `${Math.round(savingsRate.rate * 100)}%` : "—"}</span>, savingsRate.rate != null ? `${formatEUR(savingsRate.saved)} opzij van ${formatEUR(savingsRate.income)}` : "nog geen inkomsten deze maand")}
      </div>

      {monthly.length === 12 && (() => {
        const short = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
        const rows = monthly.map((m, i) => ({ i, has: m.income !== 0 || m.expense !== 0, ink: m.income - m.fromSavings, uit: m.expense - m.toSavings }));
        const maxUit = Math.max(1, ...rows.map((r) => r.uit));
        if (!rows.some((r) => r.has)) return null;
        return (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Uitgaven per maand <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· klik op een maand voor de transacties</span></div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map((r) => {
                if (!r.has && r.i + 1 > currentMonth) return null;
                const res = r.ink - r.uit;
                return (
                  <button key={r.i} onClick={() => r.has && onDrill && onDrill({ maand: r.i + 1 })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", border: "none", borderTop: r.i ? `1px solid ${T.line}` : "none", background: "transparent", cursor: r.has ? "pointer" : "default", textAlign: "left", width: "100%" }}>
                    <span style={{ width: 34, flexShrink: 0, fontSize: 12, color: r.i + 1 === currentMonth ? T.accent : T.sub, fontWeight: r.i + 1 === currentMonth ? 800 : 600 }}>{short[r.i]}</span>
                    <span style={{ flex: 1, height: 8, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><span style={{ display: "block", width: `${Math.min(100, Math.round((r.uit / maxUit) * 100))}%`, height: "100%", background: T.neg, opacity: 0.5 }} /></span>
                    <span style={{ width: 96, textAlign: "right", fontFamily: T.mono, fontSize: 12, color: T.neg, flexShrink: 0 }}>{r.has ? `− ${formatEUR(r.uit)}` : "—"}</span>
                    <span style={{ width: 96, textAlign: "right", fontFamily: T.mono, fontSize: 12, color: res >= 0 ? T.pos : T.neg, flexShrink: 0 }}>{r.has ? `${res >= 0 ? "+" : "−"} ${formatEUR(Math.abs(res))}` : ""}</span>
                    <span style={{ color: T.sub, flexShrink: 0, fontSize: 12 }}>{r.has ? "›" : " "}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {forecastYear && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: forecastYear.budgetRunout.length ? 10 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Prognose jaareinde {jaar} <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· op basis van je begroting + tempo tot nu toe</span></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: forecastYear.projectedYearEnd >= 0 ? T.pos : T.neg }}>≈ <Money cents={forecastYear.projectedYearEnd} sign bold size={16} /></div>
          </div>
          <div style={{ fontSize: 12, color: T.sub }}>Beginsaldo {formatEUR(forecastYear.carryIn)} + werkelijk t/m nu {forecastYear.actualNetYTD >= 0 ? "+" : "−"}{formatEUR(Math.abs(forecastYear.actualNetYTD))} + begroot restant {forecastYear.budgetNetRest >= 0 ? "+" : "−"}{formatEUR(Math.abs(forecastYear.budgetNetRest))}{Math.abs(forecastYear.bias) > 50 ? `, met correctie voor je maandpatroon (${forecastYear.bias >= 0 ? "+" : "−"}${formatEUR(Math.abs(Math.round(forecastYear.bias)))}/mnd)` : ""}.</div>
          {forecastYear.budgetRunout.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Op dit tempo raakt het jaarbudget eerder op:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {forecastYear.budgetRunout.map((b) => (
                  <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.naam}</span>
                    <span style={{ flexShrink: 0, color: b.runoutMonth <= currentMonth + 1 ? T.neg : "#9a6a14" }}>{b.pace}% van jaarbudget/tempo · op rond {["", "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][Math.min(12, b.runoutMonth)]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {reconciliation && (
        <Card style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${reconciliation.gaps ? "#f0dcb8" : "#cfe6d4"}`, background: reconciliation.gaps ? T.warnSoft : "#f2f9f4" }}>
          <div style={{ fontSize: 13 }}>
            {reconciliation.gaps > 0
              ? <><b style={{ color: "#9a6a14" }}>Saldoketen heeft {reconciliation.gaps} onderbreking{reconciliation.gaps > 1 ? "en" : ""}</b> — er lijken transacties te ontbreken. Controleer je import.</>
              : reconciliation.through > 0
                ? <><b style={{ color: "#1f6b3a" }}>✓ Administratie sluit t/m {["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"][reconciliation.through]}</b> — banksaldo en boekingen lopen gelijk.</>
                : <>Nog geen sluitende maand om af te letteren.</>}
          </div>
          <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Transacties</Btn>
        </Card>
      )}

      {agingAdvances.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid ${agingAdvances.some((a) => a.days >= 30) ? "#f0dcb8" : T.line}`, background: agingAdvances.some((a) => a.days >= 30) ? T.warnSoft : T.panel }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: agingAdvances.some((a) => a.days >= 30) ? "#9a6a14" : T.ink }}>Openstaande voorschotten · {agingAdvances.length}</div>
            <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Afhandelen</Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {agingAdvances.slice(0, 6).map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <span style={{ flexShrink: 0 }}><b>{formatEUR(a.remaining)}</b> open · <span style={{ color: a.days >= 30 ? T.neg : T.sub }}>{a.days} dag{a.days === 1 ? "" : "en"}</span></span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(vastMonthly > 0 || varMonthly > 0) && (() => {
        const totM = vastMonthly + varMonthly;
        const vp = totM > 0 ? Math.round((vastMonthly / totM) * 100) : 0;
        return (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Vaste vs. variabele lasten <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· per maand (begroot)</span></div>
              <div style={{ fontSize: 12, color: T.sub }}>Vast <b style={{ color: "#4338ca" }}>{formatEUR(vastMonthly)}</b> · Variabel <b style={{ color: T.pos }}>{formatEUR(varMonthly)}</b></div>
            </div>
            <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "#eef3f1" }}>
              <div style={{ width: `${vp}%`, background: "#6366f1" }} />
              <div style={{ width: `${100 - vp}%`, background: T.pos }} />
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>{vp}% van je begrote uitgaven ligt vast; {100 - vp}% is vrij besteedbaar. Pas per post aan op <button onClick={() => onGoto && onGoto("posten")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 12 }}>Posten</button>.</div>
          </Card>
        );
      })()}

      {recurringTotal > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid ${missingRecurring.length ? "#f0dcb8" : T.line}`, background: missingRecurring.length ? T.warnSoft : T.panel }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: missingRecurring.length ? 8 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: missingRecurring.length ? "#9a6a14" : T.ink }}>Vaste lasten deze maand · {recurringPaid}/{recurringTotal} binnen</div>
            {missingRecurring.length > 0 && <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>}
          </div>
          {missingRecurring.length === 0
            ? <div style={{ fontSize: 13, color: T.pos, fontWeight: 600 }}>✓ Al je maandelijkse vaste lasten zijn deze maand binnen.</div>
            : <>
                <div style={{ fontSize: 12, color: "#7a5a1a", marginBottom: 6 }}>Deze maandelijkse posten zag ik deze maand nog niet — ze moeten mogelijk nog binnenkomen, of importeer even de recentste periode:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {missingRecurring.map((m) => <span key={m.id} style={{ fontSize: 12.5, background: "#fff", border: "1px solid #f0dcb8", borderRadius: 999, padding: "3px 10px" }}>○ {m.naam}{m.avg ? ` · ~${formatEUR(m.avg)}` : ""}</span>)}
                </div>
              </>}
        </Card>
      )}

      {freqAlerts.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14", marginBottom: 8 }}>Mogelijke dubbele boekingen · {jaar}</div>
          {freqAlerts.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "4px 0" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{a.naam.split(":")[0]}</span>
              <span style={{ color: T.neg, fontWeight: 600, flexShrink: 0 }}>{a.count}× geboekt · max {a.max}×</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#7a5a1a" }}>Vaker geboekt dan je verwacht — controleer op een dubbele, of pas de max/jaar aan op Posten.</div>
            <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Btn onClick={() => onGoto && onGoto("import")}>+ Nieuwe uitgaven importeren</Btn>
        {oa.teSorteren > 0 && <Btn variant="secondary" onClick={() => onReview && onReview()}>{oa.teSorteren} nog toe te kennen — nu nalopen</Btn>}
      </div>

      {oa.count > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: oa.items.length ? 10 : 0, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14" }}>Openstaande acties · {oa.teSorteren} toe te kennen · {oa.gemarkeerd} gemarkeerd</div>
            <div style={{ display: "flex", gap: 8 }}>
              {oa.teSorteren > 0 && <Btn size="sm" onClick={() => onReview && onReview()}>Nu nalopen</Btn>}
              <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Alle transacties</Btn>
            </div>
          </div>
          {oa.items.slice(0, 5).map((t, i) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: i ? `1px solid #f0dcb8` : "none", fontSize: 13 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)} · {t.name}{t.note ? ` · ${t.note}` : ""}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color: t.amountCents < 0 ? T.neg : T.pos }}>{formatEUR(t.amountCents)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: t.reason === "toe te kennen" ? "#fff" : "#eef0ff", color: t.reason === "toe te kennen" ? T.warn : "#4338ca" }}>{t.reason}</span>
              </span>
            </div>
          ))}
          {oa.count > 5 && <div style={{ fontSize: 12, color: "#9a6a14", marginTop: 8 }}>en nog {oa.count - 5} meer…</div>}
        </Card>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card style={{ padding: 18, flex: 1, minWidth: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Grootste afwijkingen</div>
            {topDeviations.length > 0 && <button onClick={() => onGoto && onGoto("uitgaven")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>alle uitgaven →</button>}
          </div>
          {topDeviations.length === 0 && <div style={{ fontSize: 13, color: T.sub }}>Importeer je ING-CSV en zet een begroting om afwijkingen te zien.</div>}
          {topDeviations.map((d, i) => {
            const over = d.dev > 0;
            return (
              <div key={d.id} style={{ padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.naam}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 700, color: over ? T.neg : T.pos, flexShrink: 0 }}>{over ? "+" : ""}{formatEUR(d.dev)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: T.sub }}>{formatEUR(d.actual)} besteed · {d.budget > 0 ? `begroot ${formatEUR(d.budget)}` : "niet begroot"}</div>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
function SaldoChart({ rows, currentMonth }) {
  const W = 520, H = 150, pad = 8;
  const vals = rows.map((r) => r.end);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals), span = max - min || 1;
  const x = (i) => pad + (i * (W - 2 * pad)) / 11;
  const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const mn = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: "100%" }}>
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke={T.line} />
      <polyline points={rows.map((r, i) => `${x(i)},${y(r.end)}`).join(" ")} fill="none" stroke={T.accent} strokeWidth="2" />
      {rows.map((r, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(r.end)} r={i + 1 === currentMonth ? 4 : 2.5} fill={i + 1 <= currentMonth ? T.accent : "#cdd6d4"} />
          <text x={x(i)} y={H + 10} fontSize="9" fill={T.sub} textAnchor="middle">{mn[i]}</text>
        </g>
      ))}
    </svg>
  );
}

function AddLine({ label, onAdd, indent = false }) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [amount, setAmount] = useState(0);
  const pad = indent ? "8px 16px 8px 28px" : "8px 16px";
  const add = () => { const n = naam.trim(); if (!n) return; onAdd(n, amount); setNaam(""); setAmount(0); setOpen(false); };
  if (!open) return (
    <div style={{ padding: pad, borderTop: `1px solid ${T.line}` }}>
      <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>+ {label}</Btn>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: pad, borderTop: `1px solid ${T.line}`, background: "#fafcfb", flexWrap: "wrap" }}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Naam van de post" style={{ ...inputStyle, width: 220, padding: "6px 10px", fontSize: 13 }} />
      <span style={{ fontSize: 12, color: T.sub }}>per maand</span>
      <MoneyInput cents={amount} width={110} onChange={setAmount} />
      <Btn size="sm" onClick={add}>Toevoegen</Btn>
      <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); setNaam(""); setAmount(0); }}>Annuleren</Btn>
    </div>
  );
}

function AddSubcategory({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const add = () => { const n = naam.trim(); if (!n) return; onAdd(n); setNaam(""); setOpen(false); };
  if (!open) return (
    <div style={{ padding: "9px 16px", borderTop: `1px solid ${T.line}`, background: "#fbfdfc" }}>
      <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>+ nieuwe subcategorie onder Uitgaven</Btn>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}`, background: "#fbfdfc", flexWrap: "wrap" }}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Naam subcategorie (bijv. Vervoer)" style={{ ...inputStyle, width: 240, padding: "6px 10px", fontSize: 13 }} />
      <Btn size="sm" onClick={add}>Toevoegen</Btn>
      <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); setNaam(""); }}>Annuleren</Btn>
    </div>
  );
}

function Beginstand({ groups, categories, year, onSetYtd }) {
  const ytd = year.ytdSeed || {};
  const total = categories.reduce((s, c) => s + (ytd[c.id] || 0), 0);
  return (
    <Card style={{ overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "12px 16px", background: T.accentSoft, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Beginstand {year.jaartal} — al besteed/ontvangen tot nu toe</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>Begin je halverwege het jaar? Vul per post in wat er dit jaar al is besteed of ontvangen vóórdat je begon te importeren. Dit telt mee als startpunt in <b>Uitgaven › Begroot vs besteed</b>. Posten zonder beginstand laat je op 0 staan.</div>
      </div>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id);
        if (cats.length === 0) return null;
        const gt = cats.reduce((s, c) => s + (ytd[c.id] || 0), 0);
        return (
          <div key={g.id}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>
              <span>{g.naam}</span>
              <span style={{ fontFamily: T.mono, color: T.sub }}>{formatEUR(gt)}</span>
            </div>
            {cats.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 16px", borderTop: `1px solid ${T.line}` }}>
                <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam.split(":")[0]}</span>
                <MoneyInput cents={ytd[c.id] || 0} width={110} onChange={(v) => onSetYtd(year.id, c.id, v)} />
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: "#eef3f1", fontWeight: 800, fontSize: 13 }}>
        <span>Totaal ingevulde beginstand</span>
        <span style={{ fontFamily: T.mono }}>{formatEUR(total)}</span>
      </div>
    </Card>
  );
}

function Begroting({ groups, categories, budgets, year, onSaveLine, onImportBudget, onAddCategory, onAddGroup, onAcceptSluitpost, prevYear, prevActualByCat, onSetYtd }) {
  const [expanded, setExpanded] = useState(null);
  const [drag, setDrag] = useState(false);
  const [showBeginstand, setShowBeginstand] = useState(false);
  const [impResult, setImpResult] = useState(null);
  const fileRef = useRef(null);
  const lines = applySluitpost(categories, budgets[year.id] || {});
  const lineFor = (cid) => lines[cid] || { average: 0, months: distributeEven(0) };
  const totals = budgetTotals(categories, lines);
  const sluitAnnual = sumMonths(lineFor(SLUITPOST_ID).months);
  const sluitAccepted = year.sluitpostAcceptedCents != null && year.sluitpostAcceptedCents === sluitAnnual;
  const hasPrev = !!(prevYear && prevActualByCat);
  const cols = hasPrev ? "1fr 130px 110px 120px 80px" : "1fr 130px 120px 80px";

  const incomeGroupId = (groups.find((g) => categories.some((c) => c.groupId === g.id && c.type === "income")) || groups[0] || {}).id;
  const savingsGroupId = (groups.find((g) => categories.some((c) => c.groupId === g.id && c.type === "savings")) || {}).id;
  const incomeGroupIds = new Set(categories.filter((c) => c.type === "income").map((c) => c.groupId));
  const savingsGroupIds = new Set(categories.filter((c) => c.type === "savings").map((c) => c.groupId));
  const incomeCats = categories.filter((c) => c.type === "income");
  const savingsCats = categories.filter((c) => c.type === "savings");
  const expenseGroups = groups.filter((g) => !incomeGroupIds.has(g.id) && !savingsGroupIds.has(g.id));
  const annualOf = (cid) => sumMonths(lineFor(cid).months);
  const sumCats = (cs) => cs.reduce((a, c) => a + annualOf(c.id), 0);
  const expenseTotal = expenseGroups.reduce((a, g) => a + sumCats(categories.filter((c) => c.groupId === g.id)), 0);

  const renderLine = (c) => {
    const line = lineFor(c.id), annual = sumMonths(line.months), isOpen = expanded === c.id;
    const prevA = hasPrev ? (prevActualByCat[c.id] || 0) : 0;
    if (c.id === SLUITPOST_ID) return (
      <div key={c.id} style={{ borderTop: `1px solid ${T.line}`, background: "#fcf9e8" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 10, padding: "8px 16px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{c.naam} <span style={{ fontSize: 11, color: T.warn, fontWeight: 600 }}>· sluitpost</span></span>
          <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{formatEUR(Math.round(annual / 12))}</div>
          {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(Math.abs(prevA)) : "—"}</div>}
          <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} bold /></div>
          <div />
        </div>
      </div>
    );
    return (
      <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 10, padding: "8px 16px" }}>
          <span style={{ fontSize: 14 }}>{c.naam}{c.noteSuggested && <span title="opmerking voorgesteld" style={{ marginLeft: 6, color: T.warn }}>•</span>}</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <MoneyInput cents={line.average} width={110} onChange={(v) => onSaveLine(c.id, v, distributeEven(v))} />
          </div>
          {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(Math.abs(prevA)) : "—"}</div>}
          <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} muted /></div>
          <div style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "maanden"}</Btn></div>
        </div>
        {isOpen && <MonthEditor line={line} onSave={(months) => { onSaveLine(c.id, line.average, months); setExpanded(null); }} />}
      </div>
    );
  };
  const bigHeader = (titel, bedrag) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: T.accentSoft, borderTop: `1px solid ${T.line}` }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: T.accent, letterSpacing: 0.4, textTransform: "uppercase" }}>{titel}</span>
      <span style={{ fontFamily: T.mono, fontWeight: 700, color: T.accent }}>{formatEUR(bedrag)}/jaar</span>
    </div>
  );
  const subHeader = (titel, bedrag) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 16px 9px 22px", background: "#f0f4f3", borderTop: `1px solid ${T.line}`, borderLeft: `3px solid ${T.accent}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{titel}</span>
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.sub }}>{formatEUR(bedrag)}/jaar</span>
    </div>
  );

  const handleFile = async (file) => {
    if (!file) return;
    setImpResult(null);
    try {
      let rows;
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      } else {
        const text = await file.text();
        const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
        if (/naam \/ omschrijving|mutatiesoort|saldo na mutatie|bedrag \(eur\)/.test(head)) { setImpResult({ bank: true }); return; }
        const delim = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
        rows = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => l.split(delim));
      }
      const { updates, unmatched } = parseBudgetRows(rows, categories);
      const n = Object.keys(updates).length;
      if (n > 0) onImportBudget(updates);
      setImpResult({ matched: n, unmatched });
    } catch (e) {
      setImpResult({ error: e.message || "onbekende fout" });
    }
  };

  return (
    <div>
      <SectionTitle right={onSetYtd && <Btn variant={showBeginstand ? "secondary" : "ghost"} size="sm" onClick={() => setShowBeginstand((s) => !s)}>{showBeginstand ? "Beginstand sluiten" : "Beginstand instellen"}</Btn>}>Begroting {year.jaartal}</SectionTitle>
      {showBeginstand && onSetYtd && <Beginstand groups={groups} categories={categories} year={year} onSetYtd={onSetYtd} />}

      <Card style={{ padding: 0, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150, padding: "14px 18px", borderRight: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Inkomsten / jaar</div>
            <Money cents={totals.income} bold size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 150, padding: "14px 18px", borderRight: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Uitgaven &amp; sparen / jaar</div>
            <Money cents={totals.outflow} bold size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 200, padding: "14px 18px", background: sluitAccepted ? T.accentSoft : T.warnSoft }}>
            <div style={{ fontSize: 12, color: sluitAccepted ? T.accent : "#9a6a14", marginBottom: 4, fontWeight: 600 }}>Sluitpost · gezamenlijke spaarrekening</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Money cents={sluitAnnual} bold size={18} />
              {sluitAccepted
                ? <span style={{ fontSize: 12, color: T.pos, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={<polyline points="20 6 9 17 4 12" />} size={14} /> akkoord</span>
                : <Btn size="sm" onClick={() => onAcceptSluitpost && onAcceptSluitpost(sluitAnnual)}>Accepteren</Btn>}
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${T.line}`, fontSize: 12, color: sluitAccepted ? T.sub : "#9a6a14" }}>
          {sluitAccepted
            ? <>Het verschil tussen inkomsten en uitgaven komt op de <b>gezamenlijke spaarrekening</b>. Je hebt dit bedrag geaccepteerd.</>
            : <>Het verschil tussen inkomsten en uitgaven komt op de <b>gezamenlijke spaarrekening</b>. Controleer het bedrag hierboven en klik op <b>Accepteren</b> om de begroting te bevestigen. Wijzig je later een post, dan vraagt hij opnieuw om akkoord.</>}
        </div>
      </Card>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: `2px dashed ${drag ? T.accent : T.line}`, background: drag ? T.accentSoft : T.panel, borderRadius: T.radius, padding: "16px 18px", marginBottom: 14, cursor: "pointer", textAlign: "center" }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sleep hier je begroting · alleen postnaam + maandbedrag</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>Excel of CSV · dit is níét voor je bankafschrift — dat hoort op de Import-tab</div>
      </div>
      {impResult && (
        <div style={{ marginBottom: 16 }}>
          {impResult.bank ? <Banner tone="warn">Dit lijkt je <b>bankafschrift</b>, niet je begroting. Sleep dit bestand op de <b>Import</b>-tab — daar lees je je transacties in.</Banner>
            : impResult.error ? <Banner tone="neg">Kon het bestand niet lezen: {impResult.error}. Tip: bewaar je Excel-tabblad als CSV en sleep dat.</Banner>
            : <Banner tone={impResult.unmatched.length ? "warn" : "ok"}>
                {impResult.matched} post(en) herkend en bijgewerkt; de begroting is automatisch sluitend gemaakt.
                {impResult.unmatched.length > 0 && <div style={{ marginTop: 6, fontSize: 13 }}>Niet aan een post gekoppeld ({impResult.unmatched.length}): {impResult.unmatched.slice(0, 8).join(", ")}{impResult.unmatched.length > 8 ? "…" : ""}</div>}
              </Banner>}
        </div>
      )}

      {hasPrev && <div style={{ marginBottom: 14 }}><Banner tone="neutral">Tip: de kolom <b>{prevYear.jaartal} werkelijk</b> laat zien wat je vorig jaar echt uitgaf. Gebruik dat als ijkpunt en pas posten aan op bekende veranderingen.</Banner></div>}

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Post</span><span style={{ textAlign: "right" }}>per maand</span>{hasPrev && <span style={{ textAlign: "right" }}>{prevYear.jaartal} werkelijk</span>}<span style={{ textAlign: "right" }}>per jaar</span><span />
        </div>

        {bigHeader("Inkomsten", sumCats(incomeCats))}
        {incomeCats.map(renderLine)}
        <AddLine label="nieuwe inkomstenpost" onAdd={(n, a) => onAddCategory(incomeGroupId, n, "income", a)} />

        {bigHeader("Uitgaven", expenseTotal)}
        {expenseGroups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id}>
              {subHeader(g.naam, sumCats(cats))}
              {cats.map(renderLine)}
              <AddLine label={"nieuwe post in " + g.naam} indent onAdd={(n, a) => onAddCategory(g.id, n, "expense", a)} />
            </div>
          );
        })}
        <AddSubcategory onAdd={onAddGroup} />

        {bigHeader("Sparen", sumCats(savingsCats))}
        {savingsCats.map(renderLine)}
        {savingsGroupId && <AddLine label="nieuwe spaarpost" onAdd={(n, a) => onAddCategory(savingsGroupId, n, "savings", a)} />}
      </Card>
    </div>
  );
}
function MonthEditor({ line, onSave }) {
  const [months, setMonths] = useState(line.months.slice());
  useEffect(() => { setMonths(line.months.slice()); }, [line]);
  const names = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const check = checkDistribution(line.average, months);
  return (
    <div style={{ padding: "4px 16px 14px", background: "#fafcfb" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 10 }}>
        {months.map((m, i) => (
          <div key={i}>
            <div style={{ fontSize: 10, color: T.sub, marginBottom: 2 }}>{names[i]}</div>
            <MoneyInput cents={m} width="100%" onChange={(v) => { const n = months.slice(); n[i] = v; setMonths(n); }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: check.ok ? T.pos : T.neg }}>{check.ok ? `Sluit aan op ${formatEUR(check.target)}` : `Wijkt ${formatEUR(Math.abs(check.diff))} af van ${formatEUR(check.target)}`}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => setMonths(distributeEven(line.average))}>Verdeel gelijk</Btn>
          <Btn size="sm" disabled={!check.ok} onClick={() => onSave(months)}>Opslaan</Btn>
        </div>
      </div>
    </div>
  );
}

function AbonnementenScan({ categories, lines, actualByCat, monthsElapsed }) {
  const aboCats = categories.filter((c) => c.groupId === "abonnementen" && c.type === "expense");
  if (aboCats.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Geen posten in de groep Abonnementen. Voeg ze toe op <b>Begroting</b>, dan verschijnen ze hier met hun jaarbedrag.</div></Card>;
  const rows = aboCats.map((c) => {
    const monthly = (lines[c.id] || {}).average || 0;
    const actualYTD = Math.abs(sumMonths(actualByCat[c.id] || []));
    return { id: c.id, naam: c.naam, monthly, yearly: monthly * 12, actualYTD };
  }).sort((a, b) => b.yearly - a.yearly);
  const totMonthly = rows.reduce((s, r) => s + r.monthly, 0), totYearly = totMonthly * 12, totActual = rows.reduce((s, r) => s + r.actualYTD, 0);
  const gcols = "1fr 118px 118px 128px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: 18, background: "#f3f8f6", border: `1px solid ${T.accent}` }}>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 4 }}>Je abonnementen kosten je samen</div>
        <div style={{ fontSize: 28, fontWeight: 800 }}>{formatEUR(totYearly)} <span style={{ fontSize: 15, fontWeight: 600, color: T.sub }}>per jaar</span></div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 4 }}>= {formatEUR(totMonthly)} per maand begroot · {formatEUR(totActual)} werkelijk besteed dit jaar</div>
      </Card>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Abonnement</span><span style={{ textAlign: "right" }}>Per maand</span><span style={{ textAlign: "right" }}>Per jaar</span><span style={{ textAlign: "right" }}>Besteed dit jaar</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{r.naam}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13 }}>{r.monthly ? formatEUR(r.monthly) : "—"}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>{r.yearly ? formatEUR(r.yearly) : "—"}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13, color: T.sub }}>{r.actualYTD ? formatEUR(r.actualYTD) : "—"}</span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, alignItems: "center", padding: "12px 16px", borderTop: `2px solid ${T.line}`, background: "#f7faf9" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Totaal</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700 }}>{formatEUR(totMonthly)}</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 800 }}>{formatEUR(totYearly)}</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: T.sub }}>{formatEUR(totActual)}</span>
        </div>
      </Card>
      <div style={{ fontSize: 12, color: T.sub }}>Tip: zet elke maandprijs bij de post op <b>Begroting</b>. Een abonnement dat je nauwelijks gebruikt is vaak de makkelijkste besparing.</div>
    </div>
  );
}
function Sparkline({ values, width = 130, height = 30 }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const step = n > 1 ? width / (n - 1) : width;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 5) - 3).toFixed(1)}`).join(" ");
  const last = values.length ? values[values.length - 1] : 0;
  const lx = (n - 1) * step, ly = height - (last / max) * (height - 5) - 3;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {n > 1 && <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
      {n > 0 && <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill={T.accent} />}
    </svg>
  );
}
function TrendView({ categories, actualByCat, names, monthsElapsed }) {
  const rows = categories.filter((c) => c.type === "expense").map((c) => {
    const monthly = (actualByCat[c.id] || Array.from({ length: 12 }, () => 0)).map((v) => Math.abs(v)).slice(0, monthsElapsed);
    const total = monthly.reduce((s, v) => s + v, 0);
    const thisM = monthly[monthsElapsed - 1] || 0;
    const avg = monthsElapsed > 0 ? total / monthsElapsed : 0;
    return { c, monthly, total, thisM, avg };
  }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  if (rows.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen uitgaven om een trend te tonen.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Per post het verloop over de maanden. De pijl vergelijkt deze maand ({names[monthsElapsed - 1]}) met je gemiddelde — omhoog (rood) is meer uitgeven dan gemiddeld.</div>
      <Card style={{ overflow: "hidden" }}>
        {rows.map((r, i) => {
          const diff = r.thisM - r.avg;
          const up = diff > r.avg * 0.05, down = diff < -r.avg * 0.05;
          return (
            <div key={r.c.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px 150px", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.c.naam.split(":")[0]}</div>
                <div style={{ fontSize: 11.5, color: T.sub }}>deze maand {formatEUR(r.thisM)} · gem {formatEUR(Math.round(r.avg))}</div>
              </div>
              <Sparkline values={r.monthly} />
              <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: up ? T.neg : down ? T.pos : T.sub }}>
                {up ? "↑" : down ? "↓" : "→"} {diff === 0 ? "gelijk" : `${diff > 0 ? "+" : "−"}${formatEUR(Math.abs(diff))}`} <span style={{ color: T.sub, fontWeight: 400 }}>vs gem</span>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Uitgaven({ groups, categories, budgets, year, years = [], transactions, onAddCategory, onSetYtd, onSetSubBudget }) {
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState("vergelijking"); // vergelijking | blokjes | maand
  const [viewYearId, setViewYearId] = useState(year.id);
  const vY = years.find((y) => y.id === viewYearId) || year;
  const monthsElapsed = useMemo(() => { let m = 1; for (const t of transactions) if (effYear(t) === vY.jaartal) m = Math.max(m, effMonth(t)); return m; }, [transactions, vY]);
  const lines = useMemo(() => applySluitpost(categories, budgets[vY.id] || {}), [categories, budgets, vY]);
  const blocksByCat = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (effYear(t) !== vY.jaartal) continue;
      for (const a of t.allocations) {
        if (!map[a.categoryId]) map[a.categoryId] = [];
        map[a.categoryId].push({ id: t.id, date: t.date, amountCents: a.amountCents, note: t.note || "", flagged: !!t.flagged, label: t.omschrijving || t.name || "" });
      }
    }
    for (const k in map) map[k].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return map;
  }, [transactions, vY]);
  const actualByCat = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (effYear(t) !== vY.jaartal) continue;
      const m = effMonth(t);
      for (const a of t.allocations) {
        if (!map[a.categoryId]) map[a.categoryId] = Array.from({ length: 12 }, () => 0);
        map[a.categoryId][m - 1] += a.amountCents;
      }
    }
    return map;
  }, [transactions, vY]);
  const names = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const yearTxCount = transactions.filter((t) => effYear(t) === vY.jaartal).length;
  const totalIncome = categories.filter((c) => c.type === "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const totalOut = categories.filter((c) => c.type !== "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const cols = "1fr 110px 110px 110px 60px";
  const sortedYears = [...years].sort((a, b) => a.jaartal - b.jaartal);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Uitgaven {vY.jaartal}</SectionTitle>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {sortedYears.length > 1 && (
            <div style={{ display: "inline-flex", gap: 4 }}>
              {sortedYears.map((y) => (
                <button key={y.id} onClick={() => setViewYearId(y.id)} style={{ padding: "5px 11px", borderRadius: 8, border: `1px solid ${y.id === viewYearId ? T.accent : T.line}`, background: y.id === viewYearId ? T.accentSoft : T.panel, color: y.id === viewYearId ? T.accent : T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.mono }}>{y.jaartal}</button>
              ))}
            </div>
          )}
          <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 9, overflow: "hidden" }}>
            {[["vergelijking", "Vergelijking"], ["analyse", "Begroot vs besteed"], ["maand", "Per maand"], ["trend", "Trend"], ["winkels", "Per winkel"], ["subposten", "Subposten"], ["abonnementen", "Abonnementen"], ["bundels", "Bundels"], ["blokjes", "Blokjes per post"]].map(([v, lbl]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "7px 13px", border: "none", background: view === v ? T.accent : T.panel, color: view === v ? "#fff" : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Inkomsten dit jaar</div><Money cents={totalIncome} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Uitgaven &amp; sparen dit jaar</div><Money cents={totalOut} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Verschil</div><Money cents={totalIncome - totalOut} sign bold size={20} /></Card>
      </div>
      {yearTxCount === 0 && <div style={{ marginBottom: 16 }}><Banner tone="neutral">Nog geen transacties in {vY.jaartal}. Importeer je ING-bestand onder <b>Import</b> om je uitgaven hier te zien.</Banner></div>}
      {view === "vergelijking" && (
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Post</span><span style={{ textAlign: "right" }}>Begroot</span><span style={{ textAlign: "right" }}>Werkelijk</span><span style={{ textAlign: "right" }}>Verschil</span><span />
        </div>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          let gB = 0, gA = 0;
          for (const c of cats) { gB += Math.abs(sumMonths((lines[c.id] || { months: distributeEven(0) }).months)); gA += Math.abs(sumMonths(actualByCat[c.id] || [])); }
          return (
            <div key={g.id}>
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>
                <span>{g.naam}</span>
                <span style={{ textAlign: "right", fontFamily: T.mono, color: T.sub }}>{formatEUR(gB)}</span>
                <span style={{ textAlign: "right", fontFamily: T.mono }}>{formatEUR(gA)}</span>
                <span /><span />
              </div>
              {cats.map((c) => {
                const budgetAbs = Math.abs(sumMonths((lines[c.id] || { months: distributeEven(0) }).months));
                const actualMonths = actualByCat[c.id] || Array.from({ length: 12 }, () => 0);
                const actualAbs = Math.abs(sumMonths(actualMonths));
                const diff = c.type === "income" ? actualAbs - budgetAbs : budgetAbs - actualAbs; // + = gunstig
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "8px 16px" }}>
                      <span style={{ fontSize: 13 }}>{c.naam}</span>
                      <span style={{ textAlign: "right" }}><Money cents={budgetAbs} muted /></span>
                      <span style={{ textAlign: "right" }}><Money cents={actualAbs} /></span>
                      <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, color: diff >= 0 ? T.pos : T.neg }}>{diff >= 0 ? "+ " : "− "}{formatEUR(Math.abs(diff))}</span>
                      <span style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "mnd"}</Btn></span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "4px 16px 12px", background: "#fafcfb", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                        {actualMonths.map((m, i) => (
                          <div key={i} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 10, color: T.sub }}>{names[i]}</div>
                            <div style={{ fontSize: 12, fontFamily: T.mono }}>{m === 0 ? "—" : formatEUR(Math.abs(m))}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
      )}
      {view === "analyse" && <BegrootBesteed groups={groups} categories={categories} budgets={budgets} year={vY} transactions={transactions} onSetYtd={onSetYtd} />}
      {view === "blokjes" && <BlokjesView groups={groups} categories={categories} blocksByCat={blocksByCat} names={names} />}
      {view === "winkels" && <WinkelMatrix categories={categories} transactions={transactions} vY={vY} names={names} />}
      {view === "subposten" && <SubpostView categories={categories} transactions={transactions} vY={vY} monthsElapsed={monthsElapsed} onSetSubBudget={onSetSubBudget} />}
      {view === "bundels" && <BundelView transactions={transactions} categories={categories} />}
      {view === "maand" && <MaandMatrix groups={groups} categories={categories} lines={lines} actualByCat={actualByCat} names={names} />}
      {view === "trend" && <TrendView categories={categories} actualByCat={actualByCat} names={names} monthsElapsed={monthsElapsed} />}
      {view === "abonnementen" && <AbonnementenScan categories={categories} lines={lines} actualByCat={actualByCat} monthsElapsed={monthsElapsed} />}
    </div>
  );
}

function MaandMatrix({ groups, categories, lines, actualByCat, names }) {
  const [mode, setMode] = useState("werkelijk"); // werkelijk | begroot
  const src = (cid) => mode === "begroot" ? (lines[cid] ? lines[cid].months : Array.from({ length: 12 }, () => 0)) : (actualByCat[cid] || Array.from({ length: 12 }, () => 0));
  const colTotals = Array.from({ length: 12 }, () => 0);
  const grid = "minmax(170px, 1.6fr) repeat(12, 72px) 92px";
  const minW = 170 + 12 * 72 + 92 + 13 * 6; // post + 12 maanden + totaal + gaps
  const nowrap = { whiteSpace: "nowrap" };
  const cell = (v) => v === 0 ? <span style={{ color: "#cbd5d1" }}>—</span> : formatEUR(Math.abs(v));
  // alle categorieën met enige waarde meenemen
  const rowsByGroup = groups.map((g) => ({ g, cats: categories.filter((c) => c.groupId === g.id && (sumMonths(src(c.id)) !== 0)) })).filter((x) => x.cats.length > 0);
  for (const { cats } of rowsByGroup) for (const c of cats) src(c.id).forEach((v, i) => colTotals[i] += Math.abs(v));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
          {[["werkelijk", "Werkelijk"], ["begroot", "Begroot"]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{ padding: "5px 11px", border: "none", background: mode === v ? T.accent : T.panel, color: mode === v ? "#fff" : T.sub, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      <Card style={{ overflow: "auto" }}>
        <div style={{ minWidth: minW }}>
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub, position: "sticky", top: 0 }}>
            <span style={nowrap}>Post</span>{names.map((nm) => <span key={nm} style={{ textAlign: "right", ...nowrap }}>{nm}</span>)}<span style={{ textAlign: "right", ...nowrap }}>totaal</span>
          </div>
          {rowsByGroup.map(({ g, cats }) => (
            <div key={g.id}>
              <div style={{ padding: "7px 14px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>{g.naam}</div>
              {cats.map((c) => { const ms = src(c.id); const tot = sumMonths(ms);
                return (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "6px 14px", borderTop: `1px solid ${T.line}`, fontSize: 12 }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam}</span>
                    {ms.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", ...nowrap }}>{cell(v)}</span>)}
                    <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700, ...nowrap }}>{formatEUR(Math.abs(tot))}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", borderTop: `2px solid ${T.line}`, background: "#f7faf9", fontSize: 12, fontWeight: 700 }}>
            <span style={nowrap}>Totaal</span>
            {colTotals.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{v === 0 ? "—" : formatEUR(v)}</span>)}
            <span style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{formatEUR(colTotals.reduce((a, b) => a + b, 0))}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BegrootBesteed({ groups, categories, budgets, year, transactions, onSetYtd }) {
  const [expanded, setExpanded] = useState(null);
  const lines = applySluitpost(categories, budgets[year.id] || {});
  const ytd = year.ytdSeed || {};
  const agg = useMemo(() => {
    const m = {};
    for (const t of transactions) { if (effYear(t) !== year.jaartal) continue; for (const a of (t.allocations || [])) { const k = a.categoryId; if (!m[k]) m[k] = { net: 0, untag: 0, subs: {} }; m[k].net += a.amountCents; if (a.sub) m[k].subs[a.sub] = (m[k].subs[a.sub] || 0) + a.amountCents; else m[k].untag += a.amountCents; } }
    return m;
  }, [transactions, year]);
  const mag = (c, net) => (c.type === "income" ? net : -net); // positief 'besteed/ontvangen'
  const begrootOf = (c) => Math.abs(sumMonths((lines[c.id] || { months: distributeEven(0) }).months));
  const importedOf = (c) => mag(c, (agg[c.id] || { net: 0 }).net);
  const spentOf = (c) => importedOf(c) + (ytd[c.id] || 0);
  const grid = "minmax(150px, 1.7fr) 90px 104px 90px 96px";
  const nowrap = { whiteSpace: "nowrap" };
  const headCell = (t) => <span style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: T.sub, ...nowrap }}>{t}</span>;
  const bar = (spent, begroot, income) => { const pct = begroot > 0 ? Math.min(100, Math.round((spent / begroot) * 100)) : (spent > 0 ? 100 : 0); const over = !income && spent > begroot && begroot > 0; const col = income ? (spent >= begroot ? T.pos : T.accent) : (over ? T.neg : T.accent); return <div style={{ height: 5, background: "#eef3f1", borderRadius: 999, overflow: "hidden", marginTop: 5 }}><div style={{ width: `${pct}%`, height: "100%", background: col }} /></div>; };
  const totals = (cats) => cats.reduce((o, c) => { o.b += begrootOf(c); o.s += spentOf(c); return o; }, { b: 0, s: 0 });
  return (
    <div>
      <div style={{ marginBottom: 12 }}><Banner tone="neutral">Begroot vs besteed voor {year.jaartal}. Vul per post bij <b>t/m heden</b> in wat er dit jaar al is besteed of ontvangen vóór je begon met importeren — dat tel ik op bij de geïmporteerde transacties. Posten met subposten kun je uitklappen voor de verdeling.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "9px 16px", background: "#eef3f1" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.sub }}>Post</span>
          {headCell("Begroot")}{headCell("t/m heden")}{headCell("Besteed")}{headCell("Verschil")}
        </div>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          if (cats.length === 0) return null;
          const gt = totals(cats);
          return (
            <div key={g.id}>
              <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, padding: "8px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700, alignItems: "center" }}>
                <span>{g.naam}</span>
                <span style={{ textAlign: "right", fontFamily: T.mono, color: T.sub, ...nowrap }}>{formatEUR(gt.b)}</span>
                <span />
                <span style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{formatEUR(gt.s)}</span>
                <span />
              </div>
              {cats.map((c) => {
                const b = begrootOf(c), s = spentOf(c), income = c.type === "income";
                const verschil = income ? s - b : b - s;
                const subs = c.subs || [];
                const isOpen = expanded === c.id;
                const a = agg[c.id] || { net: 0, untag: 0, subs: {} };
                return (
                  <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <div style={{ padding: "8px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: grid, gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                          {subs.length > 0 ? <button onClick={() => setExpanded(isOpen ? null : c.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, padding: 0, fontSize: 11 }}>{isOpen ? "▾" : "▸"}</button> : <span style={{ width: 11 }} />}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.naam.split(":")[0]}</span>
                        </span>
                        <span style={{ textAlign: "right" }}><Money cents={b} muted /></span>
                        <span style={{ textAlign: "right" }}><MoneyInput cents={ytd[c.id] || 0} width={96} onChange={(v) => onSetYtd(year.id, c.id, v)} /></span>
                        <span style={{ textAlign: "right" }}><Money cents={s} /></span>
                        <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, color: verschil >= 0 ? T.pos : T.neg, ...nowrap }}>{verschil >= 0 ? "+ " : "− "}{formatEUR(Math.abs(verschil))}</span>
                      </div>
                      {bar(s, b, income)}
                    </div>
                    {isOpen && subs.length > 0 && (
                      <div style={{ padding: "2px 16px 12px 33px", background: "#fafcfb" }}>
                        {subs.map((sname) => { const sv = mag(c, a.subs[sname] || 0); return (
                          <div key={sname} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "3px 0" }}>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{sname}</span>
                            <span style={{ fontFamily: T.mono, ...nowrap }}>{formatEUR(sv)}</span>
                          </div>
                        ); })}
                        {mag(c, a.untag) !== 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "3px 0", color: T.sub, fontStyle: "italic" }}>
                            <span>— zonder subpost —</span><span style={{ fontFamily: T.mono, ...nowrap }}>{formatEUR(mag(c, a.untag))}</span>
                          </div>
                        )}
                        {(ytd[c.id] || 0) !== 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "3px 0", color: T.sub }}>
                            <span>t/m heden (ingevoerd)</span><span style={{ fontFamily: T.mono, ...nowrap }}>{formatEUR(ytd[c.id] || 0)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function WinkelMatrix({ categories, transactions, vY, names }) {
  const superCats = categories.filter((c) => /boodschap|supermarkt|speciaalzaak|drogist/i.test(c.naam) && c.type !== "income");
  const superIds = new Set(superCats.map((c) => c.id));
  const byChain = {}; // chain -> 12 maanden
  for (const t of transactions) {
    if (effYear(t) !== vY.jaartal) continue;
    const m = effMonth(t);
    for (const a of (t.allocations || [])) {
      if (!superIds.has(a.categoryId)) continue;
      const chain = detectChain(t.name);
      if (!byChain[chain]) byChain[chain] = Array.from({ length: 12 }, () => 0);
      byChain[chain][m - 1] += Math.abs(a.amountCents);
    }
  }
  const rows = Object.entries(byChain).map(([chain, ms]) => ({ chain, ms, tot: sumMonths(ms) })).sort((a, b) => b.tot - a.tot);
  const colTotals = Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.ms[i], 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  const grid = "minmax(150px, 1.4fr) repeat(12, 72px) 92px";
  const minW = 150 + 12 * 72 + 92 + 13 * 6;
  const nowrap = { whiteSpace: "nowrap" };
  const cell = (v) => v === 0 ? <span style={{ color: "#cbd5d1" }}>—</span> : formatEUR(v);
  if (superCats.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Geen boodschappen-post gevonden om uit te splitsen.</div></Card>;
  return (
    <div>
      <div style={{ marginBottom: 10 }}><Banner tone="neutral">Je boodschappen ({superCats.map((c) => c.naam).join(", ")}) per winkelketen per maand. Ketens worden herkend aan de naam van de transactie; staat een winkel onder een rare naam, voeg dan een regel toe of laat het me weten.</Banner></div>
      <Card style={{ overflow: "auto" }}>
        <div style={{ minWidth: minW }}>
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub, position: "sticky", top: 0 }}>
            <span style={nowrap}>Winkel</span>{names.map((nm) => <span key={nm} style={{ textAlign: "right", ...nowrap }}>{nm}</span>)}<span style={{ textAlign: "right", ...nowrap }}>totaal</span>
          </div>
          {rows.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen boodschappen-transacties in {vY.jaartal}.</div>}
          {rows.map((r) => (
            <div key={r.chain} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "6px 14px", borderTop: `1px solid ${T.line}`, fontSize: 12 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 }}>{r.chain}</span>
              {r.ms.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", ...nowrap }}>{cell(v)}</span>)}
              <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700, ...nowrap }}>{formatEUR(r.tot)}</span>
            </div>
          ))}
          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", borderTop: `2px solid ${T.line}`, background: "#f7faf9", fontSize: 12, fontWeight: 700 }}>
              <span style={nowrap}>Totaal</span>
              {colTotals.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{v === 0 ? "—" : formatEUR(v)}</span>)}
              <span style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{formatEUR(grand)}</span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function SubpostView({ categories, transactions, vY, monthsElapsed = 12, onSetSubBudget }) {
  const postsWithSubs = categories.filter((c) => (c.subs || []).length > 0);
  if (postsWithSubs.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen posten met subposten. Ga naar <b>Posten</b>, klik bij een uitgavepost op <b>subs</b> en voeg subposten toe (bijv. Boodschappen → AH/Jumbo, of Maud → Kleding/inventaris/verbruik/overige). Daarna kies je per transactie een subpost.</div></Card>;
  const data = postsWithSubs.map((c) => {
    const map = {}; let untagged = 0, total = 0;
    for (const t of transactions) { if (effYear(t) !== vY.jaartal) continue; for (const a of t.allocations) { if (a.categoryId !== c.id) continue; const v = Math.abs(a.amountCents); total += v; if (a.sub && (c.subs || []).includes(a.sub)) map[a.sub] = (map[a.sub] || 0) + v; else untagged += v; } }
    const rows = (c.subs || []).map((s) => ({ label: s, val: map[s] || 0, target: (c.subBudgets || {})[s] || 0 }));
    if (untagged > 0) rows.push({ label: "— zonder subpost —", val: untagged, muted: true, target: 0 });
    return { c, rows, total };
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>De werkelijke uitgaven per subpost binnen een post ({vY.jaartal}). Zet per subpost een <b>maanddoel</b>, dan zie ik of je erbinnen blijft (vergeleken t/m maand {monthsElapsed}). De begroting blijft op de hoofdpost.</div>
      {data.map(({ c, rows, total }) => (
        <Card key={c.id} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f0f4f3", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam}</span>
            <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{formatEUR(total)}</span>
          </div>
          {rows.map((r) => {
            const hasTarget = r.target > 0;
            const ytdTarget = r.target * monthsElapsed;
            const denom = hasTarget ? ytdTarget : total;
            const pct = denom > 0 ? Math.min(100, Math.round((r.val / denom) * 100)) : 0;
            const over = hasTarget && r.val > ytdTarget;
            return (
              <div key={r.label} style={{ padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: r.muted ? T.sub : T.ink, fontStyle: r.muted ? "italic" : "normal" }}>{r.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {!r.muted && onSetSubBudget && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, color: T.sub }}>doel/mnd</span><MoneyInput cents={r.target} width={90} onChange={(v) => onSetSubBudget(c.id, r.label, v)} /></span>}
                    <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{formatEUR(r.val)}{hasTarget ? <span style={{ color: over ? T.neg : T.sub, fontWeight: 400 }}> / {formatEUR(ytdTarget)}{over ? " ⚠" : ""}</span> : <span style={{ color: T.sub, fontWeight: 400 }}> · {total > 0 ? Math.round((r.val / total) * 100) : 0}%</span>}</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: r.muted ? "#c7d0ce" : over ? T.neg : T.accent }} /></div>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

function BundelView({ transactions, categories }) {
  const byBundle = {};
  for (const t of transactions) {
    const raw = (t.bundle || "").trim();
    if (!raw) continue;
    const k = raw.toLowerCase();
    if (!byBundle[k]) byBundle[k] = { naam: raw, total: 0, items: [] };
    byBundle[k].total += t.amountCents;
    byBundle[k].items.push(t);
  }
  const bundles = Object.values(byBundle).map((d) => ({ naam: d.naam, total: d.total, items: d.items.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  if (bundles.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen bundels. Open een transactie (op <b>Transacties</b>) en vul bij "Bundel" een label in, bijvoorbeeld "Verjaardag Maud". Alle transacties met hetzelfde label tel ik hier bij elkaar op — ook over verschillende winkels en maanden heen.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Bundels tellen transacties met hetzelfde label bij elkaar op, los van post of maand (alle jaren). Handig om te zien wat je in totaal aan bijvoorbeeld iemands verjaardag hebt uitgegeven.</div>
      {bundles.map((b) => (
        <Card key={b.naam} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f0f4f3", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{b.naam} <span style={{ color: T.sub, fontWeight: 500 }}>· {b.items.length}×</span></span>
            <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 15, color: b.total < 0 ? T.neg : T.pos, flexShrink: 0 }}>{formatEUR(Math.abs(b.total))}{b.total > 0 ? " terug" : ""}</span>
          </div>
          {b.items.map((t) => { const cat = (t.allocations || []).map((a) => (categories.find((c) => c.id === a.categoryId) || {}).naam).filter(Boolean).join(", ");
            return (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "78px 1fr auto", gap: 10, alignItems: "center", padding: "7px 16px", borderTop: `1px solid ${T.line}`, fontSize: 13 }}>
                <span style={{ fontFamily: T.mono, color: T.sub }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)}-{t.date.slice(2, 4)}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}{cat ? ` · ${cat}` : ""}</span>
                <span style={{ fontFamily: T.mono, color: t.amountCents < 0 ? T.neg : T.pos }}>{formatEUR(t.amountCents)}</span>
              </div>
            ); })}
        </Card>
      ))}
    </div>
  );
}

function BlokjesView({ groups, categories, blocksByCat, names }) {
  const dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${names[Number(iso.slice(5, 7)) - 1]}`;
  const [fMaand, setFMaand] = useState(0); // 0 = hele jaar
  const blocksOf = (cid) => (blocksByCat[cid] || []).filter((b) => !fMaand || Number(String(b.date).slice(5, 7)) === fMaand);
  const anyData = Object.values(blocksByCat).some((b) => b && b.length);
  if (!anyData) return <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties om als blokjes te tonen. Importeer eerst je ING-bestand onder <b>Import</b>.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Per post zie je hier elke transactie als los blokje — met bedrag, een eventuele notitie en de datum. Geld terug op een uitgavepost staat groen (dat verlaagt de post).</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {["hele jaar", ...names].map((nm, i) => (
          <button key={i} onClick={() => setFMaand(i)} style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${fMaand === i ? T.accent : T.line}`, background: fMaand === i ? T.accentSoft : T.panel, color: fMaand === i ? T.accent : T.sub, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>{nm}</button>
        ))}
      </div>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && blocksOf(c.id).length > 0);
        if (cats.length === 0) return null;
        return (
          <Card key={g.id} style={{ overflow: "hidden" }}>
            <div style={{ padding: "9px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
            {cats.map((c) => {
              const blocks = blocksOf(c.id);
              const net = blocks.reduce((s, b) => s + b.amountCents, 0);
              return (
                <div key={c.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "12px 16px", borderTop: `1px solid ${T.line}` }}>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{c.naam}</div>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: T.sub, marginTop: 2 }}>{formatEUR(Math.abs(net))} · {blocks.length}×</div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, flex: 1 }}>
                    {blocks.map((b, i) => {
                      const back = b.amountCents > 0 && c.type !== "income"; // teruggave op uitgavepost
                      const border = back ? "#bfe3c4" : b.flagged ? T.warn : T.line;
                      const bg = back ? "#eef7ee" : b.flagged ? "#fdf6e9" : "#fafcfb";
                      const col = back ? T.pos : T.ink;
                      return (
                        <div key={b.id + "-" + i} title={b.label} style={{ display: "inline-flex", flexDirection: "column", gap: 2, border: `1px solid ${border}`, background: bg, borderRadius: 9, padding: "6px 9px", minWidth: 62, maxWidth: 150 }}>
                          <span style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 12.5, color: col }}>{back ? "+ " : ""}{formatEUR(Math.abs(b.amountCents))}</span>
                          {b.note && <span style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.note}</span>}
                          <span style={{ fontSize: 9.5, color: T.sub }}>{dayLabel(b.date)} {b.flagged ? "★" : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

function SubEditor({ subs, onChange }) {
  const [val, setVal] = useState("");
  const list = subs || [];
  const add = () => { const v = val.trim(); if (!v || list.includes(v)) { setVal(""); return; } onChange([...list, v]); setVal(""); };
  return (
    <div style={{ padding: "10px 16px 14px 16px", background: "#fafcfb", borderTop: `1px dashed ${T.line}` }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Subposten verdelen het <b>werkelijke</b> bedrag van deze post (de begroting blijft op de hoofdpost). Je kiest per transactie een subpost; het totaal per subpost zie je onder <b>Uitgaven › Subposten</b>.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {list.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.accentSoft, color: T.accent, borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 600 }}>
            {s}
            <button onClick={() => onChange(list.filter((x) => x !== s))} title="verwijder subpost" style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
          </span>
        ))}
        {list.length === 0 && <span style={{ fontSize: 12, color: T.sub }}>nog geen subposten</span>}
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="subpost toevoegen" style={{ ...inputStyle, width: 170, padding: "5px 9px", fontSize: 12.5 }} />
        <Btn size="sm" variant="secondary" onClick={add}>+ Toevoegen</Btn>
      </div>
    </div>
  );
}

function Posten({ groups, categories, transactions, year, onToggleNote, onUpdateCategory, onDeleteCategory, onAddCategory }) {
  const used = new Set();
  for (const t of transactions) for (const a of t.allocations) used.add(a.categoryId);
  const countYear = {};
  for (const t of transactions) { if (year && effYear(t) !== year.jaartal) continue; const seen = new Set(); for (const a of t.allocations) { if (seen.has(a.categoryId)) continue; seen.add(a.categoryId); countYear[a.categoryId] = (countYear[a.categoryId] || 0) + 1; } }
  const [subOpen, setSubOpen] = useState(null);
  return (
    <div>
      <SectionTitle>Posten beheren</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Hier hernoem je posten, kies je het type, of verwijder je ze. Met <b>max/jaar</b> waarschuw ik bij mogelijke dubbele boekingen. Met <b>subposten</b> splits je een uitgavepost verder uit (bijv. Boodschappen → per winkel, of Maud → Kleding/inventaris/verbruik/overige) terwijl de begroting op de hoofdpost blijft. <b>Nieuwe posten voeg je toe bij Begroting.</b></Banner></div>
      <Card style={{ overflow: "hidden" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id}>
              <div style={{ padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
              {cats.map((c) => {
                const isSluit = c.id === SLUITPOST_ID;
                const inUse = used.has(c.id);
                const cnt = countYear[c.id] || 0;
                const over = c.freqPerYear && cnt > c.freqPerYear;
                const canSub = !isSluit && c.type !== "income";
                const nSub = (c.subs || []).length;
                const isSubOpen = subOpen === c.id;
                return (
                  <div key={c.id}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 104px 82px 118px 94px 80px 64px", gap: 10, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}`, background: isSluit ? "#fcf9e8" : undefined }}>
                      <input value={c.naam} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { naam: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, border: isSluit ? "none" : `1px solid ${T.line}`, background: isSluit ? "transparent" : "#fff" }} />
                      <select value={c.type} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { type: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, opacity: isSluit ? 0.6 : 1 }}>
                        <option value="expense">uitgave</option>
                        <option value="savings">sparen</option>
                        <option value="income">inkomsten</option>
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, color: T.sub }}>opm.</span>
                        <Toggle on={c.noteSuggested} onClick={() => onToggleNote(c.id)} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }} title="hoe vaak deze post per jaar mag voorkomen (leeg = geen limiet)">
                        <span style={{ fontSize: 11, color: T.sub }}>max/jr</span>
                        <input type="number" min="0" value={c.freqPerYear || ""} onChange={(e) => onUpdateCategory(c.id, { freqPerYear: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} placeholder="—" style={{ ...inputStyle, width: 44, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
                        <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: over ? T.neg : "#9aa8a5" }} title="aantal keer dit jaar geboekt">{cnt}×</span>
                      </div>
                      <div style={{ textAlign: "center" }}>{c.type === "expense" ? <button onClick={() => onUpdateCategory(c.id, { vast: !c.vast })} title="vaste (verplichte) of variabele (vrij besteedbare) last" style={{ border: `1px solid ${T.line}`, background: c.vast ? "#eef0ff" : "#f0f7f0", color: c.vast ? "#4338ca" : T.pos, borderRadius: 7, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{c.vast ? "vast" : "variabel"}</button> : <span />}</div>
                      <div style={{ textAlign: "center" }}>
                        {canSub ? <button onClick={() => setSubOpen(isSubOpen ? null : c.id)} style={{ border: `1px solid ${nSub ? T.accent : T.line}`, background: nSub ? T.accentSoft : "#fff", color: nSub ? T.accent : T.sub, borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>subs{nSub ? ` (${nSub})` : ""} {isSubOpen ? "▴" : "▾"}</button> : <span />}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {isSluit ? <span style={{ fontSize: 11, color: T.sub }}>automatisch</span>
                          : inUse ? <span style={{ fontSize: 11, color: T.sub }} title="heeft transacties">in gebruik</span>
                          : <Btn variant="danger" size="sm" onClick={() => onDeleteCategory(c.id)}>Verwijder</Btn>}
                      </div>
                    </div>
                    {isSubOpen && canSub && <SubEditor subs={c.subs} onChange={(subs) => onUpdateCategory(c.id, { subs: subs.length ? subs : undefined })} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function RuleHygiene({ rules, categories, transactions = [], onBulkDelete }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'unused' | null
  const catName = (id) => (categories.find((c) => c.id === id) || {}).naam || "(onbekende post)";
  const hasCond = (c) => c.field === "amount" ? (c.operator === "amountRange" ? (c.min != null || c.max != null) : c.amount != null) : !!String(c.value || "").trim();
  const norm = (r) => { const c = (r.conditions && r.conditions[0]) || {}; const amt = c.field === "amount" ? `${c.operator}:${c.amount ?? ""}:${c.min ?? ""}:${c.max ?? ""}` : ""; return { field: c.field, op: c.operator, val: String(c.value || "").trim().toLowerCase(), amt, has: hasCond(c) }; };
  const byFull = {};
  for (const r of rules) { const n = norm(r); const k = `${r.categoryId}|${n.field}|${n.op}|${n.val}|${n.amt}`; (byFull[k] = byFull[k] || []).push(r); }
  const dupExtra = []; for (const k in byFull) if (byFull[k].length > 1) dupExtra.push(...byFull[k].slice(1).map((r) => r.id));
  const byTrig = {};
  for (const r of rules) { const n = norm(r); if (!n.has) continue; const k = `${n.field}|${n.op}|${n.val}|${n.amt}`; (byTrig[k] = byTrig[k] || []).push(r); }
  const conflicts = Object.values(byTrig).filter((arr) => new Set(arr.map((r) => r.categoryId)).size > 1);
  const emptyIds = rules.filter((r) => !norm(r).has).map((r) => r.id);
  const hit = {}; for (const r of rules) hit[r.id] = 0;
  for (const t of transactions) for (const r of rules) if (ruleMatches(t, r)) hit[r.id]++;
  const unused = transactions.length ? rules.filter((r) => hit[r.id] === 0) : [];
  const issues = dupExtra.length + conflicts.length + emptyIds.length;
  const pill = (txt, tone) => <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: tone === "ok" ? "#e7f4ec" : T.warnSoft, color: tone === "ok" ? T.pos : "#9a6a14" }}>{txt}</span>;
  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Regels opschonen</span>
        {issues === 0 ? pill("alles ziet er netjes uit", "ok") : <>
          {dupExtra.length > 0 && pill(`${dupExtra.length} dubbel`)}
          {conflicts.length > 0 && pill(`${conflicts.length} conflict${conflicts.length > 1 ? "en" : ""}`)}
          {emptyIds.length > 0 && pill(`${emptyIds.length} leeg`)}
        </>}
        {transactions.length > 0 && unused.length > 0 && pill(`${unused.length} ongebruikt`)}
        <button onClick={() => setOpen((o) => !o)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{open ? "verberg" : "bekijk & opschonen"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: T.sub }}>{rules.length} regels in totaal{transactions.length > 0 ? ` · gemeten op ${transactions.length} transacties` : " · importeer transacties om ongebruikte regels te vinden"}.</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn size="sm" variant={dupExtra.length ? "secondary" : "ghost"} disabled={!dupExtra.length} onClick={() => onBulkDelete(dupExtra)}>Ontdubbel ({dupExtra.length})</Btn>
            <Btn size="sm" variant={emptyIds.length ? "secondary" : "ghost"} disabled={!emptyIds.length} onClick={() => onBulkDelete(emptyIds)}>Verwijder lege ({emptyIds.length})</Btn>
            {confirm === "unused"
              ? <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ fontSize: 12, color: T.neg }}>Zeker weten?</span><Btn size="sm" variant="danger" onClick={() => { onBulkDelete(unused.map((r) => r.id)); setConfirm(null); }}>Ja, verwijder {unused.length}</Btn><Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Annuleer</Btn></span>
              : <Btn size="sm" variant={unused.length ? "secondary" : "ghost"} disabled={!unused.length} onClick={() => setConfirm("unused")}>Verwijder ongebruikte ({unused.length})</Btn>}
          </div>

          {conflicts.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Conflicten — zelfde trefwoord, verschillende post (kies zelf welke klopt):</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {conflicts.slice(0, 8).map((arr, i) => (
                  <div key={i} style={{ fontSize: 12.5, background: T.warnSoft, border: `1px solid #f0dcb8`, borderRadius: 7, padding: "7px 10px" }}>
                    <b style={{ fontFamily: T.mono }}>"{norm(arr[0]).val}"</b> → {[...new Set(arr.map((r) => catName(r.categoryId)))].join("  ·  ")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {transactions.length > 0 && unused.length > 0 && (
            <div style={{ fontSize: 12, color: T.sub }}>Ongebruikt = matcht geen enkele bestaande transactie. Soms bewust (voor toekomstige uitgaven); verwijder alleen wat je niet meer nodig hebt.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function Regels({ rules, categories, groups, transactions = [], onToggle, onDelete, onBulkDelete, onUpdate, onAdd, onAddDefaults }) {
  const fl = { both: "naam of omschrijving", name: "naam", iban: "tegenrekening", description: "omschrijving", mededelingen: "mededelingen (volledig)", mutationType: "mutatiesoort", amount: "bedrag" };
  const ol = { contains: "bevat", equals: "is", startsWith: "begint met" };
  const isAmt = (f) => f === "amount";
  const opsFor = (f) => isAmt(f) ? { equals: "is exact", amountRange: "tussen" } : ol;
  const fieldChange = (cond, set, f) => { if (isAmt(f)) set({ field: f, operator: "equals", value: "", amount: cond.amount || 0, min: undefined, max: undefined }); else set({ field: f, operator: cond.operator === "amountRange" ? "contains" : cond.operator, value: cond.value || "", amount: undefined, min: undefined, max: undefined }); };
  const valEditor = (cond, set, big) => {
    if (isAmt(cond.field)) {
      if (cond.operator === "amountRange") return (
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <MoneyInput cents={cond.min || 0} width={big ? 110 : 66} onChange={(v) => set({ min: v })} />
          <span style={{ color: T.sub }}>–</span>
          <MoneyInput cents={cond.max || 0} width={big ? 110 : 66} onChange={(v) => set({ max: v })} />
        </span>);
      return <MoneyInput cents={cond.amount || 0} width={big ? 140 : 92} onChange={(v) => set({ amount: v })} />;
    }
    return <input value={cond.value || ""} onChange={(e) => set({ value: e.target.value })} placeholder={big ? "bijv. albert heijn" : ""} style={{ ...inputStyle, padding: big ? "7px 10px" : "5px 8px", fontSize: big ? 13 : 12, fontFamily: T.mono }} />;
  };
  const condValid = (c) => isAmt(c.field) ? (c.operator === "amountRange" ? ((c.min || 0) > 0 || (c.max || 0) > 0) : (c.amount || 0) > 0) : !!String(c.value || "").trim();
  const buildCond = (c) => isAmt(c.field) ? (c.operator === "amountRange" ? { field: "amount", operator: "amountRange", min: c.min || undefined, max: c.max || undefined } : { field: "amount", operator: "equals", amount: c.amount }) : { field: c.field, operator: c.operator, value: String(c.value || "").trim() };
  const [sortKey, setSortKey] = useState("priority");
  const [sortDir, setSortDir] = useState(1);
  const catName = (id) => (categories.find((c) => c.id === id) || {}).naam || "";
  const condOf = (r) => r.conditions[0] || {};
  const hitsMap = {};
  for (const r of rules) hitsMap[r.id] = 0;
  for (const t of transactions) for (const r of rules) if (r.conditions && r.conditions.length && ruleMatches(t, r)) hitsMap[r.id]++;
  const sortVal = (r) => {
    if (sortKey === "active") return r.active ? 1 : 0;
    if (sortKey === "field") return fl[condOf(r).field] || "";
    if (sortKey === "operator") return ol[condOf(r).operator] || "";
    if (sortKey === "value") return String(condOf(r).value || "").toLowerCase();
    if (sortKey === "category") return catName(r.categoryId).toLowerCase();
    if (sortKey === "hits") return hitsMap[r.id] || 0;
    return r.priority;
  };
  const sorted = [...rules].sort((a, b) => { const va = sortVal(a), vb = sortVal(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return c * sortDir || (a.priority - b.priority); });
  const toggleSort = (k) => { if (sortKey === k) setSortDir((d) => -d); else { setSortKey(k); setSortDir(1); } };
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ field: "both", operator: "contains", value: "", categoryId: "", priority: 50 });
  const grid = "46px 150px 88px 1fr 1.15fr 48px 64px 56px";
  const Th = ({ k, children, center }) => (
    <button onClick={() => toggleSort(k)} style={{ display: "flex", alignItems: "center", justifyContent: center ? "center" : "flex-start", gap: 3, border: "none", background: "transparent", padding: 0, fontSize: 11, fontWeight: 700, color: sortKey === k ? T.accent : T.sub, cursor: "pointer" }}>{children}{sortKey === k && <span>{sortDir > 0 ? "▲" : "▼"}</span>}</button>
  );
  const catOptions = groups.map((g) => (
    <optgroup key={g.id} label={g.naam}>
      {categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
    </optgroup>
  ));
  const submitNew = () => {
    if (!condValid(nf) || !nf.categoryId) return;
    onAdd({ categoryId: nf.categoryId, priority: Number(nf.priority) || 50, conditions: [buildCond(nf)] });
    setNf({ field: "both", operator: "contains", value: "", categoryId: "", priority: 50 });
    setAdding(false);
  };
  return (
    <div>
      <SectionTitle right={<div style={{ display: "flex", gap: 8 }}>{onAddDefaults && <Btn variant="secondary" size="sm" onClick={onAddDefaults}>Standaardregels</Btn>}<Btn size="sm" onClick={() => setAdding((a) => !a)}>+ Nieuwe regel</Btn></div>}>Regels</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Regels categoriseren je transacties automatisch. Ze ontstaan vanzelf via "Onthoud dit" bij het importeren, maar je kunt ze hier ook zelf maken en aanpassen. Lagere prioriteit gaat vóór.</Banner></div>

      <RuleHygiene rules={rules} categories={categories} transactions={transactions} onBulkDelete={onBulkDelete} />

      {adding && (
        <Card style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Nieuwe regel: als…</div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 130px 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={nf.field} onChange={(e) => fieldChange(nf, (p) => setNf({ ...nf, ...p }), e.target.value)} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={nf.operator} onChange={(e) => setNf({ ...nf, operator: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(opsFor(nf.field)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {valEditor(nf, (p) => setNf({ ...nf, ...p }), true)}
          </div>
          {isAmt(nf.field) && <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Het bedrag wordt vergeleken zonder plus/min — een uitgave van € 12,99 matcht dus op "12,99". Handig voor vaste lasten en abonnementen.</div>}
          <div style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 8px" }}>…dan op post</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8, alignItems: "center" }}>
            <select value={nf.categoryId} onChange={(e) => setNf({ ...nf, categoryId: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}><option value="">— kies post —</option>{catOptions}</select>
            <input type="number" value={nf.priority} onChange={(e) => setNf({ ...nf, priority: e.target.value })} title="prioriteit (lager = eerst)" style={{ ...inputStyle, padding: "7px 10px", fontSize: 13, textAlign: "center" }} />
            <Btn size="sm" onClick={submitNew} disabled={!condValid(nf) || !nf.categoryId}>Toevoegen</Btn>
          </div>
        </Card>
      )}

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "9px 16px", background: "#eef3f1" }}>
          <Th k="active">Actief</Th><Th k="field">Veld</Th><Th k="operator">Operator</Th><Th k="value">Waarde</Th><Th k="category">Post</Th><Th k="priority" center>Prio</Th><Th k="hits" center>Raak</Th><span />
        </div>
        {sorted.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen regels. Maak er een met "+ Nieuwe regel".</div>}
        {sorted.map((r) => {
          const cond = r.conditions[0] || { field: "name", operator: "contains", value: "" };
          const setCond = (patch) => onUpdate(r.id, { conditions: [{ ...cond, ...patch }] });
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
              <Toggle on={r.active} onClick={() => onToggle(r.id)} />
              <select value={cond.field} onChange={(e) => fieldChange(cond, setCond, e.target.value)} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select value={cond.operator} onChange={(e) => setCond({ operator: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(opsFor(cond.field)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {valEditor(cond, setCond, false)}
              <select value={r.categoryId} onChange={(e) => onUpdate(r.id, { categoryId: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{catOptions}</select>
              <input type="number" value={r.priority} onChange={(e) => onUpdate(r.id, { priority: Number(e.target.value) || 0 })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
              <span title="aantal transacties dat deze regel nu raakt" style={{ textAlign: "center", fontSize: 12, fontWeight: 700, fontFamily: T.mono, color: hitsMap[r.id] ? T.pos : "#c0392b" }}>{hitsMap[r.id] || 0}</span>
              <Btn variant="danger" size="sm" onClick={() => onDelete(r.id)}>Wis</Btn>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Import({ categories, groups, rules, existingHashes, history = [], onCommit, onStartReview }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null); // { committed, dupCount, errors, autoCount, uncategorized }
  const [phase, setPhase] = useState("upload"); // upload | summary | done
  const [result, setResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const processTxns = (txns, errors) => {
    const reconciled = reconcileImport(txns.map((t, i) => ({ ...t, id: "tx-" + dedupHash(t) + "-" + i })), existingHashes);
    const news = reconciled.filter((r) => r.isNew);
    const dupCount = reconciled.length - news.length;
    let autoCount = 0;
    const committed = news.map((r) => {
      const tx = { ...r.item, hash: r.hash };
      const match = categorize(tx, rules, categories);
      let allocations = [];
      if (match) { allocations = [{ categoryId: match.categoryId, amountCents: tx.amountCents }]; autoCount++; }
      return { ...tx, allocations, note: "", flagged: false };
    });
    setParsed({ committed, dupCount, errors: errors || [], autoCount, uncategorized: committed.length - autoCount });
    setPhase("summary");
  };
  const runWith = (csv) => {
    const head = (String(csv).split(/\r?\n/)[0] || "").toLowerCase();
    if (!/datum/.test(head) || !/bedrag|af bij|mutatiesoort/.test(head)) {
      setParsed({ committed: [], dupCount: 0, errors: ["Dit lijkt geen ING-bestand. Verwacht een kop met o.a. 'Datum' en 'Bedrag (EUR)'."], autoCount: 0, uncategorized: 0 });
      setPhase("summary"); return;
    }
    const { txns, errors } = parseINGCsv(csv);
    processTxns(txns, errors);
  };
  const runWithRows = (rows) => {
    const { txns, errors } = parseINGRows(rows);
    if (txns.length === 0 && errors.length) {
      setParsed({ committed: [], dupCount: 0, errors, autoCount: 0, uncategorized: 0 });
      setPhase("summary"); return;
    }
    processTxns(txns, errors);
  };
  const run = () => runWith(text);
  const handleFile = async (file) => {
    if (!file) return;
    try {
      if (/\.xlsx?$/i.test(file.name) || /\.xls$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        runWithRows(rows);
      } else {
        const csv = await file.text();
        setText(csv); runWith(csv);
      }
    } catch (e) {
      setParsed({ committed: [], dupCount: 0, errors: ["Kon het bestand niet lezen: " + (e.message || "onbekend")], autoCount: 0, uncategorized: 0 });
      setPhase("summary");
    }
  };

  const doImport = () => {
    onCommit(parsed.committed, []);
    setResult({ count: parsed.committed.length, auto: parsed.autoCount, uncategorized: parsed.uncategorized, rules: 0 });
    setPhase("done");
  };
  const finishReview = (work, learned) => {
    onCommit(work, learned);
    const unc = work.filter((t) => !t.allocations || t.allocations.length === 0).length;
    setResult({ count: work.length, auto: work.length - unc, uncategorized: unc, rules: (learned || []).length });
    setPhase("done");
  };

  if (phase === "upload") return (
    <div>
      <SectionTitle>Importeren — je ING-bestand</SectionTitle>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: `2px dashed ${drag ? T.accent : T.line}`, background: drag ? T.accentSoft : T.panel, borderRadius: T.radius, padding: "22px 18px", marginBottom: 14, cursor: "pointer", textAlign: "center" }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sleep je ING-bestand hierheen (CSV of Excel)</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>of klik om je gedownloade bestand te kiezen · herkende transacties worden meteen ingedeeld, de rest zet je daarna op Transacties</div>
      </div>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}>Of plak de inhoud van je ING-export hieronder.</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Datum;Naam / Omschrijving;Rekening;Tegenrekening;…"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: T.mono, fontSize: 12, padding: 10, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Btn onClick={run} disabled={!text.trim()}>Verwerk</Btn>
          <Btn variant="secondary" onClick={() => setText(SAMPLE_CSV)}>Laad mijn ING-voorbeeld</Btn>
        </div>
      </Card>
    </div>
  );

  if (phase === "summary") {
    const n = parsed.committed.length;
    return (
      <div>
        <SectionTitle>Importeren — overzicht</SectionTitle>
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Banner tone="neutral"><b>{n}</b> nieuw · <b>{parsed.dupCount}</b> al eerder geïmporteerd</Banner>
          {parsed.errors.length > 0 && <Banner tone="warn">{parsed.errors.length === 1 ? parsed.errors[0] : `${parsed.errors.length} regel(s) niet gelezen`}</Banner>}
        </div>
        {n === 0 ? (
          <Card style={{ padding: 18, marginBottom: 16 }}><div style={{ fontSize: 14 }}>{parsed.dupCount > 0 ? "Alle transacties in dit bestand waren al eerder ingelezen — er is niets nieuws toe te voegen." : "Geen nieuwe transacties gevonden."}</div></Card>
        ) : (
          <Card style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <div><b style={{ color: T.pos }}>{parsed.autoCount}</b> automatisch herkend door je regels en spaarrekening-codes.</div>
              <div><b style={{ color: T.warn }}>{parsed.uncategorized}</b> nog toe te kennen — die loop je zo samen na, of vind je later op <b>Transacties</b>.</div>
            </div>
          </Card>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {n > 0 && <Btn onClick={() => { onCommit(parsed.committed, []); if (onStartReview) onStartReview(); }}>Toevoegen &amp; begeleid nalopen ({n})</Btn>}
          {n > 0 && <Btn variant="secondary" onClick={doImport}>Alleen toevoegen</Btn>}
          <Btn variant="ghost" onClick={() => { setParsed(null); setPhase("upload"); }}>Terug</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Importeren — klaar</SectionTitle>
      <Banner tone="ok">{result.count} transactie(s) toegevoegd: {result.auto} ingedeeld{result.uncategorized > 0 ? `, ${result.uncategorized} nog toe te kennen op Transacties` : ""}{result.rules ? `, en ${result.rules} nieuwe regel(s) geleerd` : ""}.</Banner>
      <div style={{ marginTop: 14 }}><Btn variant="secondary" onClick={() => { setText(""); setParsed(null); setResult(null); setPhase("upload"); }}>Nog een bestand importeren</Btn></div>
    </div>
  );
}

/* ============================================ TRANSACTIES & VERMOGEN */
function RuleLearn({ tx, categoryId, onAddRule }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [field, setField] = useState("both"); // name | description | both
  const [kw, setKw] = useState(() => guessKeyword(tx.name) || guessKeyword(tx.omschrijving));
  const pickField = (f) => { setField(f); if (f === "name") setKw(guessKeyword(tx.name)); else if (f === "description") setKw(guessKeyword(tx.omschrijving || tx.description || "")); };
  if (done) return <span style={{ fontSize: 12, color: T.pos }}>✓ regel toegevoegd aan Regels — voortaan automatisch</span>;
  if (!open) return <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>Onthoud deze keuze…</Btn>;
  const make = () => { const v = kw.trim().toLowerCase(); if (!v) return; onAddRule({ categoryId, priority: 35, conditions: [{ field, operator: "contains", value: v }] }); setDone(true); };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Onthoud: alles met</span>
      <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="trefwoord" style={{ ...inputStyle, width: 150, padding: "4px 8px", fontSize: 12, fontFamily: T.mono }} />
      <span style={{ fontSize: 12, color: T.sub }}>in</span>
      <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 7, overflow: "hidden" }}>
        {[["both", "naam of omschr."], ["name", "naam"], ["description", "omschrijving"]].map(([v, l]) => (
          <button key={v} onClick={() => pickField(v)} style={{ padding: "4px 9px", border: "none", borderLeft: v !== "both" ? `1px solid ${T.line}` : "none", background: field === v ? T.accent : "#fff", color: field === v ? "#fff" : T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      <Btn size="sm" variant="secondary" onClick={make}>Onthoud</Btn>
    </div>
  );
}

function SplitEditor({ tx, categories, groups, onSave, onCancel }) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  const total = Math.abs(tx.amountCents);
  const init = (tx.allocations && tx.allocations.length > 1)
    ? tx.allocations.map((a) => ({ categoryId: a.categoryId, mag: Math.abs(a.amountCents), note: a.note || "", sub: a.sub || "" }))
    : (tx.allocations && tx.allocations.length === 1
      ? [{ categoryId: tx.allocations[0].categoryId, mag: total, note: tx.allocations[0].note || "", sub: tx.allocations[0].sub || "" }, { categoryId: "", mag: 0, note: "", sub: "" }]
      : [{ categoryId: "", mag: total, note: "", sub: "" }, { categoryId: "", mag: 0, note: "", sub: "" }]);
  const [rows, setRows] = useState(init);
  const subsOf = (cid) => (categories.find((c) => c.id === cid) || {}).subs || [];
  const sum = rows.reduce((s, r) => s + (r.mag || 0), 0);
  const remaining = total - sum;
  const filled = rows.filter((r) => r.mag > 0 && r.categoryId);
  const balanced = remaining === 0 && rows.filter((r) => r.mag > 0).every((r) => r.categoryId) && filled.length >= 1;
  const upd = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const verdeelEvenredig = () => setRows((rs) => { const n = rs.length || 1; const base = Math.floor(total / n); const rest = total - base * n; return rs.map((r, i) => ({ ...r, mag: base + (i === 0 ? rest : 0) })); });
  return (
    <div style={{ background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Verdeel {formatEUR(tx.amountCents)} over posten</div>
        <Btn size="sm" variant="ghost" onClick={verdeelEvenredig}>Evenredig verdelen</Btn>
      </div>
      {rows.map((r, i) => { const subs = subsOf(r.categoryId); return (
        <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 7, padding: 8, marginBottom: 6, background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 32px", gap: 8, alignItems: "center" }}>
            <CatSelect categories={categories} groups={groups} value={r.categoryId} sign={sign} onChange={(v) => upd(i, { categoryId: v, sub: "" })} />
            <MoneyInput cents={r.mag} onChange={(v) => upd(i, { mag: v })} />
            <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="regel weg" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <input value={r.note} onChange={(e) => upd(i, { note: e.target.value })} placeholder="omschrijving voor dit deel (optioneel)" style={{ ...inputStyle, flex: 1, minWidth: 140, padding: "5px 8px", fontSize: 12 }} />
            {subs.length > 0 && (
              <select value={r.sub} onChange={(e) => upd(i, { sub: e.target.value })} title="subpost" style={{ ...inputStyle, width: 150, padding: "5px 6px", fontSize: 12 }}>
                <option value="">— subpost —</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>
      ); })}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { categoryId: "", mag: remaining > 0 ? remaining : 0, note: "", sub: "" }])}>+ post</Btn>
          <span style={{ fontSize: 12, color: remaining === 0 ? T.pos : T.warn }}>{remaining === 0 ? "precies verdeeld" : remaining > 0 ? `nog ${formatEUR(remaining)} te verdelen` : `${formatEUR(-remaining)} te veel`}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={onCancel}>Annuleren</Btn>
          <Btn size="sm" disabled={!balanced} onClick={() => onSave(filled.map((r) => { const o = { categoryId: r.categoryId, amountCents: sign * r.mag }; if ((r.note || "").trim()) o.note = r.note.trim(); if ((r.sub || "").trim()) o.sub = r.sub.trim(); return o; }))}>Opslaan</Btn>
        </div>
      </div>
    </div>
  );
}

const TX_COLS = "78px 1fr 96px 200px 40px 34px";
// Comprimeer een foto op het apparaat vóór upload (max 1600px, JPEG ~80%); PDF's gaan ongewijzigd.
async function fileToUploadPayload(file) {
  const MAX_RAW = 6 * 1024 * 1024;
  const isImage = /^image\//.test(file.type);
  if (isImage) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      return { filename: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", data: dataUrl.split(",")[1] };
    } catch { /* val terug op het origineel */ }
  }
  if (file.size > MAX_RAW) throw new Error("Bestand is groter dan 6 MB.");
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("lezen mislukt")); r.readAsDataURL(file); });
  return { filename: file.name, mime: file.type === "application/pdf" ? "application/pdf" : file.type, data: b64 };
}
// Bijlagen bij één transactie: uploaden (camera/galerij/PDF), bekijken en verwijderen.
function Bijlagen({ tx, onChanged }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  const load = useCallback(() => { listAttachments(tx.id).then((r) => setItems(r.attachments || [])).catch(() => setItems([])); }, [tx.id]);
  useEffect(() => { load(); }, [load]);
  const pick = async (file) => {
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const payload = await fileToUploadPayload(file);
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(payload.mime)) throw new Error("Alleen foto's (jpg/png/webp) of PDF.");
      await uploadAttachment({ txId: tx.id, ...payload });
      load(); if (onChanged) onChanged();
    } catch (e) { setErr(e && e.message ? e.message : "Uploaden mislukt."); }
    finally { setBusy(false); }
  };
  const remove = async (id) => { if (!confirm("Deze bijlage verwijderen?")) return; try { await deleteAttachment(id); load(); if (onChanged) onChanged(); } catch {} };
  return (
    <div style={{ marginTop: 8, background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
        <Btn size="sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>{busy ? "Bezig…" : "📎 Foto of PDF toevoegen"}</Btn>
        <span style={{ fontSize: 11.5, color: T.sub }}>foto's worden automatisch verkleind · max 6 MB</span>
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: T.neg }}>{err}</div>}
      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          {items.map((a) => (
            <div key={a.id} style={{ position: "relative", border: `1px solid ${T.line}`, borderRadius: 8, background: "#fff", padding: 6, width: 96 }}>
              {/^image\//.test(a.mime)
                ? <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer"><img src={attachmentUrl(a.id)} alt={a.filename} style={{ width: 82, height: 82, objectFit: "cover", borderRadius: 5, display: "block" }} /></a>
                : <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" style={{ width: 82, height: 82, display: "grid", placeItems: "center", background: "#fdf2f2", borderRadius: 5, textDecoration: "none", fontSize: 20 }}>📄</a>}
              <div style={{ fontSize: 9.5, color: T.sub, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</div>
              <button onClick={() => remove(a.id)} title="verwijderen" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: "50%", border: `1px solid ${T.line}`, background: "#fff", color: T.neg, cursor: "pointer", fontSize: 11, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {items && items.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: T.sub }}>Nog geen bijlagen bij deze transactie.</div>}
    </div>
  );
}
// "Kijk hier even naar": zet een taak voor de ander klaar, gekoppeld aan deze transactie.
function TaakKnop({ tx, otherName, onAddTask }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) return <Btn size="sm" variant="ghost" onClick={() => setOpen(true)}>→ Taak voor {otherName}</Btn>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="korte toelichting (optioneel)" style={{ border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, width: 220 }} />
      <Btn size="sm" onClick={() => { onAddTask(tx.id, note.trim()); setNote(""); setOpen(false); }}>Klaarzetten</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>×</Btn>
    </span>
  );
}
function TxRowBase({ tx, groups, categories, rules = [], history = [], years = [], newBatchId = null, onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne, attachCounts = null, onAttachChanged, onAddTask, otherName = "de ander" }) {
  const [showAttach, setShowAttach] = useState(false);
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const sign = tx.amountCents < 0 ? -1 : 1;
  const allocs = tx.allocations || [];
  const isSplit = allocs.length > 1;
  const uncategorized = allocs.length === 0;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const pickSingle = (catId) => onSetAllocations(tx.id, catId ? [{ categoryId: catId, amountCents: tx.amountCents }] : []);
  const singleSubs = (categories.find((c) => c.id === singleCat) || {}).subs || [];
  const setSingleSub = (sub) => onSetAllocations(tx.id, [{ ...allocs[0], categoryId: singleCat, amountCents: tx.amountCents, sub: sub || undefined }]);
  const isNewBatch = newBatchId && tx.batchId === newBatchId;
  const bg = uncategorized ? "#fff9ef" : (tx.flagged ? "#fdf3f3" : (isNewBatch ? "#fafcff" : undefined));
  const sugIds = uncategorized ? rankSuggestions(tx, rules, categories, history, 3) : [];
  return (
    <div title={tx.importedAt ? `Geïmporteerd ${fmtDateTime(tx.importedAt)}` : undefined} style={{ borderTop: `1px solid ${T.line}`, borderLeft: `4px solid ${tx.batchId ? batchColor(tx.batchId) : "transparent"}`, background: bg }}>
      <div style={{ display: "grid", gridTemplateColumns: TX_COLS, gap: 10, alignItems: "center", padding: "8px 14px" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, color: T.sub, fontFamily: T.mono }}>{tx.date.slice(8, 10)}-{tx.date.slice(5, 7)}</span>
          {tx.periodDate && <div style={{ fontSize: 9, color: T.accent, fontWeight: 700 }} title="telt mee voor een andere periode">↪ {String(effMonth(tx)).padStart(2, "0")}-{effYear(tx)}</div>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.name}</div>
          {tx.note && tx.note.trim()
            ? <div style={{ fontSize: 11, color: T.warn, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.note}</div>
            : (tx.omschrijving && tx.omschrijving !== tx.name && <div style={{ fontSize: 11, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.omschrijving}</div>)}
        </div>
        <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 600, color: sign < 0 ? T.neg : T.pos }}>{formatEUR(tx.amountCents)}</span>
        <div>
          {isSplit
            ? <button onClick={() => { setOpen(true); setSplitting(true); }} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, textAlign: "left", cursor: "pointer", background: "#eef0ff", color: "#4338ca", border: "1px solid #d7dcff", borderRadius: 7 }}>Verdeeld over {allocs.length} posten ✎</button>
            : <CatSelect categories={categories} groups={groups} value={singleCat} sign={sign} onChange={pickSingle} placeholder={uncategorized ? "— toe te kennen —" : "— kies post —"} />}
          {uncategorized && sugIds.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              {sugIds.map((cid) => { const c = categories.find((x) => x.id === cid); if (!c) return null;
                return <button key={cid} onClick={() => pickSingle(cid)} title="snel toekennen" style={{ border: `1px solid ${T.accent}`, background: T.accentSoft, color: T.accent, borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam}</button>; })}
            </div>
          )}
          {!isSplit && singleCat && singleSubs.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>Kies subpost:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {singleSubs.map((s) => { const on = (allocs[0] && allocs[0].sub) === s; return (
                  <button key={s} onClick={() => setSingleSub(on ? "" : s)} style={{ border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accent : "#fff", color: on ? "#fff" : T.sub, borderRadius: 999, padding: "2px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{s}</button>
                ); })}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => onToggleFlag(tx.id)} title={tx.flagged ? "markering weghalen" : "markeer: nog uitzoeken / voorgeschoten"} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 17, lineHeight: 1, color: tx.flagged ? T.warn : "#c7d0ce" }}>{tx.flagged ? "★" : "☆"}</button>
        <button onClick={() => setOpen((o) => !o)} title="meer" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, display: "flex", justifyContent: "center" }}><Icon d={open ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />} size={16} /></button>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px 90px", display: "flex", flexDirection: "column", gap: 10 }}>
          {sign > 0 && <div style={{ fontSize: 12, color: T.sub }}>Geld terug dat je had voorgeschoten? Kies hierboven de <b>uitgavepost</b> waarop je het had geboekt; de teruggave verlaagt dan die post.</div>}
          {tx.description && tx.description !== tx.omschrijving && <div style={{ fontSize: 12, color: T.sub, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px" }}><span style={{ fontWeight: 600 }}>Mededelingen: </span>{tx.description}</div>}
          <VermogenHint tx={tx} categories={categories} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn size="sm" variant={showAttach ? "secondary" : "ghost"} onClick={() => setShowAttach((v) => !v)}>📎 Bijlagen{attachCounts && attachCounts[tx.id] ? ` (${attachCounts[tx.id]})` : ""}</Btn>
            {onAddTask && <TaakKnop tx={tx} otherName={otherName} onAddTask={onAddTask} />}
          </div>
          {showAttach && <Bijlagen tx={tx} onChanged={onAttachChanged} />}
          {isSplit && !splitting && (
            <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, marginBottom: 4 }}>Verdeling</div>
              {allocs.map((a, i) => { const c = categories.find((x) => x.id === a.categoryId); return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "2px 0" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c ? c.naam : "(post?)"}{a.sub ? ` › ${a.sub}` : ""}{a.note ? ` · ${a.note}` : ""}</span>
                  <span style={{ fontFamily: T.mono, flexShrink: 0 }}>{formatEUR(a.amountCents)}</span>
                </div>); })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
            <input value={tx.note || ""} onChange={(e) => onSetNote(tx.id, e.target.value)} placeholder="bijv. voorgeschoten voor Maud" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
          </div>
          {onSaveOne && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Bundel</span>
              <input value={tx.bundle || ""} list="bundel-labels" onChange={(e) => onSaveOne(tx.id, { bundle: e.target.value })} placeholder="bijv. Verjaardag Maud — telt los op bij Uitgaven › Bundels" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
            </div>
          )}
          {onSaveOne && settlementsOf(tx).length === 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 12, color: T.sub, width: 64, paddingTop: 4 }}>Tikkie</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                  <Toggle on={!!tx.advance} onClick={() => onSaveOne(tx.id, tx.advance ? { advance: false } : { advance: true, expectedBackCents: Math.abs(tx.amountCents) })} />
                  <span>Ik ga hier een tikkie voor sturen — verwacht (deels) terug</span>
                </label>
                {tx.advance && <ExpectedBackEditor amountCents={tx.amountCents} value={tx.expectedBackCents} onChange={(v) => onSaveOne(tx.id, { expectedBackCents: v })} />}
              </div>
            </div>
          )}
          {settlementsOf(tx).length > 0 && <div style={{ fontSize: 12.5, color: T.pos, fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><span>✓ Gekoppeld aan {settlementsOf(tx).length === 1 ? "een tikkie" : `${settlementsOf(tx).length} tikkies`}{unassignedOf(tx) > 0 ? ` · nog ${formatEUR(unassignedOf(tx))} vrij` : ""} · beheren onder Tikkies</span>{onSaveOne && <button onClick={() => onSaveOne(tx.id, { settledWith: undefined, settlements: [], allocations: [] })} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>ontkoppel</button>}</div>}
          {onSaveOne && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: T.sub, width: 64 }}>Periode</span><PeriodControl tx={tx} years={years} onChange={(pd) => onSaveOne(tx.id, { periodDate: pd })} /></div>}
          {!splitting && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Btn variant="secondary" size="sm" onClick={() => setSplitting(true)}>Verdeel over meerdere posten</Btn>
              {singleCat && <RuleLearn tx={tx} categoryId={singleCat} onAddRule={onAddRule} />}
            </div>
          )}
          {splitting && <SplitEditor tx={tx} categories={categories} groups={groups} onSave={(a) => { onSetAllocations(tx.id, a); setSplitting(false); }} onCancel={() => setSplitting(false)} />}
        </div>
      )}
    </div>
  );
}
// Alleen opnieuw renderen als de transactie zelf of relevante lijsten wijzigen — scheelt veel werk
// bij lange transactielijsten.
const TxRow = React.memo(TxRowBase, (a, b) =>
  a.tx === b.tx && a.categories === b.categories && a.rules === b.rules && a.years === b.years && a.newBatchId === b.newBatchId && a.groups === b.groups && a.history === b.history && a.attachCounts === b.attachCounts
);

function DataCleanup({ year, years = [], txCount, onClearRange, onClearYear, onClearAll, onResetAll }) {
  const months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const yearList = (years.length ? years : [year]).map((y) => y.jaartal).sort((a, b) => a - b);
  const [fy, setFy] = useState(year.jaartal), [fm, setFm] = useState(1);
  const [ty, setTy] = useState(year.jaartal), [tm, setTm] = useState(12);
  const [sm, setSm] = useState(1), [smY, setSmY] = useState(year.jaartal); // losse maand
  const [confirm, setConfirm] = useState(null); // 'month' | 'range' | 'year' | 'all' | 'reset'
  const ss = { ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 };
  const fromKey = fy * 100 + fm, toKey = ty * 100 + tm;
  const monthKey = smY * 100 + sm;
  const ConfirmRow = ({ id, label, onYes, danger }) => confirm === id ? (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.neg }}>Zeker weten?</span>
      <Btn size="sm" variant="danger" onClick={() => { onYes(); setConfirm(null); }}>{label}</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Annuleer</Btn>
    </span>
  ) : <Btn size="sm" variant={danger ? "danger" : "secondary"} onClick={() => setConfirm(id)}>{label}</Btn>;
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid #f0dcb8`, background: "#fffdf8" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Gegevens opschonen</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Hiermee verwijder je ingelezen transacties. Je begroting, posten en regels blijven staan (tenzij je hieronder "opnieuw beginnen" kiest).</div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: T.sub, minWidth: 64 }}>Eén maand</span>
        <select value={sm} onChange={(e) => setSm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={smY} onChange={(e) => setSmY(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <ConfirmRow id="month" label={`Wis ${months[sm - 1]} ${smY}`} onYes={() => onClearRange(monthKey, monthKey)} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: T.sub, minWidth: 64 }}>Periode van</span>
        <select value={fm} onChange={(e) => setFm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 13, color: T.sub }}>t/m</span>
        <select value={tm} onChange={(e) => setTm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={ty} onChange={(e) => setTy(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <ConfirmRow id="range" label={`Verwijder ${months[fm - 1]} ${fy} t/m ${months[tm - 1]} ${ty}`} onYes={() => onClearRange(Math.min(fromKey, toKey), Math.max(fromKey, toKey))} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
        <ConfirmRow id="year" label={`Wis heel ${year.jaartal}`} onYes={onClearYear} />
        <ConfirmRow id="all" label="Wis álle transacties (alle jaren)" onYes={onClearAll} />
        <ConfirmRow id="reset" label="Opnieuw beginnen — wis alles behalve regels & inlog" onYes={onResetAll} danger />
      </div>
      {confirm === "reset" && <div style={{ fontSize: 12, color: T.neg, marginTop: 8 }}>Dit wist transacties, begrotingsbedragen, startsaldo en spaarsaldi en zet de posten terug naar de standaard. Je <b>regels</b> en <b>inlogaccounts</b> blijven.</div>}
      <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>Op dit moment {txCount} transactie(s) in totaal.</div>
    </Card>
  );
}

function VoorschotPanel({ transactions, categories, onLinkSettle, onUnlinkSettle, onUnsettle, onPatch }) {
  const dt = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`;
  const catLabel = (t) => (t.allocations || []).map((a) => (categories.find((c) => c.id === a.categoryId) || {}).naam).filter(Boolean).join(", ") || "nog niet ingedeeld";
  const partFor = (inc, advId) => (settlementsOf(inc).find((s) => s.advanceId === advId) || {}).amountCents || 0;
  const linkedTo = (advId) => transactions.filter((t) => t.amountCents > 0 && settlementsOf(t).some((s) => s.advanceId === advId)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const advances = transactions.filter((t) => t.advance).map((adv) => { const owed = expectedBackOf(adv); const recovered = recoveredFor(adv.id, transactions); return { adv, owed, recovered, remaining: owed - recovered, applied: linkedTo(adv.id) }; });
  const open = advances.filter((a) => a.remaining > 0).sort((a, b) => (a.adv.date < b.adv.date ? 1 : -1));
  const done = advances.filter((a) => a.remaining <= 0).sort((a, b) => (a.adv.date < b.adv.date ? 1 : -1));
  const candidatesFor = (a) => transactions.filter((t) => t.amountCents > 0 && t.id !== a.adv.id && t.date >= a.adv.date && unassignedOf(t) > 0 && !settlementsOf(t).some((s) => s.advanceId === a.adv.id)).sort((x, y) => Math.abs(a.remaining - unassignedOf(x)) - Math.abs(a.remaining - unassignedOf(y)) || (x.date < y.date ? -1 : 1));
  const toggle = (a, inc, on) => { if (on) { onUnlinkSettle(inc.id, a.adv.id); } else { const amt = Math.min(a.remaining, unassignedOf(inc)); if (amt > 0) onLinkSettle(inc.id, a.adv.id, amt); } };
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid ${T.accent}`, background: "#f3f8f6" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Tikkies &amp; voorschotten</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Markeer bij het verwerken een bedrag waar je een tikkie voor stuurt en geef aan hoeveel je terugverwacht (mag een deel zijn). Komt geld binnen, vink het dan hieronder aan onder de bijbehorende tikkie — ik koppel telkens zoveel als er nog openstaat. <b>Eén binnengekomen bedrag kun je zo over meerdere tikkies verdelen</b> (vink het onder elke tikkie aan). De terugbetaling wordt naar verhouding op dezelfde post(en) geboekt.</div>

      {open.length === 0 && <div style={{ fontSize: 13, color: T.sub }}>Geen openstaande tikkies. 👍</div>}
      {open.map((a) => {
        const cands = candidatesFor(a).slice(0, 10);
        const rows = [...a.applied.map((inc) => ({ inc, on: true })), ...cands.map((inc) => ({ inc, on: false }))];
        return (
          <div key={a.adv.id} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 10, marginBottom: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{dt(a.adv.date)} · {a.adv.name}</div>
                <div style={{ fontSize: 12, color: T.sub }}>{catLabel(a.adv)} · {a.recovered > 0 ? <>al terug <b>{formatEUR(a.recovered)}</b> · nog open <b style={{ color: T.warn }}>{formatEUR(a.remaining)}</b></> : <>verwacht terug <b>{formatEUR(a.owed)}</b></>}</div>
              </div>
              <span style={{ fontFamily: T.mono, fontWeight: 700, color: a.adv.amountCents < 0 ? T.neg : T.pos, flexShrink: 0 }}>{formatEUR(a.adv.amountCents)}</span>
            </div>
            {(a.adv.allocations || []).length === 0 && <div style={{ fontSize: 11.5, color: T.warn, marginTop: 5 }}>Tip: geef deze uitgave eerst een post, dan boekt de terugbetaling automatisch op de juiste plek.</div>}
            {onPatch && a.recovered === 0 && <div style={{ marginTop: 6 }}><ExpectedBackEditor amountCents={a.adv.amountCents} value={a.owed} onChange={(v) => onPatch(a.adv.id, { expectedBackCents: v })} /></div>}
            <div style={{ marginTop: 8 }}>
              {rows.length === 0 ? <div style={{ fontSize: 12, color: T.warn }}>Nog geen binnengekomen bedragen om te koppelen. Zodra geld binnen is, kun je 'm hier aanvinken.</div> : (
                <>
                  <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Vink aan welk binnengekomen geld bij deze tikkie hoort — dichtstbijzijnde eerst:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {rows.map(({ inc, on }) => { const part = partFor(inc, a.adv.id); const vrij = unassignedOf(inc); const full = Math.abs(inc.amountCents); return (
                      <label key={inc.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 9px", background: on ? "#eef7f1" : "#f7faf9", border: `1px solid ${on ? T.accent : T.line}`, borderRadius: 7, cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(a, inc, on)} />
                        <span style={{ fontSize: 12.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{dt(inc.date)} · {inc.name}{on && part !== full ? <span style={{ color: T.sub }}> · {formatEUR(part)} hiervan</span> : !on && vrij !== full ? <span style={{ color: T.sub }}> · nog {formatEUR(vrij)} vrij</span> : null}</span>
                        <span style={{ fontFamily: T.mono, color: T.pos, flexShrink: 0 }}>{formatEUR(inc.amountCents)}</span>
                      </label>
                    ); })}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Volledig verrekend</div>
          {done.map((a) => (
            <div key={a.adv.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{dt(a.adv.date)} · {a.adv.name} · {formatEUR(a.owed)}</div>
              <div style={{ paddingLeft: 4 }}>{a.applied.map((inc) => { const part = partFor(inc, a.adv.id); const full = Math.abs(inc.amountCents); return (
                <div key={inc.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: T.pos }}>✓ {dt(inc.date)} · {inc.name} · {formatEUR(part)}{part !== full ? <span style={{ color: T.sub }}> (van {formatEUR(full)})</span> : null}</span>
                  <button onClick={() => onUnlinkSettle(inc.id, a.adv.id)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>ontkoppel</button>
                </div>
              ); })}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ManualTxForm({ onAdd, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [oms, setOms] = useState("");
  const [bedrag, setBedrag] = useState(0);
  const [richting, setRichting] = useState("af"); // af | bij
  const valid = date && bedrag > 0 && name.trim();
  const submit = () => { if (!valid) return; onAdd({ date, name: name.trim(), omschrijving: oms.trim(), amountCents: (richting === "af" ? -1 : 1) * bedrag }); setName(""); setOms(""); setBedrag(0); setRichting("af"); onClose && onClose(); };
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid ${T.accent}`, background: "#f3f8f6" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Losse transactie toevoegen</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Voor iets dat niet in je bankexport staat (bijvoorbeeld contant geld). Je regels en spaarrekening-codes worden meteen toegepast.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, color: T.sub }}>Datum<br /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
        <label style={{ fontSize: 12, color: T.sub, flex: 1, minWidth: 180 }}>Naam / winkel<br /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. Markt, contant" style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
        <label style={{ fontSize: 12, color: T.sub }}>Bedrag<br /><div style={{ marginTop: 3 }}><MoneyInput cents={bedrag} width={120} onChange={setBedrag} /></div></label>
        <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 7, overflow: "hidden", height: 34 }}>
          {[["af", "Af (uit)"], ["bij", "Bij (in)"]].map(([v, l]) => (
            <button key={v} onClick={() => setRichting(v)} style={{ padding: "0 12px", border: "none", borderLeft: v === "bij" ? `1px solid ${T.line}` : "none", background: richting === v ? (v === "af" ? T.neg : T.pos) : "#fff", color: richting === v ? "#fff" : T.sub, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 12, color: T.sub }}>Omschrijving (optioneel)<br /><input value={oms} onChange={(e) => setOms(e.target.value)} placeholder="waar ging het om?" style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Btn size="sm" disabled={!valid} onClick={submit}>Toevoegen</Btn>
        <Btn size="sm" variant="ghost" onClick={() => onClose && onClose()}>Sluiten</Btn>
      </div>
    </Card>
  );
}

function UnknownSavingsRow({ u, savingsCats, onCreate, onLink }) {
  const preMatch = savingsCats.find((c) => c.naam.toUpperCase().includes(u.code.toUpperCase()));
  const [naam, setNaam] = useState(u.hint || "");
  const [linkTo, setLinkTo] = useState(preMatch ? preMatch.id : "");
  const richting = u.inCents > 0 && u.outCents > 0 ? "in- en uitgaand" : u.inCents > 0 ? "geld binnengekomen" : "geld naartoe";
  return (
    <div style={{ padding: "10px 0", borderTop: `1px solid ${T.line}` }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Code <span style={{ fontFamily: T.mono }}>{u.code}</span>{u.hint ? ` · ${u.hint}` : ""}</div>
      <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 8 }}>{u.count} transactie{u.count > 1 ? "s" : ""} · {richting}</div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        {savingsCats.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.sub }}>Koppel aan bestaande rekening</span>
            <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} style={{ ...inputStyle, width: 220, padding: "6px 8px", fontSize: 13 }}>
              <option value="">— kies rekening —</option>
              {savingsCats.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
            </select>
            <Btn size="sm" disabled={!linkTo} onClick={() => linkTo && onLink(linkTo, u.code)}>Koppel</Btn>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.sub }}>of nieuw</span>
          <input value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="naam nieuwe rekening" style={{ ...inputStyle, width: 190, padding: "6px 8px", fontSize: 13 }} />
          <Btn size="sm" variant="secondary" onClick={() => onCreate(u.code, naam.trim() || `Spaarrekening ${u.code}`)}>Aanmaken</Btn>
        </div>
      </div>
    </div>
  );
}
function OnbekendeSpaarrekeningen({ transactions, categories, onCreateSavings, onLinkSavings }) {
  const unknown = unknownSavingsCodes(transactions, categories);
  if (unknown.length === 0) return null;
  const savingsCats = categories.filter((c) => c.type === "savings");
  return (
    <Card style={{ padding: 14, marginBottom: 14, border: `1px solid ${T.warn}`, background: T.warnSoft }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Spaarrekening-mutatie{unknown.length > 1 ? "s" : ""} nog niet gekoppeld</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 4 }}>Er gaat geld van of naar een spaarrekening (herkend aan de code in de mededelingen) die nog niet aan een rekening hangt. <b>Koppel de code aan je bestaande rekening</b> — het Vermogen-tabblad rekent alle bij- en afschrijvingen met deze code er dan vanzelf aan toe. Je boekingen op posten (bijv. Tussenrekening) blijven gewoon staan. Of maak een nieuwe rekening aan.</div>
      {unknown.map((u) => <UnknownSavingsRow key={u.code} u={u} savingsCats={savingsCats} onCreate={onCreateSavings} onLink={onLinkSavings} />)}
    </Card>
  );
}

function Transacties({ groups, categories, year, years = [], transactions, rules = [], onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne, onClearYear, onClearRange, onClearAll, onResetAll, onAddManual, onLinkSettle, onUnlinkSettle, onUnsettle, onCreateSavings, onLinkSavings, reviewedBatches = [], onMarkBatchReviewed, kickReview, preset = null, onPresetConsumed, attachCounts = null, onAttachChanged, onAddTask, otherName }) {
  const [showCleanup, setShowCleanup] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showVoorschot, setShowVoorschot] = useState(false);
  const [batchFilter, setBatchFilter] = useState(null);
  const batches = useMemo(() => batchesOf(transactions), [transactions]);
  const newestBatch = batches[0] || null;
  const newestUnreviewed = newestBatch && !reviewedBatches.includes(newestBatch.id) ? newestBatch : null;
  const openAdvances = transactions.filter((t) => t.advance && remainingOf(t, transactions) > 0).length;
  const [maand, setMaand] = useState(0);
  const [status, setStatus] = useState("alle");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // filter op post
  const [focusId, setFocusId] = useState(null); // focus op één transactie (vanaf taak/doorklik)
  const [reviewing, setReviewing] = useState(false);
  // Doorklik vanaf het dashboard: filters overnemen en preset weer vrijgeven.
  useEffect(() => {
    if (!preset) return;
    setMaand(preset.maand != null ? preset.maand : 0);
    setCat(preset.categoryId || "");
    setFocusId(preset.txId || null);
    setStatus("alle"); setBatchFilter(null); setQ(""); setReviewing(false);
    if (onPresetConsumed) onPresetConsumed();
  }, [preset]);
  const names = ["alle maanden", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const yearTx = useMemo(() => transactions.filter((t) => effYear(t) === year.jaartal).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), [transactions, year]);
  const teSorterenItems = yearTx.filter((t) => !t.allocations || t.allocations.length === 0);
  const teSorteren = teSorterenItems.length;
  useEffect(() => { if (kickReview && teSorteren > 0) setReviewing(true); }, [kickReview]);
  const gemarkeerd = yearTx.filter((t) => t.flagged).length;
  const shown = yearTx.filter((t) => {
    if (batchFilter && t.batchId !== batchFilter) return false;
    if (maand && effMonth(t) !== maand) return false;
    if (status === "sorteren" && t.allocations && t.allocations.length > 0) return false;
    if (status === "gemarkeerd" && !t.flagged) return false;
    if (focusId && t.id !== focusId) return false;
    if (cat && !(t.allocations || []).some((a) => a.categoryId === cat)) return false;
    if (q) { const hay = (t.name + " " + (t.description || "") + " " + (t.note || "")).toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
    return true;
  });
  const PAGE = 100;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [batchFilter, maand, status, q, cat, focusId, year]);
  const visible = shown.slice(0, limit);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Transacties {year.jaartal}</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {teSorteren > 0 && !reviewing && <Btn size="sm" onClick={() => setReviewing(true)}>▶ Nalopen ({teSorteren})</Btn>}
          {onAddManual && <Btn variant={showManual ? "secondary" : "ghost"} size="sm" onClick={() => { setShowManual((s) => !s); setShowCleanup(false); setShowVoorschot(false); }}>{showManual ? "Sluiten" : "+ Losse transactie"}</Btn>}
          {onLinkSettle && <Btn variant={showVoorschot ? "secondary" : "ghost"} size="sm" onClick={() => { setShowVoorschot((s) => !s); setShowManual(false); setShowCleanup(false); }}>{showVoorschot ? "Sluiten" : `Tikkies${openAdvances ? ` (${openAdvances})` : ""}`}</Btn>}
          {(onClearRange || onClearYear) && <Btn variant={showCleanup ? "secondary" : "ghost"} size="sm" onClick={() => { setShowCleanup((s) => !s); setShowManual(false); setShowVoorschot(false); }}>{showCleanup ? "Opschonen sluiten" : "Opschonen / wissen"}</Btn>}
        </div>
      </div>
      {onCreateSavings && <OnbekendeSpaarrekeningen transactions={transactions} categories={categories} onCreateSavings={onCreateSavings} onLinkSavings={onLinkSavings} />}
      {showManual && <div style={{ marginTop: 12 }}><ManualTxForm onAdd={onAddManual} onClose={() => setShowManual(false)} /></div>}
      {showVoorschot && <div style={{ marginTop: 12 }}><VoorschotPanel transactions={transactions} categories={categories} onLinkSettle={onLinkSettle} onUnlinkSettle={onUnlinkSettle} onUnsettle={onUnsettle} onPatch={onSaveOne} /></div>}
      {showCleanup && <div style={{ marginTop: 12 }}><DataCleanup year={year} years={years} txCount={transactions.length} onClearRange={onClearRange} onClearYear={onClearYear} onClearAll={onClearAll} onResetAll={onResetAll} /></div>}
      {reviewing ? (
        <div style={{ marginTop: 12 }}>
          <ImportReview items={teSorterenItems} groups={groups} categories={categories} rules={rules} history={transactions} transactions={transactions} years={years} title={`Transacties ${year.jaartal} nalopen`} onSaveOne={onSaveOne} onAddRule={onAddRule} onClose={() => setReviewing(false)} onOpenTikkies={() => { setShowVoorschot(true); }} />
        </div>
      ) : (
      <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, marginTop: 4 }}>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Transacties</div><div style={{ fontSize: 20, fontWeight: 700 }}>{yearTx.length}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Nog toe te kennen</div><div style={{ fontSize: 20, fontWeight: 700, color: teSorteren ? T.warn : T.pos }}>{teSorteren}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Gemarkeerd</div><div style={{ fontSize: 20, fontWeight: 700, color: gemarkeerd ? T.warn : T.ink }}>{gemarkeerd}</div></Card>
      </div>
      {newestUnreviewed && (
        <Card style={{ padding: "12px 14px", marginBottom: 14, borderLeft: `4px solid ${batchColor(newestUnreviewed.id)}`, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: batchColor(newestUnreviewed.id), flexShrink: 0 }} />
            <span style={{ fontSize: 13, minWidth: 0 }}><b>Laatste import:</b> {newestUnreviewed.count} nieuwe transactie{newestUnreviewed.count > 1 ? "s" : ""}{newestUnreviewed.at ? ` · ${fmtDateTime(newestUnreviewed.at)}` : ""}. Ze hebben dit kleurtje gekregen zodat je ze snel even kunt nalopen.</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn size="sm" variant="secondary" onClick={() => setBatchFilter(batchFilter === newestUnreviewed.id ? null : newestUnreviewed.id)}>{batchFilter === newestUnreviewed.id ? "Toon alles" : "Toon alleen deze"}</Btn>
            <Btn size="sm" onClick={() => { if (onMarkBatchReviewed) onMarkBatchReviewed(newestUnreviewed.id); setBatchFilter(null); }}>Gecontroleerd</Btn>
          </div>
        </Card>
      )}
      {teSorteren > 0 && onSaveOne && (
        <div style={{ marginBottom: 14 }}>
          <Btn onClick={() => setReviewing(true)}>Toe te kennen nalopen ({teSorteren}) →</Btn>
          <span style={{ fontSize: 12, color: T.sub, marginLeft: 10 }}>Loop ze één voor één na in het begeleidingsscherm; je kunt altijd stoppen en later verder.</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <select value={maand} onChange={(e) => setMaand(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 13 }}>{names.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, width: "auto", maxWidth: 230, padding: "7px 10px", fontSize: 13 }}>
          <option value="">alle posten</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.naam}>{categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.naam.split(":")[0]}</option>)}</optgroup>
          ))}
        </select>
        {[["alle", "Alle"], ["sorteren", "Toe te kennen"], ["gemarkeerd", "Gemarkeerd"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setStatus(v)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${status === v ? T.accent : T.line}`, background: status === v ? T.accentSoft : T.panel, color: status === v ? T.accent : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{lbl}</button>
        ))}
        {newestBatch && <button onClick={() => setBatchFilter(batchFilter === newestBatch.id ? null : newestBatch.id)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${batchFilter === newestBatch.id ? batchColor(newestBatch.id) : T.line}`, background: batchFilter === newestBatch.id ? "#fafcff" : T.panel, color: batchFilter === newestBatch.id ? T.ink : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: batchColor(newestBatch.id) }} />Laatste import ({newestBatch.count})</button>}
        {batchFilter && batchFilter !== (newestBatch && newestBatch.id) && <button onClick={() => setBatchFilter(null)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>× toon alles</button>}
        {focusId && <button onClick={() => setFocusId(null)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.accent}`, background: T.accentSoft, color: T.accent, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>× focus op 1 transactie wissen</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="zoek op naam, mededeling of notitie" style={{ ...inputStyle, flex: 1, minWidth: 160, padding: "7px 10px", fontSize: 13 }} />
      </div>
      {yearTx.length === 0 ? (
        <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties in {year.jaartal}. Importeer je ING-CSV onder <b>Import</b>.</div></Card>
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: TX_COLS, gap: 10, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
            <span>Datum</span><span>Omschrijving</span><span style={{ textAlign: "right" }}>Bedrag</span><span>Post</span><span style={{ textAlign: "center" }}>Mark</span><span />
          </div>
          <datalist id="bundel-labels">{bundleLabels(transactions).map((b) => <option key={b} value={b} />)}</datalist>
          {visible.map((t) => <TxRow key={t.id} tx={t} groups={groups} categories={categories} rules={rules} history={transactions} years={years} newBatchId={newestUnreviewed ? newestUnreviewed.id : null} onSetAllocations={onSetAllocations} onSetNote={onSetNote} onToggleFlag={onToggleFlag} onAddRule={onAddRule} onSaveOne={onSaveOne} attachCounts={attachCounts} onAttachChanged={onAttachChanged} onAddTask={onAddTask} otherName={otherName} />)}
          {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Geen transacties met dit filter.</div>}
          {shown.length > visible.length && (
            <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.line}`, display: "flex", justifyContent: "center", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: T.sub }}>{visible.length} van {shown.length} getoond</span>
              <Btn size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Toon {Math.min(PAGE, shown.length - visible.length)} meer</Btn>
              {shown.length - visible.length > PAGE && <Btn size="sm" variant="ghost" onClick={() => setLimit(shown.length)}>Toon alles</Btn>}
            </div>
          )}
        </Card>
      )}
      </>
      )}
    </div>
  );
}

// Maandelijks vermogensverloop als lijngrafiek (custom SVG, geen externe library).
// Toont het totaal (dik) en per rekening een dunne lijn; kies onder de grafiek wat je toont.
function VermogenChart({ history, jaartal }) {
  const [mode, setMode] = useState("total"); // "total" of een rekening-id
  if (!history || history.perAccount.length === 0) return null;
  const monthsWithData = history.total.some((v, i) => i > 0 ? history.total[i] !== history.total[i - 1] : v !== history.startTotal) || history.startTotal !== 0;
  const W = 640, H = 220, padL = 62, padR = 16, padT = 14, padB = 26;
  const labels = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const series = mode === "total" ? history.total : (history.perAccount.find((a) => a.id === mode) || { series: [] }).series;
  const startVal = mode === "total" ? history.startTotal : (history.perAccount.find((a) => a.id === mode) || { start: 0 }).start;
  // 13 punten: startsaldo (x=0) + 12 maandeindes
  const points = [startVal, ...series];
  const maxV = Math.max(...points, 1), minV = Math.min(...points, 0);
  const range = maxV - minV || 1;
  const x = (i) => padL + (i / 12) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - minV) / range) * (H - padT - padB);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${x(12).toFixed(1)} ${y(minV).toFixed(1)} L ${x(0).toFixed(1)} ${y(minV).toFixed(1)} Z`;
  // y-as-ticks
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => minV + (range * i) / ticks);
  const curName = mode === "total" ? "Totaal vermogen" : (history.perAccount.find((a) => a.id === mode) || {}).naam;
  const curEnd = points[12];
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Vermogensverloop {jaartal} <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· {curName}</span></div>
        <div style={{ fontSize: 13, color: T.sub }}>eind: <b style={{ color: T.ink }}>{formatEUR(curEnd)}</b> <span style={{ color: curEnd - startVal >= 0 ? T.pos : T.neg }}>({curEnd - startVal >= 0 ? "+" : "−"}{formatEUR(Math.abs(curEnd - startVal))} dit jaar)</span></div>
      </div>
      {!monthsWithData ? (
        <div style={{ fontSize: 12.5, color: T.sub, padding: "20px 0" }}>Nog geen mutaties dit jaar om te tonen.</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {tickVals.map((tv, i) => (
              <g key={i}>
                <line x1={padL} y1={y(tv)} x2={W - padR} y2={y(tv)} stroke={T.line} strokeWidth="1" />
                <text x={padL - 8} y={y(tv) + 3} textAnchor="end" fontSize="9" fill={T.sub}>{Math.round(tv / 100000) === tv / 100000 ? `€${Math.round(tv / 100000)}k` : `€${(tv / 100).toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`}</text>
              </g>
            ))}
            {minV < 0 && <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#c9d3d0" strokeWidth="1.5" strokeDasharray="3 3" />}
            <path d={areaPath} fill={T.accent} opacity="0.08" />
            <path d={path} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={T.accent} />)}
            {["start", ...labels].map((lb, i) => (i === 0 || i % 2 === 1) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill={T.sub}>{lb}</text>)}
          </svg>
          {history.perAccount.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button onClick={() => setMode("total")} style={chipStyle(mode === "total")}>Totaal</button>
              {history.perAccount.map((a) => <button key={a.id} onClick={() => setMode(a.id)} style={chipStyle(mode === a.id)}>{a.naam}</button>)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
function chipStyle(active) {
  return { border: `1px solid ${active ? T.accent : T.line}`, background: active ? T.accentSoft : T.panel, color: active ? T.accent : T.sub, borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}
function Vermogen({ pots, categories, transactions, year, budgetLines = {}, onSetPotOpening, onSetSpaarcode, onSetPotTarget }) {
  const potOf = (cid) => pots.find((x) => x.categoryId === cid) || {};
  const [openId, setOpenId] = useState(null);
  const flows = useMemo(() => potFlows(transactions, categories), [transactions, categories]);
  const mutations = useMemo(() => potMutations(transactions, categories), [transactions, categories]);
  const history = useMemo(() => (year ? potHistory(transactions, categories, pots, year.jaartal) : null), [transactions, categories, pots, year]);
  const rows = categories.filter((c) => c.type === "savings").map((c) => {
    const f = flows.get(c.id) || { dep: 0, wd: 0, depDerived: 0, wdDerived: 0 };
    const dep = f.dep, wd = f.wd, depDerived = f.depDerived || 0, wdDerived = f.wdDerived || 0;
    const p = potOf(c.id);
    const opening = p.opening || 0, target = p.target || 0;
    const contrib = (budgetLines[c.id] || {}).average || 0;
    return { categoryId: c.id, naam: c.naam, spaarcode: c.spaarcode || "", opening, dep, wd, depDerived, wdDerived, current: opening + dep - wd, target, contrib };
  });
  const tot = rows.reduce((a, r) => ({ opening: a.opening + r.opening, dep: a.dep + r.dep, wd: a.wd + r.wd, current: a.current + r.current }), { opening: 0, dep: 0, wd: 0, current: 0 });
  const cols = "1fr 130px 100px 100px 120px";
  return (
    <div>
      <SectionTitle>Vermogen · opbouw per rekening</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Per spaar- of reserveringsrekening: het <b>startsaldo</b>, wat er bij/af ging en het huidige saldo. Vul de <b>code of tegenrekening-IBAN</b> in, dan herkent de app stortingen en opnames automatisch — <b>ook als de transactie zelf op een andere post staat</b> (bijv. Tussenrekening): bij "Naar Spaardeposito X…" of "Van Oranje spaarrekening M…" in de mededelingen wordt de juiste rekening vanzelf bij- of afgeboekt. Zet een <b>doel</b> en ik toon de voortgang — met een maandinleg in je begroting ook een prognose.</Banner></div>
      {history && <VermogenChart history={history} jaartal={year.jaartal} />}
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Rekening</span><span style={{ textAlign: "right" }}>Startsaldo</span><span style={{ textAlign: "right" }}>Bij</span><span style={{ textAlign: "right" }}>Af</span><span style={{ textAlign: "right" }}>Huidig saldo</span>
        </div>
        {rows.map((r, i) => {
          const pct = r.target > 0 ? Math.min(100, Math.round((r.current / r.target) * 100)) : 0;
          const remaining = Math.max(0, r.target - r.current);
          const months = r.target > 0 && r.contrib > 0 && remaining > 0 ? Math.ceil(remaining / r.contrib) : 0;
          const reached = r.target > 0 && r.current >= r.target;
          return (
            <div key={i} style={{ borderTop: `1px solid ${T.line}` }}>
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "10px 16px 6px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.naam}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
                    {onSetSpaarcode && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 11, color: T.sub }}>Code/IBAN</span><input value={r.spaarcode} onChange={(e) => onSetSpaarcode(r.categoryId, e.target.value.trim())} placeholder="bijv. H17729888" style={{ ...inputStyle, width: 145, padding: "3px 7px", fontSize: 11, fontFamily: T.mono }} /></span>}
                    {onSetPotTarget && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 11, color: T.sub }}>Doel</span><MoneyInput cents={r.target} width={100} onChange={(v) => onSetPotTarget(r.categoryId, v)} /></span>}
                    {(r.depDerived > 0 || r.wdDerived > 0) && <span style={{ fontSize: 11, color: T.sub }} title="Overboekingen die op een andere post staan (bijv. Tussenrekening) maar via de code in de mededelingen aan deze rekening zijn toegerekend.">waarvan uit mededelingen: {r.depDerived > 0 ? `+ ${formatEUR(r.depDerived)}` : ""}{r.depDerived > 0 && r.wdDerived > 0 ? " · " : ""}{r.wdDerived > 0 ? `− ${formatEUR(r.wdDerived)}` : ""}</span>}
                    {(mutations.get(r.categoryId) || []).length > 0 && <button onClick={() => setOpenId(openId === r.categoryId ? null : r.categoryId)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>{openId === r.categoryId ? "▴ mutaties verbergen" : `▾ ${(mutations.get(r.categoryId) || []).length} mutatie${(mutations.get(r.categoryId) || []).length > 1 ? "s" : ""} tonen`}</button>}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>{onSetPotOpening ? <MoneyInput cents={r.opening} width={120} onChange={(v) => onSetPotOpening(r.categoryId, v)} /> : <Money cents={r.opening} muted />}</div>
                <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.dep ? "+ " + formatEUR(r.dep) : "—"}</span>
                <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.wd ? "− " + formatEUR(r.wd) : "—"}</span>
                <span style={{ textAlign: "right" }}><Money cents={r.current} bold /></span>
              </div>
              {r.target > 0 && (
                <div style={{ padding: "0 16px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: T.sub, marginBottom: 3 }}>
                    <span style={{ minWidth: 0 }}>{reached ? <b style={{ color: T.pos }}>✓ Doel bereikt</b> : <>nog <b>{formatEUR(remaining)}</b> tot {formatEUR(r.target)}{months ? ` · ~${months} mnd bij ${formatEUR(r.contrib)}/mnd` : ""}</>}</span>
                    <span style={{ flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: reached ? T.pos : T.accent }} /></div>
                </div>
              )}
              {openId === r.categoryId && (
                <div style={{ margin: "0 16px 12px", background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
                  {(mutations.get(r.categoryId) || []).map((m, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12, padding: "3px 0", borderTop: j ? `1px solid ${T.line}` : "none" }}>
                      <span style={{ color: T.sub, flexShrink: 0, fontFamily: T.mono }}>{m.date.slice(8, 10)}-{m.date.slice(5, 7)}-{m.date.slice(0, 4)}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.name}{m.derived ? <span style={{ color: T.sub }}> · uit mededelingen{m.via ? ` (staat op: ${m.via})` : ""}</span> : <span style={{ color: T.sub }}> · direct geboekt</span>}</span>
                      <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", flexShrink: 0, color: m.deltaCents >= 0 ? T.pos : T.neg }}>{m.deltaCents >= 0 ? "+ " : "− "}{formatEUR(Math.abs(m.deltaCents))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "12px 16px", borderTop: `2px solid ${T.line}`, background: "#f7faf9" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Totaal vermogen</span>
          <span style={{ textAlign: "right", paddingRight: 4 }}><Money cents={tot.opening} muted /></span>
          <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontSize: 13 }}>{tot.dep ? "+ " + formatEUR(tot.dep) : "—"}</span>
          <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontSize: 13 }}>{tot.wd ? "− " + formatEUR(tot.wd) : "—"}</span>
          <span style={{ textAlign: "right" }}><Money cents={tot.current} bold size={16} /></span>
        </div>
      </Card>
    </div>
  );
}

/* ============================================ BEGELEIDE TRANSACTIEVERWERKING (slaat direct op) */
function ImportReview({ items, groups, categories, rules = [], history = [], transactions = [], years = [], title = "Transacties nalopen", onSaveOne, onAddRule, onClose, onOpenTikkies }) {
  const [work, setWork] = useState(() => items.map((t) => ({ ...t })));
  const [i, setI] = useState(0);
  const [splitting, setSplitting] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [autoLearn, setAutoLearn] = useState(false);
  const total = work.length;
  if (total === 0) return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Niets meer toe te kennen — alles is ingedeeld. <button onClick={onClose} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600 }}>Terug</button></div></Card>
    </div>
  );
  const cur = work[i];
  const sign = cur.amountCents < 0 ? -1 : 1;
  const allocs = cur.allocations || [];
  const isSplit = allocs.length > 1;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const teSorteren = work.filter((t) => !t.allocations || t.allocations.length === 0).length;

  // elke wijziging wordt meteen opgeslagen, zodat er nooit werk verloren gaat
  const update = (patch) => { setWork((w) => w.map((t, j) => (j === i ? { ...t, ...patch } : t))); if (onSaveOne) onSaveOne(cur.id, patch); };
  const setSingle = (catId) => update({ allocations: catId ? [{ categoryId: catId, amountCents: cur.amountCents }] : [] });
  const learnRule = (rule) => {
    if (onAddRule) onAddRule(rule); // direct toevoegen aan Regels
    setWork((w) => w.map((t, j) => {
      if (j > i && (!t.allocations || t.allocations.length === 0) && ruleMatches(t, rule)) {
        const na = [{ categoryId: rule.categoryId, amountCents: t.amountCents }];
        if (onSaveOne) onSaveOne(t.id, { allocations: na });
        return { ...t, allocations: na };
      }
      return t;
    }));
  };
  const go = (d) => { setSplitting(false); setI((x) => Math.max(0, Math.min(total - 1, x + d))); };
  const ranked = !isSplit ? rankSuggestions(cur, rules, categories, history) : [];
  const dt = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`;
  // Voor inkomende bedragen: openstaande voorschotten waar dit bedrag binnen past (deelaflossing mag).
  const openAdvances = sign > 0 ? transactions.filter((t) => t.advance && t.id !== cur.id && (t.allocations || []).length > 0).map((adv) => ({ adv, remaining: remainingOf(adv, transactions) })).filter((a) => a.remaining > 0).sort((a, b) => Math.abs(a.remaining - Math.abs(cur.amountCents)) - Math.abs(b.remaining - Math.abs(cur.amountCents)) || (a.adv.date < b.adv.date ? -1 : 1)) : [];
  const myLinks = settlementsOf(cur);
  const linkedAdvs = myLinks.map((s) => transactions.find((t) => t.id === s.advanceId)).filter(Boolean);
  const unsettleCur = () => update({ settledWith: undefined, settlements: [], allocations: [] });
  const sameCond = (r, kw) => r.conditions && r.conditions[0] && r.conditions[0].field === "both" && r.conditions[0].operator === "contains" && String(r.conditions[0].value).toLowerCase() === kw;
  const subsOfCat = (catId) => ((categories.find((c) => c.id === catId) || {}).subs) || [];
  const choosePost = (catId) => {
    setSingle(catId);
    if (autoLearn && catId) {
      const kw = (guessKeyword(cur.name) || guessKeyword(cur.omschrijving || cur.description || "") || "").trim().toLowerCase();
      if (kw && !rules.some((r) => sameCond(r, kw) && r.categoryId === catId)) learnRule({ categoryId: catId, priority: 35, conditions: [{ field: "both", operator: "contains", value: kw }] });
    }
    const hasSubs = catId && subsOfCat(catId).length > 0;
    if (autoNext && catId && !hasSubs && i < total - 1) go(1); // bij subposten: eerst de subkeuze, dan pas door
  };
  const chooseSub = (sub) => { update({ allocations: [{ categoryId: singleCat, amountCents: cur.amountCents, sub: sub || undefined }] }); if (autoNext && i < total - 1) go(1); };

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: T.sub }}>Transactie {i + 1} van {total}</span>
        <span style={{ fontSize: 13, color: teSorteren ? T.warn : T.pos }}>{teSorteren} nog toe te kennen</span>
      </div>
      <div style={{ height: 4, background: "#eef2f1", borderRadius: 2, marginBottom: 14 }}><div style={{ height: 4, width: `${((i + 1) / total) * 100}%`, background: T.accent, borderRadius: 2 }} /></div>

      <Card style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{cur.name}</div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{cur.date.slice(8, 10)}-{cur.date.slice(5, 7)}-{cur.date.slice(0, 4)}</span><Badge>{cur.mutationType}</Badge>{cur.iban && <span style={{ fontFamily: T.mono }}>{cur.iban}</span>}</div>
          </div>
          <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 22, color: sign < 0 ? T.neg : T.pos, whiteSpace: "nowrap" }}>{formatEUR(cur.amountCents)}</div>
        </div>
        <div style={{ background: T.accentSoft, border: `1px solid ${T.accent}`, borderRadius: 9, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Omschrijving</div>
          <div style={{ fontSize: 16, color: T.ink, fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>{cur.omschrijving || cur.description || cur.name}</div>
          {cur.description && cur.description !== cur.omschrijving && cur.description !== cur.name && <div style={{ fontSize: 13, color: T.sub, marginTop: 7, lineHeight: 1.45, wordBreak: "break-word" }}><b style={{ color: T.sub }}>Volledige mededelingen: </b>{cur.description}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
          <input value={cur.note || ""} onChange={(e) => update({ note: e.target.value })} placeholder="Eigen omschrijving — vervangt de bank-omschrijving in je overzichten" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Bundel</span>
          <input value={cur.bundle || ""} list="bundel-labels-wiz" onChange={(e) => update({ bundle: e.target.value })} placeholder="bijv. Verjaardag Maud — telt los op bij Uitgaven › Bundels" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
          <datalist id="bundel-labels-wiz">{bundleLabels(transactions).map((b) => <option key={b} value={b} />)}</datalist>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sign < 0 ? 10 : 14, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={!!cur.flagged} onChange={(e) => update({ flagged: e.target.checked })} />
          Markeer als "nog uitzoeken"
        </label>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={!!cur.advance} onChange={(e) => update(e.target.checked ? { advance: true, expectedBackCents: cur.expectedBackCents != null ? cur.expectedBackCents : Math.abs(cur.amountCents) } : { advance: false })} />
            Ik ga hier een tikkie voor sturen — verwacht (deels) terug
          </label>
          {cur.advance && <div style={{ marginTop: 8, marginLeft: 26 }}><ExpectedBackEditor amountCents={cur.amountCents} value={cur.expectedBackCents} onChange={(v) => update({ expectedBackCents: v })} /></div>}
        </div>
        <div style={{ marginBottom: 14 }}><PeriodControl tx={cur} years={years} onChange={(pd) => update({ periodDate: pd })} /></div>

        {sign > 0 && (linkedAdvs.length > 0 || openAdvances.length > 0) && (
          <div style={{ background: "#f3f8f6", border: `1px solid ${T.accent}`, borderRadius: 9, padding: "10px 12px", marginBottom: 14 }}>
            {linkedAdvs.length > 0 ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: T.pos, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>✓ Gekoppeld aan {linkedAdvs.length === 1 ? `tikkie ${linkedAdvs[0].name}` : `${linkedAdvs.length} tikkies`}{unassignedOf(cur) > 0 ? ` · nog ${formatEUR(unassignedOf(cur))} vrij` : ""}</span>
                <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {unassignedOf(cur) > 0 && onOpenTikkies && <button onClick={onOpenTikkies} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>nog koppelen →</button>}
                  <button onClick={unsettleCur} style={{ border: "none", background: "transparent", color: T.sub, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>ontkoppel</button>
                </span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Hoort dit (deels) bij één of meer tikkies die je hebt gestuurd? Koppel het op het tikkiescherm met een vinkje.</div>
                <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Openstaand: {openAdvances.slice(0, 3).map(({ adv, remaining }) => `${adv.name} (${formatEUR(remaining)})`).join(" · ")}{openAdvances.length > 3 ? " · …" : ""}</div>
                {onOpenTikkies && <button onClick={onOpenTikkies} style={{ border: `1px solid ${T.accent}`, background: T.accent, color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>→ Naar tikkiescherm</button>}
                <div style={{ fontSize: 11.5, color: T.sub, marginTop: 8 }}>Hoort het ergens anders bij? Kies hieronder gewoon een post.</div>
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Waar hoort dit bij?</div>
        {isSplit
          ? <div style={{ fontSize: 13, marginBottom: 4 }}>Verdeeld over {allocs.length} posten. <button onClick={() => setSplitting(true)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600 }}>wijzig</button> · <button onClick={() => setSingle("")} style={{ border: "none", background: "transparent", color: T.sub, cursor: "pointer" }}>maak leeg</button></div>
          : <PostPicker key={cur.id} categories={categories} groups={groups} sign={sign} value={singleCat} suggestions={ranked} onChange={choosePost} autoFocus />}
        {sign > 0 && !isSplit && myLinks.length === 0 && openAdvances.length === 0 && <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>Geld terug dat je had voorgeschoten? Kies de <b>uitgavepost</b> waarop je het had geboekt — die post wordt dan per saldo lager.</div>}
        <div style={{ marginTop: 8 }}><VermogenHint tx={cur} categories={categories} /></div>
        {!isSplit && singleCat && subsOfCat(singleCat).length > 0 && (
          <div style={{ marginTop: 10, background: "#fff", border: `1px solid ${T.accent}`, borderRadius: 9, padding: "10px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Stap 2 — kies een subpost van "{(categories.find((c) => c.id === singleCat) || {}).naam}":</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {subsOfCat(singleCat).map((s) => { const on = allocs[0] && allocs[0].sub === s; return (
                <button key={s} onClick={() => chooseSub(on ? "" : s)} style={{ border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accent : "#fff", color: on ? "#fff" : T.ink, borderRadius: 999, padding: "5px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{s}</button>
              ); })}
              <button onClick={() => chooseSub("")} style={{ border: `1px dashed ${T.line}`, background: "#fff", color: T.sub, borderRadius: 999, padding: "5px 13px", fontSize: 13, cursor: "pointer" }}>geen subpost</button>
            </div>
          </div>
        )}
        {splitting && <div style={{ marginTop: 10 }}><SplitEditor tx={cur} categories={categories} groups={groups} onSave={(a) => { update({ allocations: a }); setSplitting(false); }} onCancel={() => setSplitting(false)} /></div>}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, color: T.sub }}>
              <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />
              Snel doorklikken — ga automatisch door na je keuze
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, color: T.sub }}>
              <input type="checkbox" checked={autoLearn} onChange={(e) => setAutoLearn(e.target.checked)} />
              Leer automatisch een regel van mijn keuze <span style={{ color: T.sub, fontSize: 11 }}>(maakt de regels slimmer)</span>
            </label>
          </div>
          {!splitting && !isSplit && <Btn variant="ghost" size="sm" onClick={() => setSplitting(true)}>Verdeel over meerdere posten</Btn>}
        </div>

        {singleCat && !autoLearn && <div style={{ marginTop: 12 }}><RuleLearn tx={cur} categoryId={singleCat} onAddRule={learnRule} /></div>}
        {autoLearn && singleCat && <div style={{ marginTop: 10, fontSize: 12, color: T.pos }}>✓ van deze keuze wordt automatisch een regel gemaakt</div>}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="ghost" onClick={onClose}>Sluiten</Btn>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.pos }}>✓ automatisch opgeslagen</span>
          <Btn variant="secondary" onClick={() => go(-1)} disabled={i === 0}>Vorige</Btn>
          {i < total - 1 ? <Btn onClick={() => go(1)}>Volgende</Btn> : <Btn onClick={onClose}>Klaar</Btn>}
        </div>
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}><button onClick={onClose} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Stoppen en later verder →</button></div>
    </div>
  );
}

/* ===================================================================== APP */
function YearSwitcher({ years, activeYearId, onSelect, onNew }) {
  const sorted = [...years].sort((a, b) => a.jaartal - b.jaartal);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {sorted.map((y) => {
        const on = y.id === activeYearId;
        return (
          <button key={y.id} onClick={() => onSelect(y.id)} style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accentSoft : T.panel, color: on ? T.accent : T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.mono }}>{y.jaartal}</button>
        );
      })}
      <button onClick={onNew} title="Nieuw begrotingsjaar opstellen" style={{ padding: "5px 11px", borderRadius: 8, border: `1px dashed ${T.line}`, background: T.panel, color: T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ jaar</button>
    </div>
  );
}

function NewYearDialog({ years, budgets, categories, transactions, onCreate, onClose }) {
  const maxY = Math.max(...years.map((y) => y.jaartal));
  const [jaartal, setJaartal] = useState(maxY + 1);
  const [basis, setBasis] = useState("copy");
  const exists = years.some((y) => y.jaartal === Number(jaartal));
  const prevBudget = budgetTotals(categories, applySluitpost(categories, budgets[String(maxY)] || {}));
  const prevActuals = txYearActuals(transactions, categories, maxY);
  const prevSpent = prevActuals.reduce((s, a) => s + a.expense, 0);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,24,22,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 16 }}>
      <Card onClick={(e) => e.stopPropagation()} style={{ padding: 24, width: "100%", maxWidth: 470, background: T.panel }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Nieuw begrotingsjaar opstellen</div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, marginBottom: 16 }}>
          De beste aanpak: <b>neem vorig jaar als basis</b> en pas posten aan op wat je werkelijk uitgaf en op bekende veranderingen — een nieuwe verzekering, hogere energie, een kind erbij. De sluitpost houdt het automatisch kloppend.
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, padding: "10px 12px", background: T.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>{maxY} begroot (uit&sparen)</div>
            <Money cents={prevBudget.outflow} bold size={16} />
          </div>
          <div style={{ flex: 1, padding: "10px 12px", background: T.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>{maxY} werkelijk uitgegeven</div>
            <Money cents={prevSpent} bold size={16} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>Welk jaar?</div>
          <input type="number" value={jaartal} onChange={(e) => setJaartal(e.target.value)} style={{ ...inputStyle, width: 140 }} />
          {exists && <div style={{ fontSize: 12, color: T.warn, marginTop: 6 }}>Dat jaar bestaat al — je gaat ernaartoe.</div>}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>Beginpunt</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["copy", `Neem ${maxY} over`], ["empty", "Begin leeg"]].map(([v, lbl]) => {
              const on = basis === v;
              return <button key={v} onClick={() => setBasis(v)} disabled={exists} style={{ flex: 1, padding: "10px", borderRadius: 8, cursor: exists ? "default" : "pointer", fontSize: 13, fontWeight: 600, border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accentSoft : T.panel, color: on ? T.accent : T.sub, opacity: exists ? 0.5 : 1 }}>{lbl}</button>;
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>Annuleren</Btn>
          <Btn onClick={() => onCreate(Number(jaartal), basis)}>{exists ? "Ga naar jaar" : "Jaar aanmaken"}</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ===================================================================== */
/* AUTHENTICATIE, LOGBOEK & WERKRUIMTE                                    */
/* ===================================================================== */

const pwInput = (err) => ({ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, border: `1px solid ${err ? T.neg : T.line}`, borderRadius: 8, outline: "none", marginBottom: 10 });
const pwBtn = (disabled) => ({ flex: 1, padding: "10px 14px", fontSize: 14, fontWeight: 700, border: "none", borderRadius: 8, cursor: disabled ? "default" : "pointer", background: disabled ? "#9ec5c0" : T.accent, color: "#fff" });
function fmtWhen(at) {
  try { return new Date(at).toLocaleString("nl-NL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}
function mergeSeed(state) {
  const seed = buildSeed();
  const cats = [...(state.categories || [])];
  const haveCat = new Set(cats.map((c) => c.id));
  for (const c of seed.categories) if (!haveCat.has(c.id)) cats.push(c);
  const grps = [...(state.groups || [])];
  const haveGrp = new Set(grps.map((g) => g.id));
  for (const g of seed.groups) if (!haveGrp.has(g.id)) grps.push(g);
  // migratie: oud enkel-jaar-model -> jaren-lijst
  let years = state.years, activeYearId = state.activeYearId;
  if (!Array.isArray(years) || !years.length) {
    if (state.year && state.year.id) { years = [state.year]; activeYearId = state.year.id; }
    else { years = seed.years; activeYearId = seed.activeYearId; }
  }
  if (!activeYearId || !years.some((y) => y.id === activeYearId)) activeYearId = years[0].id;
  const merged = { ...seed, ...state, categories: cats, groups: grps, years, activeYearId };
  // repareer transacties: unieke id's + standaardvelden (voor data van vóór deze update)
  const seenTxIds = new Set();
  merged.transactions = (merged.transactions || []).map((t, i) => {
    let id = t.id;
    if (!id || seenTxIds.has(id)) id = "tx-" + (t.hash || "x") + "-" + i;
    seenTxIds.add(id);
    return { ...t, id, allocations: t.allocations || [], note: t.note || "", flagged: !!t.flagged };
  });
  delete merged.year;
  // vul ontbrekende potten aan (bv. nieuwe Aandelenrekening), alleen voor bestaande categorieën
  const pots = [...(merged.pots || [])];
  const havePot = new Set(pots.map((p) => p.categoryId));
  for (const p of seed.pots) if (!havePot.has(p.categoryId) && cats.some((c) => c.id === p.categoryId)) pots.push(p);
  merged.pots = pots;
  // taken (telefoon: "kijk hier even naar") — additief veld; bestaande data blijft onaangetast
  merged.tasks = Array.isArray(merged.tasks) ? merged.tasks : [];
  // vul ontbrekende seed-begrotingsregels aan in bestaande jaren (bv. €300/maand aandelenrekening), daarna opnieuw sluitend maken
  const budgets = { ...(merged.budgets || {}) };
  for (const [yid, seedLines] of Object.entries(seed.budgets)) {
    if (!budgets[yid]) continue;
    let yl = { ...budgets[yid] }, changed = false;
    for (const [cidKey, line] of Object.entries(seedLines)) {
      if (cidKey === SLUITPOST_ID) continue;
      if (!(cidKey in yl)) { yl[cidKey] = line; changed = true; }
    }
    if (changed) budgets[yid] = applySluitpost(cats, yl);
  }
  merged.budgets = budgets;
  // vul ontbrekende Oranje-spaarrekeningcodes aan vanuit de seed (overschrijft eigen ingevulde codes niet)
  for (const c of merged.categories) { if (!c.spaarcode) { const sc = seed.categories.find((x) => x.id === c.id); if (sc && sc.spaarcode) c.spaarcode = sc.spaarcode; } }
  if (merged.openingBalanceCents === undefined) merged.openingBalanceCents = null;
  if (merged.reviewedBatches === undefined) merged.reviewedBatches = [];
  return merged;
}

/* ----------------------------------------------------------- Activiteit */
function DataBackup({ dbReady, onExport, onImport, onRestoreSnapshot }) {
  const fileRef = useRef(null);
  const [snaps, setSnaps] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadSnaps = () => { setBusy(true); getSnapshots().then((r) => setSnaps(r.snapshots || [])).catch(() => setSnaps([])).finally(() => setBusy(false)); };
  const restore = async (id) => {
    if (!confirm("Deze versie terugzetten? De huidige gegevens worden vervangen (je kunt daarna weer een eerdere versie kiezen).")) return;
    try { const r = await getSnapshot(id); if (r && r.state && onRestoreSnapshot) onRestoreSnapshot(r.state); } catch { alert("Kon deze versie niet ophalen."); }
  };
  return (
    <Card style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Gegevens &amp; backup</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Download af en toe een backup als extra zekerheid naast de database. Een backup bevat je volledige huishoudboekje (begroting, transacties, regels, vermogen) en kun je later weer terugzetten.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Btn size="sm" onClick={onExport}>⬇ Backup downloaden</Btn>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { onImport(e.target.files[0]); e.target.value = ""; }} />
        <Btn size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()}>⬆ Backup terugzetten</Btn>
        {dbReady && <Btn size="sm" variant="ghost" onClick={loadSnaps}>{snaps == null ? "Herstelpunten tonen" : "Vernieuwen"}</Btn>}
      </div>
      {dbReady && snaps != null && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Automatische herstelpunten <span style={{ fontWeight: 400 }}>· de laatste 40 opgeslagen versies</span></div>
          {busy && <div style={{ fontSize: 12.5, color: T.sub }}>Laden…</div>}
          {!busy && snaps.length === 0 && <div style={{ fontSize: 12.5, color: T.sub }}>Nog geen herstelpunten.</div>}
          {!busy && snaps.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, padding: "5px 0", borderTop: `1px solid ${T.line}` }}>
              <span>{fmtWhen(s.at)} <span style={{ color: T.sub }}>· {s.updatedBy || "onbekend"} · v{s.rev}</span></span>
              <Btn size="sm" variant="secondary" onClick={() => restore(s.id)}>Terugzetten</Btn>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
function Activiteit() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let on = true;
    getActivity().then((r) => on && setItems(r.activity || [])).catch(() => on && setItems([]));
    return () => { on = false; };
  }, []);
  return (
    <div>
      <SectionTitle>Activiteit</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Hier zie je wie wat heeft gedaan: inloggen, importeren, de begroting en regels aanpassen, en wachtwoordwijzigingen.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        {items === null && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Bezig met laden…</div>}
        {items && items.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen activiteit vastgelegd.</div>}
        {items && items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 130px", gap: 10, alignItems: "center", padding: "10px 16px", borderTop: i ? `1px solid ${T.line}` : "none" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{it.displayName}</span>
            <span style={{ fontSize: 13 }}>{it.action}</span>
            <span style={{ fontSize: 12, color: T.sub, textAlign: "right", fontFamily: T.mono }}>{fmtWhen(it.at)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ------------------------------------------------ Wachtwoord wijzigen */
function ChangePasswordCard({ displayName, forced, onDone, onCancel }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw1.length < 8) { setErr("Kies minstens 8 tekens."); return; }
    if (pw1 !== pw2) { setErr("De twee wachtwoorden zijn niet gelijk."); return; }
    setBusy(true); setErr("");
    try { await apiChangePassword(pw1); onDone(); }
    catch { setErr("Wijzigen mislukt, probeer het opnieuw."); setBusy(false); }
  };
  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{forced ? `Welkom, ${displayName}` : "Wachtwoord wijzigen"}</div>
      <div style={{ fontSize: 13, color: T.sub, marginBottom: 16 }}>{forced ? "Kies bij de eerste keer inloggen een eigen, nieuw wachtwoord (minstens 8 tekens)." : "Kies een nieuw wachtwoord (minstens 8 tekens)."}</div>
      <input type="password" autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Nieuw wachtwoord" style={pwInput(false)} />
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Herhaal nieuw wachtwoord" style={pwInput(false)} />
      {err && <div style={{ fontSize: 12, color: T.neg, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={busy} style={pwBtn(busy)}>{busy ? "Bezig…" : "Opslaan"}</button>
        {!forced && <button onClick={onCancel} style={{ ...pwBtn(false), background: T.panel, color: T.sub, border: `1px solid ${T.line}` }}>Annuleren</button>}
      </div>
    </div>
  );
}
function ChangePasswordScreen({ user, onDone }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, color: T.ink, padding: 16 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <ChangePasswordCard displayName={user.displayName} forced onDone={onDone} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Inlogscherm */
function LoginScreen({ onSuccess }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getUsers().then((r) => { setUsers(r.users || []); if (r.users && r.users[0]) setUsername(r.users[0].username); }).catch(() => {});
  }, []);
  const submit = async () => {
    if (!username || !pw) return;
    setBusy(true); setErr("");
    try { const r = await apiLogin(username, pw); onSuccess(r); }
    catch { setErr("Onjuiste gebruiker of wachtwoord."); setBusy(false); }
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, color: T.ink, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 380, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>€</div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Huishoudboekje</div>
        </div>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 10 }}>Wie ben je?</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {users.map((u) => (
            <button key={u.username} onClick={() => { setUsername(u.username); setErr(""); }} style={{ flex: 1, padding: "10px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, border: `1px solid ${username === u.username ? T.accent : T.line}`, background: username === u.username ? T.accentSoft : T.panel, color: username === u.username ? T.accent : T.sub }}>{u.displayName}</button>
          ))}
        </div>
        <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Wachtwoord" style={pwInput(!!err)} />
        {err && <div style={{ fontSize: 12, color: T.neg, marginBottom: 10 }}>{err}</div>}
        <button onClick={submit} disabled={busy || !pw || !username} style={pwBtn(busy || !pw || !username)}>{busy ? "Bezig…" : "Inloggen"}</button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Werkruimte */
// ---- Mobiel startscherm: drie grote acties (verwerken · bonnetje · taak) + taken en saldo ----
function MobileHome({ user, otherName, bankNow, teSorteren, transactions, tasks, attachCounts, onAttachChanged, onStartReview, onAddTask, onToggleTask, onRemoveTask, onOpenTx }) {
  const [mode, setMode] = useState(null); // null | "bijlage" | "taak"
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState(null);
  const recent = useMemo(() => {
    const list = transactions.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const filtered = q ? list.filter((t) => `${t.name} ${t.description || ""}`.toLowerCase().includes(q.toLowerCase())) : list;
    return filtered.slice(0, 30);
  }, [transactions, q]);
  const picked = recent.find((t) => t.id === pickedId) || transactions.find((t) => t.id === pickedId) || null;
  const openForMe = tasks.filter((t) => !t.done && t.to === user.username);
  const openByMe = tasks.filter((t) => !t.done && t.from === user.username);
  const txById = (id) => transactions.find((t) => t.id === id);
  const closePicker = () => { setMode(null); setPickedId(null); setQ(""); };
  const actionCard = (emoji, title, sub, onClick, badge) => (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", border: `1px solid ${T.line}`, background: T.panel, borderRadius: 14, padding: "16px 16px", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15.5, fontWeight: 800, color: T.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: T.sub, marginTop: 2 }}>{sub}</span>
      </span>
      {badge > 0 && <span style={{ fontSize: 12, fontWeight: 800, minWidth: 24, textAlign: "center", padding: "3px 8px", borderRadius: 999, background: T.warn, color: "#fff" }}>{badge}</span>}
      <span style={{ color: T.sub }}>›</span>
    </button>
  );
  const txRowBtn = (t) => (
    <button key={t.id} onClick={() => setPickedId(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: "none", borderTop: `1px solid ${T.line}`, background: pickedId === t.id ? T.accentSoft : "transparent", padding: "10px 6px", cursor: "pointer" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
        <span style={{ display: "block", fontSize: 11, color: T.sub }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)}{attachCounts && attachCounts[t.id] ? ` · 📎 ${attachCounts[t.id]}` : ""}</span>
      </span>
      <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: t.amountCents < 0 ? T.neg : T.pos, flexShrink: 0 }}>{t.amountCents < 0 ? "−" : "+"} {formatEUR(Math.abs(t.amountCents))}</span>
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: T.sub }}>Huidig saldo betaalrekening</span>
        <Money cents={bankNow} sign bold size={20} />
      </Card>
      {actionCard("✓", "Transacties verwerken", teSorteren > 0 ? "loop de nieuwe transacties één voor één na" : "alles is verwerkt — niets te doen", () => onStartReview(), teSorteren)}
      {actionCard("📎", "Bonnetje of factuur koppelen", "kies een transactie en voeg een foto of PDF toe", () => { setMode(mode === "bijlage" ? null : "bijlage"); setPickedId(null); }, 0)}
      {actionCard("👤", `Taak voor ${otherName}`, "\u201ckijk hier even naar\u201d bij een transactie", () => { setMode(mode === "taak" ? null : "taak"); setPickedId(null); }, openForMe.length)}
      {mode && (
        <Card style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{mode === "bijlage" ? "Kies de transactie voor de bijlage" : `Kies de transactie voor ${otherName}`}</div>
            <Btn size="sm" variant="ghost" onClick={closePicker}>×</Btn>
          </div>
          <input value={q} onChange={(e) => { setQ(e.target.value); setPickedId(null); }} placeholder="zoek op naam of mededeling" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, marginBottom: 4 }} />
          <div style={{ maxHeight: 300, overflowY: "auto" }}>{recent.map(txRowBtn)}</div>
          {picked && mode === "bijlage" && <Bijlagen tx={picked} onChanged={onAttachChanged} />}
          {picked && mode === "taak" && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
              <MobileTaakForm otherName={otherName} onSubmit={(note) => { onAddTask(picked.id, note); closePicker(); }} />
            </div>
          )}
        </Card>
      )}
      {(openForMe.length > 0 || openByMe.length > 0) && (
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Taken</div>
          {openForMe.map((t) => {
            const tx = txById(t.txId);
            return (
              <div key={t.id} style={{ padding: "9px 0", borderTop: `1px solid ${T.line}` }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tx ? tx.name : "transactie"}{tx ? ` · ${tx.amountCents < 0 ? "−" : "+"} ${formatEUR(Math.abs(tx.amountCents))}` : ""}</div>
                {t.note && <div style={{ fontSize: 12.5, color: T.sub, marginTop: 2 }}>“{t.note}”</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                  <Btn size="sm" onClick={() => onToggleTask(t.id)}>✓ Afgehandeld</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => onOpenTx(t.txId)}>Openen</Btn>
                </div>
              </div>
            );
          })}
          {openByMe.map((t) => {
            const tx = txById(t.txId);
            return (
              <div key={t.id} style={{ padding: "9px 0", borderTop: `1px solid ${T.line}` }}>
                <div style={{ fontSize: 12.5, color: T.sub }}>Klaargezet voor {otherName}: <b style={{ color: T.ink }}>{tx ? tx.name : "transactie"}</b>{t.note ? ` — \u201c${t.note}\u201d` : ""}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Btn size="sm" variant="ghost" onClick={() => onRemoveTask(t.id)}>× intrekken</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => onOpenTx(t.txId)}>openen</Btn>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
function MobileTaakForm({ otherName, onSubmit }) {
  const [note, setNote] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="korte toelichting (optioneel)" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14 }} />
      <Btn onClick={() => onSubmit(note.trim())}>Klaarzetten voor {otherName}</Btn>
    </div>
  );
}
function Workspace({ state, setState, dbReady, user, meta, onLogout, conflict, saveError = false, onTakeServer, onKeepMine, onRestore }) {
  const { groups, categories, years, activeYearId, budgets, pots, rules, transactions } = state;
  const openingBalanceCents = state.openingBalanceCents ?? null;
  const reviewedBatches = state.reviewedBatches || [];
  const markBatchReviewed = (id) => { setState((s) => ({ ...s, reviewedBatches: (s.reviewedBatches || []).includes(id) ? s.reviewedBatches : [...(s.reviewedBatches || []), id] })); };
  const [tab, setTab] = useState("overzicht");
  const [showChangePw, setShowChangePw] = useState(false);
  const [showNewYear, setShowNewYear] = useState(false);
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (typeof window !== "undefined" && window.innerWidth < 760) setTab("mhome"); }, []);
  const [txPreset, setTxPreset] = useState(null); // doorklik vanaf het dashboard: { maand?, categoryId? }
  const gotoTransacties = useCallback((preset) => { setTxPreset(preset || null); setTab("transacties"); }, []);
  // Wie is "de ander" (voor taken)?
  const OTHER = { frank: { username: "kimberley", name: "Kimberley" }, kimberley: { username: "frank", name: "Frank" } };
  const other = OTHER[user.username] || { username: "", name: "de ander" };
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const addTask = useCallback((txId, note) => { setState((s) => ({ ...s, tasks: [...(Array.isArray(s.tasks) ? s.tasks : []), { id: "task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), txId, from: user.username, to: (OTHER[user.username] || {}).username || "", note: note || "", createdAt: new Date().toISOString(), done: false }] })); logAction("taak klaargezet"); }, [user.username]);
  const toggleTask = useCallback((id) => { setState((s) => ({ ...s, tasks: (Array.isArray(s.tasks) ? s.tasks : []).map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: !t.done ? new Date().toISOString() : null } : t)) })); }, []);
  const removeTask = useCallback((id) => { setState((s) => ({ ...s, tasks: (Array.isArray(s.tasks) ? s.tasks : []).filter((t) => t.id !== id) })); }, []);
  // Bijlage-tellingen (📎-badges); losse opslag, hier alleen aantallen ophalen
  const [attachCounts, setAttachCounts] = useState({});
  const refreshAttachCounts = useCallback(() => { attachmentCounts().then((r) => setAttachCounts(r.counts || {})).catch(() => {}); }, []);
  useEffect(() => { refreshAttachCounts(); }, [refreshAttachCounts]);

  const year = years.find((y) => y.id === activeYearId) || years[0];
  const catById = useCallback((id) => categories.find((c) => c.id === id), [categories]);

  const derived = useMemo(() => {
    const lines = applySluitpost(categories, budgets[year.id] || {});
    const budgetNet = Array.from({ length: 12 }, () => 0);
    for (const c of categories) {
      const line = lines[c.id], months = line ? line.months : null;
      if (months) for (let m = 0; m < 12; m++) budgetNet[m] += c.type === "income" ? months[m] : -months[m];
    }

    const yearTx = transactions.filter((t) => effYear(t) === year.jaartal);
    const actuals = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    let currentMonth = 1;
    for (const t of yearTx) {
      const m = effMonth(t); currentMonth = Math.max(currentMonth, m);
      for (const a of t.allocations) {
        const cat = catById(a.categoryId);
        if (cat?.type === "income") actuals[m - 1].income += a.amountCents;
        else actuals[m - 1].expense += -a.amountCents;
      }
    }
    const monthRows = computeRunningSaldo(year.carryInCents, actuals);
    const deviation = computeBudgetDeviation(actuals.map((a) => a.income - a.expense), budgetNet);

    // Spaarbuffer-bewegingen per maand: geld dat naar een spaarrekening ging (storting) of eruit
    // kwam (opname/buffer). Zowel direct op een spaarpost geboekt als afgeleid uit de mededelingen.
    const savingsIdSet = new Set(categories.filter((c) => c.type === "savings").map((c) => c.id));
    const savingsMove = Array.from({ length: 12 }, () => ({ toSavings: 0, fromSavings: 0 }));
    for (const t of yearTx) {
      const m = effMonth(t) - 1;
      let handled = false;
      for (const a of t.allocations) {
        if (savingsIdSet.has(a.categoryId)) {
          handled = true;
          if (a.amountCents < 0) savingsMove[m].toSavings += -a.amountCents;
          else savingsMove[m].fromSavings += a.amountCents;
        }
      }
      if (!handled) {
        const d = derivedPotMutation(t, categories);
        if (d) {
          if (d.amountCents < 0) savingsMove[m].toSavings += -d.amountCents;
          else savingsMove[m].fromSavings += d.amountCents;
        }
      }
    }
    // Per maand een compact resultaat-object voor het dashboard.
    const monthly = actuals.map((a, m) => ({
      income: a.income,
      expense: a.expense,
      net: a.income - a.expense,
      budgetNet: budgetNet[m],
      toSavings: savingsMove[m].toSavings,
      fromSavings: savingsMove[m].fromSavings,
    }));
    // Top-uitgavenposten per maand: voor de doorklik en het maandinzicht op het dashboard.
    const spendPerMonthCat = Array.from({ length: 12 }, () => new Map());
    for (const t of yearTx) {
      const m = effMonth(t) - 1;
      for (const a of t.allocations) {
        const c = catById(a.categoryId);
        if (!c || c.type !== "expense") continue;
        spendPerMonthCat[m].set(a.categoryId, (spendPerMonthCat[m].get(a.categoryId) || 0) + (-a.amountCents));
      }
    }
    const topPostsByMonth = spendPerMonthCat.map((mp) => [...mp.entries()]
      .map(([id, cents]) => ({ id, naam: (catById(id) || { naam: id }).naam.split(":")[0], cents }))
      .filter((x) => x.cents > 0).sort((a, b) => b.cents - a.cents).slice(0, 6));

    const potFlowMap = potFlows(transactions, categories);
    const vermogen = categories.filter((c) => c.type === "savings").reduce((sum, c) => {
      const pot = pots.find((p) => p.categoryId === c.id);
      const f = potFlowMap.get(c.id) || { dep: 0, wd: 0 };
      return sum + (pot ? pot.opening : 0) + f.dep - f.wd;
    }, 0);

    const vitals = { saldo: monthRows[currentMonth - 1].end, deviation: deviation[currentMonth - 1], vermogen, potCount: categories.filter((c) => c.type === "savings").length };

    const accountBalance = (openingBalanceCents || 0) + transactions.reduce((s, t) => s + t.amountCents, 0);
    let budOut = 0, budInc = 0;
    for (const c of categories) { const line = lines[c.id]; if (!line) continue; const m = line.months[currentMonth - 1] || 0; if (c.type === "income") budInc += m; else budOut += m; }
    const remainingOut = Math.max(0, budOut - actuals[currentMonth - 1].expense);
    const remainingInc = Math.max(0, budInc - actuals[currentMonth - 1].income);
    const forecast = { month: currentMonth, accountBalance, remainingOut, remainingInc, projectedEnd: accountBalance + remainingInc - remainingOut, openingSet: openingBalanceCents != null };

    // Grootste afwijkingen t.o.v. begroting (t/m huidige maand)
    const devs = [];
    for (const c of categories) {
      if (c.type !== "expense") continue;
      const line = lines[c.id];
      let actual = 0;
      for (const t of yearTx) { if (effMonth(t) > currentMonth) continue; for (const a of t.allocations) if (a.categoryId === c.id) actual += -a.amountCents; }
      const budgetYTD = line ? sumMonths(line.months.slice(0, currentMonth)) : 0;
      if (budgetYTD === 0 && actual === 0) continue;
      devs.push({ id: c.id, naam: c.naam.split(":")[0], actual, budget: budgetYTD, dev: actual - budgetYTD });
    }
    const topDeviations = devs.slice().sort((a, b) => b.dev - a.dev).slice(0, 5);

    // Vaste lasten deze maand: maandelijkse posten (freq ≥ 11×/jaar) die deze maand nog niet geboekt zijn
    const seenThisMonth = new Set();
    for (const t of yearTx) if (effMonth(t) === currentMonth) for (const a of t.allocations) seenThisMonth.add(a.categoryId);
    const recurringPosts = categories.filter((c) => (c.type === "expense" || c.type === "savings") && c.freqPerYear && c.freqPerYear >= 11);
    const missingRecurring = recurringPosts.filter((c) => !seenThisMonth.has(c.id)).map((c) => ({ id: c.id, naam: c.naam.split(":")[0], avg: lines[c.id] ? (lines[c.id].months[currentMonth - 1] || 0) : 0 }));
    const recurringTotal = recurringPosts.length;
    const recurringPaid = recurringTotal - missingRecurring.length;

    // Besparingsratio deze maand op basis van het huishoud-resultaat (zonder spaarbuffer-mutaties):
    // hoeveel van je inkomsten hield je over, los van geld dat je enkel naar/uit je spaarbuffer schoof.
    const mInc = actuals[currentMonth - 1].income, mExp = actuals[currentMonth - 1].expense;
    const mNetSpaar = savingsMove[currentMonth - 1].toSavings - savingsMove[currentMonth - 1].fromSavings;
    const mReal = (mInc - mExp) + mNetSpaar; // resultaat exclusief spaarmutaties
    const savingsRate = { income: mInc, saved: mReal, rate: mInc > 0 ? mReal / mInc : null };

    const existingHashes = new Map();
    for (const t of transactions) existingHashes.set(t.hash, (existingHashes.get(t.hash) || 0) + 1);

    const bankBalanceCents = bankBalanceFromTxns(transactions);
    const saldoGaps = saldoChainGaps(transactions);
    const chainOpening = openingFromChain(transactions);

    const freqAlerts = [];
    { const cnt = {};
      for (const t of yearTx) { const seen = new Set(); for (const a of t.allocations) { if (seen.has(a.categoryId)) continue; seen.add(a.categoryId); cnt[a.categoryId] = (cnt[a.categoryId] || 0) + 1; } }
      for (const c of categories) { if (c.freqPerYear && cnt[c.id] && cnt[c.id] > c.freqPerYear) freqAlerts.push({ id: c.id, naam: c.naam, count: cnt[c.id], max: c.freqPerYear }); }
    }

    // Vaste vs. variabele lasten (maandbedragen uit de begroting)
    let vastMonthly = 0, varMonthly = 0;
    for (const c of categories) {
      if (c.type !== "expense") continue;
      const line = lines[c.id]; if (!line) continue;
      if (c.vast) vastMonthly += line.average; else varMonthly += line.average;
    }

    // ---- Jaareinde-prognose ----
    // Werkelijk netto t/m huidige maand + begroot netto voor de resterende maanden,
    // gecorrigeerd met het gemiddelde afwijkingspatroon per maand tot nu toe.
    const actualNetYTD = actuals.slice(0, currentMonth).reduce((s, a) => s + a.income - a.expense, 0);
    const budgetNetYTD = budgetNet.slice(0, currentMonth).reduce((s, v) => s + v, 0);
    const budgetNetRest = budgetNet.slice(currentMonth).reduce((s, v) => s + v, 0);
    const ytdBias = currentMonth > 0 ? (actualNetYTD - budgetNetYTD) / currentMonth : 0; // gem. afwijking/maand
    const monthsRest = 12 - currentMonth;
    const projectedYearEnd = year.carryInCents + actualNetYTD + budgetNetRest + Math.round(ytdBias * monthsRest);
    // Per post: op dit tempo raakt het jaarbudget eerder op?
    const budgetRunout = [];
    for (const c of categories) {
      if (c.type !== "expense") continue;
      const line = lines[c.id]; if (!line) continue;
      const yearBudget = sumMonths(line.months);
      if (yearBudget <= 0) continue;
      let spent = 0;
      for (const t of yearTx) { if (effMonth(t) > currentMonth) continue; for (const a of t.allocations) if (a.categoryId === c.id) spent += -a.amountCents; }
      const perMonth = currentMonth > 0 ? spent / currentMonth : 0;
      if (perMonth <= 0) continue;
      const monthsToRunout = yearBudget / perMonth;
      if (monthsToRunout < 12 && spent > 0) budgetRunout.push({ id: c.id, naam: c.naam.split(":")[0], spent, yearBudget, runoutMonth: Math.ceil(monthsToRunout), pace: Math.round((perMonth * 12 / yearBudget) * 100) });
    }
    budgetRunout.sort((a, b) => a.runoutMonth - b.runoutMonth);
    const forecastYear = { projectedYearEnd, carryIn: year.carryInCents, actualNetYTD, budgetNetRest, bias: ytdBias, monthsRest, budgetRunout: budgetRunout.slice(0, 6) };

    // ---- Maandafletter-status ----
    // Per maand: is er banksaldo-informatie én sluit de saldoketen? "Kloppend t/m maand X".
    const monthsWithData = new Set(yearTx.map((t) => effMonth(t)));
    let reconciledThrough = 0;
    for (let m = 1; m <= currentMonth; m++) { if (monthsWithData.has(m)) reconciledThrough = m; else break; }
    const reconciliation = { through: saldoGaps === 0 ? reconciledThrough : 0, gaps: saldoGaps, currentMonth };

    // ---- Voorschot-ouderdom (tikkies die te lang openstaan) ----
    const today = new Date();
    const agingAdvances = [];
    for (const t of transactions) {
      if (!t.advance) continue;
      const remaining = remainingOf(t, transactions);
      if (remaining <= 0) continue;
      const d = new Date(effDate(t));
      const days = isNaN(d) ? 0 : Math.floor((today - d) / 86400000);
      agingAdvances.push({ id: t.id, name: t.name || "voorschot", date: effDate(t), remaining, days });
    }
    agingAdvances.sort((a, b) => b.days - a.days);

    return { monthRows, monthly, topPostsByMonth, vitals, currentMonth, existingHashes, accountBalance, forecast, forecastYear, reconciliation, agingAdvances, bankBalanceCents, saldoGaps, chainOpening, freqAlerts, topDeviations, missingRecurring, recurringTotal, recurringPaid, savingsRate, vastMonthly, varMonthly };
  }, [budgets, year, categories, transactions, pots, catById, openingBalanceCents]);

  const prevYear = years.find((y) => y.jaartal === year.jaartal - 1) || null;
  const prevActualByCat = useMemo(() => {
    if (!prevYear) return null;
    const map = {};
    for (const t of transactions) {
      if (effYear(t) !== prevYear.jaartal) continue;
      for (const a of t.allocations) { if (!map[a.categoryId]) map[a.categoryId] = 0; map[a.categoryId] += a.amountCents; }
    }
    return map;
  }, [transactions, prevYear]);

  const openActions = useMemo(() => {
    const items = [];
    for (const t of transactions) {
      const uncategorized = !t.allocations || t.allocations.length === 0;
      if (uncategorized) items.push({ ...t, reason: "toe te kennen" });
      else if (t.flagged) items.push({ ...t, reason: "gemarkeerd" });
    }
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { teSorteren: items.filter((i) => i.reason === "toe te kennen").length, gemarkeerd: items.filter((i) => i.reason === "gemarkeerd").length, count: items.length, items };
  }, [transactions]);

  const saveLine = (catId, average, months) => setState((s) => {
    const yid = s.activeYearId;
    const lines = { ...(s.budgets[yid] || {}), [catId]: { average, months } };
    return { ...s, budgets: { ...s.budgets, [yid]: applySluitpost(s.categories, lines) } };
  });
  const onImportBudget = (updates) => {
    setState((s) => {
      const yid = s.activeYearId;
      const lines = { ...(s.budgets[yid] || {}) };
      for (const [catId, avg] of Object.entries(updates)) lines[catId] = { average: avg, months: distributeEven(avg) };
      return { ...s, budgets: { ...s.budgets, [yid]: applySluitpost(s.categories, lines) } };
    });
    logAction(`begroting bijgewerkt via bestand: ${Object.keys(updates).length} post(en)`);
  };
  const onAddDefaults = () => {
    setState((s) => {
      const seedRules = buildSeed().rules;
      const exists = (sr) => s.rules.some((x) => x.categoryId === sr.categoryId && x.conditions[0]?.field === sr.conditions[0]?.field && x.conditions[0]?.value === sr.conditions[0]?.value);
      const toAdd = seedRules.filter((sr) => !exists(sr)).map((sr) => ({ ...sr, id: "rs" + Math.random().toString(36).slice(2, 8) }));
      return { ...s, rules: [...s.rules, ...toAdd] };
    });
    logAction("standaardregels toegevoegd");
  };
  const toggleNote = (id) => {
    setState((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, noteSuggested: !c.noteSuggested } : c)) }));
    const c = categories.find((x) => x.id === id); logAction(`post-instelling gewijzigd: ${(c || {}).naam || id}`);
  };
  const addCategory = (groupId, naam, type, amountCents = 0) => {
    setState((s) => {
      const base = slug(naam) || "post"; let id = base, i = 2;
      while (s.categories.some((c) => c.id === id)) id = base + "-" + i++;
      const nieuw = { id, naam, groupId, type, noteSuggested: false };
      const augmented = [...s.categories, nieuw];
      const next = { ...s, categories: augmented };
      if (type === "savings" && !(s.pots || []).some((p) => p.categoryId === id)) next.pots = [...(s.pots || []), { categoryId: id, opening: 0 }];
      if (amountCents && amountCents !== 0) {
        const yid = s.activeYearId;
        const lines = { ...(s.budgets[yid] || {}), [id]: { average: amountCents, months: distributeEven(amountCents) } };
        next.budgets = { ...s.budgets, [yid]: applySluitpost(augmented, lines) };
      }
      return next;
    });
    logAction(`post toegevoegd: ${naam}`);
  };
  const addGroup = (naam) => {
    setState((s) => {
      const base = slug(naam) || "subcategorie"; let id = base, i = 2;
      while ((s.groups || []).some((g) => g.id === id)) id = base + "-" + i++;
      return { ...s, groups: [...s.groups, { id, naam, volgorde: s.groups.length }] };
    });
    logAction(`subcategorie toegevoegd: ${naam}`);
  };
  const setPotOpening = (categoryId, cents) => {
    setState((s) => {
      const pots = s.pots || [];
      const next = pots.some((p) => p.categoryId === categoryId) ? pots.map((p) => (p.categoryId === categoryId ? { ...p, opening: cents } : p)) : [...pots, { categoryId, opening: cents }];
      return { ...s, pots: next };
    });
  };
  const setPotTarget = (categoryId, cents) => {
    setState((s) => {
      const pots = s.pots || [];
      const next = pots.some((p) => p.categoryId === categoryId) ? pots.map((p) => (p.categoryId === categoryId ? { ...p, target: cents } : p)) : [...pots, { categoryId, opening: 0, target: cents }];
      return { ...s, pots: next };
    });
  };
  const acceptSluitpost = (cents) => { setState((s) => ({ ...s, years: s.years.map((y) => (y.id === s.activeYearId ? { ...y, sluitpostAcceptedCents: cents } : y)) })); logAction("sluitpost geaccepteerd"); };
  const linkSavingsCode = (categoryId, code) => {
    const codeUp = String(code).trim().toUpperCase();
    // Alleen de code vastleggen. Bestaande boekingen blijven onaangetast: het Vermogen-tabblad
    // rekent mutaties met deze code vanzelf (afgeleid) aan de rekening toe.
    setState((s) => ({ ...s, categories: s.categories.map((c) => (c.id === categoryId ? { ...c, spaarcode: codeUp } : c)) }));
    logAction("spaarcode aan bestaande rekening gekoppeld");
  };
  const createSavingsAccount = (code, naam) => {
    const codeUp = String(code).trim().toUpperCase();
    setState((s) => {
      const groupId = (s.categories.find((c) => c.type === "savings") || {}).groupId || slug("Sparen & reserveringen");
      const cleanName = (naam || "").trim() || `Spaarrekening ${codeUp}`;
      const base = slug(cleanName) || "spaarrekening"; let id = base, i = 2;
      while (s.categories.some((c) => c.id === id)) id = base + "-" + i++;
      const nieuw = { id, naam: cleanName, groupId, type: "savings", spaarcode: codeUp, noteSuggested: false };
      const pots = s.pots.some((p) => p.categoryId === id) ? s.pots : [...s.pots, { categoryId: id, opening: 0 }];
      // Boekingen blijven onaangetast: mutaties met deze code worden vanaf nu afgeleid toegerekend.
      return { ...s, categories: [...s.categories, nieuw], pots };
    });
    logAction("spaarrekening aangemaakt en gekoppeld");
  };
  const setYtdSeed = (yearId, catId, cents) => { setState((s) => ({ ...s, years: s.years.map((y) => (y.id === yearId ? { ...y, ytdSeed: { ...(y.ytdSeed || {}), [catId]: cents } } : y)) })); logAction("stand t/m heden bijgewerkt"); };
  const setOpeningBalance = (cents) => { setState((s) => ({ ...s, openingBalanceCents: cents })); logAction("startsaldo ingesteld"); };
  const updateCategory = (id, patch) => setState((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setSubBudget = (catId, sub, cents) => setState((s) => ({ ...s, categories: s.categories.map((c) => {
    if (c.id !== catId) return c;
    const sb = { ...(c.subBudgets || {}) };
    if (cents > 0) sb[sub] = cents; else delete sb[sub];
    return { ...c, subBudgets: sb };
  }) }));
  const deleteCategory = (id) => {
    if (id === SLUITPOST_ID) return;
    setState((s) => {
      const remaining = s.categories.filter((c) => c.id !== id);
      const nb = {};
      for (const [yid, lines] of Object.entries(s.budgets)) { const nl = { ...lines }; delete nl[id]; nb[yid] = applySluitpost(remaining, nl); }
      return { ...s, categories: remaining, budgets: nb };
    });
    const c = categories.find((x) => x.id === id); logAction(`post verwijderd: ${(c || {}).naam || id}`);
  };
  const toggleRule = (id) => { setState((s) => ({ ...s, rules: s.rules.map((x) => (x.id === id ? { ...x, active: !x.active } : x)) })); logAction("regel aan-/uitgezet"); };
  const deleteRule = (id) => { setState((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== id) })); logAction("regel verwijderd"); };
  const updateRule = (id, patch) => setState((s) => ({ ...s, rules: s.rules.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const ruleSig = (r) => { const c = (r.conditions && r.conditions[0]) || {}; return `${r.categoryId}|${c.field}|${c.operator}|${String(c.value || "").toLowerCase()}|${c.amount ?? ""}|${c.min ?? ""}|${c.max ?? ""}`; };
  const addRule = (rule) => { setState((s) => { const sig = ruleSig(rule); if (s.rules.some((x) => ruleSig(x) === sig)) return s; return { ...s, rules: [...s.rules, { ...rule, id: "ru" + Math.random().toString(36).slice(2, 8), active: true }] }; }); logAction("regel toegevoegd"); };
  const bulkDeleteRules = (ids) => { const set = new Set(ids); setState((s) => ({ ...s, rules: s.rules.filter((x) => !set.has(x.id)) })); logAction("regels opgeschoond"); };
  const setTxAllocations = (txId, allocations) => { setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, allocations } : t)) })); logAction(allocations.length === 0 ? "transactie op 'toe te kennen' gezet" : allocations.length > 1 ? "transactie over meerdere posten verdeeld" : "transactie ingedeeld"); };
  const setTxNote = (txId, note) => setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, note } : t)) }));
  const toggleTxFlag = (txId) => setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, flagged: !t.flagged } : t)) }));
  const clearYearTransactions = () => { setState((s) => ({ ...s, transactions: s.transactions.filter((t) => effYear(t) !== year.jaartal) })); logAction(`alle transacties van ${year.jaartal} gewist`); };
  const clearTransactionsInRange = (fromKey, toKey) => { setState((s) => ({ ...s, transactions: s.transactions.filter((t) => { const k = effYear(t) * 100 + effMonth(t); return k < fromKey || k > toKey; }) })); logAction("transacties van een periode gewist"); };
  const clearAllTransactions = () => { setState((s) => ({ ...s, transactions: [] })); logAction("alle transacties gewist"); };
  const resetAllKeepRules = () => { setState((s) => { const fresh = buildSeed(); return { ...fresh, rules: s.rules }; }); logAction("opnieuw begonnen (regels behouden)"); };
  const patchTx = (txId, patch) => {
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, ...patch } : t)) }));
    if (patch && patch.allocations) logAction(patch.allocations.length === 0 ? "transactie op 'toe te kennen' gezet" : patch.allocations.length > 1 ? "transactie over meerdere posten verdeeld" : "transactie ingedeeld");
  };
  const addManualTx = (data) => {
    const base = { date: data.date, amountCents: data.amountCents, name: data.name || "", iban: "", description: data.omschrijving || "", omschrijving: data.omschrijving || data.name || "", mutationType: "Handmatig", saldoNaMutatieCents: null };
    const hash = dedupHash(base);
    const match = categorize(base, rules, categories);
    const allocations = match ? [{ categoryId: match.categoryId, amountCents: base.amountCents }] : [];
    const tx = { ...base, id: "man-" + hash + "-" + Math.random().toString(36).slice(2, 6), hash, allocations, note: "", flagged: false };
    setState((s) => ({ ...s, transactions: [...s.transactions, tx] }));
    logAction("losse transactie toegevoegd");
  };
  const linkSettlement = (incomingId, advanceId, amountCents) => {
    if (!(amountCents > 0)) return;
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => {
      if (t.id !== incomingId) return t;
      const settlements = [...settlementsOf(t).filter((x) => x.advanceId !== advanceId), { advanceId, amountCents }];
      return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) };
    }) }));
    logAction("tikkie (deels) verrekend");
  };
  const unlinkSettlement = (incomingId, advanceId) => {
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => {
      if (t.id !== incomingId) return t;
      const settlements = settlementsOf(t).filter((x) => x.advanceId !== advanceId);
      return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) };
    }) }));
    logAction("koppeling tikkie ongedaan gemaakt");
  };
  const unsettleTx = (txId) => {
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => {
      if (t.id === txId) return { ...t, settledWith: undefined, settlements: [], allocations: [] };
      if (t.settledWith === txId || settlementsOf(t).some((x) => x.advanceId === txId)) { const settlements = settlementsOf(t).filter((x) => x.advanceId !== txId); return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) }; }
      return t;
    }) }));
    logAction("verrekening ongedaan gemaakt");
  };
  const [reviewKick, setReviewKick] = useState(0);
  const startReview = () => { setTab("transacties"); setReviewKick((k) => k + 1); };
  const commitImport = (txns, newRules) => {
    const batchId = "b" + Date.now();
    const importedAt = new Date().toISOString();
    // Debug: log elke binnenkomende transactie naar de server-terminal (Railway-logs),
    // inclusief wat de vermogens-afleiding ervan maakt.
    debugLogImport(txns, state.categories);
    setState((s) => {
      const tagged = txns.map((t) => ({ ...t, batchId, importedAt }));
      // Géén automatische aanmaak van spaarrekeningen meer: transacties zonder passende post
      // blijven 'te sorteren'. De vermogensmutatie wordt afgeleid uit de mededelingen zodra
      // de code aan een bestaande rekening is gekoppeld (tabblad Vermogen).
      return { ...s, transactions: [...s.transactions, ...tagged], rules: newRules && newRules.length ? [...s.rules, ...newRules] : s.rules };
    });
    logAction(`${txns.length} transacties geïmporteerd`);
  };
  const setActiveYear = (id) => setState((s) => ({ ...s, activeYearId: id }));
  // ---- Backup: download de volledige toestand als JSON ----
  const exportBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
      a.href = url; a.download = `huishoudboekje-backup-${stamp}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      logAction("backup gedownload");
    } catch {}
  };
  // ---- Herstel uit een geüpload backup-bestand ----
  const importBackup = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.years)) { alert("Dit lijkt geen geldig backup-bestand van het huishoudboekje."); return; }
      if (!confirm("Weet je het zeker? De huidige gegevens worden vervangen door de inhoud van dit backup-bestand.")) return;
      if (onRestore) onRestore(parsed);
      logAction("backup teruggezet");
    } catch { alert("Kon het bestand niet lezen — is het een geldig .json backup-bestand?"); }
  };
  const createYear = (jaartal, basis) => {
    const id = String(jaartal);
    if (years.some((y) => y.id === id)) { setActiveYear(id); setShowNewYear(false); setTab("begroting"); return; }
    setState((s) => {
      const latest = [...s.years].sort((a, b) => b.jaartal - a.jaartal)[0];
      const acts = txYearActuals(s.transactions, s.categories, latest.jaartal);
      const end = computeRunningSaldo(latest.carryInCents, acts)[11].end;
      const newYear = { id, jaartal, carryInCents: end, status: "open" };
      let nb = {};
      if (basis === "copy") { const src = s.budgets[latest.id] || {}; for (const [cid, l] of Object.entries(src)) nb[cid] = { average: l.average, months: l.months.slice() }; }
      nb = applySluitpost(s.categories, nb);
      return { ...s, years: [...s.years, newYear], budgets: { ...s.budgets, [id]: nb }, activeYearId: id };
    });
    setShowNewYear(false); setTab("begroting");
    logAction(`nieuw begrotingsjaar ${jaartal} aangemaakt`);
  };

  const nav = [
    ...(isMobile ? [["mhome", "Start", icons.overzicht]] : []),
    ["overzicht", "Overzicht", icons.overzicht],
    ["begroting", "Begroting", icons.begroting],
    ["transacties", "Transacties", icons.transacties],
    ["uitgaven", "Uitgaven", icons.uitgaven],
    ["vermogen", "Vermogen", icons.vermogen],
    ["posten", "Posten", icons.posten],
    ["import", "Import", icons.import],
    ["regels", "Regels", icons.regels],
    ["activiteit", "Activiteit", <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>],
  ];
  const teSorterenBadge = transactions.reduce((n, t) => n + (effYear(t) === year.jaartal && (!t.allocations || t.allocations.length === 0) ? 1 : 0), 0);

  const asideStyle = isMobile
    ? { width: 240, background: T.panel, borderRight: `1px solid ${T.line}`, padding: "20px 14px", position: "fixed", top: 0, left: 0, height: "100vh", boxSizing: "border-box", zIndex: 41, transform: menuOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.22s ease", boxShadow: menuOpen ? "2px 0 16px rgba(0,0,0,0.15)" : "none" }
    : { width: 220, background: T.panel, borderRight: `1px solid ${T.line}`, flexShrink: 0, padding: "20px 14px", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" };
  const footerStyle = { position: isMobile ? "static" : "absolute", bottom: 16, left: 14, right: 14, marginTop: isMobile ? 20 : 0 };
  // Huidig saldo = banksaldo uit de saldoketen; valt terug op de begrotingsberekening als er
  // (nog) geen saldo-informatie in de import zit.
  const bankNow = derived.bankBalanceCents != null ? derived.bankBalanceCents : (derived.forecast ? derived.forecast.accountBalance : 0);
  const vitalTiles = [
    { label: "Huidig saldo betaalrekening", node: <Money cents={bankNow} sign bold size={18} /> },
    { label: "Vermogen", node: <Money cents={derived.vitals.vermogen} bold size={18} /> },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans }}>
      {isMobile && menuOpen && <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 40 }} />}
      <aside style={asideStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: T.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>€</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Huishoudboekje</div>
        </div>
        {nav.map(([id, label, icon]) => (
          <button key={id} onClick={() => { setTab(id); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 8, marginBottom: 2, fontSize: 14, fontWeight: 600, background: tab === id ? T.accentSoft : "transparent", color: tab === id ? T.accent : T.sub }}>
            <span style={{ color: tab === id ? T.accent : "#9aa8a5", display: "flex" }}><Icon d={icon} /></span>
            <span style={{ flex: 1 }}>{label}</span>
            {id === "transacties" && teSorterenBadge > 0 && <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: T.warn, color: "#fff" }}>{teSorterenBadge}</span>}
          </button>
        ))}
        {tasks.filter((t) => !t.done && t.to === user.username).length > 0 && (
          <div style={{ margin: "12px 2px 0", padding: "10px 12px", background: T.accentSoft, borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.accent, marginBottom: 6 }}>Taken voor jou ({tasks.filter((t) => !t.done && t.to === user.username).length})</div>
            {tasks.filter((t) => !t.done && t.to === user.username).slice(0, 3).map((t) => {
              const tx = transactions.find((x) => x.id === t.txId);
              return <button key={t.id} onClick={() => { gotoTransacties({ txId: t.txId }); setMenuOpen(false); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: "3px 0", fontSize: 12, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>› {tx ? tx.name : "transactie"}{t.note ? ` — ${t.note}` : ""}</button>;
            })}
          </div>
        )}
        <div style={footerStyle}>
          <div style={{ fontSize: 12, color: T.ink, fontWeight: 600, marginBottom: 8 }}>Ingelogd als {user.displayName}</div>
          <button onClick={() => setShowChangePw(true)} style={{ width: "100%", border: `1px solid ${T.line}`, background: T.panel, color: T.sub, cursor: "pointer", padding: "7px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Wachtwoord wijzigen</button>
          <button onClick={onLogout} style={{ width: "100%", border: `1px solid ${T.line}`, background: T.panel, color: T.sub, cursor: "pointer", padding: "7px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>Uitloggen</button>
          <div style={{ fontSize: 11, color: T.sub, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: dbReady ? T.pos : T.warn }} />
            {dbReady ? "Opgeslagen in database" : "Tijdelijk geheugen"}
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        {isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.line}`, background: T.panel, position: "sticky", top: 0, zIndex: 6 }}>
            <button onClick={() => setMenuOpen(true)} aria-label="menu" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.ink, display: "flex", padding: 4 }}><Icon d={<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>} size={22} /></button>
            <div style={{ fontWeight: 700, fontSize: 15, textTransform: "capitalize" }}>{(nav.find((n) => n[0] === tab) || [null, "Overzicht"])[1]}</div>
            <div style={{ marginLeft: "auto" }}><YearSwitcher years={years} activeYearId={activeYearId} onSelect={setActiveYear} onNew={() => setShowNewYear(true)} /></div>
          </div>
        )}
        <div style={{ display: "flex", borderBottom: `1px solid ${T.line}`, background: T.panel, position: "sticky", top: isMobile ? 47 : 0, zIndex: 5, overflowX: "auto" }}>
          {tab === "overzicht" && vitalTiles.map((t, i) => (
            <div key={i} style={{ padding: "12px 22px", borderRight: `1px solid ${T.line}`, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 2 }}>{t.label}</div>{t.node}
            </div>
          ))}
          {!isMobile && (
            <div style={{ marginLeft: "auto", padding: "10px 18px", alignSelf: "center", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <YearSwitcher years={years} activeYearId={activeYearId} onSelect={setActiveYear} onNew={() => setShowNewYear(true)} />
              {meta && meta.updatedBy && <div style={{ fontSize: 11, color: T.sub }}>laatst bijgewerkt door {meta.updatedBy}</div>}
            </div>
          )}
        </div>

        <div style={{ padding: isMobile ? "16px 14px" : "24px 28px", maxWidth: 1080 }}>
          {conflict && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 9, background: "#fdeaea", border: "1px solid #f0c2c2", color: "#8a2b2b", fontSize: 13, lineHeight: 1.5 }}>
              <b>Iemand anders heeft intussen wijzigingen opgeslagen.</b> Waarschijnlijk {meta && meta.updatedBy ? meta.updatedBy : "een ander apparaat"}. Om te voorkomen dat je elkaars werk overschrijft, kies je: <span style={{ display: "inline-flex", gap: 8, marginTop: 8 }}><button onClick={onTakeServer} style={{ border: "1px solid #f0c2c2", background: "#fff", color: "#8a2b2b", borderRadius: 7, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Hun versie laden</button><button onClick={onKeepMine} style={{ border: "1px solid #f0c2c2", background: "#8a2b2b", color: "#fff", borderRadius: 7, padding: "5px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Mijn versie behouden</button></span></div>
          )}
          {saveError && !conflict && (
            <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, background: T.warnSoft, border: "1px solid #f0dcb8", color: "#7a5a1a", fontSize: 13 }}>
              <b>Opslaan lukt momenteel niet</b> — controleer je verbinding. Je wijzigingen staan nog op dit apparaat en ik probeer het elke paar seconden opnieuw.
            </div>
          )}
          {!dbReady && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 9, background: T.warnSoft, border: `1px solid #f0dcb8`, color: "#7a5a1a", fontSize: 13, lineHeight: 1.5 }}>
              <b>Let op: je gegevens worden nu in tijdelijk geheugen bewaard en verdwijnen bij een herstart van de server.</b> Koppel in Railway een PostgreSQL-database en zet de variabele <code>DATABASE_URL</code> (Railway doet dit meestal automatisch als je een Postgres-plugin toevoegt). Daarna wordt alles blijvend opgeslagen.
            </div>
          )}
          {tab === "mhome" && <MobileHome user={user} otherName={other.name} bankNow={bankNow} teSorteren={teSorterenBadge} transactions={transactions.filter((t) => effYear(t) === year.jaartal)} tasks={tasks} attachCounts={attachCounts} onAttachChanged={refreshAttachCounts} onStartReview={startReview} onAddTask={addTask} onToggleTask={toggleTask} onRemoveTask={removeTask} onOpenTx={(txId) => gotoTransacties({ txId })} />}
          {tab === "overzicht" && <Overzicht vitals={derived.vitals} monthRows={derived.monthRows} monthly={derived.monthly} topPostsByMonth={derived.topPostsByMonth} teSorteren={teSorterenBadge} onDrill={gotoTransacties} currentMonth={derived.currentMonth} jaar={year.jaartal} openActions={openActions} forecast={derived.forecast} forecastYear={derived.forecastYear} reconciliation={derived.reconciliation} agingAdvances={derived.agingAdvances} openingBalanceCents={openingBalanceCents} bankBalanceCents={derived.bankBalanceCents} saldoGaps={derived.saldoGaps} chainOpening={derived.chainOpening} freqAlerts={derived.freqAlerts} topDeviations={derived.topDeviations} missingRecurring={derived.missingRecurring} recurringTotal={derived.recurringTotal} recurringPaid={derived.recurringPaid} savingsRate={derived.savingsRate} vastMonthly={derived.vastMonthly} varMonthly={derived.varMonthly} onSetOpeningBalance={setOpeningBalance} onGoto={setTab} onReview={startReview} />}
          {tab === "begroting" && <Begroting groups={groups} categories={categories} budgets={budgets} year={year} onSaveLine={saveLine} onImportBudget={onImportBudget} onAddCategory={addCategory} onAddGroup={addGroup} onAcceptSluitpost={acceptSluitpost} prevYear={prevYear} prevActualByCat={prevActualByCat} onSetYtd={setYtdSeed} onSetSubBudget={setSubBudget} />}
          {tab === "transacties" && <Transacties groups={groups} categories={categories} year={year} transactions={transactions} rules={rules} onSetAllocations={setTxAllocations} onSetNote={setTxNote} onToggleFlag={toggleTxFlag} onAddRule={addRule} onSaveOne={patchTx} onClearYear={clearYearTransactions} onClearRange={clearTransactionsInRange} onClearAll={clearAllTransactions} onResetAll={resetAllKeepRules} onAddManual={addManualTx} onLinkSettle={linkSettlement} onUnlinkSettle={unlinkSettlement} onUnsettle={unsettleTx} onCreateSavings={createSavingsAccount} onLinkSavings={linkSavingsCode} reviewedBatches={reviewedBatches} onMarkBatchReviewed={markBatchReviewed} kickReview={reviewKick} years={years} preset={txPreset} onPresetConsumed={() => setTxPreset(null)} attachCounts={attachCounts} onAttachChanged={refreshAttachCounts} onAddTask={addTask} otherName={other.name} />}
          {tab === "uitgaven" && <Uitgaven groups={groups} categories={categories} budgets={budgets} year={year} years={years} transactions={transactions} onAddCategory={addCategory} onSetYtd={setYtdSeed} />}
          {tab === "vermogen" && <Vermogen pots={pots} categories={categories} transactions={transactions} year={year} budgetLines={budgets[year.id] || {}} onSetPotOpening={setPotOpening} onSetPotTarget={setPotTarget} onSetSpaarcode={(id, code) => updateCategory(id, { spaarcode: code })} />}
          {tab === "posten" && <Posten groups={groups} categories={categories} transactions={transactions} year={year} onToggleNote={toggleNote} onUpdateCategory={updateCategory} onDeleteCategory={deleteCategory} onAddCategory={addCategory} />}
          {tab === "import" && <Import categories={categories} groups={groups} rules={rules} existingHashes={derived.existingHashes} history={transactions} onCommit={commitImport} onStartReview={startReview} />}
          {tab === "regels" && <Regels rules={rules} categories={categories} groups={groups} transactions={transactions} onToggle={toggleRule} onDelete={deleteRule} onBulkDelete={bulkDeleteRules} onUpdate={updateRule} onAdd={addRule} onAddDefaults={onAddDefaults} />}
          {tab === "activiteit" && <><DataBackup dbReady={dbReady} onExport={exportBackup} onImport={importBackup} onRestoreSnapshot={onRestore} /><Activiteit /></>}
        </div>
      </main>

      {showChangePw && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,22,0.55)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }}>
          <div style={{ background: T.panel, borderRadius: 14, padding: 28, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
            <ChangePasswordCard displayName={user.displayName} onCancel={() => setShowChangePw(false)} onDone={() => setShowChangePw(false)} />
          </div>
        </div>
      )}
      {showNewYear && <NewYearDialog years={years} budgets={budgets} categories={categories} transactions={transactions} onCreate={createYear} onClose={() => setShowNewYear(false)} />}
    </div>
  );
}

/* ---------------------------------------------------- Laden & opslaan-shell */
export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | login | change | ready
  const [user, setUser] = useState(null);
  const [state, setState] = useState(null);
  const [dbReady, setDbReady] = useState(false);
  const [meta, setMeta] = useState(null);
  const [conflict, setConflict] = useState(false); // een ander apparaat/gebruiker heeft intussen opgeslagen
  const [saveError, setSaveError] = useState(false); // opslaan mislukt (bijv. geen verbinding) — we blijven het proberen
  const loadedRef = useRef(false);
  const saveTimer = useRef(null);
  const revRef = useRef(0);          // laatst bevestigde serverrevisie
  const dirtyRef = useRef(false);    // lokale, nog niet-opgeslagen wijzigingen aanwezig?
  const savingRef = useRef(false);   // bezig met opslaan (voorkomt overlap met polling)

  const applyServer = useCallback((r, { fromPoll = false } = {}) => {
    setDbReady(!!r.db);
    let s = r.state;
    if (!s) { s = buildSeed(); }
    else s = mergeSeed(s);
    revRef.current = r.rev || 0;
    dirtyRef.current = false;
    setState(s);
    setMeta({ updatedBy: r.updatedBy, updatedAt: r.updatedAt });
    setConflict(false);
    if (fromPoll) loadedRef.current = true;
  }, []);

  const load = useCallback(async () => {
    const r = await getState();
    if (!r.state) { const seed = buildSeed(); try { const w = await putState(seed, null); revRef.current = w && w.rev != null ? w.rev : 0; } catch {} setState(seed); setDbReady(!!r.db); setMeta({}); }
    else applyServer(r);
    loadedRef.current = true;
    setPhase("ready");
  }, [applyServer]);

  useEffect(() => {
    (async () => {
      try {
        const m = await me();
        setDbReady(!!m.db);
        if (m.authed) { setUser(m.user); if (m.mustChange) setPhase("change"); else await load(); }
        else setPhase("login");
      } catch { setPhase("login"); }
    })();
  }, [load]);

  // Opslaan met revisie; bij 409-conflict laten we de lokale wijziging staan en tonen een melding.
  useEffect(() => {
    if (phase !== "ready" || !loadedRef.current || !state) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const attempt = () => {
      savingRef.current = true;
      putState(state, revRef.current)
        .then((r) => { setDbReady(!!r.db); if (r.rev != null) revRef.current = r.rev; dirtyRef.current = false; if (r.updatedBy) setMeta({ updatedBy: r.updatedBy, updatedAt: new Date().toISOString() }); setConflict(false); setSaveError(false); })
        .catch((e) => { if (e && e.conflict) { setConflict(true); } else { setSaveError(true); saveTimer.current = setTimeout(attempt, 6000); } }) // geen verbinding? over 6s opnieuw
        .finally(() => { savingRef.current = false; });
    };
    saveTimer.current = setTimeout(attempt, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, phase]);

  // Polling: haal elke 20s de nieuwste serverversie op als er lokaal niets openstaat.
  // Zo zie je op apparaat B wat op apparaat A is gedaan, zonder opnieuw in te loggen.
  useEffect(() => {
    if (phase !== "ready") return;
    const iv = setInterval(async () => {
      if (dirtyRef.current || savingRef.current || conflict) return;
      try { const r = await getState(); if ((r.rev || 0) !== revRef.current) applyServer(r, { fromPoll: true }); }
      catch {}
    }, 20000);
    return () => clearInterval(iv);
  }, [phase, conflict, applyServer]);

  // Conflict oplossen: server wint (lokale niet-opgeslagen wijziging gaat verloren — bewust, expliciet).
  const resolveConflictTakeServer = useCallback(async () => {
    try { const r = await getState(); applyServer(r); } catch {}
  }, [applyServer]);
  // Conflict oplossen: mijn versie wint (overschrijf de server met de laatste rev).
  const resolveConflictKeepMine = useCallback(async () => {
    try { const r = await getState(); revRef.current = r.rev || 0; const w = await putState(state, revRef.current); if (w && w.rev != null) revRef.current = w.rev; dirtyRef.current = false; setConflict(false); }
    catch (e) { if (e && e.conflict) setConflict(true); }
  }, [state]);

  const onLoginSuccess = (r) => {
    setUser(r.user); setDbReady(!!r.db);
    if (r.mustChange) setPhase("change"); else load();
  };
  const onChangeDone = () => { load(); };
  const onLogout = async () => {
    try { await apiLogout(); } catch {}
    setUser(null); setState(null); loadedRef.current = false; setPhase("login");
  };
  // Herstel een snapshot: haal 'm op en zet 'm als nieuwe toestand (wordt daarna vanzelf opgeslagen).
  const restoreState = useCallback((newState) => { setState(mergeSeed(newState)); }, []);

  if (phase === "loading")
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, color: T.sub, fontFamily: T.sans, fontSize: 14 }}>Bezig met laden…</div>;
  if (phase === "login") return <LoginScreen onSuccess={onLoginSuccess} />;
  if (phase === "change" && user) return <ChangePasswordScreen user={user} onDone={onChangeDone} />;
  if (phase === "ready" && state && user) return <ErrorBoundary><Workspace state={state} setState={setState} dbReady={dbReady} user={user} meta={meta} onLogout={onLogout} conflict={conflict} saveError={saveError} onTakeServer={resolveConflictTakeServer} onKeepMine={resolveConflictKeepMine} onRestore={restoreState} /></ErrorBoundary>;
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, color: T.sub, fontFamily: T.sans, fontSize: 14 }}>Bezig met laden…</div>;
}
