import { parseDecimalToCents, type Cents } from "./money";

/**
 * Parser voor de begrotingsmatrix die je vanuit Excel plakt (overname-wizard).
 * Ondersteunt twee plak-vormen per regel (tab-, puntkomma- of komma-gescheiden):
 *   1. postnaam + 12 maandbedragen  → die 12 maanden worden overgenomen
 *   2. postnaam + 1 maandgemiddelde → gelijk verdeeld over 12 maanden
 *
 * Bedragen zijn Nederlands genoteerd ('1.234,56'). Lege regels worden genegeerd.
 * Per regel die niet klopt komt er een nette foutmelding terug; geldige regels
 * blijven gewoon bruikbaar.
 */

export interface ParsedBudgetRow {
  name: string;
  monthsCents: Cents[]; // exact 12
}

export interface BudgetMatrixResult {
  rows: ParsedBudgetRow[];
  errors: string[];
}

function detectDelimiter(text: string): string {
  if (text.includes("\t")) return "\t";
  if (text.includes(";")) return ";";
  return ",";
}

export function parseBudgetMatrix(text: string): BudgetMatrixResult {
  const rows: ParsedBudgetRow[] = [];
  const errors: string[] = [];
  const delimiter = detectDelimiter(text);

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") return;

    const cells = rawLine.split(delimiter).map((c) => c.trim());
    const name = cells[0] ?? "";
    const amountCells = cells.slice(1).filter((c) => c !== "");

    if (name === "") {
      errors.push(`Regel ${index + 1}: geen postnaam.`);
      return;
    }

    let monthsCents: Cents[];
    try {
      if (amountCells.length === 12) {
        monthsCents = amountCells.map((c) => parseDecimalToCents(c));
      } else if (amountCells.length === 1) {
        const avg = parseDecimalToCents(amountCells[0] as string);
        monthsCents = Array.from({ length: 12 }, () => avg);
      } else {
        errors.push(
          `Regel ${index + 1} ("${name}"): verwacht 1 gemiddelde of 12 maandbedragen, kreeg ${amountCells.length}.`,
        );
        return;
      }
    } catch {
      errors.push(`Regel ${index + 1} ("${name}"): kan een bedrag niet lezen.`);
      return;
    }

    rows.push({ name, monthsCents });
  });

  return { rows, errors };
}
