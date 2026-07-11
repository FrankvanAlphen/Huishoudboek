# Huishoudboekje

Gezamenlijk huishoudboekje voor Frank & Kimberley: ING-import, categorisatie via regels, begroting, vermogensrekeningen en voorschot/tikkie-afwikkeling. Alle bedragen intern in **centen (integers)**, datums als ISO-strings.

## Architectuur

| Bestand | Rol |
|---|---|
| `server.js` | Express-API + statische hosting van `dist/`. Auth, state-opslag (PostgreSQL of tijdelijk geheugen), snapshots, audit-log, debug-log. |
| `src/App.jsx` | Volledige frontend (bewust single-file). Pure rekenfuncties bovenin, UI-componenten daaronder, `Workspace`/`App` onderaan. |
| `src/api.js` | Dunne fetch-laag; gooit `{conflict, current}` bij HTTP 409. |

**Dataopslag:** de complete toestand is één JSONB-rij (`app_state`, id=1) met een `rev`-nummer. Opslaan is **optimistisch gelijktijdig**: de client stuurt zijn laatst bekende `rev` mee; de server verhoogt atomair (`UPDATE … WHERE rev=$x`) en geeft 409 bij een conflict. Elke succesvolle save schrijft een snapshot (`state_snapshots`, laatste 40) — herstelbaar via Activiteit → Gegevens & backup. De client pollt elke 20 s en synct als er niets lokaal openstaat; mislukte saves worden elke 6 s opnieuw geprobeerd.

**Vermogenslogica:** `savingsCatForTx` is de enige bron van waarheid voor "welke vermogensrekening hoort bij deze mededeling" (spaarcode-veld of expliciet `Oranje spaarrekening <code>` / `Spaardeposito <code>`). `derivedPotMutation` leidt daaruit mutaties af voor transacties die op een gewone post (bijv. Tussenrekening) geboekt staan; `potFlows`/`potMutations`/`potHistory` bouwen daar de saldi, drilldown en jaargrafiek op. Er wordt **nooit** automatisch een rekening aangemaakt.

## Environment variables (Railway → Variables)

| Variabele | Verplicht | Uitleg |
|---|---|---|
| `DATABASE_URL` | ja (voor persistentie) | PostgreSQL-connectiestring. Zonder: tijdelijk geheugen. |
| `APP_SECRET` | ja | Lange willekeurige string; ondertekent sessiecookies. |
| `FRANK_TEMP_PW`, `KIMBERLEY_TEMP_PW` | aanbevolen | Startwachtwoorden (anders fallback in code). Eerste login dwingt wijziging af. |
| `COOKIE_INSECURE=true` | alleen lokaal | Cookies zonder `Secure`-vlag voor http://localhost. |

## Security-samenvatting

Scrypt-hashing met timing-safe vergelijking en dummy-werk tegen username-enumeratie; HMAC-cookies gebonden aan de wachtwoordhash (wachtwoord wijzigen = alle oude sessies ongeldig); HttpOnly/Secure/SameSite=Strict; rate limiting per IP én gebruikersnaam (met opruiming); uitsluitend geparametriseerde queries; security-headers + HSTS; fail-closed auth; 10 MB payload-limiet.

## Bekende dependency-punten

- **xlsx (npm) heeft open CVE's**; SheetJS publiceert fixes alleen op hun eigen CDN. Risico hier beperkt (lazy-loaded, parseert alleen eigen uploads van ingelogde gebruikers). Nette fix, lokaal uitvoeren: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **esbuild/vite (moderate)** raakt alleen de lokale dev-server, niet de productie-build. Oplossen = Vite-major-upgrade; bewust uitgesteld.

## Lokaal draaien

```bash
npm install
COOKIE_INSECURE=true npm run dev      # frontend (Vite) — of:
npm run build && COOKIE_INSECURE=true node server.js
```

## Deploy (Railway)

Build `npm run build`, start `node server.js`. **Root Directory in Railway leeg laten** (of exact de map met `package.json`). `vite.config.js` pint root en input expliciet, zodat de build ook slaagt bij een afwijkende working directory.
