import type { Cents } from "./types";

/**
 * Regel-engine — businessregels:
 *  - Een regel = één doelcategorie + één of meer voorwaarden (AND).
 *  - Voorwaarden matchen op IBAN, naam, omschrijving (tekst, hoofdletterongevoelig),
 *    bedrag (bereik) of mutatiesoort.
 *  - Categorisatie kiest de actieve regel met de hoogste prioriteit (laagste getal eerst)
 *    waarvan álle voorwaarden matchen. IBAN-exacte regels krijgen in de data standaard
 *    een hoge prioriteit en winnen zo van trefwoordregels.
 *  - Splitsen is in v1 handmatig; een regel produceert dus één koppeling.
 */

export type RuleField = "iban" | "name" | "description" | "amount" | "mutationType";

export type RuleOperator = "equals" | "contains" | "startsWith" | "amountRange";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  /** Voor tekst-operatoren. */
  value?: string;
  /** Voor 'amountRange' (centen, inclusief grenzen; min/max optioneel). */
  min?: Cents;
  max?: Cents;
}

export interface Rule {
  id: string;
  categoryId: string;
  /** Lager = eerst. */
  priority: number;
  active: boolean;
  /** Alle voorwaarden moeten matchen (AND). */
  conditions: readonly RuleCondition[];
}

export interface MatchableTransaction {
  counterpartyIban: string;
  counterpartyName: string;
  description: string;
  amountCents: Cents;
  mutationType: string;
}

export interface CategorizationResult {
  categoryId: string;
  ruleId: string;
}

function textField(tx: MatchableTransaction, field: RuleField): string | null {
  switch (field) {
    case "iban":
      return tx.counterpartyIban;
    case "name":
      return tx.counterpartyName;
    case "description":
      return tx.description;
    case "mutationType":
      return tx.mutationType;
    default:
      return null;
  }
}

export function matchCondition(tx: MatchableTransaction, c: RuleCondition): boolean {
  if (c.operator === "amountRange") {
    if (c.field !== "amount") return false;
    const v = tx.amountCents;
    if (c.min !== undefined && v < c.min) return false;
    if (c.max !== undefined && v > c.max) return false;
    return true;
  }

  const raw = textField(tx, c.field);
  if (raw === null || c.value === undefined) return false;
  const haystack = raw.toLowerCase();
  const needle = c.value.toLowerCase();

  switch (c.operator) {
    case "equals":
      return haystack === needle;
    case "contains":
      return haystack.includes(needle);
    case "startsWith":
      return haystack.startsWith(needle);
    default:
      return false;
  }
}

/** True wanneer álle voorwaarden van de regel matchen. */
export function ruleMatches(tx: MatchableTransaction, rule: Rule): boolean {
  if (rule.conditions.length === 0) return false;
  for (const c of rule.conditions) {
    if (!matchCondition(tx, c)) return false;
  }
  return true;
}

/**
 * Categoriseer een transactie: kies de actieve, matchende regel met de hoogste
 * prioriteit. Bij gelijke prioriteit wint de eerst opgegeven regel (stabiel).
 * Geeft null wanneer geen regel matcht (→ review).
 */
export function categorize(
  tx: MatchableTransaction,
  rules: readonly Rule[],
): CategorizationResult | null {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!rule.active) continue;
    if (!ruleMatches(tx, rule)) continue;
    if (best === null || rule.priority < best.priority) {
      best = rule;
    }
  }
  return best ? { categoryId: best.categoryId, ruleId: best.id } : null;
}
