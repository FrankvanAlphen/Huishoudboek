import { db } from "../db/kysely.js";
import { writeAudit } from "../audit.js";
import type { CategoryType } from "@finance/domain";

export interface CategoryDTO {
  id: string;
  groupId: string;
  naam: string;
  type: CategoryType;
  noteSuggested: boolean;
  volgorde: number;
}

export interface GroupDTO {
  id: string;
  naam: string;
  volgorde: number;
  categories: CategoryDTO[];
}

/** Alle groepen met hun niet-gearchiveerde posten, op volgorde. */
export async function listGroupsWithCategories(householdId: string): Promise<GroupDTO[]> {
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

  return groups.map((g) => ({
    id: g.id,
    naam: g.naam,
    volgorde: g.volgorde,
    categories: categories
      .filter((c) => c.group_id === g.id)
      .map((c) => ({
        id: c.id,
        groupId: c.group_id,
        naam: c.naam,
        type: c.type as CategoryType,
        noteSuggested: c.note_suggested,
        volgorde: c.volgorde,
      })),
  }));
}

export async function createGroup(
  householdId: string,
  input: { naam: string; volgorde?: number },
): Promise<string> {
  const row = await db
    .insertInto("category_group")
    .values({ household_id: householdId, naam: input.naam, volgorde: input.volgorde ?? 0 })
    .returning("id")
    .executeTakeFirstOrThrow();
  await writeAudit({ householdId, entiteit: "category_group", entityId: row.id, actie: "aangemaakt", nieuwe: input });
  return row.id;
}

export async function createCategory(
  householdId: string,
  input: { groupId: string; naam: string; type: CategoryType; noteSuggested?: boolean; volgorde?: number },
): Promise<string> {
  const row = await db
    .insertInto("category")
    .values({
      household_id: householdId,
      group_id: input.groupId,
      naam: input.naam,
      type: input.type,
      note_suggested: input.noteSuggested ?? false,
      volgorde: input.volgorde ?? 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await writeAudit({ householdId, entiteit: "category", entityId: row.id, actie: "aangemaakt", nieuwe: input });
  return row.id;
}

export async function updateCategory(
  householdId: string,
  id: string,
  patch: { naam?: string; type?: CategoryType; noteSuggested?: boolean; groupId?: string; volgorde?: number },
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.naam !== undefined) values.naam = patch.naam;
  if (patch.type !== undefined) values.type = patch.type;
  if (patch.noteSuggested !== undefined) values.note_suggested = patch.noteSuggested;
  if (patch.groupId !== undefined) values.group_id = patch.groupId;
  if (patch.volgorde !== undefined) values.volgorde = patch.volgorde;
  if (Object.keys(values).length === 0) return;

  await db.updateTable("category").set(values).where("id", "=", id).where("household_id", "=", householdId).execute();
  await writeAudit({ householdId, entiteit: "category", entityId: id, actie: "gewijzigd", nieuwe: patch });
}

/** Soft-delete: post archiveren (historie blijft behouden). */
export async function archiveCategory(householdId: string, id: string): Promise<void> {
  await db
    .updateTable("category")
    .set({ archived_at: new Date().toISOString() })
    .where("id", "=", id)
    .where("household_id", "=", householdId)
    .execute();
  await writeAudit({ householdId, entiteit: "category", entityId: id, actie: "gearchiveerd" });
}
