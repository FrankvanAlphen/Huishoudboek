# Huishoudboekje

Een gedeeld huishoudboekje voor twee mensen, met één gezamenlijk wachtwoord.
Je begroting staat al klaar in jouw eigen postenstructuur; je werkt het bij door
je ING-CSV te uploaden. De app leidt je transactie-voor-transactie door alles wat
je aandacht nodig heeft (een post kiezen of een opmerking toevoegen) en leert daar
regels van, zodat het elke keer minder werk wordt.

Techniek: één React-frontend (Vite) + een kleine Express-server die de hele
toestand als JSON bewaart in PostgreSQL. Bedragen overal in hele centen.

---

## Op Railway zetten (kort en simpel)

1. Maak een nieuw project op Railway en kies **Deploy from GitHub repo** (of sleep
   deze map als zip naar een nieuwe service). Railway herkent een Node-app, draait
   automatisch `npm install` + `npm run build` en start daarna met `npm start`.

2. Heb je nog geen database? Klik in je project op **New → Database → PostgreSQL**.

3. Open je **app-service** (niet de database) → tabblad **Variables** en zet er
   **twee** dingen op:

   | Naam           | Waarde                                  |
   | -------------- | --------------------------------------- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`            |
   | `APP_PASSWORD` | het wachtwoord dat jullie samen gebruiken |

   > Heet je Postgres-service anders (bijv. `Postgres-jIBC`), gebruik dan die naam:
   > `${{Postgres-jIBC.DATABASE_URL}}`. Of plak gewoon de interne Database-URL die
   > je bij de Postgres-service onder **Variables** ziet staan.

4. Onder **Settings → Networking** klik je op **Generate Domain** om een webadres te
   krijgen. Open dat adres, log in met `APP_PASSWORD`, en je bent binnen.

Dat is alles. De app maakt zelf de benodigde tabel aan bij de eerste start.

### Belangrijk om te weten

- **De app start altijd**, ook als je `DATABASE_URL` (nog) niet hebt gezet. Hij
  draait dan met tijdelijk geheugen en de data verdwijnt bij een herstart. Linksonder
  in de app zie je of je met de database verbonden bent. Zet `DATABASE_URL` zodra je
  blijvende, gedeelde opslag wilt.
- **SSL:** de interne Railway-database heeft dat niet nodig — niets instellen.
  Gebruik je een externe database die SSL eist, zet dan `DATABASE_SSL=true`.

---

## Lokaal draaien (optioneel)

```bash
npm install
npm run dev        # frontend op http://localhost:5173 (zonder server-opslag)

# of de echte server (frontend + opslag samen):
npm run build
npm start          # http://localhost:3000
```

Zonder `DATABASE_URL` werkt alles, maar wordt er niets blijvend opgeslagen.
