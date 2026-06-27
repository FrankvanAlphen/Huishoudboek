/**
 * Geld-helpers. Bedragen worden intern altijd in hele centen bijgehouden.
 * Deze module is bewust framework-vrij en bruikbaar in zowel server als client.
 */

export type Cents = number;

const eurFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurFormatter0 = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Formatteer centen als '€ 1.234,56'. */
export function formatEUR(cents: Cents): string {
  return eurFormatter.format(cents / 100);
}

/** Formatteer centen als '€ 1.235' (zonder decimalen, afgerond). */
export function formatEUR0(cents: Cents): string {
  return eurFormatter0.format(Math.round(cents / 100));
}

/**
 * Parse een Nederlands bedrag ('1.234,56', '-635,64', '1234,5') naar centen.
 * Punten zijn duizendtallen-scheidingstekens, komma is decimaal.
 */
export function parseDecimalToCents(input: string): Cents {
  const cleaned = input.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    throw new Error(`Kan bedrag niet parsen: "${input}"`);
  }
  return Math.round(value * 100);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
