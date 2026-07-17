import { distributeEven, slug } from "./lib.js";
import { SLUITPOST_ID, applySluitpost } from "./financieel.js";

// ---- Postenstamboom en migratie ----
// GROUPS_DEF/CAT_DEFS beschrijven de standaard groepen en posten; buildSeed() maakt een
// nieuwe, lege huishouding. mergeSeed() vult ontbrekende velden aan in bestaande data
// zonder ooit iets te overschrijven - dat is wat oude opslag veilig laat meegroeien.

const GROUPS_DEF = ["Inkomsten", "Woonlasten", "Verzekeringen", "Abonnementen", "Boodschappen & dagelijks", "Vervoer", "Zakgeld", "Sparen & reserveringen"];
// [groep, naam, type, noteSuggested]
const CAT_DEFS = [
  ["Inkomsten", "Salaris Frank + auto", "income", false],
  ["Inkomsten", "13e maand + overige Frank", "income", false],
  ["Inkomsten", "Salaris Kimberley / ING", "income", false],
  ["Inkomsten", "13e maand + vakantiegeld + overige Kimberley", "income", false],
  ["Inkomsten", "Hypotheekrenteaftrek", "income", false],
  ["Inkomsten", "Kinderopvangtoeslag", "income", false],
  ["Inkomsten", "Kinderbijslag", "income", false],
  ["Inkomsten", "Overige inkomsten | Lening ABN", "income", false],
  ["Woonlasten", "Hypotheek / ABN-Amro", "expense", false],
  ["Woonlasten", "Gas & Elektra / Vattenfall", "expense", false],
  ["Woonlasten", "Water / Duinwaterbedrijf Dunea", "expense", false],
  ["Woonlasten", "Provinciale belastingen / Zuid-Holland", "expense", false],
  ["Woonlasten", "Gemeentelijke belastingen / Gemeente Zuidplas", "expense", false],
  ["Verzekeringen", "Woon- en aansprakelijkheidsverzekeringen / FBTO", "expense", false],
  ["Verzekeringen", "Overlijdensrisicoverzekering / Dazure", "expense", false],
  ["Verzekeringen", "Zorgverzekering / Ditzo", "expense", false],
  ["Verzekeringen", "Reisverzekering / SNS bank", "expense", false],
  ["Verzekeringen", "Begrafenisverzekering / Dela", "expense", false],
  ["Verzekeringen", "Auto verzekering / Allianz", "expense", false],
  ["Abonnementen", "Internet en TV / Ziggo", "expense", false],
  ["Abonnementen", "Telefonie / Ben en Vodafone", "expense", false],
  ["Abonnementen", "Overige abonnementen / diverse", "expense", false],
  ["Abonnementen", "Netflix", "expense", false],
  ["Abonnementen", "Bankkosten / ING", "expense", false],
  ["Abonnementen", "Spotify", "expense", false],
  ["Abonnementen", "Videoland", "expense", false],
  ["Boodschappen & dagelijks", "Boodschappen: supermarkt, speciaalzaak, drogist", "expense", false],
  ["Boodschappen & dagelijks", "Huis en tuin", "expense", true],
  ["Boodschappen & dagelijks", "Cadeautjes", "expense", true],
  ["Boodschappen & dagelijks", "Uitstapjes/bestellen", "expense", true],
  ["Boodschappen & dagelijks", "Sporten", "expense", false],
  ["Boodschappen & dagelijks", "Kleding; zit in zakgeld", "expense", false],
  ["Boodschappen & dagelijks", "Persoonlijke verzorging: kapper, schoonheid", "expense", true],
  ["Boodschappen & dagelijks", "Maud: kleding, inventaris, verbruik, overige", "expense", true],
  ["Boodschappen & dagelijks", "Kinderdagverblijf", "expense", false],
  ["Boodschappen & dagelijks", "Vakanties", "expense", true],
  ["Vervoer", "Benzine", "expense", false],
  ["Vervoer", "Wegenbelasting", "expense", false],
  ["Vervoer", "Parkeren", "expense", false],
  ["Vervoer", "Onderhoud", "expense", true],
  ["Zakgeld", "Zakgeld Frank", "expense", false],
  ["Zakgeld", "Zakgeld Kimberley", "expense", false],
  ["Sparen & reserveringen", "Tussenrekening: cadeaubonnen, cash geld", "savings", false],
  ["Sparen & reserveringen", "Gezamenlijke spaarrekening / ING", "savings", false],
  ["Sparen & reserveringen", "Woning / ABN", "savings", false],
  ["Sparen & reserveringen", "Vakantie / ING", "savings", false],
  ["Sparen & reserveringen", "Woonbelasting / ING", "savings", false],
  ["Sparen & reserveringen", "Nieuwe Auto --> aflossen auto / ABN", "savings", false],
  ["Sparen & reserveringen", "Eigen risico / ING", "savings", false],
  ["Sparen & reserveringen", "Spaarrekening Maud / ING", "savings", false],
  ["Sparen & reserveringen", "Aandelenrekening", "savings", false],
];

