/**
 * Domain types — de pure rekenkern werkt uitsluitend op deze types.
 * Geld is OVERAL in hele centen (integer). Nooit floating-point bedragen.
 */

export type Cents = number;

/** Maand 1..12 (januari = 1). */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const MONTHS: readonly Month[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Een vaste array van 12 maandwaarden (index 0 = januari). */
export type Twelve<T> = [T, T, T, T, T, T, T, T, T, T, T, T];

/** Soort post. 'savings' is een uitgave die tevens een potje voedt. */
export type CategoryType = "income" | "expense" | "savings";

/** Werkelijke netto-bedragen per maand, gesplitst in inkomsten en uitgaven (beide positieve magnitudes). */
export interface MonthlyActual {
  /** Som van werkelijke inkomsten in de maand (positief). */
  incomeCents: Cents;
  /** Som van werkelijke uitgaven incl. sparen in de maand (positief). */
  expenseCents: Cents;
}

/** Resultaat van de lopend-saldoberekening voor één maand. */
export interface SaldoMonth {
  month: Month;
  beginCents: Cents;
  incomeCents: Cents;
  expenseCents: Cents;
  /** income − expense. */
  netCents: Cents;
  endCents: Cents;
}
