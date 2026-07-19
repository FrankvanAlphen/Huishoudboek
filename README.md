# Huishoudboekje

Gezamenlijk huishoudboekje voor Frank & Kimberley: ING-import, categorisatie via regels, begroting, vermogensrekeningen en voorschot/tikkie-afwikkeling. Alle bedragen intern in **centen (integers)**, datums als ISO-strings.

## Architectuur

- `tikkies.jsx` — tabblad "Tikkies & delen": losse voorschotten (VoorschotPaneel) én gedeelde bundels (DelenPaneel: delen, herkennen, koppelen). Verhuisd uit uitgaven.jsx en transacties.jsx.


| Bestand | Rol |
|---|---|
| `server.js` | Express-API + statische hosting van `dist/`. Auth, state-opslag (PostgreSQL of tijdelijk geheugen), snapshots, audit-log, debug-log. |
| `src/*.js(x)` | Frontend in 14 modules: `lib` (helpers), `financieel` (rekenlogica), `seed` (stamboom/migratie), `ui` (basiscomponenten: Chip, Keuze, MaandKiezer, MaandTabel, ScrollTabel), `store` (gedeelde context), `txrow`, `uitgaven`, `transacties`, `begroting`, `overzicht`, `vermogen`, `beheer`, `account`, `App.jsx` (Workspace/opstart). |
| `src/api.js` | Dunne fetch-laag; gooit `{conflict, current}` bij HTTP 409. |

**Dataopslag:** de complete toestand is één JSONB-rij (`app_state`, id=1) met een `rev`-nummer. Opslaan is **optimistisch gelijktijdig**: de client stuurt zijn laatst bekende `rev` mee; de server verhoogt atomair (`UPDATE … WHERE rev=$x`) en geeft 409 bij een conflict. Elke succesvolle save schrijft een snapshot (`state_snapshots`, laatste 40) — herstelbaar via Activiteit → Gegevens & backup. De client pollt elke 20 s en synct als er niets lokaal openstaat; mislukte saves worden elke 6 s opnieuw geprobeerd.

**Vermogenslogica:** `savingsCatForTx` is de enige bron van waarheid voor "welke vermogensrekening hoort bij deze mededeling" (spaarcode-veld of expliciet `Oranje spaarrekening <code>` / `Spaardeposito <code>`). `derivedPotMutation` leidt daaruit mutaties af voor transacties die op een gewone post (bijv. Tussenrekening) geboekt staan; `potFlows`/`potMutations`/`potHistory` bouwen daar de saldi, drilldown en jaargrafiek op. Er wordt **nooit** automatisch een rekening aangemaakt.

**Componenten:** terugkerende UI-patronen hebben één implementatie in `ui.jsx` — `Chip` (filterknoppen), `Keuze` (selects), `MaandKiezer` (maandkeuze, als dropdown óf als chips), `MaandTabel` (rijen × 12 maanden + totaal; draagt MaandMatrix en WinkelMatrix) en `ScrollTabel`. Nieuwe schermen composeren hiermee in plaats van eigen styling te herhalen.

**Mobiel:** `useIsMobile()` (breekpunt 760px) schakelt de indeling om. De transactieregel stapelt op de telefoon (datum/naam/bedrag + knoppen op één regel, postkiezer eronder over de volle breedte) in plaats van zes kolommen van samen 578px te forceren; de kolomkoppen verdwijnen dan. Brede tabellen (Vermogen, Posten, Regels, Uitgaven) scrollen horizontaal binnen hun eigen kaart — nooit de pagina zelf. Nieuw breed raster? Geef het een `minWidth` en zet de omhullende `Card` op `overflowX: "auto"`.

**Context i.p.v. prop-drilling:** `store.jsx` levert `useHuishoudboekje()` met `user`, `other`, `tasks`, `attachCounts` en de bijbehorende acties. `Workspace` zet de provider; `TxRow`, `Bijlagen`, `TaakKnop` en `MobileHome` halen zelf op wat ze nodig hebben.

## Environment variables (Railway → Variables)

