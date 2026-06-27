import { pool } from "./db.js";

/**
 * Schrijf een audit-regel. Centraal aangeroepen vanuit de servicelaag, nooit
 * verspreid door de applicatie. In fase 1 nog beperkt gebruikt (login), maar
 * het mechanisme staat er vanaf het begin zodat historie nooit verloren gaat.
 */
export async function writeAudit(params: {
  householdId: string;
  actorUserId?: string | null;
  entiteit: string;
  entityId: string;
  actie: string;
  oude?: unknown;
  nieuwe?: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (household_id, actor_user_id, entiteit, entity_id, actie, oude_waarde, nieuwe_waarde)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.householdId,
      params.actorUserId ?? null,
      params.entiteit,
      params.entityId,
      params.actie,
      params.oude === undefined ? null : JSON.stringify(params.oude),
      params.nieuwe === undefined ? null : JSON.stringify(params.nieuwe),
    ],
  );
}
