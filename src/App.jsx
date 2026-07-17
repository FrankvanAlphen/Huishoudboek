import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { HuishoudProvider } from "./store.jsx";
import { me, logout as apiLogout, getState, putState, logAction, attachmentCounts } from "./api.js";
import { effDate, effYear, effMonth, distributeEven, sumMonths, dedupHash, slug } from "./lib.js";
import { computeRunningSaldo, bankBalanceFromTxns, saldoChainGaps, openingFromChain, derivedPotMutation, potFlows, debugLogImport, categorize, settlementsOf, allocsFromSettlements, remainingOf, SLUITPOST_ID, applySluitpost, txYearActuals } from "./financieel.js";
import { buildSeed, mergeSeed } from "./seed.js";
import { T, ErrorBoundary, useIsMobile, Icon, icons, Money } from "./ui.jsx";
import { Uitgaven } from "./uitgaven.jsx";
import { Transacties } from "./transacties.jsx";
import { Begroting } from "./begroting.jsx";
import { Overzicht } from "./overzicht.jsx";
import { Vermogen } from "./vermogen.jsx";
import { Posten, Regels, Import } from "./beheer.jsx";
import { YearSwitcher, NewYearDialog, DataBackup, Activiteit, ChangePasswordCard, ChangePasswordScreen, LoginScreen, MobileHome } from "./account.jsx";

