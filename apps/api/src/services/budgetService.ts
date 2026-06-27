import { db } from "../db/kysely.js";
import { writeAudit } from "../audit.js";
import {
  checkDistribution,
  distributeEven,
  computeBreakEven,
  type Cents,
  type CategoryType,
  type Twelve,
} from "@finance/domain";

const toNum = (v: string): number => Number(v);
const emptyMonths = (): number[] => Array.from({ length: 12 }, () => 0);

export interface BudgetCategoryDTO {
  categoryId: string;
  naam: string;
  type: CategoryType;
  noteSuggested: boolean;
  lineId: string | null;
  monthlyAverageCents: Cents;
  monthsCents: Cents[];
  annualCents: Cents;
}

export interface BudgetGroupDTO {
  groupId: string;
  naam: string;
  categories: BudgetCategoryDTO[];
  subtotalAnnualCents: Cents;
}

export interface BudgetDTO {
  year: { id: string; jaartal: number; carryInCents: Cents; status: string };
  groups: BudgetGroupDTO[];
  breakEven: { incomeCents: Cents; outflowCents: Cents; diffCents: Cents; ok: boolean };
}

export async function getBudget(householdId: string, yearId: string): Promise<BudgetDTO> {
  const year = await db
    .selectFrom("year")
    .select(["id", "jaartal", "carry_in_saldo_cents", "status"])
    .where("id", "=", yearId)
    .where("household_id", "=", householdId)
    .executeTakeFirstOrThrow();

  const groups = await db
    .selectFrom("category_group")
    .select(["id", "naam", "volgorde"])
    .where("household_id", "=", householdId)
    .orderBy("volgorde")
    .execute();

  const categories = await db
    .selectFrom("category")
    .select(["id", "group_id", "naam", "type", "note_suggested", "volgorde"])
    .where("household_id", "=", householdId)
    .where("archived_at", "is", null)
    .orderBy("volgorde")
    .execute();

  const lines = await db
    .selectFrom("budget_line")
    .select(["id", "category_id", "monthly_average_cents"])
    .where("year_id", "=", yearId)
    .execute();

  const lineIds = lines.map((l) => l.id);
  const months = lineIds.length
    ? await db
        .selectFrom("budget_month")
        .select(["budget_line_id", "month", "amount_cents"])
        .where("budget_line_id", "in", lineIds)
        .execute()
    : [];

  const lineByCategory = new Map(lines.map((l) => [l.category_id, l]));
  const monthsByLine = new Map<string, number[]>();
  for (const id of lineIds) monthsByLine.set(id, emptyMonths());
  for (const m of months) {
    const arr = monthsByLine.get(m.budget_line_id);
    if (arr) arr[m.month - 1] = toNum(m.amount_cents);
  }

  const breakEvenLines: { type: CategoryType; annualCents: Cents }[] = [];

  const groupDtos: BudgetGroupDTO[] = groups.map((g) => {
    const cats = categories
      .filter((c) => c.group_id === g.id)
      .map<BudgetCategoryDTO>((c) => {
        const line = lineByCategory.get(c.id);
        const monthsCents = line ? monthsByLine.get(line.id)! : emptyMonths();
        const annualCents = monthsCents.reduce((a, b) => a + b, 0);
        breakEvenLines.push({ type: c.type as CategoryType, annualCents });
        return {
          categoryId: c.id,
          naam: c.naam,
          type: c.type as CategoryType,
          noteSuggested: c.note_suggested,
          lineId: line?.id ?? null,
          monthlyAverageCents: line ? toNum(line.monthly_average_cents) : 0,
          monthsCents,
          annualCents,
        };
      });
    const subtotalAnnualCents = cats.reduce((a, c) => a + c.annualCents, 0);
    return { groupId: g.id, naam: g.naam, categories: cats, subtotalAnnualCents };
  });

  return {
    year: {
      id: year.id,
      jaartal: year.jaartal,
      carryInCents: toNum(year.carry_in_saldo_cents),
      status: year.status,
    },
    groups: groupDtos,
    breakEven: computeBreakEven(breakEvenLines),
  };
}

/**
 * Maak/werk een begrotingsregel bij. Het maandgemiddelde is het anker; de twaalf
 * maandbedragen moeten samen 12 × gemiddelde vormen. Als geen maanden zijn
 * meegegeven, verdeelt de service gelijk. Bij een mismatch wordt geweigerd.
 */
export async function upsertBudgetLine(
  householdId: string,
  input: { yearId: string; categoryId: string; monthlyAverageCents: Cents; monthsCents?: Cents[] },
): Promise<{ lineId: string }> {
  const months = (input.monthsCents ?? distributeEven(input.monthlyAverageCents)) as Twelve<Cents>;
  if (months.length !== 12) {
    throw new ValidationError("Er zijn precies 12 maandbedragen nodig.");
  }
  const check = checkDistribution(input.monthlyAverageCents, months);
  if (!check.ok) {
    throw new ValidationError(
      `De maandbedragen tellen niet op tot het jaartotaal (verschil ${check.diffCents} cent).`,
    );
  }

  const lineId = await db.transaction().execute(async (trx) => {
    const line = await trx
      .insertInto("budget_line")
      .values({
        household_id: householdId,
        year_id: input.yearId,
        category_id: input.categoryId,
        monthly_average_cents: input.monthlyAverageCents,
      })
      .onConflict((oc) =>
        oc.columns(["year_id", "category_id"]).doUpdateSet({
          monthly_average_cents: input.monthlyAverageCents,
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    await trx.deleteFrom("budget_month").where("budget_line_id", "=", line.id).execute();
    await trx
      .insertInto("budget_month")
      .values(months.map((amount, i) => ({ budget_line_id: line.id, month: i + 1, amount_cents: amount })))
      .execute();

    return line.id;
  });

  await writeAudit({
    householdId,
    entiteit: "budget_line",
    entityId: lineId,
    actie: "opgeslagen",
    nieuwe: { categoryId: input.categoryId, monthlyAverageCents: input.monthlyAverageCents },
  });

  return { lineId };
}

/** Fout bij ongeldige invoer; de route vertaalt dit naar HTTP 400. */
export class ValidationError extends Error {}
