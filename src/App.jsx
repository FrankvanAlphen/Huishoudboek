import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { me, getUsers, login as apiLogin, changePassword as apiChangePassword, logout as apiLogout, getState, putState, getActivity, logAction } from "./api.js";
import * as XLSX from "xlsx";

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
  const cleaned = String(input).trim().replace(/\./g, "").replace(",", ".");
  const v = Number(cleaned);
  if (!Number.isFinite(v)) throw new Error(`Kan bedrag niet lezen: "${input}"`);
  return Math.round(v * 100);
}
const eur = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatEUR = (c) => eur.format(c / 100);
const editEUR = (c) => (c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function parseINGDate(s) {
  const t = String(s).trim();
  if (!/^\d{8}$/.test(t)) throw new Error(`Ongeldige datum: ${s}`);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}
const monthOf = (iso) => Number(iso.slice(5, 7));

/* ------------------------------------------------------------- Begroting */
const distributeEven = (avg) => Array.from({ length: 12 }, () => avg);
const sumMonths = (m) => m.reduce((a, b) => a + b, 0);
function checkDistribution(avg, months) {
  const target = avg * 12, actual = sumMonths(months);
  return { ok: actual - target === 0, target, actual, diff: actual - target };
}
function computeBreakEven(lines) {
  let income = 0, outflow = 0;
  for (const l of lines) (l.type === "income" ? (income += l.annual) : (outflow += l.annual));
  return { income, outflow, diff: income - outflow, ok: income - outflow === 0 };
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
  if (c.operator === "amountRange") {
    if (c.min != null && tx.amountCents < c.min) return false;
    if (c.max != null && tx.amountCents > c.max) return false;
    return true;
  }
  const field = { iban: tx.iban, name: tx.name, description: tx.omschrijving, mutationType: tx.mutationType }[c.field];
  if (field == null || c.value == null) return false;
  const h = String(field).toLowerCase(), n = String(c.value).toLowerCase();
  if (c.operator === "equals") return h === n;
  if (c.operator === "contains") return h.includes(n);
  if (c.operator === "startsWith") return h.startsWith(n);
  return false;
}
const ruleMatches = (tx, r) => r.conditions.length > 0 && r.conditions.every((c) => matchCondition(tx, c));
function categorize(tx, rules) {
  let best = null;
  for (const r of rules) { if (r.active && ruleMatches(tx, r) && (!best || r.priority < best.priority)) best = r; }
  return best ? { categoryId: best.categoryId, ruleId: best.id } : null;
}

/* --------------------------------------------------- Begrotingsmatrix-parser */
function parseBudgetMatrix(text) {
  const rows = [], errors = [];
  const delim = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === "") return;
    const cells = raw.split(delim).map((c) => c.trim());
    const name = cells[0] || "", amts = cells.slice(1).filter((c) => c !== "");
    if (!name) { errors.push(`Regel ${i + 1}: geen postnaam.`); return; }
    let months;
    try {
      if (amts.length === 12) months = amts.map(parseDecimalToCents);
      else if (amts.length === 1) { const a = parseDecimalToCents(amts[0]); months = Array.from({ length: 12 }, () => a); }
      else { errors.push(`Regel ${i + 1} ("${name}"): 1 gemiddelde of 12 maanden nodig.`); return; }
    } catch { errors.push(`Regel ${i + 1} ("${name}"): bedrag onleesbaar.`); return; }
    rows.push({ name, months });
  });
  return { rows, errors };
}

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
function parseINGCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { txns: [], errors: ["Geen transacties gevonden."] };
  const delim = lines[0].includes(";") ? ";" : ",";
  const header = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const idx = (f) => header.findIndex((h) => h.includes(f));
  const iDate = idx("datum"), iName = idx("naam"), iTegen = idx("tegenrekening"),
    iAfBij = header.findIndex((h) => h.includes("af bij") || h.includes("af/bij")),
    iBedrag = idx("bedrag"), iMut = idx("mutatiesoort"), iMed = idx("mededeling");
  const txns = [], errors = [];
  lines.slice(1).forEach((line, n) => {
    const c = splitCsvLine(line, delim);
    try {
      const sign = (c[iAfBij] || "").toLowerCase().startsWith("a") ? -1 : 1;
      txns.push({
        date: parseINGDate(c[iDate]),
        amountCents: sign * parseDecimalToCents(c[iBedrag]),
        name: c[iName] || "",
        iban: iTegen >= 0 ? c[iTegen] || "" : "",
        description: iMed >= 0 ? c[iMed] || "" : "",
        omschrijving: extractOmschrijving(c[iMed]) || c[iName] || "",
        mutationType: c[iMut] || "",
      });
    } catch (e) { errors.push(`Regel ${n + 2}: ${e.message}`); }
  });
  return { txns, errors };
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

const yearOf = (iso) => Number(iso.slice(0, 4));
function txYearActuals(transactions, categories, jaartal) {
  const actuals = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
  const catType = {}; for (const c of categories) catType[c.id] = c.type;
  for (const t of transactions) {
    if (yearOf(t.date) !== jaartal) continue;
    const m = monthOf(t.date);
    for (const a of t.allocations) {
      if (catType[a.categoryId] === "income") actuals[m - 1].income += a.amountCents;
      else actuals[m - 1].expense += Math.abs(a.amountCents);
    }
  }
  return actuals;
}

function buildSeed() {
  const groups = GROUPS_DEF.map((naam, i) => ({ id: slug(naam), naam, volgorde: i }));
  const categories = CAT_DEFS.map(([g, naam, type, note], i) => ({ id: slug(naam), groupId: slug(g), naam, type, noteSuggested: note, volgorde: i }));
  const cid = (naam) => slug(naam);

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

  const lines = {};
  for (const c of categories) { const a = A[c.id] || 0; if (a !== 0 && c.id !== SLUITPOST_ID) lines[c.id] = { average: a, months: distributeEven(a) }; }
  const balanced = applySluitpost(categories, lines); // Gezamenlijke spaarrekening = sluitpost

  const years = [{ id: "2026", jaartal: 2026, carryInCents: -1199, status: "open" }]; // Achterzoom −€11,99
  const budgets = { "2026": balanced };

  const pots = [
    { categoryId: cid("Gezamenlijke spaarrekening / ING"), opening: 1_200_000 },
    { categoryId: cid("Woning / ABN"), opening: 2_400_000 },
    { categoryId: cid("Vakantie / ING"), opening: 180_000 },
    { categoryId: cid("Eigen risico / ING"), opening: 38_500 },
    { categoryId: cid("Spaarrekening Maud / ING"), opening: 320_000 },
  ];

  // Startregels op basis van je terugkerende winkels; de rommelige
  // (persoonsoverboekingen) laat je in de popup categoriseren — en leren.
  let rid = 0;
  const R = (catName, value, prio, field = "name", operator = "contains") =>
    ({ id: "r" + (++rid), categoryId: cid(catName), priority: prio, active: true, conditions: [{ field, operator, value }] });
  const rules = [
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "albert heijn", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "plus moerkapelle", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "jumbo", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "lidl", 30),
    R("Bankkosten / ING", "kosten oranjepakket", 20),
    R("Bankkosten / ING", "kosten tweede rekeninghouder", 20),
    R("Kleding; zit in zakgeld", "zeeman", 40),
    R("Uitstapjes/bestellen", "van eesteren", 35),
    R("Uitstapjes/bestellen", "bagels", 35),
    R("Uitstapjes/bestellen", "la place", 35),
    R("Persoonlijke verzorging: kapper, schoonheid", "etos", 35),
    R("Huis en tuin", "hema", 45),
    R("Parkeren", "stadshart", 45),
  ];

  return { groups, categories, budgets, years, activeYearId: "2026", pots, rules, transactions: [] };
}

