# Huishoudboekje

Een gedeeld huishoudboekje voor twee mensen, met **twee persoonlijke inloggen** en
een **logboek dat bijhoudt wie wat doet**. Je begroting staat klaar in jouw eigen
postenstructuur; je werkt het bij door je ING-CSV te uploaden. De app leidt je
transactie-voor-transactie door alles wat je aandacht nodig heeft (een post kiezen
of een opmerking toevoegen) en leert daar regels van, zodat het elke keer minder
werk wordt.

Techniek: één React-frontend (Vite) + een kleine Express-server die de toestand,
de gebruikers en het logboek opslaat in PostgreSQL. Bedragen overal in hele centen.

---

## Inloggen

Er zijn twee gebruikers. Op het inlogscherm kies je wie je bent en typ je je
wachtwoord.

| Gebruiker            | Tijdelijk startwachtwoord |
| -------------------- | ------------------------- |
| Frank van Alphen     | `@chterZoom24!`           |
| Kimberley Lagendijk  | `V00rZoom24!`             |

**Bij de eerste keer inloggen** moet ieder een eigen, nieuw wachtwoord kiezen
(minstens 8 tekens). Daarna log je met dat nieuwe wachtwoord in. Wijzigen kan later
altijd nog via de knop **Wachtwoord wijzigen** linksonder in de app.

In het tabblad **Activiteit** zie je wie wanneer heeft ingelogd, geïmporteerd, de
begroting of regels heeft aangepast, of een wachtwoord heeft gewijzigd.

---

## Op Railway zetten (kort en simpel)

1. Nieuw project op Railway → **Deploy from GitHub repo** (of sleep deze map als zip
   naar een nieuwe service). Railway herkent een Node-app, draait automatisch
   `npm install` + `npm run build` en start met `npm start`.

2. Heb je nog geen database? Klik op **New → Database → PostgreSQL**.

3. Open je **app-service** (niet de database) → tabblad **Variables** en zet er
   **één** ding op:

   | Naam           | Waarde                       |
   | -------------- | ---------------------------- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

   > Heet je Postgres-service anders (bijv. `Postgres-jIBC`), gebruik dan die naam:
   > `${{Postgres-jIBC.DATABASE_URL}}`. Of plak de interne Database-URL die je bij de
   > Postgres-service onder **Variables** ziet staan.

4. Onder **Settings → Networking** klik je op **Generate Domain**. Open dat adres,
   kies wie je bent, log in met je startwachtwoord en kies een nieuw wachtwoord.

De app maakt zelf de benodigde tabellen (gebruikers, logboek, data) aan bij de
eerste start.

### Goed om te weten

- **`APP_PASSWORD` is niet meer nodig.** Inloggen gaat nu via de twee persoonlijke
  gebruikers hierboven. Een oude `APP_PASSWORD`-variabele mag blijven staan; hij
  wordt genegeerd.
- **De app start altijd**, ook zonder `DATABASE_URL`. Dan draait hij met tijdelijk
  geheugen en verdwijnt alles bij een herstart (ook de wachtwoordwijzigingen).
  Linksonder zie je of je met de database verbonden bent. Zet `DATABASE_URL` zodra je
  blijvende, gedeelde opslag wilt.
- **SSL:** de interne Railway-database heeft dat niet nodig — niets instellen. Een
  externe database die SSL eist: zet `DATABASE_SSL=true`.

---

## Beveiliging — doe dit meteen na de eerste deploy

De app staat op het open internet; je inlog is de enige drempel. Drie dingen zijn **verplicht**:

1. **Zet `APP_SECRET`** (Railway → je service → Variables) op een lange willekeurige tekst.
   Genereer er een met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   Zonder deze sleutel moet je na elke herstart opnieuw inloggen.
2. **Log één keer in als beide gebruikers en kies meteen een eigen wachtwoord.** De
   startwachtwoorden staan in de broncode; ze zijn pas veilig zodra je ze hebt gewijzigd.
   Een wachtwoord wijzigen logt automatisch álle oude sessies (ook op andere apparaten) uit.
3. **Koppel een PostgreSQL-database** (`DATABASE_URL`), anders verdwijnen je gegevens bij
   een herstart en staan ook de gebruikers/wachtwoorden niet vast.

Wat er al ingebouwd zit: wachtwoorden worden gehasht (scrypt + salt), het inlog-cookie is
`HttpOnly`, `Secure` (alleen via HTTPS) en `SameSite=Strict`, heeft een vervaldatum en is
gekoppeld aan je wachtwoord (wijzigen = oude cookies ongeldig), er zit een rem op
inlogpogingen (per IP én per gebruikersnaam), beveiligingsheaders (HSTS, anti-clickjacking,
nosniff), en alle database-opvragingen zijn geparametriseerd (geen SQL-injectie).

Optioneel sterker: zet `FRANK_TEMP_PW` / `KIMBERLEY_TEMP_PW` zodat de startwachtwoorden niet
in de broncode staan, en deel de URL niet publiek.

---

## Lokaal draaien (optioneel)

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Zonder `DATABASE_URL` werkt alles, maar wordt er niets blijvend opgeslagen.

## Nieuw: meerdere jaren, eigen posten en zelf regels beheren

- **Jaar-schakelaar** rechtsboven: wissel tussen begrotingsjaren. Met **+ jaar** open je de assistent voor een nieuw begrotingsjaar.
- **Nieuw-jaar-assistent**: neemt vorig jaar als basis over en toont per post wat je vorig jaar werkelijk uitgaf, als ijkpunt. Het beginsaldo (carry-in) wordt automatisch overgenomen uit het eindsaldo van het vorige jaar.
- **Eigen posten**: voeg posten toe met **+ nieuwe post** in Begroting, Uitgaven of Posten. In **Posten** kun je hernoemen, het type wijzigen en (lege) posten verwijderen.
- **Regels zelf maken/aanpassen**: in **Regels** maak je met **+ Nieuwe regel** eigen herkenningsregels en pas je bestaande inline aan.
- **Automatische migratie**: bestaande opgeslagen data (met één jaar) wordt bij het laden automatisch omgezet naar de nieuwe jaren-structuur. Je hoeft niets handmatig te doen.

## Nieuw: Transacties-register, Vermogen per rekening en betrouwbaar indelen

- **Transacties** (nieuw tabblad): je wekelijkse/maandelijkse naloop. Alle transacties van het gekozen jaar; per transactie kies je de post (bij een uitgave zie je géén inkomstenposten), zet je een **notitie**, **markeer** je 'm (★, bijv. voorgeschoten/nog uitzoeken), of **verdeel** je 'm over meerdere posten. Filter op *te sorteren* of *gemarkeerd*. Je kunt vanaf een transactie ook meteen een herkenningsregel maken ("Onthoud dit").
- **Openstaande acties**: staan boven op het Overzicht (te sorteren + gemarkeerd) met een knop naar Transacties.
- **Vermogen** (nieuw tabblad): per spaar-/reserveringsrekening het startsaldo, wat er bij/af ging, en het huidige saldo — plus het totaal.
- **Import zonder popup**: herkende transacties worden meteen ingedeeld; de rest komt als 'te sorteren' in het register. Geld­invoervelden (begroting, maanden, splitsen) typen nu soepel.
- **Dubbele detectie**: elke transactie krijgt een vingerafdruk uit datum + bedrag + tegenrekening + de volledige mededelingen + mutatiesoort. Upload je per ongeluk dezelfde CSV, dan wordt alles herkend als al-aanwezig en niets dubbel toegevoegd.
