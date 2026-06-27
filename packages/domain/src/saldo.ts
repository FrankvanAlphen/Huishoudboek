import type { Cents, MonthlyActual, Month, SaldoMonth, Twelve } from "./types";
import { MONTHS } from "./types";

/**
 * Saldo — businessregels:
 *  - Lopend saldo (jouw formule): eind = begin + inkomsten − uitgaven; rolt door per maand;
 *    begin[januari] = carry-in (eindsaldo vorig jaar). Afgeleid, niet opgeslagen.
 *  - Afwijking t.o.v. begroting (apart, timing-correct): werkelijk cumulatief tot maand M
 *    minus begroot cumulatief tot maand M. Positief = voor op plan, negatief = achter.
 *  - Prognose eindsaldo: carry-in + werkelijk netto (verstreken maanden) + begroot netto (resterend).
 */

/** Bereken het doorrollende lopend saldo voor alle twaalf maanden. */
export function computeRunningSaldo(
  carryInCents: Cents,
  actuals: Twelve<MonthlyActual>,
): Twelve<SaldoMonth> {
  const result: SaldoMonth[] = [];
  let begin = carryInCents;
  for (let i = 0; i < 12; i++) {
    const month = MONTHS[i] as Month;
    const a = actuals[i]!;
    const netCents = a.incomeCents - a.expenseCents;
    const endCents = begin + netCents;
    result.push({
      month,
      beginCents: begin,
      incomeCents: a.incomeCents,
      expenseCents: a.expenseCents,
      netCents,
      endCents,
    });
    begin = endCents;
  }
  return result as Twelve<SaldoMonth>;
}

/** Het eindsaldo van het jaar (laatste maand). */
export function yearEndSaldo(carryInCents: Cents, actuals: Twelve<MonthlyActual>): Cents {
  const rows = computeRunningSaldo(carryInCents, actuals);
  return rows[11]!.endCents;
}

/**
 * Afwijking t.o.v. begroting per maand (cumulatief, timing-correct).
 * actualNet/budgetNet zijn de netto-bedragen (inkomsten − uitgaven) per maand.
 */
export function computeBudgetDeviation(
  actualNet: Twelve<Cents>,
  budgetNet: Twelve<Cents>,
): Twelve<Cents> {
  const out: Cents[] = [];
  let cumActual = 0;
  let cumBudget = 0;
  for (let i = 0; i < 12; i++) {
    cumActual += actualNet[i]!;
    cumBudget += budgetNet[i]!;
    out.push(cumActual - cumBudget);
  }
  return out as Twelve<Cents>;
}

/**
 * Prognose van het eindsaldo van het jaar.
 * monthsElapsed = aantal volledig verwerkte maanden (0..12); daarvoor telt werkelijk,
 * daarna telt begroot.
 */
export function forecastYearEndSaldo(
  carryInCents: Cents,
  actualNet: Twelve<Cents>,
  budgetNet: Twelve<Cents>,
  monthsElapsed: number,
): Cents {
  if (!Number.isInteger(monthsElapsed) || monthsElapsed < 0 || monthsElapsed > 12) {
    throw new Error(`monthsElapsed moet 0..12 zijn, kreeg ${monthsElapsed}`);
  }
  let saldo = carryInCents;
  for (let i = 0; i < 12; i++) {
    saldo += i < monthsElapsed ? actualNet[i]! : budgetNet[i]!;
  }
  return saldo;
}
