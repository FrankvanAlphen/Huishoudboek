import { db } from "./db/kysely.js";

let cached: string | null = null;

/**
 * Het systeem kent precies één huishouden (gedeeld door beide bewoners). Deze
 * helper haalt dat id op en cachet het. De household_id-kolommen staan al overal
 * klaar zodat meerdere huishoudens later mogelijk zijn zonder migratie.
 */
export async function getHouseholdId(): Promise<string> {
  if (cached) return cached;
  const row = await db
    .selectFrom("household")
    .select("id")
    .orderBy("created_at")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    throw new Error("Geen huishouden gevonden — draai eerst de seed (npm run db:seed).");
  }
  cached = row.id;
  return cached;
}
