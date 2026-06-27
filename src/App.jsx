import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { me, getUsers, login as apiLogin, changePassword as apiChangePassword, logout as apiLogout, getState, putState, getActivity, logAction } from "./api.js";

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

  let income = 0, outflow = 0;
  for (const c of categories) { const a = A[c.id] || 0; c.type === "income" ? (income += a) : (outflow += a); }
  A[cid("Gezamenlijke spaarrekening / ING")] = income - outflow; // sluitpost

  const lines = {};
  for (const c of categories) { const a = A[c.id] || 0; if (a !== 0) lines[c.id] = { average: a, months: distributeEven(a) }; }

  const year = { id: "2026", jaartal: 2026, carryInCents: -1199, status: "open" }; // Achterzoom −€11,99
  const budgets = { "2026": lines };

  const pots = [
    { categoryId: cid("Gezamenlijke spaarrekening / ING"), opening: 1_200_000 },
    { categoryId: cid("Woning / ABN"), opening: 2_400_000 },
    { categoryId: cid("Vakantie / ING"), opening: 180_000 },
    { categoryId: cid("Eigen risico / ING"), opening: 38_500 },
    { categoryId: cid("Spaarrekening Maud / ING"), opening: 320_000 },
  ];

  // Een paar duidelijke startregels; de rommelige (persoonsoverboekingen, horeca)
  // laat je in de popup categoriseren — en leren.
  const rules = [
    { id: "r1", categoryId: cid("Boodschappen: supermarkt, speciaalzaak, drogist"), priority: 30, active: true, conditions: [{ field: "name", operator: "contains", value: "albert heijn" }] },
    { id: "r2", categoryId: cid("Boodschappen: supermarkt, speciaalzaak, drogist"), priority: 30, active: true, conditions: [{ field: "name", operator: "contains", value: "plus moerkapelle" }] },
    { id: "r3", categoryId: cid("Bankkosten / ING"), priority: 20, active: true, conditions: [{ field: "name", operator: "contains", value: "kosten oranjepakket" }] },
    { id: "r4", categoryId: cid("Bankkosten / ING"), priority: 20, active: true, conditions: [{ field: "name", operator: "contains", value: "kosten tweede rekeninghouder" }] },
    { id: "r5", categoryId: cid("Kleding; zit in zakgeld"), priority: 40, active: true, conditions: [{ field: "name", operator: "contains", value: "zeeman" }] },
  ];

  return { groups, categories, budgets, year, pots, rules, transactions: [] };
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
const Card = ({ children, style }) => <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: T.radius, ...style }}>{children}</div>;
function Money({ cents, sign = false, bold = false, muted = false, size }) {
  const color = !sign ? (muted ? T.sub : T.ink) : cents > 0 ? T.pos : cents < 0 ? T.neg : T.sub;
  return <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color, fontWeight: bold ? 700 : 500, fontSize: size }}>{formatEUR(cents)}</span>;
}
function MoneyInput({ cents, onChange, width = 110, align = "right" }) {
  const [str, setStr] = useState(cents != null ? editEUR(cents) : "");
  useEffect(() => { setStr(cents != null ? editEUR(cents) : ""); }, [cents]);
  return <input value={str} onChange={(e) => { setStr(e.target.value); try { onChange(parseDecimalToCents(e.target.value || "0")); } catch {} }}
    onBlur={() => setStr(cents != null ? editEUR(cents) : "")}
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

/** Doorzoekbare, gegroepeerde categoriekiezer. */
function CategoryPicker({ groups, categories, value, onChange, autoFocus }) {
  const [q, setQ] = useState("");
  const f = q.toLowerCase();
  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
      <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een post…"
        style={{ ...inputStyle, border: "none", borderBottom: `1px solid ${T.line}`, borderRadius: 0 }} />
      <div style={{ maxHeight: 230, overflowY: "auto" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id && c.naam.toLowerCase().includes(f));
          if (!cats.length) return null;
          return (
            <div key={g.id}>
              <div style={{ padding: "6px 12px", background: "#f0f4f3", fontSize: 11, fontWeight: 700, color: T.sub, position: "sticky", top: 0 }}>{g.naam}</div>
              {cats.map((c) => (
                <button key={c.id} onClick={() => onChange(c.id)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                  padding: "8px 12px", fontSize: 13, background: value === c.id ? T.accent : "transparent", color: value === c.id ? "#fff" : T.ink,
                }}>
                  <span>{c.naam}</span>
                  {c.noteSuggested && <span style={{ fontSize: 10, color: value === c.id ? "#cdeae6" : T.warn }}>opmerking</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================= POPUP */
function guessKeyword(name) {
  let s = String(name);
  if (s.includes("*")) s = s.split("*").slice(1).join("*");
  s = s.replace(/\b(nld|nl|prom|apple pay|gouda|zoetermeer|wassenaar|moerkapelle|zaandam)\b/gi, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function ReviewPopup({ queue, groups, categories, rules, onFinish, onCancel }) {
  const [decisions, setDecisions] = useState({}); // id -> {categoryId, note}
  const [skipped, setSkipped] = useState(() => new Set());
  const [learned, setLearned] = useState([]);
  const [toast, setToast] = useState(null);

  // huidige item: eerste in de wachtrij zonder beslissing en niet overgeslagen
  const current = queue.find((t) => !(t.id in decisions) && !skipped.has(t.id)) || null;

  const [catId, setCatId] = useState("");
  const [note, setNote] = useState("");
  const [learn, setLearn] = useState(false);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    if (!current) return;
    const auto = categorize(current, [...rules, ...learned]);
    setCatId(auto?.categoryId || "");
    setNote("");
    setLearn(false);
    setKeyword(guessKeyword(current.name) || current.name.toLowerCase());
  }, [current && current.id]);

  if (!current) return null;
  const cat = categories.find((c) => c.id === catId);
  const needNote = cat?.noteSuggested;
  const total = queue.length;
  const doneCount = Object.keys(decisions).length + skipped.size;

  const confirm = () => {
    if (!catId) return;
    const next = { ...decisions, [current.id]: { categoryId: catId, note: note || "" } };
    const newRules = [...learned];
    if (learn && keyword.trim()) {
      const rule = { id: "rl" + Date.now(), categoryId: catId, priority: 35, active: true, conditions: [{ field: "name", operator: "contains", value: keyword.trim().toLowerCase() }] };
      newRules.push(rule);
      // pas direct toe op de overige transacties in de wachtrij
      let applied = 0;
      for (const t of queue) {
        if (t.id === current.id || t.id in next || skipped.has(t.id)) continue;
        if (ruleMatches(t, rule)) { next[t.id] = { categoryId: catId, note: "" }; applied++; }
      }
      setToast(applied > 0 ? `Ook ${applied} andere transactie${applied > 1 ? "s" : ""} met "${keyword.trim()}" op deze post gezet.` : null);
      setLearned(newRules);
    } else setToast(null);
    const stillTodo = queue.some((t) => !(t.id in next) && !skipped.has(t.id));
    if (stillTodo) setDecisions(next); else onFinish(next, newRules);
  };

  const skip = () => {
    const ns = new Set(skipped).add(current.id);
    const stillTodo = queue.some((t) => !(t.id in decisions) && !ns.has(t.id));
    if (stillTodo) setSkipped(ns); else onFinish(decisions, learned);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,22,0.55)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 560, background: T.panel, borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* voortgang */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Transacties nalopen</span>
          <span style={{ fontSize: 13, color: T.sub }}>{doneCount} van {total} klaar</span>
        </div>
        <div style={{ height: 4, background: "#eef2f1" }}><div style={{ height: 4, width: `${(doneCount / total) * 100}%`, background: T.accent }} /></div>

        <div style={{ padding: 20 }}>
          {/* transactie */}
          <div style={{ background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{current.name}</div>
                {current.omschrijving && current.omschrijving !== current.name && (
                  <div style={{ fontSize: 13, color: T.sub, marginTop: 2 }}>{current.omschrijving}</div>
                )}
                <div style={{ fontSize: 12, color: T.sub, marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{current.date}</span><Badge>{current.mutationType}</Badge>
                </div>
              </div>
              <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 20, color: current.amountCents < 0 ? T.neg : T.pos, whiteSpace: "nowrap" }}>{formatEUR(current.amountCents)}</div>
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Waar hoort dit bij?</div>
          <CategoryPicker groups={groups} categories={categories} value={catId} onChange={setCatId} autoFocus />

          {needNote && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Opmerking <span style={{ color: T.sub, fontWeight: 400 }}>(handig bij deze post)</span></div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="bijv. verjaardag Pernille" style={inputStyle} />
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
            Onthoud dit, zodat ik het niet meer hoef te kiezen
          </label>
          {learn && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: T.sub }}>Alles met de tekst</span>
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ ...inputStyle, width: 200, padding: "5px 8px", fontSize: 13, fontFamily: T.mono }} />
              <span style={{ fontSize: 12, color: T.sub }}>→ deze post</span>
            </div>
          )}

          {toast && <div style={{ marginTop: 12, fontSize: 12, color: T.pos, background: "#e8f5ee", padding: "6px 10px", borderRadius: 7 }}>{toast}</div>}
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.line}`, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Btn variant="ghost" onClick={onCancel}>Annuleer alles</Btn>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={skip}>Sla over</Btn>
            <Btn disabled={!catId} onClick={confirm}>Bevestig & volgende</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================================== */
/* PAGINA'S                                                              */
/* ===================================================================== */

function Overzicht({ vitals, signals, breakEven, monthRows, currentMonth }) {
  const tile = (label, node, sub) => (
    <Card style={{ padding: 18, flex: 1, minWidth: 190 }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 700, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>{node}</div>
      {sub && <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
  const mn = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return (
    <div>
      <SectionTitle>Overzicht · t/m {mn[currentMonth - 1]} 2026</SectionTitle>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {tile("Lopend saldo", <Money cents={vitals.saldo} sign bold />, "begin + inkomsten − uitgaven")}
        {tile("Afwijking t.o.v. begroting", <Money cents={vitals.deviation} sign bold />, vitals.deviation >= 0 ? "voor op planning" : "achter op planning")}
        {tile("Gereserveerd vermogen", <Money cents={vitals.vermogen} bold />, `${vitals.potCount} potjes`)}
      </div>
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

function Begroting({ groups, categories, budgets, year, onSaveLine, breakEven }) {
  const [expanded, setExpanded] = useState(null);
  const lines = budgets[year.id] || {};
  const lineFor = (cid) => lines[cid] || { average: 0, months: distributeEven(0) };
  return (
    <div>
      <SectionTitle>Begroting {year.jaartal}</SectionTitle>
      <div style={{ marginBottom: 16 }}>
        {breakEven.ok ? <Banner tone="ok">De begroting is sluitend: inkomsten en uitgaven (incl. sparen) zijn precies in balans op {formatEUR(breakEven.income)} per jaar.</Banner>
          : <Banner tone="warn">Nog niet sluitend — {breakEven.diff > 0 ? "overschot" : "tekort"} van {formatEUR(Math.abs(breakEven.diff))} per jaar.</Banner>}
      </div>
      <Card style={{ overflow: "hidden" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          if (!cats.length) return null;
          const subtotal = cats.reduce((a, c) => a + sumMonths(lineFor(c.id).months), 0);
          return (
            <div key={g.id}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>
                <span>{g.naam}</span><span style={{ fontFamily: T.mono }}>{formatEUR(subtotal)}/jaar</span>
              </div>
              {cats.map((c) => {
                const line = lineFor(c.id), annual = sumMonths(line.months), isOpen = expanded === c.id;
                return (
                  <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 120px 80px", alignItems: "center", gap: 10, padding: "8px 16px" }}>
                      <span style={{ fontSize: 14 }}>{c.naam}{c.noteSuggested && <span title="opmerking voorgesteld" style={{ marginLeft: 6, color: T.warn }}>•</span>}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, color: T.sub }}>gem.</span>
                        <MoneyInput cents={line.average} width={95} onChange={(v) => onSaveLine(c.id, v, distributeEven(v))} />
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} muted /><span style={{ fontSize: 11, color: T.sub }}>/jr</span></div>
                      <div style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "maanden"}</Btn></div>
                    </div>
                    {isOpen && <MonthEditor line={line} onSave={(months) => onSaveLine(c.id, line.average, months)} />}
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

function Posten({ groups, categories, onToggleNote }) {
  const typeLabel = { income: "inkomsten", expense: "uitgave", savings: "sparen" };
  return (
    <div>
      <SectionTitle>Posten</SectionTitle>
      <Card style={{ overflow: "hidden" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          if (!cats.length) return null;
          return (
            <div key={g.id}>
              <div style={{ padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
              {cats.map((c) => (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}` }}>
                  <span style={{ fontSize: 14 }}>{c.naam}</span>
                  <Badge tone={c.type}>{typeLabel[c.type]}</Badge>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: T.sub }}>opmerking vragen</span>
                    <Toggle on={c.noteSuggested} onClick={() => onToggleNote(c.id)} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Regels({ rules, categories, onToggle, onDelete }) {
  const catName = (id) => categories.find((c) => c.id === id)?.naam || "—";
  const fl = { iban: "tegenrekening", name: "naam", description: "omschrijving", mutationType: "mutatiesoort", amount: "bedrag" };
  const ol = { equals: "is", contains: "bevat", startsWith: "begint met", amountRange: "tussen" };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  return (
    <div>
      <SectionTitle>Regels</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Regels ontstaan vanzelf wanneer je tijdens het importeren "Onthoud dit" aanvinkt. Hier kun je ze bekijken, uitzetten of verwijderen.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "60px 2fr 1.4fr 60px 80px", gap: 10, padding: "9px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700, color: T.sub }}>
          <span>Actief</span><span>Als…</span><span>Dan post</span><span style={{ textAlign: "center" }}>Prio</span><span></span>
        </div>
        {sorted.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "60px 2fr 1.4fr 60px 80px", gap: 10, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}` }}>
            <Toggle on={r.active} onClick={() => onToggle(r.id)} />
            <span style={{ fontSize: 13 }}>{r.conditions.map((c, i) => <span key={i}>{i > 0 && <span style={{ color: T.sub }}> en </span>}<b>{fl[c.field]}</b> {ol[c.operator]} "<span style={{ fontFamily: T.mono }}>{c.value}</span>"</span>)}</span>
            <span style={{ fontSize: 13 }}>{catName(r.categoryId)}</span>
            <span style={{ textAlign: "center", fontFamily: T.mono, fontSize: 13 }}>{r.priority}</span>
            <Btn variant="danger" size="sm" onClick={() => onDelete(r.id)}>Verwijder</Btn>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Import({ categories, groups, rules, existingHashes, onCommit }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [phase, setPhase] = useState("upload"); // upload | summary | review | done
  const [result, setResult] = useState(null);

  const run = () => {
    const { txns, errors } = parseINGCsv(text);
    const reconciled = reconcileImport(txns.map((t, i) => ({ ...t, id: "tx-" + dedupHash(t) + "-" + i })), existingHashes);
    setParsed({ reconciled, errors });
    setPhase("summary");
  };

  const news = parsed ? parsed.reconciled.filter((r) => r.isNew) : [];
  const dupCount = parsed ? parsed.reconciled.length - news.length : 0;

  // bepaal welke aandacht nodig hebben (geen regel, of regel naar note-post)
  const prepared = useMemo(() => {
    if (!parsed) return { auto: [], queue: [] };
    const auto = [], queue = [];
    for (const r of news) {
      const tx = { ...r.item, id: r.id, hash: r.hash };
      const match = categorize(tx, rules);
      const cat = match && categories.find((c) => c.id === match.categoryId);
      if (match && !cat?.noteSuggested) auto.push({ tx, categoryId: match.categoryId });
      else queue.push(tx);
    }
    return { auto, queue };
  }, [parsed]);

  const finish = (decisions, learnedRules) => {
    const committed = [...prepared.auto.map((a) => ({ ...a.tx, allocations: [{ categoryId: a.categoryId, amountCents: a.tx.amountCents }] }))];
    for (const tx of prepared.queue) {
      const d = decisions[tx.id];
      if (!d) continue; // overgeslagen
      committed.push({ ...tx, allocations: [{ categoryId: d.categoryId, amountCents: tx.amountCents, note: d.note || undefined }] });
    }
    onCommit(committed, learnedRules);
    setResult({ count: committed.length, rules: learnedRules.length, auto: prepared.auto.length });
    setPhase("done");
  };

  if (phase === "upload") return (
    <div>
      <SectionTitle>Importeren — je ING-CSV</SectionTitle>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}>Open je ING-export, kopieer de inhoud en plak die hieronder. Of laad het meegeleverde voorbeeld van je eigen afschrift.</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="Datum;Naam / Omschrijving;Rekening;Tegenrekening;…"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: T.mono, fontSize: 12, padding: 10, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Btn onClick={run} disabled={!text.trim()}>Verwerk bestand</Btn>
          <Btn variant="secondary" onClick={() => setText(SAMPLE_CSV)}>Laad mijn ING-voorbeeld</Btn>
        </div>
      </Card>
    </div>
  );

  if (phase === "summary") return (
    <div>
      <SectionTitle>Importeren — overzicht</SectionTitle>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Banner tone="neutral"><b>{news.length}</b> nieuwe transacties · <b>{dupCount}</b> duplicaten overgeslagen</Banner>
        {parsed.errors.length > 0 && <Banner tone="warn">{parsed.errors.length} regel(s) niet gelezen</Banner>}
      </div>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>
          <div><b style={{ color: T.pos }}>{prepared.auto.length}</b> transacties zijn automatisch herkend door je regels — die hoef je niet na te lopen.</div>
          <div><b style={{ color: T.warn }}>{prepared.queue.length}</b> transacties hebben je aandacht nodig: een post kiezen, of een opmerking toevoegen.</div>
        </div>
      </Card>
      <div style={{ display: "flex", gap: 8 }}>
        {prepared.queue.length > 0
          ? <Btn onClick={() => setPhase("review")}>Begin met nalopen ({prepared.queue.length})</Btn>
          : <Btn onClick={() => finish({}, [])}>Verwerk {prepared.auto.length} transacties</Btn>}
        <Btn variant="secondary" onClick={() => { setParsed(null); setPhase("upload"); }}>Terug</Btn>
      </div>
      {phase === "review" && null}
    </div>
  );

  if (phase === "review") return (
    <div>
      <SectionTitle>Importeren — nalopen</SectionTitle>
      <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>De popup leidt je door de transacties die je aandacht nodig hebben.</div></Card>
      <ReviewPopup queue={prepared.queue} groups={groups} categories={categories} rules={rules} onFinish={finish} onCancel={() => { setParsed(null); setPhase("upload"); }} />
    </div>
  );

  // done
  return (
    <div>
      <SectionTitle>Importeren — klaar</SectionTitle>
      <Banner tone="ok">{result.count} transacties verwerkt ({result.auto} automatisch herkend){result.rules > 0 ? `, en ${result.rules} nieuwe regel${result.rules > 1 ? "s" : ""} geleerd voor de volgende keer` : ""}. Je overzicht is bijgewerkt.</Banner>
      <div style={{ marginTop: 14 }}><Btn variant="secondary" onClick={() => { setText(""); setParsed(null); setResult(null); setPhase("upload"); }}>Nog een bestand importeren</Btn></div>
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
  const { groups, categories, year, budgets, pots, rules, transactions } = state;
  const [tab, setTab] = useState("overzicht");
  const [showChangePw, setShowChangePw] = useState(false);

  const catById = useCallback((id) => categories.find((c) => c.id === id), [categories]);

  const derived = useMemo(() => {
    const lines = budgets[year.id] || {};
    const budgetNet = Array.from({ length: 12 }, () => 0);
    const beLines = [];
    for (const c of categories) {
      const line = lines[c.id], months = line ? line.months : null, annual = months ? sumMonths(months) : 0;
      beLines.push({ type: c.type, annual });
      if (months) for (let m = 0; m < 12; m++) budgetNet[m] += c.type === "income" ? months[m] : -months[m];
    }
    const breakEven = computeBreakEven(beLines);

    const actuals = Array.from({ length: 12 }, () => ({ income: 0, expense: 0 }));
    let currentMonth = 1;
    for (const t of transactions) {
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
      for (const t of transactions) { if (monthOf(t.date) > currentMonth) continue; for (const a of t.allocations) if (a.categoryId === c.id) actual += Math.abs(a.amountCents); }
      const budgetYTD = sumMonths(line.months.slice(0, currentMonth));
      if (actual > budgetYTD && budgetYTD > 0) signals.push({ tone: "warn", text: `${c.naam.split(":")[0]}: ${formatEUR(actual)} besteed t/m maand ${currentMonth}, begroot ${formatEUR(budgetYTD)}.` });
    }

    const existingHashes = new Map();
    for (const t of transactions) existingHashes.set(t.hash, (existingHashes.get(t.hash) || 0) + 1);

    return { breakEven, monthRows, vitals, signals, currentMonth, existingHashes };
  }, [budgets, year, categories, transactions, pots, catById]);

  const saveLine = (catId, average, months) =>
    setState((s) => ({ ...s, budgets: { ...s.budgets, [s.year.id]: { ...(s.budgets[s.year.id] || {}), [catId]: { average, months } } } }));
  const toggleNote = (id) => {
    setState((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, noteSuggested: !c.noteSuggested } : c)) }));
    const c = categories.find((x) => x.id === id); logAction(`post-instelling gewijzigd: ${(c || {}).naam || id}`);
  };
  const toggleRule = (id) => { setState((s) => ({ ...s, rules: s.rules.map((x) => (x.id === id ? { ...x, active: !x.active } : x)) })); logAction("regel aan-/uitgezet"); };
  const deleteRule = (id) => { setState((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== id) })); logAction("regel verwijderd"); };
  const commitImport = (txns, newRules) => {
    setState((s) => ({ ...s, transactions: [...s.transactions, ...txns], rules: newRules && newRules.length ? [...s.rules, ...newRules] : s.rules }));
    logAction(`${txns.length} transactie(s) geïmporteerd${newRules && newRules.length ? `, ${newRules.length} regel(s) geleerd` : ""}`);
  };

  const nav = [
    ["overzicht", "Overzicht", icons.overzicht],
    ["begroting", "Begroting", icons.begroting],
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
          <div style={{ marginLeft: "auto", padding: "12px 22px", alignSelf: "center", fontSize: 12, color: T.sub, textAlign: "right" }}>
            <div>Jaar {year.jaartal}</div>
            {meta && meta.updatedBy && <div style={{ fontSize: 11 }}>laatst bijgewerkt door {meta.updatedBy}</div>}
          </div>
        </div>

        <div style={{ padding: "24px 28px", maxWidth: 1080 }}>
          {tab === "overzicht" && <Overzicht vitals={derived.vitals} signals={derived.signals} breakEven={derived.breakEven} monthRows={derived.monthRows} currentMonth={derived.currentMonth} />}
          {tab === "begroting" && <Begroting groups={groups} categories={categories} budgets={budgets} year={year} onSaveLine={saveLine} breakEven={derived.breakEven} />}
          {tab === "posten" && <Posten groups={groups} categories={categories} onToggleNote={toggleNote} />}
          {tab === "import" && <Import categories={categories} groups={groups} rules={rules} existingHashes={derived.existingHashes} onCommit={commitImport} />}
          {tab === "regels" && <Regels rules={rules} categories={categories} onToggle={toggleRule} onDelete={deleteRule} />}
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

  // toestand bewaren (debounced) zodra die wijzigt
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
