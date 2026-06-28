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
const monthOf = (iso) => Number(iso.slice(5, 7));
// In overzichten toont een eigen notitie zich in plaats van de bank-omschrijving.
const txDesc = (t) => (t && t.note && t.note.trim()) ? t.note.trim() : ((t && (t.omschrijving || t.name)) || "");
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
  if (!categories) return null;
  const hay = `${tx.name || ""} ${tx.omschrijving || ""} ${tx.description || ""}`.toLowerCase();
  for (const c of categories) {
    const code = String(c.spaarcode || "").trim().toLowerCase();
    if (code && hay.includes(code)) return { categoryId: c.id, ruleId: "spaarcode" };
  }
  return null;
}
function categorize(tx, rules, categories) {
  const sc = matchSpaarcode(tx, categories); // accountnummer is het betrouwbaarst — gaat vóór gewone regels
  if (sc) return sc;
  const sign = tx.amountCents < 0 ? -1 : 1;
  const catById = (id) => (categories || []).find((c) => c.id === id);
  let best = null;
  for (const r of rules) { if (r.active && ruleMatches(tx, r) && catAllowed(catById(r.categoryId), sign) && (!best || r.priority < best.priority)) best = r; }
  return best ? { categoryId: best.categoryId, ruleId: best.id } : null;
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

const yearOf = (iso) => Number(iso.slice(0, 4));
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
  };
  for (const c of categories) if (SPAARCODES[c.naam]) c.spaarcode = SPAARCODES[c.naam];

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

  const years = [{ id: "2026", jaartal: 2026, carryInCents: -1199, status: "open" }]; // Achterzoom −€11,99
  const budgets = { "2026": balanced };

  const pots = [
    { categoryId: cid("Gezamenlijke spaarrekening / ING"), opening: 1_200_000 },
    { categoryId: cid("Woning / ABN"), opening: 2_400_000 },
    { categoryId: cid("Vakantie / ING"), opening: 180_000 },
    { categoryId: cid("Eigen risico / ING"), opening: 38_500 },
    { categoryId: cid("Spaarrekening Maud / ING"), opening: 320_000 },
    { categoryId: cid("Aandelenrekening"), opening: 0 },
  ];

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

  return { groups, categories, budgets, years, activeYearId: "2026", pots, rules, transactions: [], openingBalanceCents: null };
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

