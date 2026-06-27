-- 0001_seed.sql — startdata: één huishouden + de postenstructuur (bewerkbaar in de app).
-- note_suggested staat standaard AAN op de variabele posten en UIT op de vaste lasten.
-- Idempotent: doet niets als er al een huishouden bestaat.

DO $$
DECLARE
  hh UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM household) THEN
    RAISE NOTICE 'Seed overgeslagen: er bestaat al een huishouden.';
    RETURN;
  END IF;

  INSERT INTO household (naam) VALUES ('Huishouden') RETURNING id INTO hh;

  INSERT INTO app_user (household_id, naam, rol) VALUES
    (hh, 'Frank', 'owner'),
    (hh, 'Partner', 'member');

  INSERT INTO category_group (household_id, naam, volgorde) VALUES
    (hh, 'Inkomsten', 1),
    (hh, 'Woonlasten', 2),
    (hh, 'Verzekeringen', 3),
    (hh, 'Abonnementen', 4),
    (hh, 'Huishouden & dagelijks', 5),
    (hh, 'Vervoer', 6),
    (hh, 'Zakgeld', 7),
    (hh, 'Sparen & reserveringen', 8);

  INSERT INTO category (household_id, group_id, naam, type, note_suggested, volgorde)
  SELECT hh, g.id, c.naam, c.ctype::category_type, c.note, c.volg
  FROM (VALUES
    -- groep, naam, type, note_suggested, volgorde
    ('Inkomsten', 'Salaris Frank + auto', 'income', false, 1),
    ('Inkomsten', '13e maand + overige Frank', 'income', false, 2),
    ('Inkomsten', 'Salaris Kimberley', 'income', false, 3),
    ('Inkomsten', '13e maand + vakantiegeld + overige Kimberley', 'income', false, 4),
    ('Inkomsten', 'Hypotheekrenteaftrek', 'income', false, 5),
    ('Inkomsten', 'Kinderopvangtoeslag', 'income', false, 6),
    ('Inkomsten', 'Kinderbijslag', 'income', false, 7),
    ('Inkomsten', 'Overige inkomsten / Lening ABN', 'income', false, 8),

    ('Woonlasten', 'Hypotheek (ABN-Amro)', 'expense', false, 1),
    ('Woonlasten', 'Gas & Elektra (Vattenfall)', 'expense', false, 2),
    ('Woonlasten', 'Water (Dunea)', 'expense', false, 3),
    ('Woonlasten', 'Provinciale belastingen (Zuid-Holland)', 'expense', false, 4),
    ('Woonlasten', 'Gemeentelijke belastingen (Zuidplas)', 'expense', false, 5),

    ('Verzekeringen', 'Woon- & aansprakelijkheid (FBTO)', 'expense', false, 1),
    ('Verzekeringen', 'Overlijdensrisico (Dazure)', 'expense', false, 2),
    ('Verzekeringen', 'Zorgverzekering (Ditzo)', 'expense', false, 3),
    ('Verzekeringen', 'Reisverzekering (SNS)', 'expense', false, 4),
    ('Verzekeringen', 'Begrafenisverzekering (Dela)', 'expense', false, 5),
    ('Verzekeringen', 'Auto (Allianz)', 'expense', false, 6),

    ('Abonnementen', 'Internet & TV (Ziggo)', 'expense', false, 1),
    ('Abonnementen', 'Telefonie (Ben/Vodafone)', 'expense', false, 2),
    ('Abonnementen', 'Overige abonnementen', 'expense', false, 3),
    ('Abonnementen', 'Netflix', 'expense', false, 4),
    ('Abonnementen', 'Bankkosten (ING)', 'expense', false, 5),
    ('Abonnementen', 'Spotify', 'expense', false, 6),
    ('Abonnementen', 'Videoland', 'expense', false, 7),

    ('Huishouden & dagelijks', 'Boodschappen', 'expense', false, 1),
    ('Huishouden & dagelijks', 'Huis en tuin', 'expense', true, 2),
    ('Huishouden & dagelijks', 'Cadeautjes', 'expense', true, 3),
    ('Huishouden & dagelijks', 'Uitstapjes/bestellen', 'expense', true, 4),
    ('Huishouden & dagelijks', 'Sporten', 'expense', false, 5),
    ('Huishouden & dagelijks', 'Persoonlijke verzorging', 'expense', true, 6),
    ('Huishouden & dagelijks', 'Kleding', 'expense', false, 7),
    ('Huishouden & dagelijks', 'Maud (kleding/inventaris)', 'expense', true, 8),
    ('Huishouden & dagelijks', 'Kinderdagverblijf', 'expense', false, 9),
    ('Huishouden & dagelijks', 'Vakanties', 'expense', true, 10),

    ('Vervoer', 'Benzine', 'expense', false, 1),
    ('Vervoer', 'Wegenbelasting', 'expense', false, 2),
    ('Vervoer', 'Parkeren', 'expense', false, 3),
    ('Vervoer', 'Onderhoud', 'expense', true, 4),

    ('Zakgeld', 'Zakgeld Frank', 'expense', false, 1),
    ('Zakgeld', 'Zakgeld Kimberley', 'expense', false, 2),

    ('Sparen & reserveringen', 'Tussenrekening (cadeaubonnen/cash)', 'savings', false, 1),
    ('Sparen & reserveringen', 'Gezamenlijke spaarrekening (ING)', 'savings', false, 2),
    ('Sparen & reserveringen', 'Woning (ABN)', 'savings', false, 3),
    ('Sparen & reserveringen', 'Vakantie (ING)', 'savings', false, 4),
    ('Sparen & reserveringen', 'Woonbelasting (ING)', 'savings', false, 5),
    ('Sparen & reserveringen', 'Nieuwe auto / aflossen (ABN)', 'savings', false, 6),
    ('Sparen & reserveringen', 'Eigen risico (ING)', 'savings', false, 7),
    ('Sparen & reserveringen', 'Spaarrekening Maud (ING)', 'savings', false, 8)
  ) AS c(groep, naam, ctype, note, volg)
  JOIN category_group g ON g.household_id = hh AND g.naam = c.groep;

  RAISE NOTICE 'Seed klaar: huishouden, gebruikers, groepen en posten aangemaakt.';
END $$;
