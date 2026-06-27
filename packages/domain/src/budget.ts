import type { Cents, Twelve, CategoryType } from "./types";

/**
 * Begroting — businessregel: het maandgemiddelde is de invoer-anker.
 * Het jaartotaal = gemiddelde × 12, en de 12 maandbedragen (de timing) moeten
 * samen exact dat jaartotaal vormen: Σ maanden = 12 × gemiddelde.
 */

const MONTHS_PER_YEAR = 12;

/** Jaartotaal dat hoort bij een maandgemiddelde. */
export function annualTotalFromAverage(monthlyAverageCents: Cents): Cents {
  assertInteger(monthlyAverageCents, "monthlyAverageCents");
  return monthlyAverageCents * MONTHS_PER_YEAR;
}

/**
 * Verdeel het gemiddelde gelijk over 12 maanden. Omdat het jaartotaal
 * altijd 12 × gemiddelde is, is dit exact het gemiddelde per maand.
 */
export function distributeEven(monthlyAverageCents: Cents): Twelve<Cents> {
  assertInteger(monthlyAverageCents, "monthlyAverageCents");
  return [
    monthlyAverageCents, monthlyAverageCents, monthlyAverageCents,
    monthlyAverageCents, monthlyAverageCents, monthlyAverageCents,
    monthlyAverageCents, monthlyAverageCents, monthlyAverageCents,
    monthlyAverageCents, monthlyAverageCents, monthlyAverageCents,
  ];
}

/** Som van de twaalf maandbedragen. */
export function sumMonths(months: Twelve<Cents>): Cents {
  let total = 0;
  for (const m of months) {
    assertInteger(m, "month amount");
    total += m;
  }
  return total;
}

export interface DistributionCheck {
  ok: boolean;
  annualTargetCents: Cents;
  annualActualCents: Cents;
  /** annualActual − annualTarget; 0 wanneer geldig. */
  diffCents: Cents;
}

/** Controleer de invariant Σ maanden = 12 × gemiddelde. */
export function checkDistribution(
  monthlyAverageCents: Cents,
  months: Twelve<Cents>,
): DistributionCheck {
  const annualTargetCents = annualTotalFromAverage(monthlyAverageCents);
  const annualActualCents = sumMonths(months);
  const diffCents = annualActualCents - annualTargetCents;
  return { ok: diffCents === 0, annualTargetCents, annualActualCents, diffCents };
}

/**
 * Pas een maandbedrag aan en houd het jaartotaal kloppend door het verschil
 * in een gekozen compensatiemaand op te vangen. Handig voor de begrotings-UI
 * ("verschuif timing met behoud van het jaartotaal").
 */
export function setMonthKeepingTotal(
  months: Twelve<Cents>,
  targetIndex: number,
  newValueCents: Cents,
  compensationIndex: number,
): Twelve<Cents> {
  assertIndex(targetIndex);
  assertIndex(compensationIndex);
  assertInteger(newValueCents, "newValueCents");
  if (targetIndex === compensationIndex) {
    throw new Error("compensatiemaand mag niet de doelmaand zijn");
  }
  const next = months.slice() as Twelve<Cents>;
  const delta = newValueCents - next[targetIndex]!;
  next[targetIndex] = newValueCents;
  next[compensationIndex] = next[compensationIndex]! - delta;
  return next;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} moet een geheel aantal centen zijn, kreeg ${value}`);
  }
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > 11) {
    throw new Error(`maandindex moet 0..11 zijn, kreeg ${index}`);
  }
}

// --- Break-even ----------------------------------------------------------

export interface BudgetLineTotal {
  type: CategoryType;
  annualCents: Cents;
}

export interface BreakEvenResult {
  /** Som van alle inkomstenposten (jaarbasis). */
  incomeCents: Cents;
  /** Som van alle uitgaven én reserveringen — alles wat de begroting verlaat. */
  outflowCents: Cents;
  /** income − outflow; 0 = sluitend, positief = overschot, negatief = tekort. */
  diffCents: Cents;
  ok: boolean;
}

/**
 * Break-even-controle over de hele begroting. Sparen telt als uitstroom
 * (een reservering verlaat het budget), conform het ontwerp.
 */
export function computeBreakEven(lines: readonly BudgetLineTotal[]): BreakEvenResult {
  let incomeCents = 0;
  let outflowCents = 0;
  for (const line of lines) {
    if (line.type === "income") {
      incomeCents += line.annualCents;
    } else {
      outflowCents += line.annualCents;
    }
  }
  const diffCents = incomeCents - outflowCents;
  return { incomeCents, outflowCents, diffCents, ok: diffCents === 0 };
}