function Overzicht({ vitals, signals, breakEven, monthRows, currentMonth, jaar, openActions, forecast, openingBalanceCents, bankBalanceCents, freqAlerts = [], onSetOpeningBalance, onGoto, onReview }) {
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
  const matches = haveBank && diff === 0;
  const fixOpening = () => onSetOpeningBalance((openingBalanceCents || 0) - diff); // trek startsaldo gelijk aan de bank
  return (
    <div>
      <SectionTitle>Overzicht · t/m {mn[currentMonth - 1]} {jaar}</SectionTitle>

      {!fc.openingSet && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14", marginBottom: 4 }}>Stel eerst je startsaldo in</div>
          {haveBank ? (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Goed nieuws: in je geïmporteerde bestand staat je werkelijke banksaldo (<b>{formatEUR(bankBalanceCents)}</b> na je laatste transactie). Daarmee zet ik je startsaldo in één klik goed, zodat je huidige saldo exact met je bank klopt.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Btn onClick={fixOpening}>Gebruik mijn banksaldo ({formatEUR(bankBalanceCents)})</Btn>
                <span style={{ fontSize: 12, color: T.sub }}>of handmatig:</span>
                <MoneyInput cents={openingBalanceCents || 0} width={140} onChange={(v) => onSetOpeningBalance(v)} />
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Vul het saldo van je ING-rekening in zoals het was vóór je eerste transactie. Daar tellen alle mutaties bij op, zodat je huidige saldo hieronder gelijk hoort te zijn aan je ING-app. Tip: importeer je ING-bestand — daar staat je saldo in en kan ik dit automatisch doen.</div>
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
          <div style={{ fontSize: 12, color: T.sub, marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>startsaldo + alle mutaties · vergelijk met je ING-app</span>
          </div>
          {haveBank && (
            matches ? (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: T.pos, display: "flex", alignItems: "center", gap: 6 }}>✓ Klopt met je bank ({formatEUR(bankBalanceCents)})</div>
            ) : (
              <div style={{ marginTop: 10, background: T.warnSoft, border: "1px solid #f0dcb8", borderRadius: 8, padding: "9px 11px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#9a6a14" }}>⚠ {formatEUR(Math.abs(diff))} {diff > 0 ? "hoger" : "lager"} dan je bank</div>
                <div style={{ fontSize: 12, color: "#7a5a1a", margin: "4px 0 8px" }}>Saldo volgens je laatste import: <b>{formatEUR(bankBalanceCents)}</b>. Mogelijk mis je transacties, staan er dubbele in, of klopt je startsaldo niet.</div>
                <Btn size="sm" onClick={fixOpening}>Startsaldo gelijktrekken met de bank</Btn>
              </div>
            )
          )}
          {fc.openingSet && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: T.sub }}>Startsaldo</span>
              <MoneyInput cents={openingBalanceCents || 0} width={140} onChange={(v) => onSetOpeningBalance(v)} />
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
        </Card>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {tile(`Lopend saldo begroting ${jaar}`, <Money cents={vitals.saldo} sign bold />, "begin + inkomsten − uitgaven")}
        {tile("Afwijking t.o.v. begroting", <Money cents={vitals.deviation} sign bold />, vitals.deviation >= 0 ? "voor op planning" : "achter op planning")}
        {tile("Gereserveerd vermogen", <Money cents={vitals.vermogen} bold />, `${vitals.potCount} rekeningen · bekijk opbouw`, () => onGoto && onGoto("vermogen"))}
      </div>

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

function Uitgaven({ groups, categories, budgets, year, years = [], transactions, onAddCategory, onSetYtd }) {
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState("vergelijking"); // vergelijking | blokjes | maand
  const [viewYearId, setViewYearId] = useState(year.id);
  const vY = years.find((y) => y.id === viewYearId) || year;
  const lines = applySluitpost(categories, budgets[vY.id] || {});
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
            {[["vergelijking", "Vergelijking"], ["analyse", "Begroot vs besteed"], ["maand", "Per maand"], ["winkels", "Per winkel"], ["subposten", "Subposten"], ["bundels", "Bundels"], ["blokjes", "Blokjes per post"]].map(([v, lbl]) => (
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
      {view === "subposten" && <SubpostView categories={categories} transactions={transactions} vY={vY} />}
      {view === "bundels" && <BundelView transactions={transactions} categories={categories} />}
      {view === "maand" && <MaandMatrix groups={groups} categories={categories} lines={lines} actualByCat={actualByCat} names={names} />}
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

function SubpostView({ categories, transactions, vY }) {
  const postsWithSubs = categories.filter((c) => (c.subs || []).length > 0);
  if (postsWithSubs.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen posten met subposten. Ga naar <b>Posten</b>, klik bij een uitgavepost op <b>subs</b> en voeg subposten toe (bijv. Boodschappen → AH/Jumbo, of Maud → Kleding/inventaris/verbruik/overige). Daarna kies je per transactie een subpost.</div></Card>;
  const data = postsWithSubs.map((c) => {
    const map = {}; let untagged = 0, total = 0;
    for (const t of transactions) { if (effYear(t) !== vY.jaartal) continue; for (const a of t.allocations) { if (a.categoryId !== c.id) continue; const v = Math.abs(a.amountCents); total += v; if (a.sub && (c.subs || []).includes(a.sub)) map[a.sub] = (map[a.sub] || 0) + v; else untagged += v; } }
    const rows = (c.subs || []).map((s) => ({ label: s, val: map[s] || 0 }));
    if (untagged > 0) rows.push({ label: "— zonder subpost —", val: untagged, muted: true });
    return { c, rows, total };
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>De werkelijke uitgaven per subpost binnen een post ({vY.jaartal}). De begroting blijft op de hoofdpost; dit laat alleen zien waar het geld binnen die post naartoe ging.</div>
      {data.map(({ c, rows, total }) => (
        <Card key={c.id} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f0f4f3", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam}</span>
            <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{formatEUR(total)}</span>
          </div>
          {total === 0 && <div style={{ padding: "10px 16px", fontSize: 12.5, color: T.sub }}>Nog geen uitgaven op deze post in {vY.jaartal}.</div>}
          {total > 0 && rows.map((r) => { const pct = total > 0 ? Math.round((r.val / total) * 100) : 0; return (
            <div key={r.label} style={{ padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 4 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: r.muted ? T.sub : T.ink, fontStyle: r.muted ? "italic" : "normal" }}>{r.label}</span>
                <span style={{ fontFamily: T.mono, fontWeight: 600, flexShrink: 0 }}>{formatEUR(r.val)} <span style={{ color: T.sub, fontWeight: 400 }}>· {pct}%</span></span>
              </div>
              <div style={{ height: 6, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: r.muted ? "#c7d0ce" : T.accent }} /></div>
            </div>
          ); })}
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
  const anyData = Object.values(blocksByCat).some((b) => b && b.length);
  if (!anyData) return <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties om als blokjes te tonen. Importeer eerst je ING-bestand onder <b>Import</b>.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Per post zie je hier elke transactie als los blokje — met bedrag, een eventuele notitie en de datum. Geld terug op een uitgavepost staat groen (dat verlaagt de post).</div>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && (blocksByCat[c.id] || []).length > 0);
        if (cats.length === 0) return null;
        return (
          <Card key={g.id} style={{ overflow: "hidden" }}>
            <div style={{ padding: "9px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
            {cats.map((c) => {
              const blocks = blocksByCat[c.id] || [];
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
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 108px 96px 126px 92px 76px", gap: 10, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}`, background: isSluit ? "#fcf9e8" : undefined }}>
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
function TxRow({ tx, groups, categories, rules = [], history = [], years = [], onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne }) {
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
  const bg = uncategorized ? "#fff9ef" : (tx.flagged ? "#fdf3f3" : undefined);
  const sugIds = uncategorized ? rankSuggestions(tx, rules, categories, history, 3) : [];
  return (
    <div style={{ borderTop: `1px solid ${T.line}`, background: bg }}>
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

function Transacties({ groups, categories, year, years = [], transactions, rules = [], onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne, onClearYear, onClearRange, onClearAll, onResetAll, onAddManual, onLinkSettle, onUnlinkSettle, onUnsettle, kickReview }) {
  const [showCleanup, setShowCleanup] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showVoorschot, setShowVoorschot] = useState(false);
  const openAdvances = transactions.filter((t) => t.advance && remainingOf(t, transactions) > 0).length;
  const [maand, setMaand] = useState(0);
  const [status, setStatus] = useState("alle");
  const [q, setQ] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const names = ["alle maanden", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const yearTx = useMemo(() => transactions.filter((t) => effYear(t) === year.jaartal).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), [transactions, year]);
  const teSorterenItems = yearTx.filter((t) => !t.allocations || t.allocations.length === 0);
  const teSorteren = teSorterenItems.length;
  useEffect(() => { if (kickReview && teSorteren > 0) setReviewing(true); }, [kickReview]);
  const gemarkeerd = yearTx.filter((t) => t.flagged).length;
  const shown = yearTx.filter((t) => {
    if (maand && effMonth(t) !== maand) return false;
    if (status === "sorteren" && t.allocations && t.allocations.length > 0) return false;
    if (status === "gemarkeerd" && !t.flagged) return false;
    if (q) { const hay = (t.name + " " + (t.description || "") + " " + (t.note || "")).toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
    return true;
  });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Transacties {year.jaartal}</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onAddManual && <Btn variant={showManual ? "secondary" : "ghost"} size="sm" onClick={() => { setShowManual((s) => !s); setShowCleanup(false); setShowVoorschot(false); }}>{showManual ? "Sluiten" : "+ Losse transactie"}</Btn>}
          {onLinkSettle && <Btn variant={showVoorschot ? "secondary" : "ghost"} size="sm" onClick={() => { setShowVoorschot((s) => !s); setShowManual(false); setShowCleanup(false); }}>{showVoorschot ? "Sluiten" : `Tikkies${openAdvances ? ` (${openAdvances})` : ""}`}</Btn>}
          {(onClearRange || onClearYear) && <Btn variant={showCleanup ? "secondary" : "ghost"} size="sm" onClick={() => { setShowCleanup((s) => !s); setShowManual(false); setShowVoorschot(false); }}>{showCleanup ? "Opschonen sluiten" : "Opschonen / wissen"}</Btn>}
        </div>
      </div>
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
      {teSorteren > 0 && onSaveOne && (
        <div style={{ marginBottom: 14 }}>
          <Btn onClick={() => setReviewing(true)}>Toe te kennen nalopen ({teSorteren}) →</Btn>
          <span style={{ fontSize: 12, color: T.sub, marginLeft: 10 }}>Loop ze één voor één na in het begeleidingsscherm; je kunt altijd stoppen en later verder.</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <select value={maand} onChange={(e) => setMaand(Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "7px 10px", fontSize: 13 }}>{names.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select>
        {[["alle", "Alle"], ["sorteren", "Toe te kennen"], ["gemarkeerd", "Gemarkeerd"]].map(([v, lbl]) => (
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
          <datalist id="bundel-labels">{bundleLabels(transactions).map((b) => <option key={b} value={b} />)}</datalist>
          {shown.map((t) => <TxRow key={t.id} tx={t} groups={groups} categories={categories} rules={rules} history={transactions} years={years} onSetAllocations={onSetAllocations} onSetNote={onSetNote} onToggleFlag={onToggleFlag} onAddRule={onAddRule} onSaveOne={onSaveOne} />)}
          {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Geen transacties met dit filter.</div>}
        </Card>
      )}
      </>
      )}
    </div>
  );
}

function Vermogen({ pots, categories, transactions, onSetPotOpening, onSetSpaarcode }) {
  const potOpening = (cid) => { const p = pots.find((x) => x.categoryId === cid); return p ? p.opening : 0; };
  const rows = categories.filter((c) => c.type === "savings").map((c) => {
    let dep = 0, wd = 0;
    for (const t of transactions) for (const a of (t.allocations || [])) if (a.categoryId === c.id) (a.amountCents < 0 ? (dep += Math.abs(a.amountCents)) : (wd += a.amountCents));
    const opening = potOpening(c.id);
    return { categoryId: c.id, naam: c.naam, spaarcode: c.spaarcode || "", opening, dep, wd, current: opening + dep - wd };
  });
  const tot = rows.reduce((a, r) => ({ opening: a.opening + r.opening, dep: a.dep + r.dep, wd: a.wd + r.wd, current: a.current + r.current }), { opening: 0, dep: 0, wd: 0, current: 0 });
  const cols = "1fr 130px 110px 110px 130px";
  return (
    <div>
      <SectionTitle>Vermogen · opbouw per rekening</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Per spaar- of reserveringsrekening: het <b>startsaldo</b> (typ je zelf in), wat er dit jaar bij kwam en af ging, en het huidige saldo. Vul de <b>Oranje-code</b> in (bijv. <span style={{ fontFamily: T.mono }}>H17729888</span>) — die staat in de mededelingen bij een over-/bijschrijving, en dan herkent de app stortingen en opnames automatisch en zet ze op de juiste rekening.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Rekening</span><span style={{ textAlign: "right" }}>Startsaldo</span><span style={{ textAlign: "right" }}>Bij</span><span style={{ textAlign: "right" }}>Af</span><span style={{ textAlign: "right" }}>Huidig saldo</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${T.line}` }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{r.naam}</div>
              {onSetSpaarcode && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 11, color: T.sub }}>Oranje-code</span>
                <input value={r.spaarcode} onChange={(e) => onSetSpaarcode(r.categoryId, e.target.value.trim())} placeholder="bijv. H17729888" style={{ ...inputStyle, width: 130, padding: "3px 7px", fontSize: 11, fontFamily: T.mono }} />
              </div>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {onSetPotOpening ? <MoneyInput cents={r.opening} width={120} onChange={(v) => onSetPotOpening(r.categoryId, v)} /> : <Money cents={r.opening} muted />}
            </div>
            <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.dep ? "+ " + formatEUR(r.dep) : "—"}</span>
            <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.wd ? "− " + formatEUR(r.wd) : "—"}</span>
            <span style={{ textAlign: "right" }}><Money cents={r.current} bold /></span>
          </div>
        ))}
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
  const openingBalanceCents = state.openingBalanceCents ?? null;
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

    const vermogen = categories.filter((c) => c.type === "savings").reduce((sum, c) => {
      const pot = pots.find((p) => p.categoryId === c.id);
      let dep = 0, wd = 0;
      for (const t of transactions) for (const a of t.allocations) if (a.categoryId === c.id) (a.amountCents < 0 ? (dep += Math.abs(a.amountCents)) : (wd += a.amountCents));
      return sum + (pot ? pot.opening : 0) + dep - wd;
    }, 0);

    const vitals = { saldo: monthRows[currentMonth - 1].end, deviation: deviation[currentMonth - 1], vermogen, potCount: categories.filter((c) => c.type === "savings").length };

    const accountBalance = (openingBalanceCents || 0) + transactions.reduce((s, t) => s + t.amountCents, 0);
    let budOut = 0, budInc = 0;
    for (const c of categories) { const line = lines[c.id]; if (!line) continue; const m = line.months[currentMonth - 1] || 0; if (c.type === "income") budInc += m; else budOut += m; }
    const remainingOut = Math.max(0, budOut - actuals[currentMonth - 1].expense);
    const remainingInc = Math.max(0, budInc - actuals[currentMonth - 1].income);
    const forecast = { month: currentMonth, accountBalance, remainingOut, remainingInc, projectedEnd: accountBalance + remainingInc - remainingOut, openingSet: openingBalanceCents != null };

    const signals = [];
    for (const c of categories) {
      if (c.type !== "expense") continue;
      const line = lines[c.id]; if (!line) continue;
      let actual = 0;
      for (const t of yearTx) { if (effMonth(t) > currentMonth) continue; for (const a of t.allocations) if (a.categoryId === c.id) actual += -a.amountCents; }
      const budgetYTD = sumMonths(line.months.slice(0, currentMonth));
      if (actual > budgetYTD && budgetYTD > 0) signals.push({ tone: "warn", text: `${c.naam.split(":")[0]}: ${formatEUR(actual)} besteed t/m maand ${currentMonth}, begroot ${formatEUR(budgetYTD)}.` });
    }

    const existingHashes = new Map();
    for (const t of transactions) existingHashes.set(t.hash, (existingHashes.get(t.hash) || 0) + 1);

    const bankBalanceCents = bankBalanceFromTxns(transactions);
    const saldoGaps = saldoChainGaps(transactions);
    if (saldoGaps > 0) signals.unshift({ tone: "neg", text: `Saldo-controle: je bankafschriften sluiten niet helemaal op elkaar aan (op ${saldoGaps} plek${saldoGaps > 1 ? "ken" : ""}). Mogelijk ontbreken er transacties — importeer de ontbrekende periode.` });

    const freqAlerts = [];
    { const cnt = {};
      for (const t of yearTx) { const seen = new Set(); for (const a of t.allocations) { if (seen.has(a.categoryId)) continue; seen.add(a.categoryId); cnt[a.categoryId] = (cnt[a.categoryId] || 0) + 1; } }
      for (const c of categories) { if (c.freqPerYear && cnt[c.id] && cnt[c.id] > c.freqPerYear) freqAlerts.push({ id: c.id, naam: c.naam, count: cnt[c.id], max: c.freqPerYear }); }
    }

    return { breakEven, monthRows, vitals, signals, currentMonth, existingHashes, accountBalance, forecast, bankBalanceCents, saldoGaps, freqAlerts };
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
  const acceptSluitpost = (cents) => { setState((s) => ({ ...s, years: s.years.map((y) => (y.id === s.activeYearId ? { ...y, sluitpostAcceptedCents: cents } : y)) })); logAction("sluitpost geaccepteerd"); };
  const setYtdSeed = (yearId, catId, cents) => { setState((s) => ({ ...s, years: s.years.map((y) => (y.id === yearId ? { ...y, ytdSeed: { ...(y.ytdSeed || {}), [catId]: cents } } : y)) })); logAction("stand t/m heden bijgewerkt"); };
  const setOpeningBalance = (cents) => { setState((s) => ({ ...s, openingBalanceCents: cents })); logAction("startsaldo ingesteld"); };
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
  const teSorterenBadge = transactions.reduce((n, t) => n + (effYear(t) === year.jaartal && (!t.allocations || t.allocations.length === 0) ? 1 : 0), 0);

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans }}>
      <aside style={{ width: 220, background: T.panel, borderRight: `1px solid ${T.line}`, flexShrink: 0, padding: "20px 14px", position: "sticky", top: 0, height: "100vh", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: T.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>€</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Huishoudboekje</div>
        </div>
        {nav.map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "9px 10px", borderRadius: 8, marginBottom: 2, fontSize: 14, fontWeight: 600, background: tab === id ? T.accentSoft : "transparent", color: tab === id ? T.accent : T.sub }}>
            <span style={{ color: tab === id ? T.accent : "#9aa8a5", display: "flex" }}><Icon d={icon} /></span>
            <span style={{ flex: 1 }}>{label}</span>
            {id === "transacties" && teSorterenBadge > 0 && <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: T.warn, color: "#fff" }}>{teSorterenBadge}</span>}
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
          {!dbReady && (
            <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 9, background: T.warnSoft, border: `1px solid #f0dcb8`, color: "#7a5a1a", fontSize: 13, lineHeight: 1.5 }}>
              <b>Let op: je gegevens worden nu in tijdelijk geheugen bewaard en verdwijnen bij een herstart van de server.</b> Koppel in Railway een PostgreSQL-database en zet de variabele <code>DATABASE_URL</code> (Railway doet dit meestal automatisch als je een Postgres-plugin toevoegt). Daarna wordt alles blijvend opgeslagen.
            </div>
          )}
          {tab === "overzicht" && <Overzicht vitals={derived.vitals} signals={derived.signals} breakEven={derived.breakEven} monthRows={derived.monthRows} currentMonth={derived.currentMonth} jaar={year.jaartal} openActions={openActions} forecast={derived.forecast} openingBalanceCents={openingBalanceCents} bankBalanceCents={derived.bankBalanceCents} freqAlerts={derived.freqAlerts} onSetOpeningBalance={setOpeningBalance} onGoto={setTab} onReview={startReview} />}
          {tab === "begroting" && <Begroting groups={groups} categories={categories} budgets={budgets} year={year} onSaveLine={saveLine} onImportBudget={onImportBudget} onAddCategory={addCategory} onAddGroup={addGroup} onAcceptSluitpost={acceptSluitpost} prevYear={prevYear} prevActualByCat={prevActualByCat} onSetYtd={setYtdSeed} />}
          {tab === "transacties" && <Transacties groups={groups} categories={categories} year={year} transactions={transactions} rules={rules} onSetAllocations={setTxAllocations} onSetNote={setTxNote} onToggleFlag={toggleTxFlag} onAddRule={addRule} onSaveOne={patchTx} onClearYear={clearYearTransactions} onClearRange={clearTransactionsInRange} onClearAll={clearAllTransactions} onResetAll={resetAllKeepRules} onAddManual={addManualTx} onLinkSettle={linkSettlement} onUnlinkSettle={unlinkSettlement} onUnsettle={unsettleTx} kickReview={reviewKick} years={years} />}
          {tab === "uitgaven" && <Uitgaven groups={groups} categories={categories} budgets={budgets} year={year} years={years} transactions={transactions} onAddCategory={addCategory} onSetYtd={setYtdSeed} />}
          {tab === "vermogen" && <Vermogen pots={pots} categories={categories} transactions={transactions} onSetPotOpening={setPotOpening} onSetSpaarcode={(id, code) => updateCategory(id, { spaarcode: code })} />}
          {tab === "posten" && <Posten groups={groups} categories={categories} transactions={transactions} year={year} onToggleNote={toggleNote} onUpdateCategory={updateCategory} onDeleteCategory={deleteCategory} onAddCategory={addCategory} />}
          {tab === "import" && <Import categories={categories} groups={groups} rules={rules} existingHashes={derived.existingHashes} history={transactions} onCommit={commitImport} onStartReview={startReview} />}
          {tab === "regels" && <Regels rules={rules} categories={categories} groups={groups} transactions={transactions} onToggle={toggleRule} onDelete={deleteRule} onBulkDelete={bulkDeleteRules} onUpdate={updateRule} onAdd={addRule} onAddDefaults={onAddDefaults} />}
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
