import { db } from "../db/kysely.js";
import { writeAudit } from "../audit.js";
import type { Cents } from "@finance/domain";

export interface YearDTO {
  id: string;
  jaartal: number;
  carryInCents: Cents;
  status: string;
}

export async function listYears(householdId: string): Promise<YearDTO[]> {
  const rows = await db
    .selectFrom("year")
    .select(["id", "jaartal", "carry_in_saldo_cents", "status"])
    .where("household_id", "=", householdId)
    .orderBy("jaartal", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    jaartal: r.jaartal,
    carryInCents: Number(r.carry_in_saldo_cents),
    status: r.status,
  }));
}

export async function createYear(
  householdId: string,
  input: { jaartal: number; carryInCents?: Cents },
): Promise<string> {
  const row = await db
    .insertInto("year")
    .values({
      household_id: householdId,
      jaartal: input.jaartal,
      carry_in_saldo_cents: input.carryInCents ?? 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await writeAudit({ householdId, entiteit: "year", entityId: row.id, actie: "aangemaakt", nieuwe: input });
  return row.id;
}

/**
 * Nieuw jaar = vorig jaar kopiëren. Dupliceert alle begrotingsregels en hun
 * maandbedragen naar het nieuwe jaar. De carry-in (eindsaldo vorig jaar) wordt
 * later, zodra er werkelijke cijfers zijn, definitief; hier is hij instelbaar.
 */
export async function copyYear(
  householdId: string,
  input: { sourceYearId: string; jaartal: number; carryInCents?: Cents },
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const newYear = await trx
      .insertInto("year")
      .values({
        household_id: householdId,
        jaartal: input.jaartal,
        carry_in_saldo_cents: input.carryInCents ?? 0,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const sourceLines = await trx
      .selectFrom("budget_line")
      .select(["id", "category_id", "monthly_average_cents"])
      .where("year_id", "=", input.sourceYearId)
      .where("household_id", "=", householdId)
      .execute();

    for (const line of sourceLines) {
      const newLine = await trx
        .insertInto("budget_line")
        .values({
          household_id: householdId,
          year_id: newYear.id,
          category_id: line.category_id,
          monthly_average_cents: line.monthly_average_cents,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const months = await trx
        .selectFrom("budget_month")
        .select(["month", "amount_cents"])
        .where("budget_line_id", "=", line.id)
        .execute();

      if (months.length > 0) {
        await trx
          .insertInto("budget_month")
          .values(months.map((m) => ({ budget_line_id: newLine.id, month: m.month, amount_cents: m.amount_cents })))
          .execute();
      }
    }

    await writeAudit({
      householdId,
      entiteit: "year",
      entityId: newYear.id,
      actie: "gekopieerd",
      nieuwe: { van: input.sourceYearId, jaartal: input.jaartal, regels: sourceLines.length },
    });

    return newYear.id;
  });
}