| Variabele | Verplicht | Uitleg |
|---|---|---|
| `DATABASE_URL` | ja (voor persistentie) | PostgreSQL-connectiestring. Zonder: tijdelijk geheugen. |
| `APP_SECRET` | ja | Lange willekeurige string; ondertekent sessiecookies. |
| `FRANK_TEMP_PW`, `KIMBERLEY_TEMP_PW` | aanbevolen | Startwachtwoorden voor een **lege** database. Niet gezet? Dan genereert de server een willekeurig wachtwoord en zet het eenmalig in het opstartlog. Bestaande accounts worden nooit aangeraakt. |
| `COOKIE_INSECURE=true` | alleen lokaal | Cookies zonder `Secure`-vlag voor http://localhost. |
| `DATABASE_SSL_STRICT`, `DATABASE_CA` | optioneel | Volledige certificaatcontrole op de databaseverbinding (nodig bij verbinden buiten Railway's interne netwerk). |
| `PUBLIC_HOST` | aanbevolen | Je publieke hostnaam (bv. `huishoudboekje.up.railway.app`). Gezet? Dan accepteert de http→https-redirect alleen die host — dat sluit een open redirect via een vervalste Host-header volledig uit. |

## Security-samenvatting

**Wachtwoorden:** scrypt met willekeurig salt en timing-safe vergelijking; de kosten staan in de hash zelf (`scrypt$N$r$p$salt$hash`, nu N=65536 ≈ 64 MB per poging). Oude hashes (`salt:hash`, Node-standaardkosten) blijven werken en worden bij een geslaagde login stilletjes omgezet naar de zwaardere kosten — niemand raakt buitengesloten. Hashen gebeurt asynchroon, dus inloggen blokkeert de server niet. Bij een onbekende gebruikersnaam wordt hetzelfde werk gedaan (geen enumeratie via responstijd).

**Onderweg / in de browser:** het wachtwoord reist versleuteld via HTTPS (TLS van Railway). De server **dwingt dit actief af**: kwam een verzoek via http binnen (X-Forwarded-Proto), dan volgt een 308-redirect naar https vóórdat er iets wordt verwerkt — zo reist een wachtwoord nooit onversleuteld, ook niet bij het allereerste bezoek voordat HSTS actief is. Alle API-calls gebruiken relatieve paden en erven dus het https-protocol van de pagina; er staan geen http-URL's in de frontend (geen mixed content). HSTS met `preload` — dat is de juiste plek voor die bescherming; client-side hashen zou de hash zélf het wachtwoord maken en voegt niets toe. HSTS dwingt HTTPS af. Sessiecookie: HttpOnly (niet leesbaar voor scripts), SameSite=Strict (blokkeert CSRF), Secure (alleen via HTTPS), HMAC-ondertekend en gebonden aan de wachtwoordhash — wachtwoord wijzigen maakt alle oude sessies ongeldig. Content-Security-Policy staat alleen eigen scripts toe en verbiedt frames (clickjacking), plug-ins en externe verbindingen. React escapet alle tekst; er wordt nergens `innerHTML`/`eval` gebruikt.

**Bijlagen:** alleen jpeg/png/webp/pdf, max 6 MB, altijd achter login, en geserveerd met `sandbox` + `nosniff` zodat een geüpload bestand nooit actieve code op onze eigen domeinnaam kan uitvoeren.

**Caching:** API-antwoorden krijgen `Cache-Control: no-store` — financiële gegevens blijven nooit op schijf achter. Bijlagen zijn de bewuste uitzondering (`private, max-age=3600`) zodat bonnetjes niet bij elke blik opnieuw laden.

**Op de server:** `trust proxy` staat op 1, zodat het bezoekersadres van Railway's proxy komt en niet uit een zelf meegestuurde `X-Forwarded-For` — anders is de rate limiting te omzeilen. Geen wachtwoorden in de broncode: startwachtwoorden komen uit env of worden willekeurig gegenereerd en eenmalig gelogd. Foutmeldingen naar buiten zijn generiek (geen stack traces); details alleen in het serverlog. Databaseverbinding via SSL met optionele volledige certificaatcontrole (`DATABASE_SSL_STRICT`).

**Overig:** uitsluitend geparametriseerde queries (geen SQL-injectie), rate limiting per IP én gebruikersnaam, fail-closed auth, 10 MB payload-limiet, geen wachtwoorden in logs.

**Wachtwoord wijzigen** vraagt om je huidige wachtwoord (behalve bij de verplichte eerste wijziging, als je er nog geen hebt) — zo kan een openstaande sessie geen account kapen.

**Bekende beperkingen (bewust, passend bij een privé-app met twee vaste gebruikers):** het inlogscherm toont de twee namen als keuzelijst (geen geheim, scheelt typen); sessies zijn niet individueel in te trekken (wachtwoord wijzigen trekt ze allemaal in); minimale wachtwoordlengte is 8 tekens; geen self-service wachtwoordherstel; geen MFA. Voor een publieke app met open registratie zou elk van deze punten anders liggen — voor twee bewoners op één huishoudboekje is dit een bewuste afweging.

## Bundels & tikkies

Een **bundel** is een groep transacties met hetzelfde label (`bundle` op de transactie). Je zet het
label bij het verwerken of via de transactieregel; het datalist-veld stelt bestaande labels voor.

Werkwijze: bundel eerst de uitgaven (bijv. een weekend weg), open dan **Tikkies & delen → Delen**
en klik op **Delen door 2/3/4/5** — of "meer dan 5…" om zelf een aantal te typen. Dat aantal is
*inclusief jezelf*; de app maakt de overige personen aan, die je een naam kunt geven.

**Afronding volgt de tikkie-praktijk.** Het deel van de anderen wordt naar BOVEN afgerond op hele
centen (`Math.ceil`), want dat is het bedrag dat je als tikkie verstuurt. Jouw eigen deel is het
restant: `totaal − deel × aantal anderen`. Daardoor is jouw deel hooguit een paar cent kleiner dan
dat van de rest. Voorbeeld: bundel van € 500,03 met z'n vijven → vier tikkies van € 100,01 (samen
€ 400,04), jouw deel € 99,99. De optelsom klopt altijd exact: jouw deel + terugverwacht = bundeltotaal.

