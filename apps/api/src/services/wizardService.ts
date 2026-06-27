import { db } from "../db/kysely.js";
import { writeAudit } from "../audit.js";
import type { Cents } from "@finance/domain";

export interface WizardRow {
  name: string;
  monthsCents: Cents[]; // 12
}

export interface WizardPot {
  categoryId: string;
  openingBalanceCents: Cents;
  openingDate?: string | null;
}

export interface WizardImportInput {
  jaartal: number;
  carryInCents: Cents;
  rows: WizardRow[];
  pots: WizardPot[];
}

export interface WizardImportResult {
  yearId: string;
  matchedCount: number;
  unmatched: string[];
  potCount: number;
}

const round = (n: number): number => Math.round(n);

/**
 * Eenmalige overname vanuit Excel. Matcht begrotingsregels op postnaam (exact,
 * hoofdletterongevoelig) tegen de bestaande posten, zet de carry-in en de
 * beginstanden van de spaarpotjes. Niet-herkende namen worden teruggemeld i.p.v.
 * stilzwijgend aangemaakt. Alles in één transactie.
 */
export async function importBudget(
  householdId: string,
  input: WizardImportInput,
): Promise<WizardImportResult> {
  return db.transaction().execute(async (trx) => {
    // Jaar aanmaken of bijwerken (carry-in).
    const year = await trx
      .insertInto("year")
      .values({ household_id: householdId, jaartal: input.jaartal, carry_in_saldo_cents: input.carryInCents })
      .onConflict((oc) =>
        oc.columns(["household_id", "jaartal"]).doUpdateSet({ carry_in_saldo_cents: input.carryInCents }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    // Posten-index op genormaliseerde naam.
    const categories = await trx
      .selectFrom("category")
      .select(["id", "naam"])
      .where("household_id", "=", householdId)
      .where("archived_at", "is", null)
      .execute();
    const byName = new Map(categories.map((c) => [c.naam.trim().toLowerCase(), c.id]));

    const unmatched: string[] = [];
    let matchedCount = 0;

    for (const row of input.rows) {
      if (row.monthsCents.length !== 12) {
        unmatched.push(`${row.name} (geen 12 maanden)`);
        continue;
      }
      const categoryId = byName.get(row.name.trim().toLowerCase());
      if (!categoryId) {
        unmatched.push(row.name);
        continue;
      }

      const annual = row.monthsCents.reduce((a, b) => a + b, 0);
      // Bij import is het gemiddelde afgeleid van de 12 maanden (Excel is leidend).
      const average = round(annual / 12);

      const line = await trx
        .insertInto("budget_line")
        .values({
          household_id: householdId,
          year_id: year.id,
          category_id: categoryId,
          monthly_average_cents: average,
        })
        .onConflict((oc) =>
          oc.columns(["year_id", "category_id"]).doUpdateSet({ monthly_average_cents: average }),
        )
        .returning("id")
        .executeTakeFirstOrThrow();

      await trx.deleteFrom("budget_month").where("budget_line_id", "=", line.id).execute();
      await trx
        .insertInto("budget_month")
        .values(row.monthsCents.map((amount, i) => ({ budget_line_id: line.id, month: i + 1, amount_cents: amount })))
        .execute();

      matchedCount += 1;
    }

    // Beginstanden van de spaarpotjes.
    let potCount = 0;
    for (const pot of input.pots) {
      const cat = categories.find((c) => c.id === pot.categoryId);
      if (!cat) continue;
      await trx
        .insertInto("savings_pot")
        .values({
          household_id: householdId,
          category_id: pot.categoryId,
          naam: cat.naam,
          opening_balance_cents: pot.openingBalanceCents,
          opening_date: pot.openingDate ?? null,
        })
        .onConflict((oc) =>
          oc.columns(["household_id", "category_id"]).doUpdateSet({
            opening_balance_cents: pot.openingBalanceCents,
            opening_date: pot.openingDate ?? null,
          }),
        )
        .execute();
      potCount += 1;
    }

    await writeAudit({
      householdId,
      entiteit: "year",
      entityId: year.id,
      actie: "wizard-import",
      nieuwe: { jaartal: input.jaartal, matched: matchedCount, unmatched: unmatched.length, pots: potCount },
    });

    return { yearId: year.id, matchedCount, unmatched, potCount };
  });
}
