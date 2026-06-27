-- 0002_budget.sql — Fase 2: begroting per jaar (versioneerbare snapshot) en
-- de beginstanden van de spaarpotjes (voor de overname-wizard).

-- Begrotingsregel: één post binnen één jaar, met het maandgemiddelde als anker.
CREATE TABLE budget_line (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  year_id               UUID NOT NULL REFERENCES year(id) ON DELETE CASCADE,
  category_id           UUID NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  monthly_average_cents BIGINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year_id, category_id)
);
CREATE INDEX budget_line_year_idx ON budget_line (year_id);
CREATE INDEX budget_line_household_idx ON budget_line (household_id);

-- De twaalf maandbedragen (de timing) onder een begrotingsregel.
CREATE TABLE budget_month (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_line_id  UUID NOT NULL REFERENCES budget_line(id) ON DELETE CASCADE,
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_cents    BIGINT NOT NULL DEFAULT 0,
  UNIQUE (budget_line_id, month)
);
CREATE INDEX budget_month_line_idx ON budget_month (budget_line_id);

-- Spaarpotje (vermogen): één per spaarpost, met de beginstand uit Excel.
-- Stortingen/opnames volgen in een latere fase; hier zetten we de openingsstand.
CREATE TABLE savings_pot (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          UUID NOT NULL REFERENCES household(id) ON DELETE CASCADE,
  category_id           UUID NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  naam                  TEXT NOT NULL,
  opening_balance_cents BIGINT NOT NULL DEFAULT 0,
  opening_date          DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, category_id)
);
CREATE INDEX savings_pot_household_idx ON savings_pot (household_id);