**Betaalde tikkies worden herkend.** `bundleSuggestions()` zoekt per persoon de meest waarschijnlijke
binnengekomen betaling en toont die als voorstel; één klik op *Koppel* verrekent hem. Bij meerdere
voorstellen verschijnt *Koppel alle N*. Score: exact het openstaande bedrag = 3 punten, een paar cent
ernaast = 1, naam-match = 3; vanaf 3 punten volgt een voorstel, vanaf 6 heet het "Betaald door" in
plaats van "Mogelijk". Alleen betalingen ná de eerste bundeluitgave tellen mee, en de toewijzing is
greedy: dezelfde transactie wordt nooit aan twee personen voorgesteld. Voorstellen lopen via `allBundleSuggestions` met één
gedeelde claim-set, zodat dezelfde binnengekomen betaling nooit bij twee bundels tegelijk wordt
voorgesteld. Betaalt iemand te veel, dan koppelt de app exact het openstaande deel en toont het
restant ("… blijft over"). Bij twijfel doet hij liever
niets — een fout voorstel is duurder dan geen voorstel.

Namen matchen via `nameTokens()` (woorden vanaf 3 letters, dus aanhef en initialen tellen niet mee).
`cleanPayerName()` maakt van het ING-naamveld een bruikbare naam: "Hr M Lagendijk" → "M Lagendijk",
"Hr RW Boekestijn,Mw E Knoester" → "RW Boekestijn", "… via ASN Bank Betaalverzoek" → de persoon
ervoor. Accepteer je een voorstel, dan wordt die naam ingevuld — maar alléén zolang de naam nog de
door de app verzonnen "Persoon N" is (`isDefaultPersonName`); een naam die jij zelf typte blijft staan.

Komt er geld binnen dat hij niet herkent, dan koppel je het zelf via *kies een betaling…*. Deelbetalingen
mogen: iemand blijft "open" tot zijn deel vol is, en één inkomende transactie kan aan meerdere personen
in meerdere bundels hangen (`unassignedOf` bewaakt dat je niet meer koppelt dan er binnenkwam).
Gekoppeld geld wordt **proportioneel over de héle bundel** teruggeboekt, niet volledig tegen één
uitgave. Bij een bundel van 300 + 100 + 75 + 25 gedeeld door 5 gaat van elke betaling van € 100 dus
automatisch € 60 naar de 300, € 20 naar de 100, € 15 naar de 75 en € 5 naar de 25. Voorschotten en bundels staan samen op het tabblad **Tikkies & delen**; de knop op Transacties verwijst ernaartoe.

