# Huishoudboekje — financieel besturingssysteem

Persoonlijk huishoudboekje dat je Excel vervangt: begroting, ING-CSV-import met een
lerende regel-engine, deduplicatie, spaarpotjes/vermogen, lopend saldo en planafwijking.
Gedeeld door twee personen, één gezamenlijk saldo, één ING-rekening.

Er zijn twee onderdelen:

1. **Deze repo** — de deploybare applicatie (Vite + React + Express + PostgreSQL, Railway).
2. **`huishoudboekje-prototype.jsx`** — een testmodel met exact dezelfde rekenkern, dat
   los in een React-omgeving draait zonder database. Daarmee is de volledige werking
   (incl. de ING-import) end-to-end doorgerekend; het dient als referentie voor de UI.

## Wat zit er in de repo

- **`packages/domain`** — de pure rekenkern, volledig unit-getest (22 tests): lopend saldo
  met carry-in, planafwijking, prognose, begroting (gemiddelde-anker + 12-maandsverdeling),
  break-even, potjes/vermogen, deduplicatie (inhoud-hash + occurrence) en de regel-engine.
- **`packages/shared`** — geld-helpers (centen, nl-NL), datum-helpers, de begrotingsmatrix-
  parser (overname) en Zod-schema's. (5 tests)
- **`db/`** — migraties: `0001` kern-schema (huishouden, gebruiker, rekening, jaar, groepen,
  posten, audit) en `0002` begroting (begrotingsregels + maanden, spaarpot-beginstanden);
  plus een seed met de volledige postenstructuur.
- **`apps/api`** — Express + PostgreSQL met Kysely als typed query-laag:
  - Fase 1: gedeelde login (scrypt-hash, ondertekende sessiecookie, rate-limit), health, audit.
  - Fase 2: endpoints voor posten/groepen, jaren (incl. kopiëren), begroting (lezen met
    totalen + break-even, opslaan met Σ-validatie) en de overname-wizard.
- **`apps/web`** — Vite + React. Op dit moment de fase 1-schil (login + ingelogde weergave).
  De rijke schermen (begroting, import, regels, wizard) staan uitgewerkt in het JSX-prototype
  en worden in de deploy-stap op deze backend aangesloten.

## Stack

TypeScript (strict) · React + Vite · Express · PostgreSQL · Kysely · Zod.
Geld overal in hele centen. Geen zware ORM, geen DI-framework — bewust licht.

## Lokaal draaien

```bash
npm install
cp .env.example .env
npm run hash-password -- "JouwWachtwoord"   # zet de uitvoer in AUTH_PASSWORD_HASH
# vul ook AUTH_SECRET en DATABASE_URL in .env
npm run db:migrate
npm run db:seed
npm run dev:api    # http://localhost:3000
npm run dev:web    # http://localhost:5173
```

## Tests

```bash
npm test     # domain-rekenkern (node:test, geen extra dependencies)
```

## Deployen op GitHub + Railway

1. Push de repo naar GitHub.
2. Maak in Railway een project vanuit de repo en koppel de **PostgreSQL-plugin**
   (`DATABASE_URL` wordt automatisch gezet).
3. Zet variabelen: `AUTH_PASSWORD_HASH`, `AUTH_SECRET`, `NODE_ENV=production`.
4. Build: `npm install && npm run build` · Start: `npm start`
   (de API serveert in productie ook de gebouwde frontend).
5. Eenmalig: `npm run db:migrate` en `npm run db:seed`.

## Teststatus — eerlijk

| Onderdeel | Status |
|---|---|
| `packages/domain` (rekenkern) | **Geverifieerd**: `--strict` schoon, 22/22 tests groen |
| `packages/shared` (matrix-parser, geld) | **Geverifieerd**: 5/5 tests groen |
| Prototype (`.jsx`) end-to-end | **Doorgerekend**: 9 controles met seed + ING-voorbeeld (begroting sluit, CSV-parse, dedup 5/3, regels, saldo €1.250,08 → €-21,49, vermogen €25.281) |
| DB-schema + seed (SQL) | Geschreven, nog niet tegen een live PostgreSQL gedraaid |
| API fase 1 + 2 (auth, posten, jaren, begroting, wizard) | Compleet, nog niet runtime-getest (vereist `npm install` + database) |
| Web fase 2/3 (begroting/import/regels/wizard) | Uitgewerkt in het prototype; nog te koppelen aan de backend |

De rekenkern en alle berekeningen zijn daadwerkelijk getest. De backend-endpoints en het
schema zijn volledig en volgens de architectuur geschreven, maar moeten in jouw omgeving
(Claude Code of lokaal) met `npm install` + PostgreSQL worden gedraaid. De resterende stap
is de schermen uit het prototype als getypte React-componenten op deze backend aansluiten —
het prototype legt het verwachte gedrag exact vast.

## ING-CSV

De parser is gebouwd op het standaard ING-exportformaat
(`Datum;Naam / Omschrijving;…;Af Bij;Bedrag (EUR);Mutatiesoort;Mededelingen`, datum JJJJMMDD).
Leg een echte (geanonimiseerde) export ernaast om de kolomnamen definitief te bevestigen.