// ---- Opstart en werkruimte ----
// Workspace() houdt de state vast, leidt alle cijfers af (de grote useMemo), regelt
// opslaan met revisiecontrole (409-conflict), polling en navigatie tussen tabbladen.
// App() eronder doet het opstarten: inloggen -> wachtwoord -> laden -> werkruimte.

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
  // Eén gedeelde context i.p.v. dezelfde props overal doorgeven (geen prop-drilling).
  const ctx = useMemo(() => ({ user, other, tasks, attachCounts, refreshAttachCounts, addTask, toggleTask, removeTask, isMobile }), [user, other.name, tasks, attachCounts, refreshAttachCounts, addTask, toggleTask, removeTask, isMobile]);

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

    const vitals = { vermogen, potCount: categories.filter((c) => c.type === "savings").length };

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

    return { monthly, topPostsByMonth, vitals, currentMonth, existingHashes, accountBalance, forecast, forecastYear, reconciliation, agingAdvances, bankBalanceCents, saldoGaps, chainOpening, freqAlerts, topDeviations, missingRecurring, recurringTotal, recurringPaid, savingsRate, vastMonthly, varMonthly };
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
  // Laatste import ongedaan maken: verwijdert precies de transacties van die ene batch.
  const clearBatch = (batchId) => {
    if (!batchId) return;
    setState((s) => ({
      ...s,
      transactions: s.transactions.filter((t) => t.batchId !== batchId),
      // batch stond mogelijk als "nagelopen" gemarkeerd; die vlag heeft nu geen doel meer
      reviewedBatches: (s.reviewedBatches || []).filter((b) => b !== batchId),
    }));
    logAction("laatste import verwijderd");
  };
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
  // ---- Gedeelde bundels (tikkie) ----
  // Een bundel bestaat zodra transacties het label dragen; hier hangen we er personen aan.
  const bundelDef = (s, key) => (s.bundles || []).find((b) => b.key === key);
  // Groepsgrootte zetten via de deelknop. n = totaal aantal personen INCLUSIEF jou,
  // dus de personenlijst (de anderen) wordt n-1 lang. Krimpen gooit de laatste namen weg
  // en ruimt hun betalingskoppelingen op, anders blijft er geld aan een spook hangen.
  const setBundleSize = (key, n) => {
    const k = String(key || "").trim().toLowerCase();
    const anderen = Math.max(0, Math.min(50, Math.round(n) - 1));
    if (!k) return;
    setState((s) => {
      const bestaand = (s.bundles || []).find((b) => b.key === k);
      const huidig = (bestaand && bestaand.people) || [];
      let people = huidig.slice(0, anderen);
      for (let i = people.length; i < anderen; i++) people.push({ id: "bp" + Math.random().toString(36).slice(2, 8), naam: `Persoon ${i + 1}` });
      const weg = huidig.slice(anderen).map((p) => p.id);
      const label = (s.transactions.find((t) => ((t.bundle || "").trim().toLowerCase()) === k) || {}).bundle || k;
      const bundles = bestaand
        ? (s.bundles || []).map((b) => (b.key === k ? { ...b, people } : b))
        : [...(s.bundles || []), { key: k, naam: String(label).trim(), people }];
      const transactions = weg.length === 0 ? s.transactions : s.transactions.map((t) => {
        const sm = settlementsOf(t);
        if (!sm.some((x) => x.bundleKey === k && weg.includes(x.personId))) return t;
        const settlements = sm.filter((x) => !(x.bundleKey === k && weg.includes(x.personId)));
        return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) };
      });
      return { ...s, bundles, transactions };
    });
    logAction("bundel gedeeld door " + Math.round(n));
  };
  const renameBundlePerson = (key, personId, naam) => {
    const k = String(key || "").trim().toLowerCase();
    setState((s) => ({ ...s, bundles: (s.bundles || []).map((b) => (b.key === k ? { ...b, people: (b.people || []).map((p) => (p.id === personId ? { ...p, naam } : p)) } : b)) }));
  };
  // Betaling van één persoon koppelen aan een bundel.
  const linkBundlePayment = (incomingId, key, personId, amountCents) => {
    if (!(amountCents > 0)) return;
    const k = String(key || "").trim().toLowerCase();
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => {
      if (t.id !== incomingId) return t;
      const settlements = [...settlementsOf(t).filter((x) => !(x.bundleKey === k && x.personId === personId)), { bundleKey: k, personId, amountCents }];
      return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) };
    }) }));
    logAction("bundelbetaling gekoppeld");
  };
  const unlinkBundlePayment = (incomingId, key, personId) => {
    const k = String(key || "").trim().toLowerCase();
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => {
      if (t.id !== incomingId) return t;
      const settlements = settlementsOf(t).filter((x) => !(x.bundleKey === k && x.personId === personId));
      return { ...t, settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) };
    }) }));
    logAction("bundelbetaling ontkoppeld");
  };
  // Bundel verwijderen = alleen het label weghalen. De transacties zelf blijven staan.
  const removeBundle = (key) => {
    const k = String(key || "").trim().toLowerCase();
    setState((s) => ({
      ...s,
      bundles: (s.bundles || []).filter((b) => b.key !== k),
      transactions: s.transactions.map((t) => {
        const heeftLabel = ((t.bundle || "").trim().toLowerCase()) === k;
        const sm = settlementsOf(t);
        const raakt = sm.some((x) => x.bundleKey === k);
        if (!heeftLabel && !raakt) return t;
        const settlements = sm.filter((x) => x.bundleKey !== k);
        return {
          ...t,
          ...(heeftLabel ? { bundle: "" } : {}),
          ...(raakt ? { settledWith: undefined, settlements, allocations: allocsFromSettlements(settlements, s.transactions) } : {}),
        };
      }),
    }));
    logAction("bundel verwijderd");
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
    <HuishoudProvider value={ctx}>
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
            {tab === "mhome" && <MobileHome bankNow={bankNow} teSorteren={teSorterenBadge} transactions={transactions.filter((t) => effYear(t) === year.jaartal)} tasks={tasks} onStartReview={startReview} onToggleTask={toggleTask} onRemoveTask={removeTask} onOpenTx={(txId) => gotoTransacties({ txId })} />}
            {tab === "overzicht" && <Overzicht vitals={derived.vitals} monthly={derived.monthly} topPostsByMonth={derived.topPostsByMonth} teSorteren={teSorterenBadge} onDrill={gotoTransacties} currentMonth={derived.currentMonth} jaar={year.jaartal} openActions={openActions} forecast={derived.forecast} forecastYear={derived.forecastYear} reconciliation={derived.reconciliation} agingAdvances={derived.agingAdvances} openingBalanceCents={openingBalanceCents} bankBalanceCents={derived.bankBalanceCents} saldoGaps={derived.saldoGaps} chainOpening={derived.chainOpening} freqAlerts={derived.freqAlerts} topDeviations={derived.topDeviations} missingRecurring={derived.missingRecurring} recurringTotal={derived.recurringTotal} recurringPaid={derived.recurringPaid} savingsRate={derived.savingsRate} vastMonthly={derived.vastMonthly} varMonthly={derived.varMonthly} onSetOpeningBalance={setOpeningBalance} onGoto={setTab} onReview={startReview} />}
            {tab === "begroting" && <Begroting groups={groups} categories={categories} budgets={budgets} year={year} onSaveLine={saveLine} onImportBudget={onImportBudget} onAddCategory={addCategory} onAddGroup={addGroup} onAcceptSluitpost={acceptSluitpost} prevYear={prevYear} prevActualByCat={prevActualByCat} onSetYtd={setYtdSeed} onSetSubBudget={setSubBudget} />}
            {tab === "transacties" && <Transacties bundles={state.bundles || []} onClearBatch={clearBatch} onOpenBundels={() => setTab("uitgaven")} groups={groups} categories={categories} year={year} transactions={transactions} rules={rules} onSetAllocations={setTxAllocations} onSetNote={setTxNote} onToggleFlag={toggleTxFlag} onAddRule={addRule} onSaveOne={patchTx} onClearYear={clearYearTransactions} onClearRange={clearTransactionsInRange} onClearAll={clearAllTransactions} onResetAll={resetAllKeepRules} onAddManual={addManualTx} onLinkSettle={linkSettlement} onUnlinkSettle={unlinkSettlement} onUnsettle={unsettleTx} onCreateSavings={createSavingsAccount} onLinkSavings={linkSavingsCode} reviewedBatches={reviewedBatches} onMarkBatchReviewed={markBatchReviewed} kickReview={reviewKick} years={years} preset={txPreset} onPresetConsumed={() => setTxPreset(null)} />}
            {tab === "uitgaven" && <Uitgaven groups={groups} categories={categories} budgets={budgets} year={year} years={years} transactions={transactions} onAddCategory={addCategory} onSetYtd={setYtdSeed} bundles={state.bundles || []} onSetBundleSize={setBundleSize} onRenameBundlePerson={renameBundlePerson} onRemoveBundle={removeBundle} onLinkBundlePayment={linkBundlePayment} onUnlinkBundlePayment={unlinkBundlePayment} />}
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
    </HuishoudProvider>
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