/* ----------------------------------------------------------- UI-bouwstenen */
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
const SectionTitle = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 14px" }}>
    <h2 style={{ fontSize: 17, margin: 0 }}>{children}</h2>{right}
  </div>
);
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 14, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none", fontFamily: T.sans };

/** Betrouwbare, gegroepeerde keuzelijst voor posten. sign<0 = uitgave/sparen, sign>0 = inkomsten. */
function CatSelect({ categories, groups, value, onChange, sign = 0, placeholder = "— kies post —", style }) {
  const allow = (c) => { if (c.id === SLUITPOST_ID) return false; if (sign < 0) return c.type !== "income"; if (sign > 0) return c.type === "income"; return true; };
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

/* ================================================================= POPUP */
function guessKeyword(name) {
  let s = String(name);
  if (s.includes("*")) s = s.split("*").slice(1).join("*");
  s = s.replace(/\b(nld|nl|prom|apple pay|gouda|zoetermeer|wassenaar|moerkapelle|zaandam)\b/gi, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/* ===================================================================== */
/* PAGINA'S                                                              */
/* ===================================================================== */

function Overzicht({ vitals, signals, breakEven, monthRows, currentMonth, jaar, openActions, onGoto }) {
  const tile = (label, node, sub, onClick) => (
    <Card onClick={onClick} style={{ padding: 18, flex: 1, minWidth: 190, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 700, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>{node}</div>
      {sub && <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
  const mn = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const oa = openActions || { teSorteren: 0, gemarkeerd: 0, count: 0, items: [] };
  return (
    <div>
      <SectionTitle>Overzicht · t/m {mn[currentMonth - 1]} {jaar}</SectionTitle>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {tile("Lopend saldo", <Money cents={vitals.saldo} sign bold />, "begin + inkomsten − uitgaven")}
        {tile("Afwijking t.o.v. begroting", <Money cents={vitals.deviation} sign bold />, vitals.deviation >= 0 ? "voor op planning" : "achter op planning")}
        {tile("Gereserveerd vermogen", <Money cents={vitals.vermogen} bold />, `${vitals.potCount} rekeningen · bekijk opbouw`, () => onGoto && onGoto("vermogen"))}
      </div>

      {oa.count > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: oa.items.length ? 10 : 0, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14" }}>Openstaande acties · {oa.teSorteren} te sorteren · {oa.gemarkeerd} gemarkeerd</div>
            <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Naar Transacties</Btn>
          </div>
          {oa.items.slice(0, 5).map((t, i) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: i ? `1px solid #f0dcb8` : "none", fontSize: 13 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)} · {t.name}{t.note ? ` · ${t.note}` : ""}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color: t.amountCents < 0 ? T.neg : T.pos }}>{formatEUR(t.amountCents)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: t.reason === "te sorteren" ? "#fff" : "#eef0ff", color: t.reason === "te sorteren" ? T.warn : "#4338ca" }}>{t.reason}</span>
              </span>
            </div>
          ))}
          {oa.count > 5 && <div style={{ fontSize: 12, color: "#9a6a14", marginTop: 8 }}>en nog {oa.count - 5} meer…</div>}
        </Card>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card style={{ padding: 18, flex: 2, minWidth: 320 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Lopend saldo per maand</div>
          <SaldoChart rows={monthRows} currentMonth={currentMonth} />
        </Card>
        <Card style={{ padding: 18, flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Signalen</div>
          {signals.length === 0 && <div style={{ fontSize: 13, color: T.sub }}>Importeer je ING-CSV om te beginnen.</div>}
          {signals.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.tone === "neg" ? T.neg : T.warn, marginTop: 5, flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>{s.text}</span>
            </div>
          ))}
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

function AddPostRow({ groupId, onAdd }) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [type, setType] = useState("expense");
  const add = () => { const n = naam.trim(); if (!n) return; onAdd(groupId, n, type); setNaam(""); setType("expense"); setOpen(false); };
  if (!open) return (
    <div style={{ padding: "7px 16px", borderTop: `1px solid ${T.line}` }}>
      <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>+ nieuwe post</Btn>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}`, background: "#fafcfb", flexWrap: "wrap" }}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Naam van de post" style={{ ...inputStyle, width: 230, padding: "6px 10px", fontSize: 13 }} />
      <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: 130, padding: "6px 10px", fontSize: 13 }}>
        <option value="expense">uitgave</option>
        <option value="savings">sparen</option>
        <option value="income">inkomsten</option>
      </select>
      <Btn size="sm" onClick={add}>Toevoegen</Btn>
      <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); setNaam(""); }}>Annuleren</Btn>
    </div>
  );
}

function Begroting({ groups, categories, budgets, year, onSaveLine, onImportBudget, onAddCategory, prevYear, prevActualByCat }) {
  const [expanded, setExpanded] = useState(null);
  const [drag, setDrag] = useState(false);
  const [impResult, setImpResult] = useState(null);
  const fileRef = useRef(null);
  const lines = applySluitpost(categories, budgets[year.id] || {});
  const lineFor = (cid) => lines[cid] || { average: 0, months: distributeEven(0) };
  const totals = budgetTotals(categories, lines);
  const hasPrev = !!(prevYear && prevActualByCat);
  const cols = hasPrev ? "1fr 130px 110px 120px 80px" : "1fr 130px 120px 80px";

  const handleFile = async (file) => {
    if (!file) return;
    setImpResult(null);
    try {
      let rows;
      if (/\.xlsx?$/i.test(file.name)) {
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
      <SectionTitle>Begroting {year.jaartal}</SectionTitle>

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
          <div style={{ flex: 1, minWidth: 150, padding: "14px 18px", background: T.accentSoft }}>
            <div style={{ fontSize: 12, color: T.accent, marginBottom: 4, fontWeight: 600 }}>In balans</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.pos, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon d={<polyline points="20 6 9 17 4 12" />} size={18} /> Sluitend
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${T.line}`, fontSize: 12, color: T.sub }}>
          Het verschil tussen inkomsten en uitgaven komt automatisch op <b>Gezamenlijke spaarrekening / ING</b>. Daardoor klopt de begroting altijd precies.
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
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          const subtotal = cats.reduce((a, c) => a + sumMonths(lineFor(c.id).months), 0);
          return (
            <div key={g.id}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>
                <span>{g.naam}</span><span style={{ fontFamily: T.mono }}>{formatEUR(subtotal)}/jaar</span>
              </div>
              {cats.map((c) => {
                const line = lineFor(c.id), annual = sumMonths(line.months), isOpen = expanded === c.id;
                const prevA = hasPrev ? (prevActualByCat[c.id] || 0) : 0;
                if (c.id === SLUITPOST_ID) return (
                  <div key={c.id} style={{ borderTop: `1px solid ${T.line}`, background: "#fcf9e8" }}>
                    <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 10, padding: "8px 16px" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{c.naam} <span style={{ fontSize: 11, color: T.warn, fontWeight: 600 }}>· sluitpost</span></span>
                      <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{formatEUR(Math.round(annual / 12))}</div>
                      {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(prevA) : "—"}</div>}
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
                      {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(prevA) : "—"}</div>}
                      <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} muted /></div>
                      <div style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "maanden"}</Btn></div>
                    </div>
                    {isOpen && <MonthEditor line={line} onSave={(months) => onSaveLine(c.id, line.average, months)} />}
                  </div>
                );
              })}
              <AddPostRow groupId={g.id} onAdd={onAddCategory} />
            </div>
          );
        })}
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

