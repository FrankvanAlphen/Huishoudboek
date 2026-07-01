# KPS 3.0 — Financiële beheersingsmodule

Interne projectbeheersing voor J.P. van Eesteren (TBI). Next.js 15 (app-router) + React 19.

Bevat: PER-lijst (laag 1), kostendragerbewaking + afrekenblad (contractgebonden rubrieken), bewaking op arbeid (rubriek 1 + 6), bewaking materieelstukken (rubriek 5). Eén gedeelde rekenmotor (`berekenKD`) bepaalt per rubriektype de prognose kosten einde werk.

## Structuur

```
app/
  layout.js        root layout + metadata
  page.js          rendert <Kps3App/>
  globals.css      reset
components/
  Kps3App.jsx      alle UI, data, helpers en stijlen in één client-component ("use client")
scripts/
  preflight.py     statische validatie vóór deploy
package.json · railway.json · next.config.js · jsconfig.json · .nvmrc · .eslintrc.json
```

## Lokaal draaien / controleren

```bash
npm install
python3 scripts/preflight.py     # statische checks (verwacht: ALLE CHECKS GESLAAGD)
npm run build                     # productiebuild — moet zonder fouten slagen
npm run start                     # draait op $PORT (lokaal 3000)
```

> De build/lint is hier niet uitgevoerd (geen netwerk in de bouwomgeving). Draai `npm install && npm run build` lokaal even ter bevestiging vóór het pushen.

## Deployen op Railway

1. Push deze map als repository (of upload de inhoud) naar je Railway-project.
2. **Root Directory**: laat dit veld **leeg** (de bestanden staan in de root van de repo, niet in een submap).
3. Railway gebruikt automatisch `railway.json`: build = `npm install && npm run build`, start = `npm run start` (bindt op `$PORT`).
4. Nixpacks detecteert Node via `.nvmrc` (20) en `engines` in `package.json` (`>=20 <23`).

## Let op

- De data staat **in het geheugen** (React state) en **reset bij herladen**; er is nog geen persistente opslag/backend.
- Het **inlogscherm staat aan**. De app start uitgelogd: kies een gebruiker en voer het wachtwoord in. Het wachtwoord en de gebruikerslijst staan in `components/Kps3App.jsx` (`APP_WACHTWOORD` en `GEBRUIKERS`). Dit is een eenvoudige client-side gate (geen echte server-authenticatie); voor productie met gevoelige data is een serverside auth-laag aan te raden.