/* ---- Sluitpost: het verschil komt automatisch op Gezamenlijke spaarrekening ---- */
function buildSeed() {
  const groups = GROUPS_DEF.map((naam, i) => ({ id: slug(naam), naam, volgorde: i }));
  const categories = CAT_DEFS.map(([g, naam, type, note], i) => ({ id: slug(naam), groupId: slug(g), naam, type, noteSuggested: note, volgorde: i }));
  const cid = (naam) => slug(naam);
  // Oranje (ING) spaarrekeningcodes — die staan in de mededelingen bij een over-/bijschrijving.
  const SPAARCODES = {
    "Gezamenlijke spaarrekening / ING": "H17729888",
    "Tussenrekening: cadeaubonnen, cash geld": "B55030134",
    "Spaarrekening Maud / ING": "A96691295",
    "Eigen risico / ING": "H96319154",
    "Nieuwe Auto --> aflossen auto / ABN": "M96388351",
    "Vakantie / ING": "V54438290",
    "Woonbelasting / ING": "X34919021",
    "Aandelenrekening": "15593447",
  };
  for (const c of categories) if (SPAARCODES[c.naam]) c.spaarcode = SPAARCODES[c.naam];
  // Vaste vs. variabele lasten: woonlasten/verzekeringen/abonnementen zijn standaard 'vast', de rest 'variabel'. Per post aanpasbaar op Posten.
  const VAST_GROUPS = new Set(["woonlasten", "verzekeringen", "abonnementen"]);
  for (const c of categories) if (c.type === "expense") c.vast = VAST_GROUPS.has(c.groupId);

  // Maandgemiddelden (euro's) — uit je begroting. De Gezamenlijke spaarrekening is
  // de sluitpost die de begroting precies op €77.940 laat kloppen.
  const A = {};
  const set = (naam, e) => (A[cid(naam)] = Math.round(e * 100));
  set("Salaris Frank + auto", 3000); set("13e maand + overige Frank", 200);
  set("Salaris Kimberley / ING", 2450); set("13e maand + vakantiegeld + overige Kimberley", 300);
  set("Hypotheekrenteaftrek", 100); set("Kinderopvangtoeslag", 360); set("Kinderbijslag", 85);
  set("Hypotheek / ABN-Amro", 1020); set("Gas & Elektra / Vattenfall", 100); set("Water / Duinwaterbedrijf Dunea", 25);
  set("Provinciale belastingen / Zuid-Holland", 40); set("Gemeentelijke belastingen / Gemeente Zuidplas", 80);
  set("Woon- en aansprakelijkheidsverzekeringen / FBTO", 25); set("Overlijdensrisicoverzekering / Dazure", 10);
  set("Zorgverzekering / Ditzo", 300); set("Reisverzekering / SNS bank", 5); set("Begrafenisverzekering / Dela", 10);
  set("Auto verzekering / Allianz", 40); set("Internet en TV / Ziggo", 75); set("Telefonie / Ben en Vodafone", 35);
  set("Overige abonnementen / diverse", 35); set("Netflix", 13); set("Bankkosten / ING", 5); set("Spotify", 11); set("Videoland", 10);
  set("Boodschappen: supermarkt, speciaalzaak, drogist", 500); set("Huis en tuin", 70); set("Cadeautjes", 140);
  set("Uitstapjes/bestellen", 400); set("Sporten", 25); set("Persoonlijke verzorging: kapper, schoonheid", 25);
  set("Maud: kleding, inventaris, verbruik, overige", 250); set("Kinderdagverblijf", 300); set("Vakanties", 300);
  set("Benzine", 60); set("Wegenbelasting", 40); set("Parkeren", 15); set("Onderhoud", 50);
  set("Zakgeld Frank", 500); set("Zakgeld Kimberley", 500);
  set("Woning / ABN", 580); set("Vakantie / ING", 300); set("Woonbelasting / ING", 120);
  set("Nieuwe Auto --> aflossen auto / ABN", 100); set("Eigen risico / ING", 50); set("Spaarrekening Maud / ING", 85);
  set("Aandelenrekening", 300);

  const lines = {};
  for (const c of categories) { const a = A[c.id] || 0; if (a !== 0 && c.id !== SLUITPOST_ID) lines[c.id] = { average: a, months: distributeEven(a) }; }
  const balanced = applySluitpost(categories, lines); // Gezamenlijke spaarrekening = sluitpost

  const years = [{ id: "2026", jaartal: 2026, carryInCents: 0, status: "open" }];
  const budgets = { "2026": balanced };

  const pots = []; // start leeg: spaarsaldi vul je zelf in op het Vermogen-tabblad

  // Scherpe startset: afgestemd op je eigen terugkerende transacties + gangbare NL-winkels.
  // categorize() is sign-bewust (catAllowed), dus inkomsten-regels pakken alleen + en uitgaven-regels alleen de juiste kant.
  // Persoonsoverboekingen met een duidelijke omschrijving vangen we op het omschrijving-veld.
  let rid = 0;
  const R = (catName, value, prio, field = "both", operator = "contains") =>
    ({ id: "r" + (++rid), categoryId: cid(catName), priority: prio, active: true, conditions: [{ field, operator, value }] });
  const rules = [
    // ---- Inkomsten (pakken via catAllowed alleen positieve bedragen) ----
    R("Kinderbijslag", "kinderbijslag", 18, "both"),
    R("Kinderbijslag", "sociale verzekeringsbank", 18, "both"),
    R("Kinderopvangtoeslag", "kinderopvangtoeslag", 18, "both"),
    R("Hypotheekrenteaftrek", "inkomstenbelasting", 20, "both"),
    R("Hypotheekrenteaftrek", "voorlopige teruggaaf", 20, "both"),

    // ---- Bankkosten ----
    R("Bankkosten / ING", "kosten oranjepakket", 18),
    R("Bankkosten / ING", "kosten tweede rekeninghouder", 18),
    R("Bankkosten / ING", "oranjepakket", 19),

    // ---- Verzekeringen ----
    R("Zorgverzekering / Ditzo", "ditzo", 22),
    R("Auto verzekering / Allianz", "allianz", 22),
    R("Woon- en aansprakelijkheidsverzekeringen / FBTO", "fbto", 22),
    R("Overlijdensrisicoverzekering / Dazure", "dazure", 22),
    R("Begrafenisverzekering / Dela", "dela", 22),
    R("Begrafenisverzekering / Dela", "begrafenisverzekering", 22, "description"),
    R("Reisverzekering / SNS bank", "reisverzekering", 22, "description"),

    // ---- Woonlasten / vaste lasten ----
    R("Hypotheek / ABN-Amro", "hypotheek", 22),
    R("Gas & Elektra / Vattenfall", "vattenfall", 22),
    R("Water / Duinwaterbedrijf Dunea", "dunea", 22),
    R("Gemeentelijke belastingen / Gemeente Zuidplas", "svhw", 24),
    R("Gemeentelijke belastingen / Gemeente Zuidplas", "gemeente zuidplas", 24),
    R("Provinciale belastingen / Zuid-Holland", "provincie zuid-holland", 24),

    // ---- Abonnementen ----
    R("Netflix", "netflix", 24),
    R("Spotify", "spotify", 24),
    R("Videoland", "videoland", 24),
    R("Internet en TV / Ziggo", "ziggo", 24),
    R("Telefonie / Ben en Vodafone", "vodafone", 24),
    R("Telefonie / Ben en Vodafone", "odido", 24),
    R("Telefonie / Ben en Vodafone", "t-mobile", 24),
    R("Telefonie / Ben en Vodafone", "kpn", 24),
    R("Telefonie / Ben en Vodafone", "simyo", 24),
    R("Telefonie / Ben en Vodafone", "youfone", 24),
    R("Overige abonnementen / diverse", "disney", 26),
    R("Overige abonnementen / diverse", "hbo max", 26),
    R("Overige abonnementen / diverse", "prime video", 26),
    R("Overige abonnementen / diverse", "amazon prime", 26),
    R("Overige abonnementen / diverse", "audible", 26),
    R("Overige abonnementen / diverse", "storytel", 26),
    R("Overige abonnementen / diverse", "apple.com/bill", 26),
    R("Overige abonnementen / diverse", "icloud", 26),

    // ---- Boodschappen: supermarkten ----
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "albert heijn", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "plus moerkapelle", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "jumbo", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "lidl", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "aldi", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "dirk", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "hoogvliet", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "picnic", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "spar", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "coop", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "vomar", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "dekamarkt", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "nettorama", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "poiesz", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "jan linders", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "ekoplaza", 30),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "gall", 32),
    // ---- Boodschappen: drogist (post heet expliciet ook 'drogist') ----
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "etos", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "kruidvat", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "trekpleister", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "da drogist", 32),
    R("Boodschappen: supermarkt, speciaalzaak, drogist", "holland & barrett", 32),

    // ---- Persoonlijke verzorging (kapper, schoonheid, parfum) ----
    R("Persoonlijke verzorging: kapper, schoonheid", "ici paris", 32),
    R("Persoonlijke verzorging: kapper, schoonheid", "kapsalon", 32),
    R("Persoonlijke verzorging: kapper, schoonheid", "kapper", 32, "description"),

    // ---- Uitstapjes / uit eten / bestellen ----
    R("Uitstapjes/bestellen", "ccv*j p van eesteren", 35), // bedrijfskantine — specifiek, raakt je salaris niet
    R("Uitstapjes/bestellen", "thuisbezorgd", 35),
    R("Uitstapjes/bestellen", "takeaway", 35),
    R("Uitstapjes/bestellen", "uber eats", 35),
    R("Uitstapjes/bestellen", "mcdonald", 35),
    R("Uitstapjes/bestellen", "new york pizza", 35),
    R("Uitstapjes/bestellen", "domino", 35),
    R("Uitstapjes/bestellen", "starbucks", 35),
    R("Uitstapjes/bestellen", "kfc", 35),
    R("Uitstapjes/bestellen", "bagels", 35),
    R("Uitstapjes/bestellen", "la place", 35),
    R("Uitstapjes/bestellen", "burger king", 35),
    R("Uitstapjes/bestellen", "kwalitaria", 35),
    R("Uitstapjes/bestellen", "febo", 35),
    R("Uitstapjes/bestellen", "subway", 35),
    R("Uitstapjes/bestellen", "duinrell", 36),
    R("Uitstapjes/bestellen", "efteling", 36),
    R("Uitstapjes/bestellen", "pathe", 36),
    R("Uitstapjes/bestellen", "bioscoop", 36),

    // ---- Cadeautjes (persoonsoverboeking-omschrijving) ----
    R("Cadeautjes", "cadeau", 38, "description"),

    // ---- Tussenrekening: cash ----
    R("Tussenrekening: cadeaubonnen, cash geld", "cash", 35, "description", "equals"),

    // ---- Benzine ----
    R("Benzine", "shell", 30),
    R("Benzine", "bp ", 30),
    R("Benzine", "esso", 30),
    R("Benzine", "tinq", 30),
    R("Benzine", "tango", 30),
    R("Benzine", "tankstation", 30),
    R("Benzine", "total", 32),
    R("Benzine", "avia", 32),
    R("Benzine", "q8", 32),
    R("Benzine", "gulf", 32),
    R("Benzine", "texaco", 32),
    R("Benzine", "firezone", 32),

    // ---- Parkeren ----
    R("Parkeren", "q-park", 40),
    R("Parkeren", "parkmobile", 40),
    R("Parkeren", "yellowbrick", 40),
    R("Parkeren", "easypark", 40),
    R("Parkeren", "parkbee", 40),
    R("Parkeren", "interparking", 40),
    R("Parkeren", "stadshart", 40),
    R("Parkeren", "parkeren", 44),
    R("Parkeren", "parkeerkosten", 42, "description"),

    // ---- Wegenbelasting ----
    R("Wegenbelasting", "motorrijtuigenbelasting", 28),
    R("Wegenbelasting", "wegenbelasting", 28),

    // ---- Onderhoud auto ----
    R("Onderhoud", "garage", 45),
    R("Onderhoud", "apk", 45),
    R("Onderhoud", "kwik fit", 45),
    R("Onderhoud", "profile", 45),
    R("Onderhoud", "euromaster", 45),
    R("Onderhoud", "carglass", 45),

    // ---- Sporten ----
    R("Sporten", "basic fit", 38),
    R("Sporten", "basic-fit", 38),
    R("Sporten", "sportschool", 38),
    R("Sporten", "anytime fitness", 38),
    R("Sporten", "fit for free", 38),
    R("Sporten", "decathlon", 38),

    // ---- Kleding (zit in zakgeld) ----
    R("Kleding; zit in zakgeld", "zeeman", 40),
    R("Kleding; zit in zakgeld", "primark", 40),
    R("Kleding; zit in zakgeld", "h&m", 40),
    R("Kleding; zit in zakgeld", "zara", 40),
    R("Kleding; zit in zakgeld", "c&a", 40),
    R("Kleding; zit in zakgeld", "wibra", 40),
    R("Kleding; zit in zakgeld", "scapino", 40),
    R("Kleding; zit in zakgeld", "van haren", 40),

    // ---- Kinderdagverblijf ----
    R("Kinderdagverblijf", "kinderdagverblijf", 28),
    R("Kinderdagverblijf", "kinderopvang", 28),
    R("Kinderdagverblijf", "partou", 28),
    R("Kinderdagverblijf", "smallsteps", 28),
    R("Kinderdagverblijf", "kindergarden", 28),

    // ---- Huis en tuin ----
    R("Huis en tuin", "hema", 45),
    R("Huis en tuin", "action", 45),
    R("Huis en tuin", "ikea", 45),
    R("Huis en tuin", "praxis", 45),
    R("Huis en tuin", "gamma", 45),
    R("Huis en tuin", "karwei", 45),
    R("Huis en tuin", "kwantum", 45),
    R("Huis en tuin", "intratuin", 45),
    R("Huis en tuin", "blokker", 45),
    R("Huis en tuin", "xenos", 45),
    R("Huis en tuin", "jysk", 45),
    R("Huis en tuin", "leen bakker", 45),
    R("Huis en tuin", "hornbach", 45),
    R("Huis en tuin", "welkoop", 45),
    R("Huis en tuin", "dille & kamille", 45),
  ];

  return { groups, categories, budgets, years, activeYearId: "2026", pots, rules, transactions: [], tasks: [], openingBalanceCents: null, reviewedBatches: [] };
}

