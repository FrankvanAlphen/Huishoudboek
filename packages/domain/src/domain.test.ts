import { test } from "node:test";
import assert from "node:assert/strict";

import {
  annualTotalFromAverage,
  distributeEven,
  sumMonths,
  checkDistribution,
  setMonthKeepingTotal,
  computeBreakEven,
} from "./budget";
import {
  computeRunningSaldo,
  yearEndSaldo,
  computeBudgetDeviation,
  forecastYearEndSaldo,
} from "./saldo";
import { computePotBalance, totalSavings } from "./pot";
import { dedupHash, reconcileImport, type DedupSource } from "./dedup";
import { categorize, matchCondition, type Rule, type MatchableTransaction } from "./rules";
import type { Twelve, Cents, MonthlyActual } from "./types";

const twelve = <T>(fill: (i: number) => T): Twelve<T> =>
  Array.from({ length: 12 }, (_, i) => fill(i)) as Twelve<T>;

// ---------------------------------------------------------------- Begroting

test("begroting: jaartotaal = gemiddelde × 12", () => {
  assert.equal(annualTotalFromAverage(10_000), 120_000);
});

test("begroting: gelijke verdeling klopt met het jaartotaal", () => {
  const months = distributeEven(2_500);
  assert.equal(sumMonths(months), annualTotalFromAverage(2_500));
  assert.deepEqual(checkDistribution(2_500, months), {
    ok: true,
    annualTargetCents: 30_000,
    annualActualCents: 30_000,
    diffCents: 0,
  });
});

test("begroting: kwartaalverdeling (water €25/mnd → €75 per kwartaal) blijft geldig", () => {
  // Σ = 12 × 2500 = 30000; gelegd in mrt/jun/sep/dec als 7500 elk
  const months = twelve<Cents>((i) => ([2, 5, 8, 11].includes(i) ? 7_500 : 0));
  const check = checkDistribution(2_500, months);
  assert.equal(check.ok, true);
  assert.equal(check.diffCents, 0);
});

test("begroting: ongeldige verdeling wordt gesignaleerd met het verschil", () => {
  const months = twelve<Cents>((i) => (i === 0 ? 9_999 : 0));
  const check = checkDistribution(2_500, months);
  assert.equal(check.ok, false);
  assert.equal(check.diffCents, 9_999 - 30_000);
});

test("begroting: maand verschuiven houdt het jaartotaal kloppend", () => {
  const months = distributeEven(2_500); // alles 2500
  const next = setMonthKeepingTotal(months, 0, 0, 1); // januari → 0, februari vangt op
  assert.equal(next[0], 0);
  assert.equal(next[1], 5_000);
  assert.equal(sumMonths(next), 30_000);
});

// -------------------------------------------------------------------- Saldo

test("saldo: lopend saldo rolt door met carry-in", () => {
  const carryIn: Cents = -1_199; // Achterzoom −11,99
  const actuals = twelve<MonthlyActual>(() => ({ incomeCents: 600_000, expenseCents: 620_000 }));
  const rows = computeRunningSaldo(carryIn, actuals);
  assert.equal(rows[0]!.beginCents, -1_199);
  assert.equal(rows[0]!.netCents, -20_000);
  assert.equal(rows[0]!.endCents, -21_199);
  assert.equal(rows[1]!.beginCents, -21_199); // doorrollen
  assert.equal(yearEndSaldo(carryIn, actuals), -1_199 + 12 * -20_000);
});

test("saldo: planafwijking is timing-correct (late inkomsten lijken niet 'achter')", () => {
  // Werkelijk: salaris elke maand 100, géén extra; begroot: idem 100/mnd plus 1200 in nov (13e maand)
  const actualNet = twelve<Cents>(() => 10_000);
  const budgetNet = twelve<Cents>((i) => (i === 10 ? 10_000 + 120_000 : 10_000));
  const dev = computeBudgetDeviation(actualNet, budgetNet);
  // t/m oktober loopt werkelijk gelijk met begroot → afwijking 0
  assert.equal(dev[9], 0);
  // in november is de begrote 13e maand nog niet werkelijk → 120000 achter
  assert.equal(dev[10], -120_000);
});

test("saldo: prognose telt werkelijk voor verstreken maanden, begroot voor de rest", () => {
  const carryIn: Cents = 0;
  const actualNet = twelve<Cents>(() => 5_000);
  const budgetNet = twelve<Cents>(() => 10_000);
  // 3 maanden verstreken: 3×5000 + 9×10000 = 105000
  assert.equal(forecastYearEndSaldo(carryIn, actualNet, budgetNet, 3), 3 * 5_000 + 9 * 10_000);
});

// ---------------------------------------------------------------------- Pot

test("pot: saldo = begin + stortingen − opnames + correcties (loopt op én af)", () => {
  const balance = computePotBalance({
    openingBalanceCents: 100_000,
    depositsCents: [25_500, 25_500],
    withdrawalsCents: [40_000],
    mutationsCents: [-500],
  });
  assert.equal(balance, 100_000 + 51_000 - 40_000 - 500);
});

test("pot: totaal vermogen telt potjes op", () => {
  assert.equal(totalSavings([100_000, 250_000, -5_000]), 345_000);
});

test("pot: negatieve storting wordt geweigerd", () => {
  assert.throws(() =>
    computePotBalance({ openingBalanceCents: 0, depositsCents: [-1], withdrawalsCents: [], mutationsCents: [] }),
  );
});

