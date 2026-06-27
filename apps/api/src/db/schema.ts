import type { ColumnType, Generated } from "kysely";

/**
 * Typed databaseschema voor Kysely. Geld is overal BIGINT; pg levert dat als
 * string terug, daarom modelleren we bedragen als string bij select en number
 * bij insert/update via ColumnType. De servicelaag converteert naar number.
 */

type Money = ColumnType<string, number | string, number | string>;
type Timestamp = ColumnType<Date, string | undefined, string | undefined>;

export interface HouseholdTable {
  id: Generated<string>;
  naam: string;
  locale: Generated<string>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AppUserTable {
  id: Generated<string>;
  household_id: string;
  naam: string;
  rol: Generated<string>;
  created_at: Timestamp;
}

export interface AccountTable {
  id: Generated<string>;
  household_id: string;
  iban: string;
  naam: string;
  bank: Generated<string>;
  type: "betaal" | "spaar";
  is_imported: Generated<boolean>;
  actief: Generated<boolean>;
  created_at: Timestamp;
}

export interface YearTable {
  id: Generated<string>;
  household_id: string;
  jaartal: number;
  carry_in_saldo_cents: Money;
  status: Generated<"open" | "afgesloten">;
  created_at: Timestamp;
}

export interface CategoryGroupTable {
  id: Generated<string>;
  household_id: string;
  naam: string;
  volgorde: Generated<number>;
}

export interface CategoryTable {
  id: Generated<string>;
  household_id: string;
  group_id: string;
  naam: string;
  type: "income" | "expense" | "savings";
  note_suggested: Generated<boolean>;
  volgorde: Generated<number>;
  archived_at: ColumnType<Date | null, string | null | undefined, string | null>;
  created_at: Timestamp;
}

export interface BudgetLineTable {
  id: Generated<string>;
  household_id: string;
  year_id: string;
  category_id: string;
  monthly_average_cents: Money;
  created_at: Timestamp;
}

export interface BudgetMonthTable {
  id: Generated<string>;
  budget_line_id: string;
  month: number;
  amount_cents: Money;
}

export interface SavingsPotTable {
  id: Generated<string>;
  household_id: string;
  category_id: string;
  naam: string;
  opening_balance_cents: Money;
  opening_date: ColumnType<Date | null, string | null | undefined, string | null>;
  created_at: Timestamp;
}

export interface AuditLogTable {
  id: Generated<number>;
  household_id: string;
  actor_user_id: string | null;
  entiteit: string;
  entity_id: string;
  actie: string;
  oude_waarde: ColumnType<unknown, string | null, string | null>;
  nieuwe_waarde: ColumnType<unknown, string | null, string | null>;
  at: Timestamp;
}

export interface Database {
  household: HouseholdTable;
  app_user: AppUserTable;
  account: AccountTable;
  year: YearTable;
  category_group: CategoryGroupTable;
  category: CategoryTable;
  budget_line: BudgetLineTable;
  budget_month: BudgetMonthTable;
  savings_pot: SavingsPotTable;
  audit_log: AuditLogTable;
}
