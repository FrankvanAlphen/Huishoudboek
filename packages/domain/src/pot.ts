import type { Cents } from "./types";

/**
 * Spaarpotje / vermogen — businessregel:
 *   potsaldo = beginstand + Σ stortingen − Σ opnames + Σ correcties.
 * Potjes lopen op én af. Opnames zijn op saldo-niveau budgetneutraal (geen 'inkomen'),
 * maar verlagen hier wél het potsaldo.
 *
 * Stortingen en opnames worden als positieve magnitudes aangeleverd; correcties zijn
 * signed (een handmatige potmutatie kan + of − zijn).
 */

export interface PotInput {
  openingBalanceCents: Cents;
  /** Stortingen (positief). */
  depositsCents: readonly Cents[];
  /** Opnames (positief). */
  withdrawalsCents: readonly Cents[];
  /** Handmatige correcties (signed). */
  mutationsCents: readonly Cents[];
}

export function computePotBalance(input: PotInput): Cents {
  const deposits = sumPositive(input.depositsCents, "storting");
  const withdrawals = sumPositive(input.withdrawalsCents, "opname");
  const mutations = sumSigned(input.mutationsCents, "correctie");
  return input.openingBalanceCents + deposits - withdrawals + mutations;
}

/** Totaal gereserveerd vermogen over meerdere potjes. */
export function totalSavings(balances: readonly Cents[]): Cents {
  let total = 0;
  for (const b of balances) total += b;
  return total;
}

function sumPositive(values: readonly Cents[], label: string): Cents {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`${label} moet een niet-negatief geheel aantal centen zijn, kreeg ${v}`);
    }
    total += v;
  }
  return total;
}

function sumSigned(values: readonly Cents[], label: string): Cents {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) {
      throw new Error(`${label} moet een geheel aantal centen zijn, kreeg ${v}`);
    }
    total += v;
  }
  return total;
}