**Datamodel.** `state.bundles = [{ key, naam, people: [{ id, naam }] }]`, waarbij `key` het label in
kleine letters is en `people` alleen de ánderen bevat (jij bent impliciet +1). De bundel zelf bestaat
door de labels op de transacties; `state.bundles` hangt er alleen de deel-informatie aan. Een label
zonder personen is gewoon een niet-gedeelde bundel — die blijft werken zoals voorheen. Betalingen zijn
settlements met `{ bundleKey, personId, amountCents }` naast de bestaande voorschot-vorm
`{ advanceId, amountCents }`; beide vormen leven naast elkaar in `settlements`.

**Bundel verwijderen** haalt alleen het label bij de transacties weg (en ruimt de koppelingen op).
De transacties zelf blijven altijd staan.

## Importeren

**Import** accepteert je ING-bestand op twee manieren: slepen in de zone, of klikken op *Kies je
gedownloade bestand*. Excel (.xlsx/.xls) gaat via `loadXLSX()` → `parseINGRows`; CSV gaat via
`parseINGCsv`. Beide routes roepen `handleFile` aan, die zelf doorschakelt naar het overzicht — er
is geen aparte "verwerk"-stap. Het plakvak voor ruwe CSV is vervallen (en daarmee de knop met het ING-voorbeeld).

## Opschonen

**Transacties → Opschonen** kan een maand, een periode, een heel jaar of alles wissen. Bovenaan staat
**Laatste import**: die verwijdert precies de transacties van de nieuwste batch (`batchId`, nieuwste
eerst via `batchesOf`) — handig als je net het verkeerde bestand inlas. Oudere batches blijven staan.

## Bekende dependency-punten

- **xlsx (npm) heeft open CVE's**; SheetJS publiceert fixes alleen op hun eigen CDN. Risico hier beperkt (lazy-loaded, parseert alleen eigen uploads van ingelogde gebruikers). Nette fix, lokaal uitvoeren: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- **esbuild/vite**: opgelost door de upgrade naar Vite 8 (draait op Rolldown; esbuild is niet langer een afhankelijkheid).

## Onderhoud: hoe je hier veilig aan werkt

**Waar hoort mijn wijziging?** Rekenen → `financieel.js` (puur, geen React). Nieuwe standaardpost → `seed.js`. UI-patroon dat op twee plekken nodig is → `ui.jsx`, niet kopiëren. Gedeelde gegevens (gebruiker, taken, bijlagetellingen) → via `useHuishoudboekje()` uit `store.jsx`, niet als prop doorgeven. Elk bestand opent met een kopregel die vertelt wat er woont.

**Afhankelijkheidsrichting** loopt één kant op: `lib` → `financieel` → `seed` → `ui` → `store` → `txrow` → schermen → `App`. Importeer nooit terug (een cirkel breekt de build op onverwachte plekken).

**Valkuil bij testen.** Het demo-artifact wordt gemaakt door de modules samen te vóégen tot één bestand. Daardoor werkt daarin ook code die vergeten is te importeren — een ontbrekende import blijft dan onzichtbaar tot de echte app crasht. Test dus altijd tegen de **echte modulegraaf** (`npm run build` + de app draaien), niet alleen tegen de demo. `npm run build` faalt níet op een ontbrekende import: dat wordt pas een fout in de browser.

## Lokaal draaien

```bash
npm install
COOKIE_INSECURE=true npm run dev      # frontend (Vite) — of:
npm run build && COOKIE_INSECURE=true node server.js
```

## Deploy (Railway)

Build `npm run build`, start `npm start` (= `node server.js`). **Root Directory in Railway leeg laten** (of exact de map met `package.json`). `vite.config.js` pint root en input expliciet, zodat de build ook slaagt bij een afwijkende working directory.

Twee dingen die een deploy stil laten mislukken en daarom vastliggen:

- **Node-versie.** Vite 8 eist `^20.19 || >=22.12`. `package.json` → `engines.node: ">=22.12.0"` en `.nvmrc` (22.12.0) dwingen dat af; zonder die pinning kan Railway een oudere Node kiezen en faalt de build.
- **Lockfile in sync.** Railway draait `npm ci`, en die weigert zodra `package.json` en `package-lock.json` uit elkaar lopen. Na élke handmatige wijziging in `package.json`: `npm install --package-lock-only` en beide bestanden committen.

Zet minimaal `DATABASE_URL` en `APP_SECRET`. Zonder `APP_SECRET` werkt de app wél, maar wordt bij elke herstart een nieuwe sleutel gemaakt en moet iedereen opnieuw inloggen.