function Uitgaven({ groups, categories, budgets, year, transactions, onAddCategory }) {
  const [expanded, setExpanded] = useState(null);
  const lines = applySluitpost(categories, budgets[year.id] || {});
  const actualByCat = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (yearOf(t.date) !== year.jaartal) continue;
      const m = monthOf(t.date);
      for (const a of t.allocations) {
        if (!map[a.categoryId]) map[a.categoryId] = Array.from({ length: 12 }, () => 0);
        map[a.categoryId][m - 1] += a.amountCents;
      }
    }
    return map;
  }, [transactions, year]);
  const names = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const yearTxCount = transactions.filter((t) => yearOf(t.date) === year.jaartal).length;
  const totalIncome = categories.filter((c) => c.type === "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const totalOut = categories.filter((c) => c.type !== "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const cols = "1fr 110px 110px 110px 60px";

  return (
    <div>
      <SectionTitle>Uitgaven {year.jaartal} · werkelijk vs. begroot</SectionTitle>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Inkomsten dit jaar</div><Money cents={totalIncome} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Uitgaven &amp; sparen dit jaar</div><Money cents={totalOut} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Verschil</div><Money cents={totalIncome - totalOut} sign bold size={20} /></Card>
      </div>
      {yearTxCount === 0 && <div style={{ marginBottom: 16 }}><Banner tone="neutral">Nog geen transacties in {year.jaartal}. Importeer je ING-CSV onder <b>Import</b> om je uitgaven hier te zien.</Banner></div>}
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
              <AddPostRow groupId={g.id} onAdd={onAddCategory} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Posten({ groups, categories, transactions, onToggleNote, onUpdateCategory, onDeleteCategory, onAddCategory }) {
  const used = new Set();
  for (const t of transactions) for (const a of t.allocations) used.add(a.categoryId);
  return (
    <div>
      <SectionTitle>Posten beheren</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Voeg eigen posten toe, hernoem ze, kies het type, of verwijder ze. Zet "opmerking" aan voor posten waar je bij het importeren een toelichting wilt typen. Een post met transacties kun je niet verwijderen.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id}>
              <div style={{ padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
              {cats.map((c) => {
                const isSluit = c.id === SLUITPOST_ID;
                const inUse = used.has(c.id);
                return (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 130px 150px 90px", gap: 12, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}`, background: isSluit ? "#fcf9e8" : undefined }}>
                    <input value={c.naam} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { naam: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, border: isSluit ? "none" : `1px solid ${T.line}`, background: isSluit ? "transparent" : "#fff" }} />
                    <select value={c.type} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { type: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, opacity: isSluit ? 0.6 : 1 }}>
                      <option value="expense">uitgave</option>
                      <option value="savings">sparen</option>
                      <option value="income">inkomsten</option>
                    </select>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: T.sub }}>opmerking</span>
                      <Toggle on={c.noteSuggested} onClick={() => onToggleNote(c.id)} />
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {isSluit ? <span style={{ fontSize: 11, color: T.sub }}>automatisch</span>
                        : inUse ? <span style={{ fontSize: 11, color: T.sub }} title="heeft transacties">in gebruik</span>
                        : <Btn variant="danger" size="sm" onClick={() => onDeleteCategory(c.id)}>Verwijder</Btn>}
                    </div>
                  </div>
                );
              })}
              <AddPostRow groupId={g.id} onAdd={onAddCategory} />
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Regels({ rules, categories, groups, onToggle, onDelete, onUpdate, onAdd, onAddDefaults }) {
  const fl = { name: "naam", iban: "tegenrekening", description: "omschrijving", mutationType: "mutatiesoort" };
  const ol = { contains: "bevat", equals: "is", startsWith: "begint met" };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ field: "name", operator: "contains", value: "", categoryId: "", priority: 50 });
  const grid = "52px 92px 92px 1fr 1.3fr 54px 64px";
  const catOptions = groups.map((g) => (
    <optgroup key={g.id} label={g.naam}>
      {categories.filter((c) => c.groupId === g.id && c.id !== SLUITPOST_ID).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
    </optgroup>
  ));
  const submitNew = () => {
    if (!nf.value.trim() || !nf.categoryId) return;
    onAdd({ categoryId: nf.categoryId, priority: Number(nf.priority) || 50, conditions: [{ field: nf.field, operator: nf.operator, value: nf.value.trim() }] });
    setNf({ field: "name", operator: "contains", value: "", categoryId: "", priority: 50 });
    setAdding(false);
  };
  return (
    <div>
      <SectionTitle right={<div style={{ display: "flex", gap: 8 }}>{onAddDefaults && <Btn variant="secondary" size="sm" onClick={onAddDefaults}>Standaardregels</Btn>}<Btn size="sm" onClick={() => setAdding((a) => !a)}>+ Nieuwe regel</Btn></div>}>Regels</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Regels categoriseren je transacties automatisch. Ze ontstaan vanzelf via "Onthoud dit" bij het importeren, maar je kunt ze hier ook zelf maken en aanpassen. Lagere prioriteit gaat vóór.</Banner></div>

      {adding && (
        <Card style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Nieuwe regel: als…</div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 120px 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={nf.field} onChange={(e) => setNf({ ...nf, field: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={nf.operator} onChange={(e) => setNf({ ...nf, operator: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(ol).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input value={nf.value} onChange={(e) => setNf({ ...nf, value: e.target.value })} placeholder='bijv. albert heijn' style={{ ...inputStyle, padding: "7px 10px", fontSize: 13, fontFamily: T.mono }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 8px" }}>…dan op post</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8, alignItems: "center" }}>
            <select value={nf.categoryId} onChange={(e) => setNf({ ...nf, categoryId: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}><option value="">— kies post —</option>{catOptions}</select>
            <input type="number" value={nf.priority} onChange={(e) => setNf({ ...nf, priority: e.target.value })} title="prioriteit (lager = eerst)" style={{ ...inputStyle, padding: "7px 10px", fontSize: 13, textAlign: "center" }} />
            <Btn size="sm" onClick={submitNew} disabled={!nf.value.trim() || !nf.categoryId}>Toevoegen</Btn>
          </div>
        </Card>
      )}

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 8, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Actief</span><span>Veld</span><span>Operator</span><span>Waarde</span><span>Post</span><span style={{ textAlign: "center" }}>Prio</span><span />
        </div>
        {sorted.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen regels. Maak er een met "+ Nieuwe regel".</div>}
        {sorted.map((r) => {
          const cond = r.conditions[0] || { field: "name", operator: "contains", value: "" };
          const setCond = (patch) => onUpdate(r.id, { conditions: [{ ...cond, ...patch }] });
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 8, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
              <Toggle on={r.active} onClick={() => onToggle(r.id)} />
              <select value={cond.field} onChange={(e) => setCond({ field: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select value={cond.operator} onChange={(e) => setCond({ operator: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(ol).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input value={cond.value} onChange={(e) => setCond({ value: e.target.value })} style={{ ...inputStyle, padding: "5px 8px", fontSize: 12, fontFamily: T.mono }} />
              <select value={r.categoryId} onChange={(e) => onUpdate(r.id, { categoryId: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{catOptions}</select>
              <input type="number" value={r.priority} onChange={(e) => onUpdate(r.id, { priority: Number(e.target.value) || 0 })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
              <Btn variant="danger" size="sm" onClick={() => onDelete(r.id)}>Wis</Btn>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Import({ categories, groups, rules, existingHashes, onCommit }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null); // { committed, dupCount, errors, autoCount, uncategorized }
  const [phase, setPhase] = useState("upload"); // upload | summary | done
  const [result, setResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const runWith = (csv) => {
    const head = (csv.split(/\r?\n/)[0] || "").toLowerCase();
    if (!/datum/.test(head) || !/bedrag|af bij|mutatiesoort/.test(head)) {
      setParsed({ committed: [], dupCount: 0, errors: ["Dit lijkt geen ING-bestand. Verwacht een kop met o.a. 'Datum' en 'Bedrag (EUR)'."], autoCount: 0, uncategorized: 0 });
      setPhase("summary"); return;
    }
    const { txns, errors } = parseINGCsv(csv);
    const reconciled = reconcileImport(txns.map((t, i) => ({ ...t, id: "tx-" + dedupHash(t) + "-" + i })), existingHashes);
    const news = reconciled.filter((r) => r.isNew);
    const dupCount = reconciled.length - news.length;
    let autoCount = 0;
    const committed = news.map((r) => {
      const tx = { ...r.item, hash: r.hash };
      const match = categorize(tx, rules);
      let allocations = [];
      if (match) { allocations = [{ categoryId: match.categoryId, amountCents: tx.amountCents }]; autoCount++; }
      return { ...tx, allocations, note: "", flagged: false };
    });
    setParsed({ committed, dupCount, errors, autoCount, uncategorized: committed.length - autoCount });
    setPhase("summary");
  };
  const run = () => runWith(text);
  const handleFile = async (file) => { if (!file) return; const csv = await file.text(); setText(csv); runWith(csv); };

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
      <SectionTitle>Importeren — je ING-CSV</SectionTitle>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: `2px dashed ${drag ? T.accent : T.line}`, background: drag ? T.accentSoft : T.panel, borderRadius: T.radius, padding: "22px 18px", marginBottom: 14, cursor: "pointer", textAlign: "center" }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sleep je ING-CSV hierheen</div>
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
              <div><b style={{ color: T.pos }}>{parsed.autoCount}</b> automatisch herkend door je regels.</div>
              <div><b style={{ color: T.warn }}>{parsed.uncategorized}</b> nog te sorteren — die loop je zo samen na, of vind je later op <b>Transacties</b>.</div>
            </div>
          </Card>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {n > 0 && <Btn onClick={() => setPhase("review")}>Begeleid nalopen ({n})</Btn>}
          {n > 0 && <Btn variant="secondary" onClick={doImport}>Direct toevoegen</Btn>}
          <Btn variant="ghost" onClick={() => { setParsed(null); setPhase("upload"); }}>Terug</Btn>
        </div>
      </div>
    );
  }

  if (phase === "review") return (
    <ImportReview items={parsed.committed} groups={groups} categories={categories} onCommit={finishReview} onCancel={() => { setParsed(null); setPhase("upload"); }} />
  );

  return (
    <div>
      <SectionTitle>Importeren — klaar</SectionTitle>
      <Banner tone="ok">{result.count} transactie(s) toegevoegd: {result.auto} ingedeeld{result.uncategorized > 0 ? `, ${result.uncategorized} nog te sorteren op Transacties` : ""}{result.rules ? `, en ${result.rules} nieuwe regel(s) geleerd` : ""}.</Banner>
      <div style={{ marginTop: 14 }}><Btn variant="secondary" onClick={() => { setText(""); setParsed(null); setResult(null); setPhase("upload"); }}>Nog een bestand importeren</Btn></div>
    </div>
  );
}

/* ============================================ TRANSACTIES & VERMOGEN */
function RuleLearn({ tx, categoryId, onAddRule }) {
  const [done, setDone] = useState(false);
  const [kw, setKw] = useState(guessKeyword(tx.name) || tx.name.toLowerCase());
  if (done) return <span style={{ fontSize: 12, color: T.pos }}>✓ regel gemaakt — voortaan automatisch</span>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Onthoud: alles met</span>
      <input value={kw} onChange={(e) => setKw(e.target.value)} style={{ ...inputStyle, width: 170, padding: "4px 8px", fontSize: 12, fontFamily: T.mono }} />
      <Btn size="sm" variant="secondary" onClick={() => { if (!kw.trim()) return; onAddRule({ categoryId, priority: 35, conditions: [{ field: "name", operator: "contains", value: kw.trim().toLowerCase() }] }); setDone(true); }}>Maak regel</Btn>
    </div>
  );
}

function SplitEditor({ tx, categories, groups, onSave, onCancel }) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  const total = Math.abs(tx.amountCents);
  const init = (tx.allocations && tx.allocations.length > 1)
    ? tx.allocations.map((a) => ({ categoryId: a.categoryId, mag: Math.abs(a.amountCents) }))
    : (tx.allocations && tx.allocations.length === 1
      ? [{ categoryId: tx.allocations[0].categoryId, mag: total }, { categoryId: "", mag: 0 }]
      : [{ categoryId: "", mag: total }, { categoryId: "", mag: 0 }]);
  const [rows, setRows] = useState(init);
  const sum = rows.reduce((s, r) => s + (r.mag || 0), 0);
  const remaining = total - sum;
  const filled = rows.filter((r) => r.mag > 0 && r.categoryId);
  const balanced = remaining === 0 && rows.filter((r) => r.mag > 0).every((r) => r.categoryId) && filled.length >= 1;
  const upd = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div style={{ background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Verdeel {formatEUR(tx.amountCents)} over posten</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 32px", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <CatSelect categories={categories} groups={groups} value={r.categoryId} sign={sign} onChange={(v) => upd(i, { categoryId: v })} />
          <MoneyInput cents={r.mag} onChange={(v) => upd(i, { mag: v })} />
          <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="regel weg" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, fontSize: 14 }}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { categoryId: "", mag: remaining > 0 ? remaining : 0 }])}>+ post</Btn>
          <span style={{ fontSize: 12, color: remaining === 0 ? T.pos : T.warn }}>{remaining === 0 ? "precies verdeeld" : remaining > 0 ? `nog ${formatEUR(remaining)} te verdelen` : `${formatEUR(-remaining)} te veel`}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={onCancel}>Annuleren</Btn>
          <Btn size="sm" disabled={!balanced} onClick={() => onSave(filled.map((r) => ({ categoryId: r.categoryId, amountCents: sign * r.mag })))}>Opslaan</Btn>
        </div>
      </div>
    </div>
  );
}

const TX_COLS = "78px 1fr 96px 200px 40px 34px";
function TxRow({ tx, groups, categories, onSetAllocations, onSetNote, onToggleFlag, onAddRule }) {
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const sign = tx.amountCents < 0 ? -1 : 1;
  const allocs = tx.allocations || [];
  const isSplit = allocs.length > 1;
  const uncategorized = allocs.length === 0;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const pickSingle = (catId) => onSetAllocations(tx.id, catId ? [{ categoryId: catId, amountCents: tx.amountCents }] : []);
  const bg = uncategorized ? "#fff9ef" : (tx.flagged ? "#fdf3f3" : undefined);
  return (
    <div style={{ borderTop: `1px solid ${T.line}`, background: bg }}>
      <div style={{ display: "grid", gridTemplateColumns: TX_COLS, gap: 10, alignItems: "center", padding: "8px 14px" }}>
        <span style={{ fontSize: 12, color: T.sub, fontFamily: T.mono }}>{tx.date.slice(8, 10)}-{tx.date.slice(5, 7)}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.name}{tx.note ? <span style={{ color: T.warn }}> · {tx.note}</span> : null}</div>
          {tx.omschrijving && tx.omschrijving !== tx.name && <div style={{ fontSize: 11, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.omschrijving}</div>}
        </div>
        <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 600, color: sign < 0 ? T.neg : T.pos }}>{formatEUR(tx.amountCents)}</span>
        <div>
          {isSplit
            ? <button onClick={() => { setOpen(true); setSplitting(true); }} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, textAlign: "left", cursor: "pointer", background: "#eef0ff", color: "#4338ca", border: "1px solid #d7dcff", borderRadius: 7 }}>Verdeeld over {allocs.length} posten ✎</button>
            : <CatSelect categories={categories} groups={groups} value={singleCat} sign={sign} onChange={pickSingle} placeholder={uncategorized ? "— te sorteren —" : "— kies post —"} />}
        </div>
        <button onClick={() => onToggleFlag(tx.id)} title={tx.flagged ? "markering weghalen" : "markeer: nog uitzoeken / voorgeschoten"} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 17, lineHeight: 1, color: tx.flagged ? T.warn : "#c7d0ce" }}>{tx.flagged ? "★" : "☆"}</button>
        <button onClick={() => setOpen((o) => !o)} title="meer" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, display: "flex", justifyContent: "center" }}><Icon d={open ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />} size={16} /></button>
      </div>
      {open && (
        <div style={{ padding: "0 14px 14px 90px", display: "flex", flexDirection: "column", gap: 10 }}>
          {tx.description && tx.description !== tx.omschrijving && <div style={{ fontSize: 12, color: T.sub, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px" }}><span style={{ fontWeight: 600 }}>Mededelingen: </span>{tx.description}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
            <input value={tx.note || ""} onChange={(e) => onSetNote(tx.id, e.target.value)} placeholder="bijv. voorgeschoten voor Maud" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
          </div>
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

function Transacties({ groups, categories, year, transactions, onSetAllocations, onSetNote, onToggleFlag, onAddRule }) {
  const [maand, setMaand] = useState(0);
  const [status, setStatus] = useState("alle");
  const [q, setQ] = useState("");
  const names = ["alle maanden", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const yearTx = useMemo(() => transactions.filter((t) => yearOf(t.date) === year.jaartal).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), [transactions, year]);
  const teSorteren = yearTx.filter((t) => !t.allocations || t.allocations.length === 0).length;
  const gemarkeerd = yearTx.filter((t) => t.flagged).length;
  const shown = yearTx.filter((t) => {
    if (maand && monthOf(t.date) !== maand) return false;
    if (status === "sorteren" && t.allocations && t.allocations.length > 0) return false;
    if (status === "gemarkeerd" && !t.flagged) return false;
    if (q) { const hay = (t.name + " " + (t.description || "") + " " + (t.note || "")).toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
    return true;
  });
  return (
    <div>
      <SectionTitle>Transacties {year.jaartal}</SectionTitle>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Transacties</div><div style={{ fontSize: 20, fontWeight: 700 }}>{yearTx.length}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Nog te sorteren</div><div style={{ fontSize: 20, fontWeight: 700, color: teSorteren ? T.warn : T.pos }}>{teSorteren}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Gemarkeerd</div><div style={{ fontSize: 20, fontWeight: 700, color: gemarkeerd ? T.warn : T.ink }}>{gemarkeerd}</div></Card>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <select value={maand} onChange={(e) => setMaand(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 13 }}>{names.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select>
        {[["alle", "Alle"], ["sorteren", "Te sorteren"], ["gemarkeerd", "Gemarkeerd"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setStatus(v)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${status === v ? T.accent : T.line}`, background: status === v ? T.accentSoft : T.panel, color: status === v ? T.accent : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{lbl}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="zoek op naam, mededeling of notitie" style={{ ...inputStyle, flex: 1, minWidth: 160, padding: "7px 10px", fontSize: 13 }} />
      </div>
      {yearTx.length === 0 ? (
        <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties in {year.jaartal}. Importeer je ING-CSV onder <b>Import</b>.</div></Card>
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: TX_COLS, gap: 10, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
            <span>Datum</span><span>Omschrijving</span><span style={{ textAlign: "right" }}>Bedrag</span><span>Post</span><span style={{ textAlign: "center" }}>Mark</span><span />
          </div>
          {shown.map((t) => <TxRow key={t.id} tx={t} groups={groups} categories={categories} onSetAllocations={onSetAllocations} onSetNote={onSetNote} onToggleFlag={onToggleFlag} onAddRule={onAddRule} />)}
          {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Geen transacties met dit filter.</div>}
        </Card>
      )}
    </div>
  );
}

function Vermogen({ pots, categories, transactions }) {
  const rows = pots.map((p) => {
    const cat = categories.find((c) => c.id === p.categoryId);
    let dep = 0, wd = 0;
    for (const t of transactions) for (const a of (t.allocations || [])) if (a.categoryId === p.categoryId) (a.amountCents < 0 ? (dep += Math.abs(a.amountCents)) : (wd += a.amountCents));
    return { naam: cat ? cat.naam : p.categoryId, opening: p.opening, dep, wd, current: p.opening + dep - wd };
  });
  const tot = rows.reduce((a, r) => ({ opening: a.opening + r.opening, dep: a.dep + r.dep, wd: a.wd + r.wd, current: a.current + r.current }), { opening: 0, dep: 0, wd: 0, current: 0 });
  const cols = "1fr 120px 110px 110px 130px";
  return (
    <div>
      <SectionTitle>Vermogen · opbouw per rekening</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Per spaar- of reserveringsrekening: het startsaldo, wat er dit jaar bij kwam en af ging, en het huidige saldo. Een storting herkent het systeem aan een overboeking náár die rekening (een uitgave op een spaarpost).</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Rekening</span><span style={{ textAlign: "right" }}>Startsaldo</span><span style={{ textAlign: "right" }}>Bij</span><span style={{ textAlign: "right" }}>Af</span><span style={{ textAlign: "right" }}>Huidig saldo</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{r.naam}</span>
            <span style={{ textAlign: "right" }}><Money cents={r.opening} muted /></span>
            <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.dep ? "+ " + formatEUR(r.dep) : "—"}</span>
            <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.wd ? "− " + formatEUR(r.wd) : "—"}</span>
            <span style={{ textAlign: "right" }}><Money cents={r.current} bold /></span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "12px 16px", borderTop: `2px solid ${T.line}`, background: "#f7faf9" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Totaal vermogen</span>
          <span style={{ textAlign: "right" }}><Money cents={tot.opening} muted /></span>
          <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontSize: 13 }}>{tot.dep ? "+ " + formatEUR(tot.dep) : "—"}</span>
          <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontSize: 13 }}>{tot.wd ? "− " + formatEUR(tot.wd) : "—"}</span>
          <span style={{ textAlign: "right" }}><Money cents={tot.current} bold size={16} /></span>
        </div>
      </Card>
    </div>
  );
}

/* ============================================ BEGELEIDE IMPORT-NALOOP */
function ImportReview({ items, groups, categories, onCommit, onCancel }) {
  const [work, setWork] = useState(() => items.map((t) => ({ ...t })));
  const [i, setI] = useState(0);
  const [learned, setLearned] = useState([]);
  const [splitting, setSplitting] = useState(false);
  const total = work.length;
  const cur = work[i];
  const sign = cur.amountCents < 0 ? -1 : 1;
  const allocs = cur.allocations || [];
  const isSplit = allocs.length > 1;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const teSorteren = work.filter((t) => !t.allocations || t.allocations.length === 0).length;

  const update = (patch) => setWork((w) => w.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const setSingle = (catId) => update({ allocations: catId ? [{ categoryId: catId, amountCents: cur.amountCents }] : [] });
  const learnRule = (rule) => {
    const full = { ...rule, id: "ru" + Math.random().toString(36).slice(2, 8), active: true };
    setLearned((L) => [...L, full]);
    setWork((w) => w.map((t, j) => (j > i && (!t.allocations || t.allocations.length === 0) && ruleMatches(t, full)) ? { ...t, allocations: [{ categoryId: full.categoryId, amountCents: t.amountCents }] } : t));
  };
  const go = (d) => { setSplitting(false); setI((x) => Math.max(0, Math.min(total - 1, x + d))); };

  return (
    <div>
      <SectionTitle>Importeren — nalopen</SectionTitle>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: T.sub }}>Transactie {i + 1} van {total}</span>
        <span style={{ fontSize: 13, color: teSorteren ? T.warn : T.pos }}>{teSorteren} nog te sorteren</span>
      </div>
      <div style={{ height: 4, background: "#eef2f1", borderRadius: 2, marginBottom: 14 }}><div style={{ height: 4, width: `${((i + 1) / total) * 100}%`, background: T.accent, borderRadius: 2 }} /></div>

      <Card style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{cur.name}</div>
            {cur.omschrijving && cur.omschrijving !== cur.name && <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>{cur.omschrijving}</div>}
            <div style={{ fontSize: 12, color: T.sub, marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{cur.date}</span><Badge>{cur.mutationType}</Badge></div>
            {cur.description && cur.description !== cur.omschrijving && <div style={{ fontSize: 12, color: T.sub, marginTop: 8, background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px" }}><b>Mededelingen: </b>{cur.description}</div>}
          </div>
          <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 20, color: sign < 0 ? T.neg : T.pos, whiteSpace: "nowrap" }}>{formatEUR(cur.amountCents)}</div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Waar hoort dit bij?</div>
        {isSplit
          ? <div style={{ fontSize: 13, marginBottom: 4 }}>Verdeeld over {allocs.length} posten. <button onClick={() => setSplitting(true)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600 }}>wijzig</button> · <button onClick={() => setSingle("")} style={{ border: "none", background: "transparent", color: T.sub, cursor: "pointer" }}>maak leeg</button></div>
          : <CatSelect categories={categories} groups={groups} value={singleCat} sign={sign} onChange={setSingle} placeholder="— kies een post (leeg laten = te sorteren) —" />}
        {splitting && <div style={{ marginTop: 10 }}><SplitEditor tx={cur} categories={categories} groups={groups} onSave={(a) => { update({ allocations: a }); setSplitting(false); }} onCancel={() => setSplitting(false)} /></div>}
        {!splitting && !isSplit && <div style={{ marginTop: 8 }}><Btn variant="ghost" size="sm" onClick={() => setSplitting(true)}>Verdeel over meerdere posten</Btn></div>}

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
          <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
          <input value={cur.note || ""} onChange={(e) => update({ note: e.target.value })} placeholder="bijv. voorgeschoten voor Maud" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={!!cur.flagged} onChange={(e) => update({ flagged: e.target.checked })} />
          Markeer als "nog uitzoeken / voorgeschoten"
        </label>

        {singleCat && <div style={{ marginTop: 12 }}><RuleLearn tx={cur} categoryId={singleCat} onAddRule={learnRule} /></div>}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="ghost" onClick={onCancel}>Annuleer import</Btn>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" onClick={() => go(-1)} disabled={i === 0}>Vorige</Btn>
          {i < total - 1 ? <Btn onClick={() => go(1)}>Volgende</Btn> : <Btn onClick={() => onCommit(work, learned)}>Alles toevoegen ({total})</Btn>}
        </div>
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}><button onClick={() => onCommit(work, learned)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Klaar — voeg alle {total} direct toe →</button></div>
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
  return merged;
}

/* ----------------------------------------------------------- Activiteit */
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
function Workspace({ state, setState, dbReady, user, meta, onLogout }) {
  const { groups, categories, years, activeYearId, budgets, pots, rules, transactions } = state;
  const [tab, setTab] = useState("overzicht");
  const [showChangePw, setShowChangePw] = useState(false);
  const [showNewYear, setShowNewYear] = useState(false);

  const year = years.find((y) => y.id === activeYearId) || years[0];
  const catById = useCallback((id) => categories.find((c) => c.id === id), [categories]);

  const derived = useMemo(() => {
    const lines = applySluitpost(categories, budgets[year.id] || {});
    const budgetNet = Array.from({ length: 12 }, () => 0);
    const beLines = [];
    for (const c of categories) {
      const line = lines[c.id], months = line ? line.months : null, annual = months ? sumMonths(months) : 0;
      beLines.push({ type: c.type, annual });
      if (months) for (let m = 0; m < 12; m++) budgetNet[m] += c.type === "income" ? months[m] : -months[m];
    }
    const breakEven = computeBreakEven(beLines);

    const yearTx = transactions.filter((t) => yearOf(t.date) === year.jaartal);
    const actuals = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    let currentMonth = 1;
    for (const t of yearTx) {
      const m = monthOf(t.date); currentMonth = Math.max(currentMonth, m);
      for (const a of t.allocations) {
        const cat = catById(a.categoryId);
        if (cat?.type === "income") actuals[m - 1].income += a.amountCents;
        else actuals[m - 1].expense += Math.abs(a.amountCents);
      }
    }
    const monthRows = computeRunningSaldo(year.carryInCents, actuals);
    const deviation = computeBudgetDeviation(actuals.map((a) => a.income - a.expense), budgetNet);

    const vermogen = pots.reduce((sum, p) => {
      const deposits = [], withdrawals = [];
      for (const t of transactions) for (const a of t.allocations) if (a.categoryId === p.categoryId) (a.amountCents < 0 ? deposits.push(Math.abs(a.amountCents)) : withdrawals.push(a.amountCents));
      return sum + p.opening + deposits.reduce((x, y) => x + y, 0) - withdrawals.reduce((x, y) => x + y, 0);
    }, 0);

    const vitals = { saldo: monthRows[currentMonth - 1].end, deviation: deviation[currentMonth - 1], vermogen, potCount: pots.length };

    const signals = [];
    for (const c of categories) {
      if (c.type !== "expense") continue;
      const line = lines[c.id]; if (!line) continue;
      let actual = 0;
      for (const t of yearTx) { if (monthOf(t.date) > currentMonth) continue; for (const a of t.allocations) if (a.categoryId === c.id) actual += Math.abs(a.amountCents); }
      const budgetYTD = sumMonths(line.months.slice(0, currentMonth));
      if (actual > budgetYTD && budgetYTD > 0) signals.push({ tone: "warn", text: `${c.naam.split(":")[0]}: ${formatEUR(actual)} besteed t/m maand ${currentMonth}, begroot ${formatEUR(budgetYTD)}.` });
    }

    const existingHashes = new Map();
    for (const t of transactions) existingHashes.set(t.hash, (existingHashes.get(t.hash) || 0) + 1);

    return { breakEven, monthRows, vitals, signals, currentMonth, existingHashes };
  }, [budgets, year, categories, transactions, pots, catById]);

  const prevYear = years.find((y) => y.jaartal === year.jaartal - 1) || null;
  const prevActualByCat = useMemo(() => {
    if (!prevYear) return null;
    const map = {};
    for (const t of transactions) {
      if (yearOf(t.date) !== prevYear.jaartal) continue;
      for (const a of t.allocations) { if (!map[a.categoryId]) map[a.categoryId] = 0; map[a.categoryId] += Math.abs(a.amountCents); }
    }
    return map;
  }, [transactions, prevYear]);

  const openActions = useMemo(() => {
    const items = [];
    for (const t of transactions) {
      const uncategorized = !t.allocations || t.allocations.length === 0;
      if (uncategorized) items.push({ ...t, reason: "te sorteren" });
      else if (t.flagged) items.push({ ...t, reason: "gemarkeerd" });
    }
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { teSorteren: items.filter((i) => i.reason === "te sorteren").length, gemarkeerd: items.filter((i) => i.reason === "gemarkeerd").length, count: items.length, items };
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
  const addCategory = (groupId, naam, type) => {
    setState((s) => {
      const base = slug(naam) || "post"; let id = base, i = 2;
      while (s.categories.some((c) => c.id === id)) id = base + "-" + i++;
      return { ...s, categories: [...s.categories, { id, naam, groupId, type, noteSuggested: false }] };
    });
    logAction(`post toegevoegd: ${naam}`);
  };
  const updateCategory = (id, patch) => setState((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
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
  const addRule = (rule) => { setState((s) => ({ ...s, rules: [...s.rules, { ...rule, id: "ru" + Math.random().toString(36).slice(2, 8), active: true }] })); logAction("regel toegevoegd"); };
  const setTxAllocations = (txId, allocations) => { setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, allocations } : t)) })); logAction(allocations.length === 0 ? "transactie op 'te sorteren' gezet" : allocations.length > 1 ? "transactie over meerdere posten verdeeld" : "transactie ingedeeld"); };
  const setTxNote = (txId, note) => setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, note } : t)) }));
  const toggleTxFlag = (txId) => setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === txId ? { ...t, flagged: !t.flagged } : t)) }));
  const commitImport = (txns, newRules) => {
    setState((s) => ({ ...s, transactions: [...s.transactions, ...txns], rules: newRules && newRules.length ? [...s.rules, ...newRules] : s.rules }));
    logAction(`${txns.length} transactie(s) geïmporteerd${newRules && newRules.length ? `, ${newRules.length} regel(s) geleerd` : ""}`);
  };
  const setActiveYear = (id) => setState((s) => ({ ...s, activeYearId: id }));
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

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans }}>
      <aside style={{ width: 220, background: T.panel, borderRight: `1px solid ${T.line}`, flexShrink: 0, padding: "20px 14px", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: T.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>€</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Huishoudboekje</div>
        </div>
        {nav.map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 8, marginBottom: 2, fontSize: 14, fontWeight: 600, background: tab === id ? T.accentSoft : "transparent", color: tab === id ? T.accent : T.sub }}>
            <span style={{ color: tab === id ? T.accent : "#9aa8a5", display: "flex" }}><Icon d={icon} /></span>{label}
          </button>
        ))}
        <div style={{ position: "absolute", bottom: 16, left: 14, right: 14 }}>
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
        <div style={{ display: "flex", borderBottom: `1px solid ${T.line}`, background: T.panel, position: "sticky", top: 0, zIndex: 5 }}>
          {[["Lopend saldo", <Money key="s" cents={derived.vitals.saldo} sign bold size={18} />],
            ["Afwijking begroting", <Money key="d" cents={derived.vitals.deviation} sign bold size={18} />],
            ["Vermogen", <Money key="v" cents={derived.vitals.vermogen} bold size={18} />]].map(([label, node], i) => (
            <div key={i} style={{ padding: "12px 22px", borderRight: i < 2 ? `1px solid ${T.line}` : "none" }}>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 2 }}>{label}</div>{node}
            </div>
          ))}
          <div style={{ marginLeft: "auto", padding: "10px 18px", alignSelf: "center", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <YearSwitcher years={years} activeYearId={activeYearId} onSelect={setActiveYear} onNew={() => setShowNewYear(true)} />
            {meta && meta.updatedBy && <div style={{ fontSize: 11, color: T.sub }}>laatst bijgewerkt door {meta.updatedBy}</div>}
          </div>
        </div>

        <div style={{ padding: "24px 28px", maxWidth: 1080 }}>
          {tab === "overzicht" && <Overzicht vitals={derived.vitals} signals={derived.signals} breakEven={derived.breakEven} monthRows={derived.monthRows} currentMonth={derived.currentMonth} jaar={year.jaartal} openActions={openActions} onGoto={setTab} />}
          {tab === "begroting" && <Begroting groups={groups} categories={categories} budgets={budgets} year={year} onSaveLine={saveLine} onImportBudget={onImportBudget} onAddCategory={addCategory} prevYear={prevYear} prevActualByCat={prevActualByCat} />}
          {tab === "transacties" && <Transacties groups={groups} categories={categories} year={year} transactions={transactions} onSetAllocations={setTxAllocations} onSetNote={setTxNote} onToggleFlag={toggleTxFlag} onAddRule={addRule} />}
          {tab === "uitgaven" && <Uitgaven groups={groups} categories={categories} budgets={budgets} year={year} transactions={transactions} onAddCategory={addCategory} />}
          {tab === "vermogen" && <Vermogen pots={pots} categories={categories} transactions={transactions} />}
          {tab === "posten" && <Posten groups={groups} categories={categories} transactions={transactions} onToggleNote={toggleNote} onUpdateCategory={updateCategory} onDeleteCategory={deleteCategory} onAddCategory={addCategory} />}
          {tab === "import" && <Import categories={categories} groups={groups} rules={rules} existingHashes={derived.existingHashes} onCommit={commitImport} />}
          {tab === "regels" && <Regels rules={rules} categories={categories} groups={groups} onToggle={toggleRule} onDelete={deleteRule} onUpdate={updateRule} onAdd={addRule} onAddDefaults={onAddDefaults} />}
          {tab === "activiteit" && <Activiteit />}
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
  const loadedRef = useRef(false);
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    const r = await getState();
    setDbReady(!!r.db);
    let s = r.state;
    if (!s) { s = buildSeed(); try { await putState(s); } catch {} }
    else s = mergeSeed(s);
    setState(s);
    setMeta({ updatedBy: r.updatedBy, updatedAt: r.updatedAt });
    loadedRef.current = true;
    setPhase("ready");
  }, []);

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

  useEffect(() => {
    if (phase !== "ready" || !loadedRef.current || !state) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      putState(state).then((r) => { setDbReady(!!r.db); if (r.updatedBy) setMeta({ updatedBy: r.updatedBy, updatedAt: new Date().toISOString() }); }).catch(() => {});
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state, phase]);

  const onLoginSuccess = (r) => {
    setUser(r.user); setDbReady(!!r.db);
    if (r.mustChange) setPhase("change"); else load();
  };
  const onChangeDone = () => { load(); };
  const onLogout = async () => {
    try { await apiLogout(); } catch {}
    setUser(null); setState(null); loadedRef.current = false; setPhase("login");
  };

  if (phase === "loading")
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, color: T.sub, fontFamily: T.sans, fontSize: 14 }}>Bezig met laden…</div>;
  if (phase === "login") return <LoginScreen onSuccess={onLoginSuccess} />;
  if (phase === "change" && user) return <ChangePasswordScreen user={user} onDone={onChangeDone} />;
  if (phase === "ready" && state && user) return <Workspace state={state} setState={setState} dbReady={dbReady} user={user} meta={meta} onLogout={onLogout} />;
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, color: T.sub, fontFamily: T.sans, fontSize: 14 }}>Bezig met laden…</div>;
}