// ------------------------------------------------------------------- Dedup

const tx = (over: Partial<DedupSource> = {}): DedupSource => ({
  bookingDate: "2024-03-15",
  amountCents: -4_500,
  counterpartyIban: "NL00INGB0001234567",
  description: "Albert Heijn 1234",
  mutationType: "BA",
  ...over,
});

test("dedup: identieke inhoud levert dezelfde hash, verschillende inhoud niet", () => {
  assert.equal(dedupHash(tx()), dedupHash(tx()));
  assert.notEqual(dedupHash(tx()), dedupHash(tx({ amountCents: -4_501 })));
});

test("dedup: overlappende import telt niet dubbel", () => {
  const existing = new Map<string, number>([[dedupHash(tx()), 1]]);
  const result = reconcileImport([tx()], existing);
  assert.equal(result[0]!.isNew, false);
});

test("dedup: twee échte identieke boekingen op één dag blijven beide behouden", () => {
  const result = reconcileImport([tx(), tx()], new Map());
  assert.equal(result[0]!.occurrence, 1);
  assert.equal(result[1]!.occurrence, 2);
  assert.equal(result[0]!.isNew, true);
  assert.equal(result[1]!.isNew, true);
});

test("dedup: bij één reeds opgeslagen voorkomen is alleen het tweede nieuw", () => {
  const existing = new Map<string, number>([[dedupHash(tx()), 1]]);
  const result = reconcileImport([tx(), tx()], existing);
  assert.equal(result[0]!.isNew, false);
  assert.equal(result[1]!.isNew, true);
});

// ------------------------------------------------------------------- Regels

const mtx = (over: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  counterpartyIban: "NL11VATT0000000000",
  counterpartyName: "Vattenfall",
  description: "Maandtermijn energie",
  amountCents: -10_000,
  mutationType: "IC",
  ...over,
});

test("regels: trefwoord 'contains' matcht hoofdletterongevoelig", () => {
  assert.equal(
    matchCondition(mtx({ counterpartyName: "ALBERT HEIJN 1234" }), {
      field: "name",
      operator: "contains",
      value: "albert heijn",
    }),
    true,
  );
});

test("regels: amountRange respecteert grenzen", () => {
  const c = { field: "amount", operator: "amountRange", min: -20_000, max: -5_000 } as const;
  assert.equal(matchCondition(mtx({ amountCents: -10_000 }), c), true);
  assert.equal(matchCondition(mtx({ amountCents: -1_000 }), c), false);
});

test("regels: IBAN-exacte regel (hoge prioriteit) wint van trefwoordregel", () => {
  const rules: Rule[] = [
    {
      id: "keyword",
      categoryId: "cat-overig",
      priority: 100,
      active: true,
      conditions: [{ field: "description", operator: "contains", value: "energie" }],
    },
    {
      id: "iban",
      categoryId: "cat-gas-elektra",
      priority: 10,
      active: true,
      conditions: [{ field: "iban", operator: "equals", value: "NL11VATT0000000000" }],
    },
  ];
  assert.deepEqual(categorize(mtx(), rules), { categoryId: "cat-gas-elektra", ruleId: "iban" });
});

test("regels: combinatie (IBAN + maandbedrag) onderscheidt 13e maand van gewoon salaris", () => {
  const employerIban = "NL22WERK0000000000";
  const rules: Rule[] = [
    {
      id: "salaris",
      categoryId: "cat-salaris",
      priority: 20,
      active: true,
      conditions: [{ field: "iban", operator: "equals", value: employerIban }],
    },
    {
      id: "13e",
      categoryId: "cat-13e-maand",
      priority: 10,
      active: true,
      conditions: [
        { field: "iban", operator: "equals", value: employerIban },
        { field: "amount", operator: "amountRange", min: 400_000 },
      ],
    },
  ];
  const gewoon = mtx({ counterpartyIban: employerIban, amountCents: 300_000 });
  const dertiende = mtx({ counterpartyIban: employerIban, amountCents: 450_000 });
  assert.equal(categorize(gewoon, rules)!.categoryId, "cat-salaris");
  assert.equal(categorize(dertiende, rules)!.categoryId, "cat-13e-maand");
});

test("regels: inactieve regel wordt overgeslagen; geen match → null", () => {
  const rules: Rule[] = [
    {
      id: "uit",
      categoryId: "cat-x",
      priority: 1,
      active: false,
      conditions: [{ field: "iban", operator: "equals", value: "NL11VATT0000000000" }],
    },
  ];
  assert.equal(categorize(mtx(), rules), null);
});

// -------------------------------------------------------------- Break-even

test("break-even: sluitende begroting (inkomsten = uitgaven + sparen)", () => {
  const r = computeBreakEven([
    { type: "income", annualCents: 100_000 },
    { type: "expense", annualCents: 70_000 },
    { type: "savings", annualCents: 30_000 },
  ]);
  assert.equal(r.incomeCents, 100_000);
  assert.equal(r.outflowCents, 100_000);
  assert.equal(r.diffCents, 0);
  assert.equal(r.ok, true);
});

test("break-even: sparen telt als uitstroom, tekort wordt gesignaleerd", () => {
  const r = computeBreakEven([
    { type: "income", annualCents: 100_000 },
    { type: "expense", annualCents: 80_000 },
    { type: "savings", annualCents: 30_000 },
  ]);
  assert.equal(r.outflowCents, 110_000);
  assert.equal(r.diffCents, -10_000);
  assert.equal(r.ok, false);
});