/* ----------------------------------------------------------- UI-bouwstenen */
function mergeSeed(state) {
  const seed = buildSeed();
  const cats = [...(state.categories || [])];
  const haveCat = new Set(cats.map((c) => c.id));
  for (const c of seed.categories) if (!haveCat.has(c.id)) cats.push(c);
  const grps = [...(state.groups || [])];
  const haveGrp = new Set(grps.map((g) => g.id));
  for (const g of seed.groups) if (!haveGrp.has(g.id)) grps.push(g);
  // migratie: oud enkel-jaar-model -> jaren-lijst
  let years = state.years, activeYearId = state.activeYearId;
  if (!Array.isArray(years) || !years.length) {
    if (state.year && state.year.id) { years = [state.year]; activeYearId = state.year.id; }
    else { years = seed.years; activeYearId = seed.activeYearId; }
  }
  if (!activeYearId || !years.some((y) => y.id === activeYearId)) activeYearId = years[0].id;
  const merged = { ...seed, ...state, categories: cats, groups: grps, years, activeYearId };
  // repareer transacties: unieke id's + standaardvelden (voor data van vóór deze update)
  const seenTxIds = new Set();
  merged.transactions = (merged.transactions || []).map((t, i) => {
    let id = t.id;
    if (!id || seenTxIds.has(id)) id = "tx-" + (t.hash || "x") + "-" + i;
    seenTxIds.add(id);
    return { ...t, id, allocations: t.allocations || [], note: t.note || "", flagged: !!t.flagged };
  });
  delete merged.year;
  // vul ontbrekende potten aan (bv. nieuwe Aandelenrekening), alleen voor bestaande categorieën
  const pots = [...(merged.pots || [])];
  const havePot = new Set(pots.map((p) => p.categoryId));
  for (const p of seed.pots) if (!havePot.has(p.categoryId) && cats.some((c) => c.id === p.categoryId)) pots.push(p);
  merged.pots = pots;
  // taken (telefoon: "kijk hier even naar") — additief veld; bestaande data blijft onaangetast
  merged.tasks = Array.isArray(merged.tasks) ? merged.tasks : [];
  // vul ontbrekende seed-begrotingsregels aan in bestaande jaren (bv. €300/maand aandelenrekening), daarna opnieuw sluitend maken
  const budgets = { ...(merged.budgets || {}) };
  for (const [yid, seedLines] of Object.entries(seed.budgets)) {
    if (!budgets[yid]) continue;
    let yl = { ...budgets[yid] }, changed = false;
    for (const [cidKey, line] of Object.entries(seedLines)) {
      if (cidKey === SLUITPOST_ID) continue;
      if (!(cidKey in yl)) { yl[cidKey] = line; changed = true; }
    }
    if (changed) budgets[yid] = applySluitpost(cats, yl);
  }
  merged.budgets = budgets;
  // vul ontbrekende Oranje-spaarrekeningcodes aan vanuit de seed (overschrijft eigen ingevulde codes niet)
  for (const c of merged.categories) { if (!c.spaarcode) { const sc = seed.categories.find((x) => x.id === c.id); if (sc && sc.spaarcode) c.spaarcode = sc.spaarcode; } }
  if (merged.openingBalanceCents === undefined) merged.openingBalanceCents = null;
  if (merged.reviewedBatches === undefined) merged.reviewedBatches = [];
  // Gedeelde bundels (tikkie). Bestaande losse bundel-labels op transacties blijven gewoon
  // werken: die verschijnen als niet-gedeelde bundel tot je er personen aan hangt.
  merged.bundles = Array.isArray(merged.bundles) ? merged.bundles : [];
  return merged;
}

/* ----------------------------------------------------------- Activiteit */

export { GROUPS_DEF, CAT_DEFS, buildSeed, mergeSeed };
