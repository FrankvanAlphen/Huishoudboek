-- 0001_init.sql — Fase 1 kern-schema
-- Conventies: geld in hele centen (BIGINT), UUID primaire sleutels, household_id
-- op alle wortelentiteiten (multi-tenant-klaar), soft-delete via archived_at.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- voor gen_random_uuid()

-- Enums -------------------------------------------------------------------
CREATE TYPE category_type AS ENUM ('income', 'expense', 'savings');
CREATE TYPE account_type  AS ENUM ('betaal', 'spaar');
CREATE TYPE year_status   AS ENUM ('open', 'afgesloten');

-- Household (tenant-grens; nu precies één) --------------------------------
CREATE TABLE household (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  naam        TEXT NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'nl-NL',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- App-gebruiker (voor attributie en toekomstige rollen) -------------------
CREATE TABLE app_user (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  naam          TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'member',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX app_user_household_idx ON app_user (household_id);

-- Bankrekening (bron van transacties of doel van reserveringen) -----------
CREATE TABLE account (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  iban          TEXT NOT NULL,
  naam          TEXT NOT NULL,
  bank          TEXT NOT NULL DEFAULT 'ING',
  type          account_type NOT NULL,
  is_imported   BOOLEAN NOT NULL DEFAULT false,
  actief        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, iban)
);

-- Boekjaar ----------------------------------------------------------------
CREATE TABLE year (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  jaartal             INTEGER NOT NULL,
  carry_in_saldo_cents BIGINT NOT NULL DEFAULT 0,
  status              year_status NOT NULL DEFAULT 'open',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, jaartal)
);

-- Categoriegroep ----------------------------------------------------------
CREATE TABLE category_group (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  naam          TEXT NOT NULL,
  volgorde      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX category_group_household_idx ON category_group (household_id);

-- Post (categorie) --------------------------------------------------------
CREATE TABLE category (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES category_group(id) ON DELETE RESTRICT,
  naam            TEXT NOT NULL,
  type            category_type NOT NULL,
  note_suggested  BOOLEAN NOT NULL DEFAULT false,
  volgorde        INTEGER NOT NULL DEFAULT 0,
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX category_household_idx ON category (household_id);
CREATE INDEX category_group_idx ON category (group_id);
-- Unieke postnaam binnen een huishouden, alleen voor niet-gearchiveerde posten:
CREATE UNIQUE INDEX category_unique_active_name
  ON category (household_id, naam) WHERE archived_at IS NULL;

-- Append-only audit-log ---------------------------------------------------
CREATE TABLE audit_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household_id    UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES app_user(id),
  entiteit        TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  actie           TEXT NOT NULL,
  oude_waarde     JSONB,
  nieuwe_waarde   JSONB,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entiteit, entity_id);
CREATE INDEX audit_log_household_idx ON audit_log (household_id, at);
