"use client";
import { useState, useMemo, useRef, Fragment } from "react";

// ─── SORTEER HULP ─────────────────────────────────────────────────────────────
function useSortable(data, defaultKey, defaultDir) {
  const [sortKey, setSortKey] = useState(defaultKey || null);
  const [sortDir, setSortDir] = useState(defaultDir || "asc");

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      let va = a[sortKey]; let vb = b[sortKey];
      if (va == null) va = ""; if (vb == null) vb = "";
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb), "nl")
        : String(vb).localeCompare(String(va), "nl");
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggleSort };
}

// ─── SORTEER HULPCOMPONENTEN ──────────────────────────────────────────────────
function SortHeader({ label, sortKey, currentKey, currentDir, onSort, align, style: extraStyle }) {
  const active = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        cursor:"pointer", userSelect:"none",
        textAlign: align || "left",
        whiteSpace:"nowrap",
        ...extraStyle,
      }}
    >
      <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
        {label}
        <span style={{ fontSize:9, opacity: active ? 1 : 0.3, color: active ? T.purple : "inherit" }}>
          {active ? (currentDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

// ─── TOKENS ───────────────────────────────────────────────────────────────────
const T = {
  purple:"#630D80", purpleFade:"#F4EEF7", lime:"#C1E62E",
  cost:"#B5546B", costLight:"#FAF0F3",
  budget:"#3F8F6B", budgetLight:"#EBF5F0",
  forecast:"#C99A4E", forecastLight:"#FBF6EC",
  risk:"#9AA0AC", riskLight:"#F4F5F7",
  bg:"#F6F4F8", surface:"#FFFFFF",
  border:"#EAE6EF", text:"#2A2233",
  textSub:"#6B6577", textMuted:"#9C97A6",
  danger:"#B5546B",
  // ABK-matrix accenten — huisstijl: jaartotaal-kolommen = paars, bewerkbare cellen = lime
  purpleDk:"#4F0A68", purpleLt:"#9450AC", limeDk:"#9DBF1E", borderDk:"#CFC6DC",
  totBg:"#EDE5F4", editBg:"#F4FADF", readBg:"#FAFAFC",
};


// ─── DATA ─────────────────────────────────────────────────────────────────────
// 1 onderaannemer per kostendrager — procesafspraak
// Demo-inkooplaag: 6 onderaannemers, elk gekoppeld aan een ECHTE rubriek-8 kostencode.
// (Aanpak A — de afrekenblad-/inkoopdemo blijft werken op echte kostencodes; overige
//  kostendragers starten met een lege inkoop-/afrekenlaag die in de UI te vullen is.)
const ONDERAANNEMER_KDS = [
  { id:"2155008", naam:"Houtskeletbouw & CLT",   onderaannemer:"Derix Houtconstructies" },
  { id:"2165008", naam:"Gevel & beglazing",      onderaannemer:"Sorba Projects" },
  { id:"2365008", naam:"Prefab trappen",         onderaannemer:"Voorbij Prefab" },
  { id:"4115008", naam:"Balkons & vloeren",      onderaannemer:"Hurks Beton" },
  { id:"4610008", naam:"Installaties (W/E)",     onderaannemer:"Kuijpers Installaties" },
  { id:"4420008", naam:"Afbouw & stucwerk",      onderaannemer:"Woudenberg Afbouw" },
];
// Her-koppeling oude demo-kostendrager (CC-04x) → echte rubriek-8 kostencode, en terug
const RELINK_CC = { "CC-047":"2155008", "CC-048":"2165008", "CC-049":"2365008", "CC-050":"4115008", "CC-051":"4610008", "CC-052":"4420008" };
const RELINK    = Object.fromEntries(Object.entries(RELINK_CC).map(([cc,code])=>[code,cc])); // code → CC (terug naar demo-data)

// Helper: onderaannemer ophalen voor een kostendrager (op kostencode)
const getOA = (kdId) => ONDERAANNEMER_KDS.find(k=>k.id===String(kdId))?.onderaannemer || "";

// OA-meldingen — nu met oaRefNr (eigen nummering OA) en invloedMMWId (optionele link 1-op-1)
const initOaData = [
  // CC-047 — Derix Houtconstructies
  { id:"OA-301", kdId:"2155008", datum:"14-03-2022", aantal:13, eenheid:"pst", prijsPerEenheid:5205.77, oaRefNr:"VPM-2024-041", omschrijving:"Extra CLT-wandpanelen kern",        gemeld:67675,  akkoord:67675,  io:0,     status:"Akkoord",          dagen:14, invloedMMWId:null,     externOpmerking:"Meegenomen in kosten", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-302", kdId:"2155008", datum:"14-03-2022", aantal:1, eenheid:"pst", prijsPerEenheid:3000.0, oaRefNr:"VPM-2024-042", omschrijving:"Aanpassing houtverbindingen lift­schacht", gemeld:3000,   akkoord:3000,   io:0,     status:"Akkoord",          dagen:14, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-303", kdId:"2155008", datum:"07-06-2021", aantal:3, eenheid:"m2", prijsPerEenheid:5000.0, oaRefNr:"VPM-2024-055", omschrijving:"Indexatie hout 8e t/m 12e verd.",           gemeld:15000,  akkoord:0,      io:15000, status:"In onderhandeling", dagen:31, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-309", kdId:"2155008", datum:"21-09-2023", aantal:4, eenheid:"st", prijsPerEenheid:5600.0, oaRefNr:"VPM-2024-061", omschrijving:"Correctie kolomstramien niveau 5",             gemeld:22400,  akkoord:21000,  io:0,     status:"Akkoord",          dagen:6,  invloedMMWId:"INV-091", externOpmerking:"Doorbelasting OG verwacht", internOpmerking:"", prognoseBedrag:21000 },
  { id:"OA-310", kdId:"2155008", datum:"03-11-2023", aantal:1, eenheid:"m1", prijsPerEenheid:4500.0, oaRefNr:"VPM-2024-063", omschrijving:"Revisie houtconstructie-tekeningen",                 gemeld:4500,   akkoord:4500,   io:0,     status:"Akkoord",          dagen:2,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-311", kdId:"2155008", datum:"17-01-2024", aantal:1, eenheid:"pst", prijsPerEenheid:8900.0, oaRefNr:"VPM-2024-067", omschrijving:"Extra brandwerende bekleding CLT",          gemeld:8900,   akkoord:8900,   io:0,     status:"Akkoord",          dagen:5,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-312", kdId:"2155008", datum:"28-02-2024", aantal:11, eenheid:"m3", prijsPerEenheid:5000.0, oaRefNr:"VPM-2024-071", omschrijving:"Verzwaring CLT-vloerligger blok B",             gemeld:55000,  akkoord:0,      io:55000, status:"In onderhandeling", dagen:44, invloedMMWId:"INV-095", externOpmerking:"Scopewijziging — OG in bespreking", internOpmerking:"", prognoseBedrag:55000 },
  { id:"OA-313", kdId:"2155008", datum:"09-04-2024", aantal:6, eenheid:"st", prijsPerEenheid:5250.0, oaRefNr:"VPM-2024-078", omschrijving:"Minderwerk vervallen houten luifel",                  gemeld:31500,  akkoord:29000,  io:0,     status:"Akkoord",          dagen:18, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-324", kdId:"2155008", datum:"22-05-2024", aantal:3, eenheid:"pst", prijsPerEenheid:6250.0, oaRefNr:"VPM-2024-085", omschrijving:"Extra montage-uren torenkraan",                gemeld:18750,  akkoord:18750,  io:0,     status:"Akkoord",          dagen:3,  invloedMMWId:"INV-099", externOpmerking:"OG-doorbelasting verwacht", internOpmerking:"", prognoseBedrag:18750 },
  { id:"OA-325", kdId:"2155008", datum:"14-06-2024", aantal:8, eenheid:"m2", prijsPerEenheid:5250.0, oaRefNr:"VPM-2024-091", omschrijving:"Aanpassing ankerdetails fundering",               gemeld:42000,  akkoord:0,      io:42000, status:"In onderhandeling", dagen:12, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-326", kdId:"2155008", datum:"05-07-2024", aantal:1, eenheid:"st", prijsPerEenheid:9800.0, oaRefNr:"VPM-2024-094", omschrijving:"Akoestische ontkoppeling woningscheidend",               gemeld:9800,   akkoord:9800,   io:0,     status:"Akkoord",          dagen:1,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-048 — Sorba Projects
  { id:"OA-306", kdId:"2165008", datum:"19-08-2024", aantal:6, eenheid:"m1", prijsPerEenheid:5666.67, oaRefNr:"BAM-2024-112", omschrijving:"Extra geveldelen zonwering west",                 gemeld:34000,  akkoord:34000,  io:0,     status:"Akkoord",          dagen:5,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-314", kdId:"2165008", datum:"30-09-2024", aantal:17, eenheid:"pst", prijsPerEenheid:5117.65, oaRefNr:"BAM-2024-118", omschrijving:"Aanpassing beglazing hoekappartementen",                gemeld:87000,  akkoord:82000,  io:0,     status:"Akkoord",          dagen:11, invloedMMWId:"INV-093", externOpmerking:"Scopewijziging OG ingediend", internOpmerking:"", prognoseBedrag:82000 },
  { id:"OA-315", kdId:"2165008", datum:"11-10-2024", aantal:3, eenheid:"m3", prijsPerEenheid:6500.0, oaRefNr:"BAM-2024-124", omschrijving:"Driedubbel glas upgrade zuid",                   gemeld:19500,  akkoord:0,      io:19500, status:"In onderhandeling", dagen:28, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-316", kdId:"2165008", datum:"24-11-2024", aantal:8, eenheid:"st", prijsPerEenheid:5125.0, oaRefNr:"BAM-2024-131", omschrijving:"Correctie gevelankers verdieping 4",                 gemeld:41000,  akkoord:38000,  io:0,     status:"Akkoord",          dagen:7,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-317", kdId:"2165008", datum:"08-12-2024", aantal:2, eenheid:"pst", prijsPerEenheid:7100.0, oaRefNr:"BAM-2024-145", omschrijving:"Extra kit- en afdichtingswerk",                    gemeld:14200,  akkoord:14200,  io:0,     status:"Akkoord",          dagen:1,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-318", kdId:"2165008", datum:"19-01-2025", aantal:12, eenheid:"pst", prijsPerEenheid:5250.0, oaRefNr:"BAM-2024-156", omschrijving:"Scopewijziging vliesgevel plint",                  gemeld:63000,  akkoord:0,      io:63000, status:"Nieuw",            dagen:0,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-327", kdId:"2165008", datum:"02-02-2025", aantal:5, eenheid:"m2", prijsPerEenheid:5700.0, oaRefNr:"BAM-2024-162", omschrijving:"Minderwerk vervallen gevelluik",                  gemeld:28500,  akkoord:0,      io:28500, status:"In onderhandeling", dagen:8,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-328", kdId:"2165008", datum:"16-03-2025", aantal:2, eenheid:"st", prijsPerEenheid:7375.0, oaRefNr:"BAM-2024-171", omschrijving:"Extra brandwerende gevelpanelen",                  gemeld:14750,  akkoord:14750,  io:0,     status:"Akkoord",          dagen:3,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-049 — Voorbij Prefab
  { id:"OA-308", kdId:"2365008", datum:"27-04-2025", aantal:4, eenheid:"m1", prijsPerEenheid:5500.0, oaRefNr:"IMT-2024-088", omschrijving:"Extra prefab trapbordessen",                 gemeld:22000,  akkoord:19500,  io:0,     status:"Akkoord",          dagen:3,  invloedMMWId:"INV-094", externOpmerking:"OG meerwerk aangevraagd", internOpmerking:"", prognoseBedrag:19500 },
  { id:"OA-319", kdId:"2365008", datum:"09-05-2025", aantal:6, eenheid:"pst", prijsPerEenheid:5166.67, oaRefNr:"IMT-2024-091", omschrijving:"Aanpassing trapleuning ontwerp",                 gemeld:31000,  akkoord:29000,  io:0,     status:"Akkoord",          dagen:9,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-321", kdId:"2365008", datum:"21-06-2025", aantal:1, eenheid:"m3", prijsPerEenheid:9800.0, oaRefNr:"IMT-2024-097", omschrijving:"Antislip-profilering traptreden",                    gemeld:9800,   akkoord:0,      io:9800,  status:"In onderhandeling", dagen:16, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-322", kdId:"2365008", datum:"03-07-2025", aantal:8, eenheid:"st", prijsPerEenheid:5500.0, oaRefNr:"IMT-2024-103", omschrijving:"Correctie trapgat-afmeting kern",                    gemeld:44000,  akkoord:41000,  io:0,     status:"Akkoord",          dagen:21, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-323", kdId:"2365008", datum:"15-08-2025", aantal:5, eenheid:"pst", prijsPerEenheid:5300.0, oaRefNr:"IMT-2024-108", omschrijving:"Extra vluchttrap blok C",              gemeld:26500,  akkoord:24000,  io:0,     status:"Akkoord",          dagen:4,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-329", kdId:"2365008", datum:"28-09-2025", aantal:1, eenheid:"m2", prijsPerEenheid:8900.0, oaRefNr:"IMT-2024-115", omschrijving:"Minderwerk vervallen spiltrap lobby",          gemeld:8900,   akkoord:0,      io:8900,  status:"In onderhandeling", dagen:11, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-330", kdId:"2365008", datum:"10-10-2025", aantal:1, eenheid:"st", prijsPerEenheid:5400.0, oaRefNr:"IMT-2024-121", omschrijving:"Brandwerende coating trappenhuis",          gemeld:5400,   akkoord:5400,   io:0,     status:"Akkoord",          dagen:2,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-047 — extra meldingen
  { id:"OA-331", kdId:"2155008", datum:"23-11-2025", aantal:3, eenheid:"m1", prijsPerEenheid:5400.0, oaRefNr:"VPM-2024-098", omschrijving:"Extra CLT-balkonconsoles",            gemeld:16200,  akkoord:16200,  io:0,     status:"Akkoord",          dagen:4,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-332", kdId:"2155008", datum:"04-12-2025", aantal:1, eenheid:"pst", prijsPerEenheid:-7400.0, oaRefNr:"VPM-2024-101", omschrijving:"Vochtmonitoring CLT tijdens bouw",       gemeld:-7400,  akkoord:-7400,  io:0,     status:"Akkoord",          dagen:6,  invloedMMWId:null,     externOpmerking:"Sparingen vervallen na engineering", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-333", kdId:"2155008", datum:"16-01-2026", aantal:4, eenheid:"m3", prijsPerEenheid:5950.0, oaRefNr:"VPM-2024-104", omschrijving:"Minderwerk geschrapte daktrim hout",               gemeld:23800,  akkoord:0,      io:23800, status:"In onderhandeling", dagen:9,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-334", kdId:"2155008", datum:"27-01-2026", aantal:2, eenheid:"st", prijsPerEenheid:6250.0, oaRefNr:"VPM-2024-109", omschrijving:"Extra demontabele hijsvoorzieningen",           gemeld:12500,  akkoord:0,      io:0,     status:"Nieuw",            dagen:0,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-048 — extra meldingen
  { id:"OA-335", kdId:"2165008", datum:"14-03-2022", aantal:10, eenheid:"pst", prijsPerEenheid:5200.0, oaRefNr:"BAM-2024-178", omschrijving:"Aanpassing kozijnmaten loggia",              gemeld:52000,  akkoord:48000,  io:0,     status:"Akkoord",          dagen:13, invloedMMWId:"INV-100", externOpmerking:"OG-doorbelasting in voorbereiding", internOpmerking:"", prognoseBedrag:48000 },
  { id:"OA-336", kdId:"2165008", datum:"14-03-2022", aantal:2, eenheid:"pst", prijsPerEenheid:-5600.0, oaRefNr:"BAM-2024-184", omschrijving:"Extra ventilatieroosters gevel",          gemeld:-11200, akkoord:-11200, io:0,     status:"Akkoord",          dagen:5,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-337", kdId:"2165008", datum:"07-06-2021", aantal:7, eenheid:"m2", prijsPerEenheid:5500.0, oaRefNr:"BAM-2024-191", omschrijving:"Verzwaarde gevelbevestiging hoek",                 gemeld:38500,  akkoord:0,      io:38500, status:"In onderhandeling", dagen:19, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-338", kdId:"2165008", datum:"21-09-2023", aantal:1, eenheid:"st", prijsPerEenheid:6800.0, oaRefNr:"BAM-2024-197", omschrijving:"Minderwerk geschrapt balkonscherm",                gemeld:6800,   akkoord:6800,   io:0,     status:"Akkoord",          dagen:2,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-049 — extra meldingen
  { id:"OA-339", kdId:"2365008", datum:"03-11-2023", aantal:3, eenheid:"m1", prijsPerEenheid:5866.67, oaRefNr:"IMT-2024-128", omschrijving:"Extra prefab podesten dak",               gemeld:17600,  akkoord:17600,  io:0,     status:"Akkoord",          dagen:7,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-340", kdId:"2365008", datum:"17-01-2024", aantal:1, eenheid:"pst", prijsPerEenheid:9200.0, oaRefNr:"IMT-2024-134", omschrijving:"Aanpassing ophanging trapelement",                gemeld:9200,   akkoord:0,      io:9200,  status:"In onderhandeling", dagen:14, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-341", kdId:"2365008", datum:"28-02-2024", aantal:2, eenheid:"m3", prijsPerEenheid:-6750.0, oaRefNr:"IMT-2024-139", omschrijving:"Geluidsisolatie traptredes",               gemeld:-13500, akkoord:-13500, io:0,     status:"Akkoord",          dagen:3,  invloedMMWId:null,     externOpmerking:"UPS uit scope na herziening", internOpmerking:"", prognoseBedrag:0 },
  // CC-050 — Hurks Beton (Balkons & vloeren)
  { id:"OA-342", kdId:"4115008", datum:"09-04-2024", aantal:14, eenheid:"st", prijsPerEenheid:5285.71, oaRefNr:"HEY-2025-002", omschrijving:"Extra balkonplaten type B",                   gemeld:74000,  akkoord:68000,  io:0,     status:"Akkoord",          dagen:10, invloedMMWId:"INV-101", externOpmerking:"Architectwijziging — OG akkoord verwacht", internOpmerking:"", prognoseBedrag:68000 },
  { id:"OA-343", kdId:"4115008", datum:"22-05-2024", aantal:24, eenheid:"pst", prijsPerEenheid:5041.67, oaRefNr:"HEY-2025-007", omschrijving:"Dekvloer-correctie verdieping 6",              gemeld:121000, akkoord:115000, io:0,     status:"Akkoord",          dagen:22, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-344", kdId:"4115008", datum:"14-06-2024", aantal:8, eenheid:"m2", prijsPerEenheid:5437.5, oaRefNr:"HEY-2025-011", omschrijving:"Verzwaarde balkonconsole hoek",                gemeld:43500,  akkoord:0,      io:43500, status:"In onderhandeling", dagen:16, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-345", kdId:"4115008", datum:"05-07-2024", aantal:3, eenheid:"st", prijsPerEenheid:-6000.0, oaRefNr:"HEY-2025-014", omschrijving:"Minderwerk geschrapt dakterras-deel",            gemeld:-18000, akkoord:-18000, io:0,     status:"Akkoord",          dagen:4,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-346", kdId:"4115008", datum:"19-08-2024", aantal:5, eenheid:"m1", prijsPerEenheid:5960.0, oaRefNr:"HEY-2025-019", omschrijving:"Akoestische zwevende dekvloer",                 gemeld:29800,  akkoord:29800,  io:0,     status:"Akkoord",          dagen:6,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-347", kdId:"4115008", datum:"30-09-2024", aantal:7, eenheid:"pst", prijsPerEenheid:5142.86, oaRefNr:"HEY-2025-023", omschrijving:"Extra waterkering balkonrand",                gemeld:36000,  akkoord:0,      io:0,     status:"Nieuw",            dagen:0,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-051 — Kuijpers Installaties (W/E)
  { id:"OA-348", kdId:"4610008", datum:"11-10-2024", aantal:31, eenheid:"m3", prijsPerEenheid:5032.26, oaRefNr:"MOB-2025-031", omschrijving:"Extra leidingwerk WTW-units",               gemeld:156000, akkoord:148000, io:0,     status:"Akkoord",          dagen:27, invloedMMWId:"INV-102", externOpmerking:"Grootschalige scopewijziging OG", internOpmerking:"", prognoseBedrag:148000 },
  { id:"OA-349", kdId:"4610008", datum:"24-11-2024", aantal:17, eenheid:"st", prijsPerEenheid:5235.29, oaRefNr:"MOB-2025-038", omschrijving:"Aanpassing meterkast-opstelling",                  gemeld:89000,  akkoord:0,      io:89000, status:"In onderhandeling", dagen:33, invloedMMWId:"INV-103", externOpmerking:"OG in bespreking", internOpmerking:"", prognoseBedrag:89000 },
  { id:"OA-350", kdId:"4610008", datum:"08-12-2024", aantal:12, eenheid:"pst", prijsPerEenheid:5375.0, oaRefNr:"MOB-2025-042", omschrijving:"Extra laadpunten parkeerkelder",                     gemeld:64500,  akkoord:61000,  io:0,     status:"Akkoord",          dagen:15, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-351", kdId:"4610008", datum:"19-01-2025", aantal:4, eenheid:"pst", prijsPerEenheid:-5500.0, oaRefNr:"MOB-2025-047", omschrijving:"Minderwerk vervallen koelunit",             gemeld:-22000, akkoord:-22000, io:0,     status:"Akkoord",          dagen:8,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-352", kdId:"4610008", datum:"02-02-2025", aantal:19, eenheid:"m2", prijsPerEenheid:5105.26, oaRefNr:"MOB-2025-053", omschrijving:"Verzwaring elektra hoofdverdeler",               gemeld:97000,  akkoord:0,      io:97000, status:"In onderhandeling", dagen:21, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-353", kdId:"4610008", datum:"16-03-2025", aantal:1, eenheid:"st", prijsPerEenheid:8400.0, oaRefNr:"MOB-2025-058", omschrijving:"Extra brandmeldcomponenten",                    gemeld:8400,   akkoord:8400,   io:0,     status:"Akkoord",          dagen:2,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // CC-052 — Woudenberg Afbouw
  { id:"OA-354", kdId:"4420008", datum:"27-04-2025", aantal:16, eenheid:"m1", prijsPerEenheid:5250.0, oaRefNr:"WDB-2025-061", omschrijving:"Extra stucwerk gemeenschappelijke hal",       gemeld:84000,  akkoord:79000,  io:0,     status:"Akkoord",          dagen:18, invloedMMWId:"INV-104", externOpmerking:"Monumentaanpassing — OG doorbelasting", internOpmerking:"", prognoseBedrag:79000 },
  { id:"OA-355", kdId:"4420008", datum:"09-05-2025", aantal:6, eenheid:"pst", prijsPerEenheid:5200.0, oaRefNr:"WDB-2025-066", omschrijving:"Spachtelputz correctie verdieping 3",              gemeld:31200,  akkoord:31200,  io:0,     status:"Akkoord",          dagen:9,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-356", kdId:"4420008", datum:"21-06-2025", aantal:9, eenheid:"m3", prijsPerEenheid:5166.67, oaRefNr:"WDB-2025-072", omschrijving:"Vervangen binnenkozijnen blok A",             gemeld:46500,  akkoord:0,      io:46500, status:"In onderhandeling", dagen:12, invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-357", kdId:"4420008", datum:"03-07-2025", aantal:1, eenheid:"st", prijsPerEenheid:-9600.0, oaRefNr:"WDB-2025-078", omschrijving:"Minderwerk geschrapte systeemwand",           gemeld:-9600,  akkoord:-9600,  io:0,     status:"Akkoord",          dagen:5,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-358", kdId:"4420008", datum:"15-08-2025", aantal:5, eenheid:"pst", prijsPerEenheid:5480.0, oaRefNr:"WDB-2025-083", omschrijving:"Extra akoestisch stucplafond",                   gemeld:27400,  akkoord:0,      io:0,     status:"Nieuw",            dagen:0,  invloedMMWId:null,     externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
];

// Inkooporders — onderaannemer altijd van kostendrager
const initInkooporders = [
  { id:"IO-112", kdId:"2155008", datum:"10-11-2020", omschrijving:"CLT-casco bundel 1",          committed:177230, budgetOG:140000, invloedMMW:0,     risico:12000, actieUitgevoerd:true,  oaIds:["OA-301","OA-302"], goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-113", kdId:"2155008", datum:"14-12-2020", omschrijving:"CLT-casco bundel 2",           committed:29750,  budgetOG:27000,  invloedMMW:21000, risico:2500,  actieUitgevoerd:true,  oaIds:["OA-309","OA-311"], goedgekeurdOGId:"OG-101", invloedMMWIds:["INV-091"], risicoLog:[{datum:"12-03-2024", type:"vrijval", bedrag:1500, van:4000, naar:2500, opmerking:"Risico deels afgedekt na engineering", bron:"IO-114"}] },
  { id:"IO-114", kdId:"2155008", datum:"04-03-2021", omschrijving:"Houtverbindingen meerwerk",               committed:48250,  budgetOG:25000,  invloedMMW:18750, risico:2000,  actieUitgevoerd:true,  oaIds:["OA-313","OA-324"], goedgekeurdOGId:null,    invloedMMWIds:["INV-099"] },
  { id:"IO-115", kdId:"2155008", datum:"08-04-2021", omschrijving:"Tijdelijke hijsvoorzieningen fase 3",  committed:9800,   budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:false, oaIds:["OA-326"],         goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-116", kdId:"2165008", datum:"13-04-2021", omschrijving:"Vliesgevel bundel 1",           committed:34000,  budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:true,  oaIds:["OA-306"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-117", kdId:"2165008", datum:"30-08-2021", omschrijving:"Beglazing meerwerk",               committed:82000,  budgetOG:75000,  invloedMMW:82000, risico:4000,  actieUitgevoerd:true,  oaIds:["OA-314"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-093"], risicoLog:[{datum:"05-09-2024", type:"vrijval", bedrag:2000, van:6000, naar:4000, opmerking:"Deel reserve vrijgevallen — palen conform verwachting", bron:"IO-118"}] },
  { id:"IO-118", kdId:"2165008", datum:"22-02-2022", omschrijving:"Gevelafdichting bundel",           committed:38000,  budgetOG:35000,  invloedMMW:0,     risico:2000,  actieUitgevoerd:true,  oaIds:["OA-316"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-119", kdId:"2165008", datum:"15-05-2022", omschrijving:"Geveldetails restwerk",                    committed:14200,  budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:false, oaIds:["OA-317"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-120", kdId:"2365008", datum:"03-09-2022", omschrijving:"Prefab trappen bundel 1",            committed:19500,  budgetOG:0,      invloedMMW:19500, risico:0,     actieUitgevoerd:true,  oaIds:["OA-308"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-094"] },
  { id:"IO-121", kdId:"2365008", datum:"18-01-2023", omschrijving:"Trapleuningen uitbreiding",             committed:29000,  budgetOG:26000,  invloedMMW:0,     risico:0,     actieUitgevoerd:true,  oaIds:["OA-319"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-122", kdId:"2365008", datum:"27-04-2023", omschrijving:"Vluchttrap aanpassing fase 2",        committed:41000,  budgetOG:38000,  invloedMMW:0,     risico:2000,  actieUitgevoerd:true,  oaIds:["OA-322"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-123", kdId:"2365008", datum:"09-08-2023", omschrijving:"Trapafwerking restwerk",              committed:24000,  budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:false, oaIds:["OA-323"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  // Extra op bestaande KD's
  { id:"IO-124", kdId:"2155008", datum:"14-11-2023", omschrijving:"Trekankers & schoring zuid",         committed:16200,  budgetOG:0,      invloedMMW:0,     risico:1500,  actieUitgevoerd:false, oaIds:["OA-331"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-125", kdId:"2165008", datum:"22-02-2024", omschrijving:"Grondverbetering sectie D",          committed:48000,  budgetOG:44000,  invloedMMW:48000, risico:3000,  actieUitgevoerd:true,  oaIds:["OA-335"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-100"] },
  { id:"IO-126", kdId:"2365008", datum:"06-05-2024", omschrijving:"BMS meet- en regeluitbreiding",      committed:17600,  budgetOG:15000,  invloedMMW:0,     risico:0,     actieUitgevoerd:true,  oaIds:["OA-339"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  // CC-050 — Hurks Beton
  { id:"IO-127", kdId:"4115008", datum:"19-08-2024", omschrijving:"Balkonplaten bundel",                committed:68000,  budgetOG:62000,  invloedMMW:68000, risico:5000,  actieUitgevoerd:true,  oaIds:["OA-342"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-101"] },
  { id:"IO-128", kdId:"4115008", datum:"30-10-2024", omschrijving:"Dekvloeren meerwerk",        committed:144800, budgetOG:120000, invloedMMW:0,     risico:8000,  actieUitgevoerd:true,  oaIds:["OA-343","OA-346"], goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-129", kdId:"4115008", datum:"12-02-2025", omschrijving:"Balkon-restwerk",                   committed:11500,  budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:false, oaIds:[],                  goedgekeurdOGId:null,    invloedMMWIds:[] },
  // CC-051 — Kuijpers Installaties
  { id:"IO-130", kdId:"4610008", datum:"25-04-2025", omschrijving:"W-installatie bundel 1",            committed:148000, budgetOG:140000, invloedMMW:148000,risico:15000, actieUitgevoerd:true,  oaIds:["OA-348"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-102"] },
  { id:"IO-131", kdId:"4610008", datum:"08-07-2025", omschrijving:"E-installatie uitbreiding",                  committed:61000,  budgetOG:55000,  invloedMMW:0,     risico:6000,  actieUitgevoerd:true,  oaIds:["OA-350"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  { id:"IO-132", kdId:"4610008", datum:"20-09-2025", omschrijving:"WTW meerwerk fase 1",                 committed:8400,   budgetOG:0,      invloedMMW:0,     risico:0,     actieUitgevoerd:false, oaIds:["OA-353"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
  // CC-052 — Woudenberg Afbouw
  { id:"IO-133", kdId:"4420008", datum:"03-11-2025", omschrijving:"Stucwerk hal bundel",         committed:79000,  budgetOG:72000,  invloedMMW:79000, risico:7000,  actieUitgevoerd:true,  oaIds:["OA-354"],          goedgekeurdOGId:null,    invloedMMWIds:["INV-104"] },
  { id:"IO-134", kdId:"4420008", datum:"16-01-2026", omschrijving:"Spachtelputz woningen",           committed:31200,  budgetOG:28000,  invloedMMW:0,     risico:0,     actieUitgevoerd:true,  oaIds:["OA-355"],          goedgekeurdOGId:null,    invloedMMWIds:[] },
];

const BUDGET_REGELS = [
  // CC-047
  { id:"BR-041", kdId:"2155008", type:"Initieel", omschrijving:"CLT-vloerpanelen verd. 3", bedrag:6300, gekoppeldAanIO:"IO-112" },
  { id:"BR-042", kdId:"2155008", type:"Initieel", omschrijving:"CLT-vloerpanelen verd. 4", bedrag:9100, gekoppeldAanIO:"IO-113" },
  { id:"BR-043", kdId:"2155008", type:"Initieel", omschrijving:"CLT-wandpanelen kern", bedrag:5500, gekoppeldAanIO:"IO-114" },
  { id:"BR-044", kdId:"2155008", type:"Initieel", omschrijving:"Houten lateien kozijnen", bedrag:5500, gekoppeldAanIO:"IO-115" },
  { id:"BR-045", kdId:"2155008", type:"Initieel", omschrijving:"Brandwerende coating trap", bedrag:7100, gekoppeldAanIO:"IO-124" },
  { id:"BR-046", kdId:"2155008", type:"Initieel", omschrijving:"Houtverbindingsbeslag", bedrag:1000, gekoppeldAanIO:null },
  { id:"BR-047", kdId:"2155008", type:"Initieel", omschrijving:"Schroeven & verbindingsmiddelen", bedrag:2100, gekoppeldAanIO:null },
  { id:"BR-048", kdId:"2155008", type:"Initieel", omschrijving:"Akoestische strips", bedrag:4600, gekoppeldAanIO:null },
  { id:"BR-049", kdId:"2155008", type:"Initieel", omschrijving:"Dampremmende folie", bedrag:2000, gekoppeldAanIO:null },
  { id:"BR-050", kdId:"2155008", type:"Initieel", omschrijving:"Houten regelwerk", bedrag:14900, gekoppeldAanIO:null },
  { id:"BR-051", kdId:"2155008", type:"Meerwerk", omschrijving:"Montage-uren CLT-ploeg", bedrag:2200, gekoppeldAanIO:null },
  { id:"BR-052", kdId:"2155008", type:"Meerwerk", omschrijving:"Stelkosten elementen", bedrag:2500, gekoppeldAanIO:null },
  { id:"BR-053", kdId:"2155008", type:"Meerwerk", omschrijving:"Hijsbanden & toebehoren", bedrag:6000, gekoppeldAanIO:null },
  { id:"BR-054", kdId:"2155008", type:"Meerwerk", omschrijving:"Vochtmeting hout", bedrag:8000, gekoppeldAanIO:null },
  { id:"BR-055", kdId:"2155008", type:"Meerwerk", omschrijving:"Afdekzeilen tijdens montage", bedrag:10300, gekoppeldAanIO:null },
  { id:"BR-056", kdId:"2155008", type:"Meerwerk", omschrijving:"Houten dakranden", bedrag:2100, gekoppeldAanIO:null },
  { id:"BR-057", kdId:"2155008", type:"Meerwerk", omschrijving:"Kimnaad-afdichting", bedrag:26600, gekoppeldAanIO:null },
  { id:"BR-058", kdId:"2155008", type:"Meerwerk", omschrijving:"Aftimmering schachten", bedrag:3200, gekoppeldAanIO:null },
  { id:"BR-059", kdId:"2155008", type:"Meerwerk", omschrijving:"Inmeten & uitzetten", bedrag:3000, gekoppeldAanIO:null },
  { id:"BR-060", kdId:"2155008", type:"Meerwerk", omschrijving:"Correctie elementmaat", bedrag:16300, gekoppeldAanIO:null },
  // CC-048
  { id:"BR-061", kdId:"2165008", type:"Initieel", omschrijving:"Gevelpaneel type A", bedrag:3700, gekoppeldAanIO:"IO-116" },
  { id:"BR-062", kdId:"2165008", type:"Initieel", omschrijving:"Gevelpaneel type B", bedrag:3200, gekoppeldAanIO:"IO-117" },
  { id:"BR-063", kdId:"2165008", type:"Initieel", omschrijving:"Beglazing woonkamer", bedrag:2600, gekoppeldAanIO:"IO-118" },
  { id:"BR-064", kdId:"2165008", type:"Initieel", omschrijving:"Beglazing slaapkamer", bedrag:13900, gekoppeldAanIO:"IO-119" },
  { id:"BR-065", kdId:"2165008", type:"Initieel", omschrijving:"Kit & afdichting", bedrag:10600, gekoppeldAanIO:null },
  { id:"BR-066", kdId:"2165008", type:"Initieel", omschrijving:"Gevelankers RVS", bedrag:5300, gekoppeldAanIO:null },
  { id:"BR-067", kdId:"2165008", type:"Initieel", omschrijving:"Ventilatierooster gevel", bedrag:5000, gekoppeldAanIO:null },
  { id:"BR-068", kdId:"2165008", type:"Initieel", omschrijving:"Zonwering screens", bedrag:2600, gekoppeldAanIO:null },
  { id:"BR-069", kdId:"2165008", type:"Initieel", omschrijving:"Waterslabben", bedrag:23900, gekoppeldAanIO:null },
  { id:"BR-070", kdId:"2165008", type:"Initieel", omschrijving:"Hoekprofielen gevel", bedrag:10800, gekoppeldAanIO:null },
  { id:"BR-071", kdId:"2165008", type:"Meerwerk", omschrijving:"Stelkozijnen", bedrag:4800, gekoppeldAanIO:null },
  { id:"BR-072", kdId:"2165008", type:"Meerwerk", omschrijving:"Montage-uren gevelploeg", bedrag:8000, gekoppeldAanIO:null },
  { id:"BR-073", kdId:"2165008", type:"Meerwerk", omschrijving:"Steigerhuur gevel", bedrag:2100, gekoppeldAanIO:null },
  { id:"BR-074", kdId:"2165008", type:"Meerwerk", omschrijving:"Glaslatten", bedrag:14900, gekoppeldAanIO:null },
  { id:"BR-075", kdId:"2165008", type:"Meerwerk", omschrijving:"Tochtprofielen", bedrag:19800, gekoppeldAanIO:null },
  { id:"BR-076", kdId:"2165008", type:"Meerwerk", omschrijving:"Dorpels natuursteen", bedrag:8100, gekoppeldAanIO:null },
  { id:"BR-077", kdId:"2165008", type:"Meerwerk", omschrijving:"Gevelreiniging oplevering", bedrag:2300, gekoppeldAanIO:null },
  { id:"BR-078", kdId:"2165008", type:"Meerwerk", omschrijving:"Brandwerend paneel trappenhuis", bedrag:3200, gekoppeldAanIO:null },
  { id:"BR-079", kdId:"2165008", type:"Meerwerk", omschrijving:"Inmeten gevel", bedrag:4800, gekoppeldAanIO:null },
  { id:"BR-080", kdId:"2165008", type:"Meerwerk", omschrijving:"Afkitten naden", bedrag:8800, gekoppeldAanIO:null },
  // CC-049
  { id:"BR-081", kdId:"2365008", type:"Initieel", omschrijving:"Prefab trap verd. 1-2", bedrag:16700, gekoppeldAanIO:"IO-120" },
  { id:"BR-082", kdId:"2365008", type:"Initieel", omschrijving:"Prefab trap verd. 2-3", bedrag:6700, gekoppeldAanIO:"IO-121" },
  { id:"BR-083", kdId:"2365008", type:"Initieel", omschrijving:"Trapleuning RVS", bedrag:1000, gekoppeldAanIO:"IO-122" },
  { id:"BR-084", kdId:"2365008", type:"Initieel", omschrijving:"Balustrade glas", bedrag:11100, gekoppeldAanIO:"IO-123" },
  { id:"BR-085", kdId:"2365008", type:"Initieel", omschrijving:"Antislipprofiel treden", bedrag:2100, gekoppeldAanIO:null },
  { id:"BR-086", kdId:"2365008", type:"Initieel", omschrijving:"Bordesplaat", bedrag:26000, gekoppeldAanIO:null },
  { id:"BR-087", kdId:"2365008", type:"Initieel", omschrijving:"Trapspil", bedrag:3900, gekoppeldAanIO:null },
  { id:"BR-088", kdId:"2365008", type:"Initieel", omschrijving:"Bevestigingsbeugels", bedrag:4900, gekoppeldAanIO:null },
  { id:"BR-089", kdId:"2365008", type:"Meerwerk", omschrijving:"Stelmortel trap", bedrag:2400, gekoppeldAanIO:null },
  { id:"BR-090", kdId:"2365008", type:"Meerwerk", omschrijving:"Montage-uren trapploeg", bedrag:5500, gekoppeldAanIO:null },
  { id:"BR-091", kdId:"2365008", type:"Meerwerk", omschrijving:"Rubber opleg trap", bedrag:2400, gekoppeldAanIO:null },
  { id:"BR-092", kdId:"2365008", type:"Meerwerk", omschrijving:"Afwerking stootborden", bedrag:11400, gekoppeldAanIO:null },
  { id:"BR-093", kdId:"2365008", type:"Meerwerk", omschrijving:"Coating leuning", bedrag:11100, gekoppeldAanIO:null },
  { id:"BR-094", kdId:"2365008", type:"Meerwerk", omschrijving:"Inmeten trapgat", bedrag:1600, gekoppeldAanIO:null },
  { id:"BR-095", kdId:"2365008", type:"Meerwerk", omschrijving:"Demontage hulptrap", bedrag:1300, gekoppeldAanIO:null },
  // CC-050
  { id:"BR-096", kdId:"4115008", type:"Initieel", omschrijving:"Balkonplaat type 1", bedrag:17000, gekoppeldAanIO:"IO-127" },
  { id:"BR-097", kdId:"4115008", type:"Initieel", omschrijving:"Balkonplaat type 2", bedrag:4800, gekoppeldAanIO:"IO-128" },
  { id:"BR-098", kdId:"4115008", type:"Initieel", omschrijving:"Dekvloer woning A", bedrag:5100, gekoppeldAanIO:"IO-129" },
  { id:"BR-099", kdId:"4115008", type:"Initieel", omschrijving:"Dekvloer woning B", bedrag:1200, gekoppeldAanIO:null },
  { id:"BR-100", kdId:"4115008", type:"Initieel", omschrijving:"Isokorf thermische onderbreking", bedrag:4600, gekoppeldAanIO:null },
  { id:"BR-101", kdId:"4115008", type:"Initieel", omschrijving:"Balkonhekwerk", bedrag:31500, gekoppeldAanIO:null },
  { id:"BR-102", kdId:"4115008", type:"Initieel", omschrijving:"Afschotmortel", bedrag:4300, gekoppeldAanIO:null },
  { id:"BR-103", kdId:"4115008", type:"Initieel", omschrijving:"Waterkering balkonrand", bedrag:6100, gekoppeldAanIO:null },
  { id:"BR-104", kdId:"4115008", type:"Meerwerk", omschrijving:"Voegband dilatatie", bedrag:7400, gekoppeldAanIO:null },
  { id:"BR-105", kdId:"4115008", type:"Meerwerk", omschrijving:"Montage-uren vloerploeg", bedrag:12800, gekoppeldAanIO:null },
  { id:"BR-106", kdId:"4115008", type:"Meerwerk", omschrijving:"Rubber oplegblokken", bedrag:15800, gekoppeldAanIO:null },
  { id:"BR-107", kdId:"4115008", type:"Meerwerk", omschrijving:"Hemelwaterafvoer balkon", bedrag:7400, gekoppeldAanIO:null },
  { id:"BR-108", kdId:"4115008", type:"Meerwerk", omschrijving:"Antislipcoating", bedrag:1800, gekoppeldAanIO:null },
  { id:"BR-109", kdId:"4115008", type:"Meerwerk", omschrijving:"Inmeten balkons", bedrag:5400, gekoppeldAanIO:null },
  { id:"BR-110", kdId:"4115008", type:"Meerwerk", omschrijving:"Stelwerk randkist", bedrag:9300, gekoppeldAanIO:null },
  // CC-051
  { id:"BR-111", kdId:"4610008", type:"Initieel", omschrijving:"Leidingwerk CV verdieping", bedrag:22500, gekoppeldAanIO:"IO-130" },
  { id:"BR-112", kdId:"4610008", type:"Initieel", omschrijving:"Radiatoren type 22", bedrag:1400, gekoppeldAanIO:"IO-131" },
  { id:"BR-113", kdId:"4610008", type:"Initieel", omschrijving:"WTW-unit woning", bedrag:9800, gekoppeldAanIO:"IO-132" },
  { id:"BR-114", kdId:"4610008", type:"Initieel", omschrijving:"Ventilatiekanalen", bedrag:12400, gekoppeldAanIO:null },
  { id:"BR-115", kdId:"4610008", type:"Initieel", omschrijving:"Meterkast bekabeling", bedrag:7900, gekoppeldAanIO:null },
  { id:"BR-116", kdId:"4610008", type:"Initieel", omschrijving:"Wandcontactdozen", bedrag:1800, gekoppeldAanIO:null },
  { id:"BR-117", kdId:"4610008", type:"Initieel", omschrijving:"Schakelmateriaal", bedrag:5700, gekoppeldAanIO:null },
  { id:"BR-118", kdId:"4610008", type:"Initieel", omschrijving:"Laadpunt parkeerplaats", bedrag:18000, gekoppeldAanIO:null },
  { id:"BR-119", kdId:"4610008", type:"Initieel", omschrijving:"Rookmelder bedraad", bedrag:3900, gekoppeldAanIO:null },
  { id:"BR-120", kdId:"4610008", type:"Initieel", omschrijving:"Verdeelkast groepen", bedrag:3100, gekoppeldAanIO:null },
  { id:"BR-121", kdId:"4610008", type:"Meerwerk", omschrijving:"Waterleiding PEX", bedrag:16600, gekoppeldAanIO:null },
  { id:"BR-122", kdId:"4610008", type:"Meerwerk", omschrijving:"Afvoerleiding PVC", bedrag:9000, gekoppeldAanIO:null },
  { id:"BR-123", kdId:"4610008", type:"Meerwerk", omschrijving:"Thermostaat per woning", bedrag:4400, gekoppeldAanIO:null },
  { id:"BR-124", kdId:"4610008", type:"Meerwerk", omschrijving:"Montage-uren E-monteur", bedrag:20100, gekoppeldAanIO:null },
  { id:"BR-125", kdId:"4610008", type:"Meerwerk", omschrijving:"Montage-uren W-monteur", bedrag:16400, gekoppeldAanIO:null },
  { id:"BR-126", kdId:"4610008", type:"Meerwerk", omschrijving:"Doorvoeren brandwerend", bedrag:5600, gekoppeldAanIO:null },
  { id:"BR-127", kdId:"4610008", type:"Meerwerk", omschrijving:"CAI/data-bekabeling", bedrag:1600, gekoppeldAanIO:null },
  { id:"BR-128", kdId:"4610008", type:"Meerwerk", omschrijving:"Buitenlamp entree", bedrag:3800, gekoppeldAanIO:null },
  { id:"BR-129", kdId:"4610008", type:"Meerwerk", omschrijving:"Inmeten installaties", bedrag:22200, gekoppeldAanIO:null },
  { id:"BR-130", kdId:"4610008", type:"Meerwerk", omschrijving:"Beproeving & inregelen", bedrag:4600, gekoppeldAanIO:null },
  // CC-052
  { id:"BR-131", kdId:"4420008", type:"Initieel", omschrijving:"Stucwerk woonkamer", bedrag:2100, gekoppeldAanIO:"IO-133" },
  { id:"BR-132", kdId:"4420008", type:"Initieel", omschrijving:"Stucwerk slaapkamer", bedrag:23100, gekoppeldAanIO:"IO-134" },
  { id:"BR-133", kdId:"4420008", type:"Initieel", omschrijving:"Spachtelputz hal", bedrag:11100, gekoppeldAanIO:null },
  { id:"BR-134", kdId:"4420008", type:"Initieel", omschrijving:"Binnendeurkozijn", bedrag:27500, gekoppeldAanIO:null },
  { id:"BR-135", kdId:"4420008", type:"Initieel", omschrijving:"Binnendeur opdek", bedrag:4100, gekoppeldAanIO:null },
  { id:"BR-136", kdId:"4420008", type:"Initieel", omschrijving:"Plinten MDF", bedrag:2300, gekoppeldAanIO:null },
  { id:"BR-137", kdId:"4420008", type:"Initieel", omschrijving:"Tegelwerk badkamer", bedrag:2900, gekoppeldAanIO:null },
  { id:"BR-138", kdId:"4420008", type:"Initieel", omschrijving:"Tegelwerk toilet", bedrag:4300, gekoppeldAanIO:null },
  { id:"BR-139", kdId:"4420008", type:"Initieel", omschrijving:"Voegwerk tegels", bedrag:2200, gekoppeldAanIO:null },
  { id:"BR-140", kdId:"4420008", type:"Initieel", omschrijving:"Sauswerk plafond", bedrag:5300, gekoppeldAanIO:null },
  { id:"BR-141", kdId:"4420008", type:"Meerwerk", omschrijving:"Systeemwand berging", bedrag:8900, gekoppeldAanIO:null },
  { id:"BR-142", kdId:"4420008", type:"Meerwerk", omschrijving:"Aftimmering leidingkoker", bedrag:1000, gekoppeldAanIO:null },
  { id:"BR-143", kdId:"4420008", type:"Meerwerk", omschrijving:"Vensterbank composiet", bedrag:6900, gekoppeldAanIO:null },
  { id:"BR-144", kdId:"4420008", type:"Meerwerk", omschrijving:"Montage-uren stukadoor", bedrag:2500, gekoppeldAanIO:null },
  { id:"BR-145", kdId:"4420008", type:"Meerwerk", omschrijving:"Montage-uren tegelzetter", bedrag:8700, gekoppeldAanIO:null },
  { id:"BR-146", kdId:"4420008", type:"Meerwerk", omschrijving:"Kitwerk sanitair", bedrag:5400, gekoppeldAanIO:null },
  { id:"BR-147", kdId:"4420008", type:"Meerwerk", omschrijving:"Schilderwerk traphek", bedrag:30100, gekoppeldAanIO:null },
  { id:"BR-148", kdId:"4420008", type:"Meerwerk", omschrijving:"Inmeten afbouw", bedrag:3800, gekoppeldAanIO:null },
  { id:"BR-149", kdId:"4420008", type:"Meerwerk", omschrijving:"Oplevering herstel", bedrag:8400, gekoppeldAanIO:null },
  { id:"BR-150", kdId:"4420008", type:"Meerwerk", omschrijving:"Reserve afbouw klein", bedrag:5000, gekoppeldAanIO:null },
];

// Invloed MMW OG (vlak 4) — zacht budget, per kostendrager, optioneel gelinkt aan OA-melding
const initInvloedMMW = [
  { id:"INV-091", kdId:"2155008", oaNummer:"MPW-2024-019", omschrijving:"Meerwerk CLT goedgekeurd OG",      bedrag:21000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-309" },
  { id:"INV-092", kdId:"2155008", oaNummer:"MPW-2024-031", omschrijving:"Invloed houtbouw vertraging",      bedrag:175000, status:"Akkoord",  ogBedrag:175000, oaId:null },
  { id:"INV-095", kdId:"2155008", oaNummer:"MPW-2024-044", omschrijving:"Verrekening indexatie hout",      bedrag:55000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-312" },
  { id:"INV-093", kdId:"2165008", oaNummer:"MPW-2024-052", omschrijving:"Gevelmeerwerk OG akkoord",    bedrag:82000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-314" },
  { id:"INV-096", kdId:"2165008", oaNummer:"MPW-2024-058", omschrijving:"Upgrade beglazing OG",           bedrag:145000, status:"Verwacht", ogBedrag:null,   oaId:null },
  { id:"INV-099", kdId:"2155008", oaNummer:"MPW-2024-089", omschrijving:"Scope-uitbreiding kern OG",         bedrag:18750,  status:"Verwacht", ogBedrag:null,   oaId:"OA-324" },
  { id:"INV-094", kdId:"2365008", oaNummer:"MPW-2024-067", omschrijving:"Trappen meerwerk OG",       bedrag:19500,  status:"Verwacht", ogBedrag:null,   oaId:"OA-308" },
  { id:"INV-098", kdId:"2365008", oaNummer:"MPW-2024-071", omschrijving:"Invloed trapaanpassing",           bedrag:29000,  status:"Verwacht", ogBedrag:null,   oaId:null },
  // Gekoppeld aan nieuwe meldingen / inkooporders
  { id:"INV-100", kdId:"2165008", oaNummer:"MPW-2024-094", omschrijving:"Invloed gevelvertraging",         bedrag:48000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-335" },
  { id:"INV-101", kdId:"4115008", oaNummer:"MPW-2025-008", omschrijving:"Balkonmeerwerk OG",      bedrag:68000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-342" },
  { id:"INV-102", kdId:"4610008", oaNummer:"MPW-2025-014", omschrijving:"Installatiemeerwerk OG",         bedrag:148000, status:"Akkoord",  ogBedrag:148000, oaId:"OA-348" },
  { id:"INV-103", kdId:"4610008", oaNummer:"MPW-2025-019", omschrijving:"Laadinfra uitbreiding OG",        bedrag:89000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-349" },
  { id:"INV-104", kdId:"4420008", oaNummer:"MPW-2025-026", omschrijving:"Afbouwmeerwerk OG",    bedrag:79000,  status:"Verwacht", ogBedrag:null,   oaId:"OA-354" },
  // Losse vlak-4 budgetten (nog niet gekoppeld aan inkooporder)
  { id:"INV-105", kdId:"4115008", oaNummer:"MPW-2025-031", omschrijving:"Dekvloer-verrekening OG",         bedrag:96000,  status:"Verwacht", ogBedrag:null,   oaId:null },
  { id:"INV-106", kdId:"4610008", oaNummer:"MPW-2025-037", omschrijving:"Invloed installatievertraging",          bedrag:52000,  status:"Verwacht", ogBedrag:null,   oaId:null },
  { id:"INV-107", kdId:"4420008", oaNummer:"MPW-2025-041", omschrijving:"Stucwerk-verrekening OG",        bedrag:64000,  status:"Verwacht", ogBedrag:null,   oaId:null },
];

// Goedgekeurd MMW OG (vlak 3) — hard budget, 1-op-1 met inkooporder, handmatig bedrag
// goedgekeurdOGId op inkooporder verwijst hierheen
const initGoedgekeurdOG = [
  // Slechts 1 echt goedgekeurd OG item — dit is in de praktijk zeldzaam
  { id:"OG-101", kdId:"2155008", onsNummer:"GKD-047-001", omschrijving:"CLT-scopewijziging formeel akkoord", bedrag:175000, datum:"12-03-2024", ioId:"IO-113", invloedMMWId:"INV-092" },
];

// ─── ID-TELLERS — dynamisch op hoogste bestaande id, voorkomt botsingen ─────────
const _maxNum = (arr, prefix) => arr.reduce((mx, x) => {
  const m = String(x.id||"").match(new RegExp("^"+prefix+"0*(\\d+)$"));
  return m ? Math.max(mx, parseInt(m[1],10)) : mx;
}, 0);
let oaCounter      = _maxNum(initOaData, "OA-") + 1;
let invloedCounter = _maxNum(initInvloedMMW, "INV-") + 1;
let ogCounter      = _maxNum(initGoedgekeurdOG, "OG-") + 1;
let invVVCounter   = _maxNum(initInvloedMMW, "INV-") + 1;

// ══════════════════════════════════════════════════════════════════════════════
//  FASE 1 — STATUSLAAG (inkooporders + budgetregels)
//  • IO-status: Concept → Goedgekeurd / Afgekeurd. "Goedgekeurd" komt ALLEEN via de
//    ERP-simulatie (nooit handmatig). Een Concept-IO kan verstuurd zijn naar 4PS
//    (verzondenERP) en staat dan "in fiattering", maar blijft Concept → in blok 2.
//  • Verhuizing blok 2→1 (OA's) en vlak 4→3 (invloed) gebeurt UITSLUITEND bij Goedgekeurd.
//  • Budgetregels: vrij → voorlopig gearresteerd (Concept-IO) → gearresteerd (Goedgekeurde IO).
// ══════════════════════════════════════════════════════════════════════════════
// Seed-normalisatie: bestaande IO's met een uitgevoerde inkoopactie zijn historisch
// goedgekeurd (staan in blok 1); de overige zijn concept (staan in blok 2). Een paar
// concepten zetten we op "verzonden · in fiattering" zodat die tussenstand zichtbaar is.
const _IO_VERZONDEN_DEMO = new Set(["IO-115","IO-129"]);
initInkooporders.forEach(io => {
  if (io.status === undefined)       io.status = io.actieUitgevoerd ? "Goedgekeurd" : "Concept";
  if (io.verzondenERP === undefined) io.verzondenERP = io.status === "Goedgekeurd" ? true : _IO_VERZONDEN_DEMO.has(io.id);
});

const IO_STATUS = {
  Concept:     { label:"Concept",     kleur:"#7A2E96", bg:"#F1E5F6", hard:false },
  Goedgekeurd: { label:"Goedgekeurd", kleur:"#2F7D5B", bg:"#E8F4EE", hard:true  },
  Afgekeurd:   { label:"Afgekeurd",   kleur:"#B5546B", bg:"#FBEAEF", hard:false },
};
const ioStatusMeta = (io) => IO_STATUS[io?.status] || IO_STATUS.Concept;
const ioIsGoedgekeurd = (io) => io?.status === "Goedgekeurd";
// Een Concept-IO die naar 4PS is gestuurd staat "in fiattering"; nog niet verstuurd = "concept".
const ioFaseLabel = (io) => io?.status === "Concept" ? (io.verzondenERP ? "in fiattering" : "concept") : ioStatusMeta(io).label.toLowerCase();

// Budgetregel-toestand afgeleid uit de IO waaraan hij gekoppeld is:
//   geen koppeling of IO afgekeurd → "vrij"; Concept-IO → "voorlopig"; Goedgekeurde IO → "gearresteerd".
const budgetregelStatus = (br, inkooporders) => {
  if (!br || !br.gekoppeldAanIO) return "vrij";
  const io = (inkooporders||[]).find(o => o.id === br.gekoppeldAanIO);
  if (!io || io.status === "Afgekeurd") return "vrij";
  return io.status === "Goedgekeurd" ? "gearresteerd" : "voorlopig";
};
const BR_STATUS = {
  vrij:         { label:"Vrij",                  kleur:"#5B6470" },
  voorlopig:    { label:"Voorlopig gearresteerd", kleur:"#9C7A12" },
  gearresteerd: { label:"Gearresteerd",          kleur:"#2F7D5B" },
};

// Vlak 3 vs 4: een invloed-item hoort bij vlak 3 zodra de gekoppelde OA-melding in een
// GOEDGEKEURDE inkooporder zit; anders vlak 4 (los). Afgeleid, niet opgeslagen.
const oaIdsInGoedgekeurdeIOs = (inkooporders) => {
  const s = new Set();
  (inkooporders||[]).filter(ioIsGoedgekeurd).forEach(io => (io.oaIds||[]).forEach(id => s.add(id)));
  return s;
};
const invloedInVlak3 = (inv, goedgekeurdeOaIds) => !!(inv && inv.oaId && goedgekeurdeOaIds.has(inv.oaId));

// ══════════════════════════════════════════════════════════════════════════════
//  FASE 2 — DATA-OVERHAUL (afrekenblad-model consistent + realistisch maken)
//  • Tweede relatie per kostendrager (afrekenblad geldt per relatie per KD).
//  • IO-112 (te groot gat) en IO-129 (lege concept-bundel) rechtgetrokken.
//  • "Harde OG"-koppeling verdwijnt (vlak 3 is voortaan zacht-in-verplichting).
//  • Twee-kolommen-model: mmwBedragIoBijOG (in onderhandeling, telt niet) +
//    invloedInPrognose (meegenomen, telt en gaat naar KOS blad) + vrij opmerkingveld.
// ══════════════════════════════════════════════════════════════════════════════

// (1) Tweede-relatie-meldingen + inkooporders — 3 rubriek-8 KD's krijgen een 2e relatie.
initOaData.push(
  // 2155008 · tweede relatie: Lignum Houtbouw
  { id:"OA-360", kdId:"2155008", relatie:"Lignum Houtbouw B.V.", datum:"12-04-2024", aantal:4, eenheid:"m3", prijsPerEenheid:5750.0, oaRefNr:"LIG-2025-003", omschrijving:"Extra CLT-dakranden zuidzijde", gemeld:23000, akkoord:22000, io:0, status:"Akkoord", dagen:6, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-361", kdId:"2155008", relatie:"Lignum Houtbouw B.V.", datum:"03-05-2024", aantal:1, eenheid:"pst", prijsPerEenheid:9500.0, oaRefNr:"LIG-2025-007", omschrijving:"Houten vluchtbalkon-constructie", gemeld:9500, akkoord:9500, io:0, status:"Akkoord", dagen:3, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // 2165008 · tweede relatie: Alkondor Hengelo
  { id:"OA-362", kdId:"2165008", relatie:"Alkondor Hengelo B.V.", datum:"18-05-2024", aantal:8, eenheid:"m2", prijsPerEenheid:5125.0, oaRefNr:"ALK-2025-012", omschrijving:"Extra geveldoek technische ruimte", gemeld:43200, akkoord:41000, io:0, status:"Akkoord", dagen:9, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  { id:"OA-363", kdId:"2165008", relatie:"Alkondor Hengelo B.V.", datum:"29-06-2024", aantal:3, eenheid:"st", prijsPerEenheid:6200.0, oaRefNr:"ALK-2025-018", omschrijving:"Aanpassing gevelroosters daktuin", gemeld:18600, akkoord:0, io:18600, status:"In onderhandeling", dagen:11, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // 4610008 · tweede relatie: Croon Elektrotechniek
  { id:"OA-364", kdId:"4610008", relatie:"Croon Elektrotechniek B.V.", datum:"22-11-2024", aantal:12, eenheid:"pst", prijsPerEenheid:5000.0, oaRefNr:"CRN-2025-004", omschrijving:"Extra data-bekabeling techniekruimte", gemeld:63000, akkoord:60000, io:0, status:"Akkoord", dagen:14, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
  // IO-129 krijgt een echte (kleine) melding zodat het een bundel is i.p.v. leeg
  { id:"OA-359", kdId:"4115008", relatie:"Hurks Beton", datum:"05-02-2025", aantal:2, eenheid:"pst", prijsPerEenheid:5500.0, oaRefNr:"HEY-2025-027", omschrijving:"Balkon-restwerk afmontage", gemeld:11000, akkoord:11000, io:0, status:"Akkoord", dagen:4, invloedMMWId:null, externOpmerking:"", internOpmerking:"", prognoseBedrag:0 },
);
initInkooporders.push(
  { id:"IO-135", kdId:"2155008", relatie:"Lignum Houtbouw B.V.", datum:"20-05-2024", omschrijving:"Houtbouw aanvulling zuid", committed:32000, budgetOG:0, invloedMMW:0, risico:1500, actieUitgevoerd:true,  oaIds:["OA-360","OA-361"], goedgekeurdOGId:null, invloedMMWIds:[], status:"Goedgekeurd", verzondenERP:true },
  { id:"IO-137", kdId:"2165008", relatie:"Alkondor Hengelo B.V.", datum:"05-06-2024", omschrijving:"Gevel daktuin meerwerk", committed:41000, budgetOG:0, invloedMMW:0, risico:2000, actieUitgevoerd:true,  oaIds:["OA-362"], goedgekeurdOGId:null, invloedMMWIds:[], status:"Goedgekeurd", verzondenERP:true },
  { id:"IO-138", kdId:"4610008", relatie:"Croon Elektrotechniek B.V.", datum:"02-12-2024", omschrijving:"Datacenter bekabeling", committed:61500, budgetOG:0, invloedMMW:0, risico:3000, actieUitgevoerd:false, oaIds:["OA-364"], goedgekeurdOGId:null, invloedMMWIds:[], status:"Concept", verzondenERP:true },
);

// (2) IO-129: nu een echte bundel (OA-359), committed sluit met kleine correctie.
(() => { const io = initInkooporders.find(o => o.id==="IO-129"); if (io){ io.oaIds = ["OA-359"]; io.committed = 11500; } })();
// (3) IO-112: committed teruggebracht tot ~som OA-meldingen + realistische 4PS-correctie (was een onrealistisch gat).
(() => { const io = initInkooporders.find(o => o.id==="IO-112"); if (io){ io.committed = 71500; } })();
// (4) "Harde OG" verdwijnt: geen enkele IO heeft nog een goedgekeurdOG-koppeling.
initInkooporders.forEach(io => { if (io.goedgekeurdOGId) io.goedgekeurdOGId = null; });

// (5) Relatie-default: elke OA/IO zonder expliciete relatie krijgt de (enige) onderaannemer van de KD.
initOaData.forEach(o => { if (o.relatie === undefined) o.relatie = getOA(o.kdId) || ""; });
initInkooporders.forEach(io => { if (io.relatie === undefined) io.relatie = getOA(io.kdId) || ""; });

// (6) Twee-kolommen-model op alle invloed MMW OG (Optie B).
//     mmwBedragIoBijOG = onderhandelingsbedrag bij OG ; invloedInPrognose = meegenomen (telt mee).
//     Seed: invloed waarvan de OA al in een goedgekeurde IO zit (vlak 3) OF al "Akkoord" was → meegenomen;
//     overige losse vlak-4-invloed start "in onderhandeling, nog niet meegenomen".
const _goedOaSeed = oaIdsInGoedgekeurdeIOs(initInkooporders);
initInvloedMMW.forEach(inv => {
  if (inv.mmwBedragIoBijOG === undefined) inv.mmwBedragIoBijOG = inv.bedrag || 0;
  if (inv.invloedInPrognose === undefined)
    inv.invloedInPrognose = (invloedInVlak3(inv, _goedOaSeed) || inv.status === "Akkoord") ? (inv.bedrag || 0) : 0;
  if (inv.opmerking === undefined) inv.opmerking = "";
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt  = (n) => new Intl.NumberFormat("nl-NL", { style:"currency", currency:"EUR", maximumFractionDigits:0 }).format(n ?? 0);
// Eén currency-formatter (fmt). eur = lege-cel-bewuste wrapper rond fmt; eurKaal = zonder €-symbool.
const nf0 = new Intl.NumberFormat("nl-NL", { maximumFractionDigits:0 });
const eur = (v) => (v===null||v===undefined||v==="") ? "" : fmt(Math.round(v));
const eur0 = (v) => fmt(v || 0);   // currency, toont "€ 0" voor leeg/null
const eurKaal = (v) => (v===null||v===undefined) ? "" : nf0.format(Math.round(v));
const fmtN = (n) => n!=null && n!==0 ? new Intl.NumberFormat("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n) : "";   // getal, 2 decimalen, leeg voor 0

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const th  = { padding:"9px 14px", textAlign:"left", fontSize:10, fontWeight:700, color:T.textSub, textTransform:"uppercase", letterSpacing:0.8, whiteSpace:"nowrap", background:T.bg };
const td  = { padding:"10px 14px", color:T.text, verticalAlign:"middle", fontSize:12 };
const btnPrimary   = { display:"inline-flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:6, border:"none", background:T.purple, color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" };
const btnSecondary = { display:"inline-flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:6, border:`1px solid ${T.border}`, background:T.surface, color:T.text, fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" };
const btnDanger    = { display:"inline-flex", alignItems:"center", gap:6, padding:"8px 16px", borderRadius:6, border:"none", background:T.danger, color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" };
const selectSt     = { padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12, background:T.surface, color:T.text, cursor:"pointer" };
const inputSt      = { padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12, color:T.text, background:T.surface, width:"100%", boxSizing:"border-box" };
const labelSt      = { display:"block", fontSize:10, fontWeight:700, color:T.textSub, textTransform:"uppercase", marginBottom:4, letterSpacing:0.6 };

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
function SectionHeader({ title, action, actionLabel }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
      <div style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:1.2 }}>{title}</div>
      {action && <button onClick={action} style={{ fontSize:11, fontWeight:600, color:T.purple, background:"none", border:`1px solid ${T.purpleFade}`, borderRadius:5, padding:"4px 10px", cursor:"pointer" }}>{actionLabel}</button>}
    </div>
  );
}

function NieuwOaFormulier({ kdId, invloedItems, onSave, onCancel, bestaand, vergelijkOAs }) {
  const defaultKd = kdId || "2155008";
  const isEdit = !!bestaand;
  const [form, setForm] = useState(bestaand ? {
    kdId:         bestaand.kdId,
    oaRefNr:      bestaand.oaRefNr || "",
    type:         bestaand.gemeld < 0 ? "Minderwerk" : "Meerwerk",
    omschrijving: bestaand.omschrijving,
    aantal:       bestaand.aantal != null ? String(bestaand.aantal) : "",
    eenheid:      bestaand.eenheid || "pst",
    prijs:        bestaand.prijsPerEenheid != null ? String(Math.abs(bestaand.prijsPerEenheid)) : "",
    akkoord:      String(Math.abs(bestaand.akkoord) || ""),
    io:           String(bestaand.io || ""),
    status:       bestaand.status,
    opmerking:    bestaand.externOpmerking || "",
  } : {
    kdId:         defaultKd,
    oaRefNr:      "",
    type:         "Meerwerk",
    omschrijving: "",
    aantal:       "",
    eenheid:      "pst",
    prijs:        "",
    akkoord:      "",
    io:           "",
    status:       "Nieuw",
    opmerking:    "",
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const aantalNum  = parseFloat(form.aantal) || 0;
  const prijsNum   = parseFloat(form.prijs)  || 0;
  const gemeldNum  = aantalNum * prijsNum;          // totaal = aantal × prijs/eenheid
  const akkoordNum = parseFloat(form.akkoord) || 0;
  const ioNum      = parseFloat(form.io)      || 0;

  const valid = form.omschrijving && aantalNum > 0 && form.eenheid && prijsNum > 0;

  // ── Dubbelcheck (alleen bij aanmaken): vergelijk met ALLE eerdere OA MMW in deze KD (incl. vervallen / in een IO) ──
  const _normTok = (t) => (t||"").toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(Boolean);
  const _simOA = (omschr, bedrag, eenheid, other) => {
    const ta=new Set(_normTok(omschr)), tb=new Set(_normTok(other.omschrijving));
    const inter=[...ta].filter(x=>tb.has(x)).length, uni=new Set([...ta,...tb]).size||1;
    const sOms = inter/uni;                                   // omschrijving-overlap
    const a=Math.abs(bedrag), b=Math.abs(other.gemeld||0), mx=Math.max(a,b)||1;
    const sBed = 1-Math.min(1,Math.abs(a-b)/mx);              // bedrag-gelijkenis
    const sEen = (eenheid||"")===(other.eenheid||"") ? 1 : 0; // eenheid (lichter)
    return 0.45*sOms + 0.45*sBed + 0.10*sEen;                 // omschrijving en bedrag even zwaar
  };
  const dubbelKandidaten = ((!isEdit && form.omschrijving && gemeldNum>0) ? (vergelijkOAs||[]) : [])
    .map(o => ({ oa:o, score:_simOA(form.omschrijving, gemeldNum, form.eenheid, o) }))
    .filter(x => x.score >= 0.60)
    .sort((a,b)=>b.score-a.score)
    .slice(0,3);

  const [saving, setSaving] = useState(false);
  const handleSave = () => {
    if (!valid || saving) return;
    setSaving(true);
    const signedGemeld = form.type==="Minderwerk" ? -gemeldNum : gemeldNum;
    // Status "Akkoord" zonder ingevuld akkoord-bedrag → neem het gemelde bedrag over
    const effAkkoord = (form.status==="Akkoord" && akkoordNum===0) ? gemeldNum : akkoordNum;
    const signedAkkoord = form.type==="Minderwerk" ? -effAkkoord : effAkkoord;
    const signedPrijs   = form.type==="Minderwerk" ? -prijsNum : prijsNum;
    // Bij status "Akkoord" staat er niets meer "in onderhandeling"
    const effIo = form.status==="Akkoord" ? 0 : ioNum;
    const base = {
      kdId:            form.kdId,
      oaRefNr:         form.oaRefNr,
      omschrijving:    form.omschrijving,
      aantal:          aantalNum,
      eenheid:         form.eenheid,
      prijsPerEenheid: signedPrijs,
      gemeld:          signedGemeld,
      akkoord:         signedAkkoord,
      io:              effIo,
      status:          form.status,
      externOpmerking: form.opmerking,
    };
    if (isEdit) {
      // behoud bestaande velden (zoals invloedMMWId, internOpmerking) die niet in het formulier zitten
      onSave({...bestaand, ...base});
    } else {
      onSave({...base, id:`OA-${oaCounter++}`, datum:new Date().toLocaleDateString("nl-NL"), dagen:0, internOpmerking:"", invloedMMWId:null, mogelijkeDubbel: dubbelKandidaten.length>0 ? (dubbelKandidaten[0].oa.oaRefNr||dubbelKandidaten[0].oa.id) : null});
    }
  };

  const field = (label, children) => (
    <div style={{ marginBottom:14 }}>
      <label style={labelSt}>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:640, overflow:"auto" }}>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:18, fontWeight:700, color:T.text }}>{isEdit ? "OA MMW bewerken" : "Nieuw OA MMW registreren"}</div>
        <div style={{ fontSize:12, color:T.textSub, marginTop:2 }}>{isEdit ? `${bestaand.id} · ${getOA(bestaand.kdId)}` : "Meerwerk of minderwerk gemeld door onderaannemer"}</div>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:12 }}>
        <SectionHeader title="Identificatie"/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {field("Kostendrager",
            isEdit
              ? <div style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, fontSize:12, color:T.text }}>{form.kdId}</div>
              : <select value={form.kdId} onChange={e=>set("kdId",e.target.value)} style={selectSt}>
                  {KOSTENDRAGERS.map(k=><option key={k.id} value={k.id}>{k.id} — {k.naam}</option>)}
                </select>
          )}
          {field("Onderaannemer",
            <div style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, fontSize:12, color:T.text }}>
              {getOA(form.kdId)}<span style={{ fontSize:10, color:T.textMuted, marginLeft:8 }}>(automatisch)</span>
            </div>
          )}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {field("Referentienummer OA",
            <input value={form.oaRefNr} onChange={e=>set("oaRefNr",e.target.value)} placeholder="Bijv. VPM-2024-099" style={inputSt}/>
          )}
          {field("Type",
            <div style={{ display:"flex", gap:0, borderRadius:6, overflow:"hidden", border:`1px solid ${T.border}` }}>
              {["Meerwerk","Minderwerk"].map(t=>(
                <button key={t} onClick={()=>set("type",t)} style={{ flex:1, padding:"7px 10px", border:"none", background:form.type===t?(t==="Meerwerk"?T.budgetLight:T.costLight):T.surface, color:form.type===t?(t==="Meerwerk"?T.budget:T.cost):T.textSub, fontWeight:form.type===t?700:400, cursor:"pointer", fontSize:12 }}>{t}</button>
              ))}
            </div>
          )}
          {field("Status",
            <select value={form.status} onChange={e=>set("status",e.target.value)} style={selectSt}>
              <option>Nieuw</option>
              <option>In onderhandeling</option>
              <option>Akkoord</option>
            </select>
          )}
        </div>
        {field("Omschrijving",
          <input value={form.omschrijving} onChange={e=>set("omschrijving",e.target.value)} placeholder="Omschrijving van het meerwerk of minderwerk..." style={inputSt}/>
        )}
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:12 }}>
        <SectionHeader title="Hoeveelheid &amp; prijs"/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
          {field("Aantal *",
            <input type="number" value={form.aantal} onChange={e=>set("aantal",e.target.value)} placeholder="0" style={{...inputSt, borderColor: aantalNum>0?T.border:T.danger}}/>
          )}
          {field("Eenheid *",
            <select value={form.eenheid} onChange={e=>set("eenheid",e.target.value)} style={selectSt}>
              {["pst","st","m1","m2","m3","kg","ton","uur","dag","%"].map(e=><option key={e} value={e}>{e}</option>)}
            </select>
          )}
          {field("Prijs per eenheid (€) *",
            <input type="number" value={form.prijs} onChange={e=>set("prijs",e.target.value)} placeholder="0" style={{...inputSt, borderColor: prijsNum>0?T.border:T.danger}}/>
          )}
        </div>
        {/* Totaal gemeld — automatisch berekend */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:form.type==="Minderwerk"?T.costLight:T.purpleFade, borderRadius:6, marginTop:4 }}>
          <span style={{ fontSize:12, fontWeight:700, color:form.type==="Minderwerk"?T.cost:T.purple }}>
            Totaal MMW gemeld {form.type==="Minderwerk"?"(minderwerk)":""}
          </span>
          <span style={{ fontSize:16, fontWeight:800, color:form.type==="Minderwerk"?T.cost:T.purple }}>
            {aantalNum>0 && prijsNum>0 ? fmt(form.type==="Minderwerk" ? -gemeldNum : gemeldNum) : "—"}
          </span>
        </div>
        <div style={{ fontSize:10, color:T.textMuted, marginTop:6 }}>
          Aantal × prijs per eenheid = totaal gemeld. Dit is het bedrag dat de onderaannemer meldt.
        </div>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:12 }}>
        <SectionHeader title="Akkoord &amp; onderhandeling"/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {field("Bedrag akkoord (€)",
            <input type="number" value={form.akkoord} onChange={e=>set("akkoord",e.target.value)} placeholder="0" style={inputSt}/>
          )}
          {field("In onderhandeling (€)",
            <input type="number" value={form.io} onChange={e=>set("io",e.target.value)} placeholder="0" style={inputSt}/>
          )}
        </div>
        {form.status==="Akkoord" && akkoordNum===0 && gemeldNum>0 && (
          <div style={{ padding:"7px 10px", background:T.purpleFade, borderRadius:5, fontSize:11, color:T.purple, marginTop:8 }}>
            Status staat op <strong>Akkoord</strong> zonder akkoord-bedrag — bij opslaan wordt het gemelde bedrag ({fmt(gemeldNum)}) als akkoord overgenomen.
          </div>
        )}
        {gemeldNum > 0 && akkoordNum > 0 && akkoordNum !== gemeldNum && (
          <div style={{ padding:"7px 10px", background:T.forecastLight, borderRadius:5, fontSize:11, color:T.forecast, marginTop:8 }}>
            Verschil akkoord vs gemeld: {fmt(akkoordNum - gemeldNum)} ({akkoordNum > gemeldNum ? "+" : ""}{((akkoordNum/gemeldNum-1)*100).toFixed(1)}%)
          </div>
        )}
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:18 }}>
        <SectionHeader title="Opmerking"/>
        <textarea value={form.opmerking} onChange={e=>set("opmerking",e.target.value)} rows={3} placeholder="Toelichting of aantekening..." style={{...inputSt, resize:"vertical"}}/>
      </div>

      {dubbelKandidaten.length>0 && (
        <div style={{ background:"#FBF3D6", border:`1px solid ${T.limeDk}`, borderRadius:8, padding:"12px 16px", marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:800, color:"#8A6D00", marginBottom:5 }}>⚠ Mogelijke dubbele melding</div>
          <div style={{ fontSize:11, color:T.textSub, marginBottom:8 }}>Er {dubbelKandidaten.length===1?"is":"zijn"} {dubbelKandidaten.length} eerdere melding(en) in deze kostendrager die hierop lijken. Controleer of dit geen dubbele invoer is — je kunt alsnog registreren.</div>
          {dubbelKandidaten.map(({oa,score})=>(
            <div key={oa.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"5px 9px", background:"#fff", borderRadius:5, marginBottom:4, fontSize:11 }}>
              <span style={{ color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><strong>{oa.oaRefNr||oa.id}</strong> · {oa.omschrijving} · {fmt(Math.abs(oa.gemeld||0))}{oa.status==="Vervallen"?" · vervallen":""}</span>
              <span style={{ fontWeight:800, color:"#8A6D00", whiteSpace:"nowrap" }}>{Math.round(score*100)}% gelijk</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <button onClick={handleSave} disabled={!valid} style={{ ...btnPrimary, opacity: valid ? 1 : 0.45, cursor: valid ? "pointer" : "not-allowed" }}>
          {isEdit ? "Wijzigingen opslaan" : "OA MMW registreren"}
        </button>
        <button onClick={onCancel} style={btnSecondary}>Annuleren</button>
        {!valid && (
          <span style={{ fontSize:11, color:T.danger }}>
            Vul omschrijving, aantal, eenheid en prijs per eenheid in.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MMW OG TAB — twee secties: Invloed (zacht) + Goedgekeurd (hard) ────────


// ─── LAAG 2 — KOSTENDRAGERBEWAKING (financiële kern, praat met afrekenblad) ────
// Per kostendrager: begroting, contracten, restant budget, overige bestedingen, bijstelling.
// KEW = Contract + Reserve inkoop + Overige bestedingen + Bijstelling (gevalideerd op KPS).
// MMW-aggregaten komen uit het afrekenblad (niet hier onderhouden).
const KD_BEWAKING = {
  // Wouters-vloerafwerking — exacte cijfers uit KPS-screenshot (validatie 1-op-1)
  "CC-047": {
    code:"4220-008", naam:"Vloerafwerking Wouters", rubriek:8,
    begroting: {
      origineel:    287308.86,
      mutaties:     -5465.17,    // begrotingsmutaties / overboekingen
      mmwBegroting: 51152.67,    // = som restant budgetregels (MMW)
      invloedMMWprognose: 0.00,  // budget nog niet in BIS
    },
    contracten: [
      { id:"0000057", crediteurNr:"2071", leverancier:"TH. Wouters Totaal Afbouw B.V.", omschrijving:"Dekvloeren",
        status:"L", mmwAkkoord:10000.00, mmwOnderhandeling:13547.50,
        begrotingsregels:281843.69, inkoopBedrag:314623.01, reserveInkoop:0.00,
        geboekteKostenBis:310476.25 },
    ],
    restantBudget: [
      { regel:20, omschrijving:"7.1 verhogen dekvloer ivm vrijstaand bad", mmwNr:"1000", mutatie:"22-10-2020", aantal:1,  eenheid:"st",  prijs:100.00,   bedrag:100.00,   vrijval:100.00,   nogUitTeGeven:0.00 },
      { regel:21, omschrijving:"14.1 Verhogen dekvloer t.p.v. badkamer",   mmwNr:"1000", mutatie:"22-10-2020", aantal:21, eenheid:"st",  prijs:50.00,    bedrag:1050.00,  vrijval:1050.00,  nogUitTeGeven:0.00, gekoppeldAanIO:"IO-115" },
      { regel:22, omschrijving:"16.1 aanbrengen 2 stuks bouwkundige nissen", mmwNr:"1000", mutatie:"22-10-2020", aantal:4,  eenheid:"st",  prijs:116.67,   bedrag:466.67,   vrijval:466.67,   nogUitTeGeven:0.00, gekoppeldAanIO:"IO-112" },
      { regel:23, omschrijving:"Budgetregels vanuit KEMP",                 mmwNr:"0993", mutatie:"04-03-2021", aantal:0,  eenheid:"pst", prijs:49536.00, bedrag:49536.00, vrijval:49536.00, nogUitTeGeven:0.00, opmerking:"Budget tackelen" },
    ],
    overigeBestedingen: [
      { omschrijving:"KRUISWIJK", geboektBis:16545.00, meenemenPrognose:16545.00 },
      { omschrijving:"WOUTERS",   geboektBis:30187.64, meenemenPrognose:30187.64 },
    ],
    bijstelling: [
      { omschrijving:"Hoofdcontract", meenemenPrognose:-4147.00 },
    ],
    resultaatVorigePeriode: -24212,
  },

  "CC-048": {
    code:"4310-002", naam:"Gevel & beglazing", rubriek:8,
    begroting: { origineel:145000.00, mutaties:-2000.00, mmwBegroting:8000.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000061", crediteurNr:"3140", leverancier:"Sorba Projects B.V.", omschrijving:"Vliesgevel & beglazing",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:140000.00, inkoopBedrag:134200.00, reserveInkoop:0.00, geboekteKostenBis:120000.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Stelpost gevelaansluitingen", mmwNr:"1100", mutatie:"12-02-2025", aantal:1, eenheid:"pst", prijs:8000.00, bedrag:8000.00, vrijval:8000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [
      { omschrijving:"Hijswerk gevel", geboektBis:5000.00, meenemenPrognose:5000.00 },
    ],
    bijstelling: [
      { omschrijving:"Correctie meminden", meenemenPrognose:-1500.00 },
    ],
    resultaatVorigePeriode: 6000,
  },

  "CC-049": {
    code:"4250-004", naam:"Prefab trappen", rubriek:8,
    begroting: { origineel:120000.00, mutaties:0.00, mmwBegroting:5000.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000064", crediteurNr:"2890", leverancier:"Voorbij Prefab B.V.", omschrijving:"Prefab betontrappen",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:124000.00, inkoopBedrag:131100.00, reserveInkoop:0.00, geboekteKostenBis:131100.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Stelpost montagedetails", mmwNr:"1200", mutatie:"03-03-2025", aantal:1, eenheid:"pst", prijs:5000.00, bedrag:5000.00, vrijval:5000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [
      { omschrijving:"Transport trappen", geboektBis:3000.00, meenemenPrognose:3000.00 },
    ],
    bijstelling: [],
    resultaatVorigePeriode: -8000,
  },

  "CC-050": {
    code:"4230-006", naam:"Balkons & vloeren", rubriek:8,
    begroting: { origineel:210000.00, mutaties:5000.00, mmwBegroting:12000.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000067", crediteurNr:"3055", leverancier:"Hurks Beton B.V.", omschrijving:"Prefab balkons",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:218000.00, inkoopBedrag:224300.00, reserveInkoop:0.00, geboekteKostenBis:200000.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Stelpost balkonhekwerk", mmwNr:"1300", mutatie:"18-03-2025", aantal:1, eenheid:"pst", prijs:12000.00, bedrag:12000.00, vrijval:12000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [
      { omschrijving:"Kraankosten balkons", geboektBis:8000.00, meenemenPrognose:8000.00 },
    ],
    bijstelling: [
      { omschrijving:"Risicoreservering montage", meenemenPrognose:-3000.00 },
    ],
    resultaatVorigePeriode: -12000,
  },

  "CC-051": {
    code:"4500-008", naam:"Installaties (W/E)", rubriek:8,
    begroting: { origineel:240000.00, mutaties:-5000.00, mmwBegroting:15000.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000070", crediteurNr:"4120", leverancier:"Kuijpers Installaties B.V.", omschrijving:"Werktuigbouw & elektra",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:230000.00, inkoopBedrag:217400.00, reserveInkoop:0.00, geboekteKostenBis:190000.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Stelpost regeltechniek", mmwNr:"1400", mutatie:"22-03-2025", aantal:1, eenheid:"pst", prijs:15000.00, bedrag:15000.00, vrijval:15000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [
      { omschrijving:"Doorvoeringen & sparingen", geboektBis:6000.00, meenemenPrognose:6000.00 },
    ],
    bijstelling: [
      { omschrijving:"Bijstelling engineering", meenemenPrognose:-4000.00 },
    ],
    resultaatVorigePeriode: 7000,
  },

  "CC-052": {
    code:"4400-010", naam:"Afbouw & stucwerk", rubriek:8,
    begroting: { origineel:105000.00, mutaties:0.00, mmwBegroting:6000.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000073", crediteurNr:"2760", leverancier:"Woudenberg Afbouw B.V.", omschrijving:"Stuc- & afbouwwerk",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:108000.00, inkoopBedrag:110200.00, reserveInkoop:0.00, geboekteKostenBis:95000.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Stelpost herstelwerk", mmwNr:"1500", mutatie:"28-03-2025", aantal:1, eenheid:"pst", prijs:6000.00, bedrag:6000.00, vrijval:6000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [
      { omschrijving:"Steigerwerk afbouw", geboektBis:4000.00, meenemenPrognose:4000.00 },
    ],
    bijstelling: [
      { omschrijving:"Correctie hoeveelheden", meenemenPrognose:-1000.00 },
    ],
    resultaatVorigePeriode: -9000,
  },

  // ── Manuren (rubriek 1) ──
  "CC-010": {
    code:"4100-001", naam:"Uitvoering eigen personeel", rubriek:1,
    begroting: { origineel:180000.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [],
    overigeBestedingen: [
      { omschrijving:"Geboekte productieve uren", geboektBis:165000.00, meenemenPrognose:172000.00 },
    ],
    bijstelling: [],
    resultaatVorigePeriode: 6000,
    // Tijd-gebonden bewaking (uren). Prognose KEW = prognoseUren × uurtarief.
    arbeid: {
      uurtarief: 48.00, prognoseUren: 3583,
      periodes: [
        { periode:"Jan 2025", begroot:600, geboekt:615 },
        { periode:"Feb 2025", begroot:620, geboekt:635 },
        { periode:"Mrt 2025", begroot:640, geboekt:650 },
        { periode:"Apr 2025", begroot:650, geboekt:660 },
        { periode:"Mei 2025", begroot:660, geboekt:678 },
        { periode:"Jun 2025", begroot:580, geboekt:0 },
      ],
    },
  },

  // ── Stelpost (rubriek 2) ──
  "CC-020": {
    code:"4900-002", naam:"Stelpost onvoorzien werk", rubriek:2,
    begroting: { origineel:75000.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [
      { regel:10, omschrijving:"Onvoorzien projectbreed", mmwNr:"0900", mutatie:"01-02-2025", aantal:1, eenheid:"pst", prijs:75000.00, bedrag:75000.00, vrijval:30000.00, nogUitTeGeven:45000.00 },
    ],
    overigeBestedingen: [],
    bijstelling: [],
    resultaatVorigePeriode: 25000,
  },

  // ── ABK — algemene bouwplaatskosten (rubriek 5) ──
  "CC-005": {
    code:"4000-005", naam:"Bouwplaatsinrichting & kranen", rubriek:5,
    begroting: { origineel:177932.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [],
    overigeBestedingen: [],
    bijstelling: [],
    resultaatVorigePeriode: 3000,
    // Tijd-gebonden bewaking (materieelstukken). Prognose KEW = som(tarief × prognose-aantal).
    materieel: [
      { omschrijving:"Torenkraan (incl. toeslagen)",        eenheid:"week", tarief:2950.00, begrootAantal:40, geboektAantal:32, prognoseAantal:44 },
      { omschrijving:"Bouwkeet kantoor + kantine",          eenheid:"week", tarief:480.00,  begrootAantal:52, geboektAantal:40, prognoseAantal:52 },
      { omschrijving:"Steiger- & klimmaterieel",            eenheid:"week", tarief:1200.00, begrootAantal:20, geboektAantal:15, prognoseAantal:20 },
      { omschrijving:"Sanitair / dixies",                   eenheid:"week", tarief:95.00,   begrootAantal:52, geboektAantal:40, prognoseAantal:52 },
      { omschrijving:"Bouwstroom, kasten & verlichting",    eenheid:"week", tarief:116.00,  begrootAantal:52, geboektAantal:40, prognoseAantal:52 },
    ],
  },

  // ── UTA — uitvoerend/technisch/administratief (rubriek 6) ──
  "CC-006": {
    code:"4150-006", naam:"Projectleiding & werkvoorbereiding", rubriek:6,
    begroting: { origineel:145015.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [],
    overigeBestedingen: [
      { omschrijving:"Geboekte UTA-uren", geboektBis:130000.00, meenemenPrognose:150000.00 },
    ],
    bijstelling: [],
    resultaatVorigePeriode: -3000,
    arbeid: {
      uurtarief: 65.00, prognoseUren: 2308,
      periodes: [
        { periode:"Jan 2025", begroot:360, geboekt:370 },
        { periode:"Feb 2025", begroot:370, geboekt:380 },
        { periode:"Mrt 2025", begroot:375, geboekt:385 },
        { periode:"Apr 2025", begroot:380, geboekt:395 },
        { periode:"Mei 2025", begroot:386, geboekt:400 },
        { periode:"Jun 2025", begroot:360, geboekt:0 },
      ],
    },
  },

  // ── Leveranciers (rubriek 7) ──
  "CC-007": {
    code:"4200-007", naam:"Materiaal & bouwstoffen", rubriek:7,
    begroting: { origineel:160000.00, mutaties:-3000.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000045", crediteurNr:"7020", leverancier:"BMN Bouwmaterialen B.V.", omschrijving:"Diverse bouwstoffen",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:155000.00, inkoopBedrag:162000.00, reserveInkoop:0.00, geboekteKostenBis:140000.00 },
    ],
    restantBudget: [],
    overigeBestedingen: [
      { omschrijving:"Kleinmateriaal & gereedschap", geboektBis:8000.00, meenemenPrognose:9000.00 },
    ],
    bijstelling: [],
    resultaatVorigePeriode: -10000,
  },

  // ── Projectontwikkeling (rubriek 3, contractgebonden) ──
  "CC-003": {
    code:"4050-003", naam:"Vergunningen, leges & advies", rubriek:3,
    begroting: { origineel:95000.00, mutaties:2000.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [
      { id:"0000035", crediteurNr:"3300", leverancier:"Adviesbureau Tonnaer", omschrijving:"Vergunningstraject & advies",
        status:"L", mmwAkkoord:0, mmwOnderhandeling:0,
        begrotingsregels:78000.00, inkoopBedrag:80500.00, reserveInkoop:0.00, geboekteKostenBis:72000.00 },
    ],
    restantBudget: [
      { regel:10, omschrijving:"Leges & rechten", mmwNr:"0300", mutatie:"08-01-2025", aantal:1, eenheid:"pst", prijs:15000.00, bedrag:15000.00, vrijval:15000.00, nogUitTeGeven:0.00 },
    ],
    overigeBestedingen: [],
    bijstelling: [
      { omschrijving:"Reservering bezwaar", meenemenPrognose:-1500.00 },
    ],
    resultaatVorigePeriode: -2000,
  },

  // ── Opslagen en reserves (rubriek 4, contractgebonden) ──
  "CC-004": {
    code:"4950-004", naam:"Algemene opslagen & reserveringen", rubriek:4,
    begroting: { origineel:120000.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [
      { regel:10, omschrijving:"Algemene risicoreserve project", mmwNr:"0400", mutatie:"01-02-2025", aantal:1, eenheid:"pst", prijs:120000.00, bedrag:120000.00, vrijval:40000.00, nogUitTeGeven:80000.00 },
    ],
    overigeBestedingen: [],
    bijstelling: [
      { omschrijving:"Aanvullende reservering directie", meenemenPrognose:25000.00 },
    ],
    resultaatVorigePeriode: 18000,
  },

  // ── Opbrengsten (rubriek 9) — opbrengstenzijde, methodiek nog te bepalen ──
  "CC-099": {
    code:"8000-009", naam:"Aanneemsom & meerwerkopbrengsten", rubriek:9,
    begroting: { origineel:0.00, mutaties:0.00, mmwBegroting:0.00, invloedMMWprognose:0.00 },
    contracten: [],
    restantBudget: [],
    overigeBestedingen: [],
    bijstelling: [],
    resultaatVorigePeriode: 0,
    // Opbrengsten worden (nog) niet in de kostenmotor berekend — eigen methodiek volgt.
    opbrengst: { aanneemsom:4250000.00, meerwerkOpbrengst:312000.00, prognoseOpbrengst:4562000.00 },
  },
};

// Rubrieken (KPS) — vaste indeling 1 t/m 9
const RUBRIEKEN = {
  1: "Manuren",
  2: "Stelpost",
  3: "Projectontwikkeling",
  4: "Opslagen en reserves",
  5: "ABK",
  6: "UTA",
  7: "Leveranciers",
  8: "Onderaannemers",
  9: "Opbrengsten",
};

// Rekenmethodiek per rubriek bepaalt naar welk laag-2 scherm een kostendrager leidt.
// - contract  : contractgebonden → kostendragerscherm + afrekenblad (KEW-methodiek)
// - arbeid    : arbeidscodes (uren) → bewaking op arbeid (in de tijd)
// - materieel : algemene bouwplaatskosten (materieelstukken) → bewaking materieel (in de tijd)
// - opbrengst : opbrengsten (nog te bepalen methodiek)
const RUBRIEK_TYPE = {
  1:"arbeid", 6:"arbeid",
  5:"materieel",
  2:"contract", 3:"contract", 4:"contract", 7:"contract", 8:"contract",
  9:"opbrengst",
};
const CONTRACT_RUBRIEKEN = [2,3,4,7,8];   // afrekenblad geldt alléén hiervoor
const typeVanRubriek   = (nr) => RUBRIEK_TYPE[nr] || "contract";
const schermVanRubriek = (nr) => {
  const t = typeVanRubriek(nr);
  if (t==="arbeid")    return "arbeid";
  if (t==="materieel") return "materieel";
  return "kdbewaking";   // contractgebonden + (voorlopig) opbrengsten
};
// Leesbaar label van het laag-2 blad waar een rubriek naartoe routeert
const schermLabelVanRubriek = (nr) => ({ arbeid:"Arbeid", materieel:"ABK", kdbewaking:"KOS blad" }[schermVanRubriek(nr)] || "KOS blad");

// ─── CENTRALE REGELS — BEGROTING & BESTEDINGEN ───────────────────────────────
// Eén centrale bron van begrotings- en bestedingsregels op kostencode-niveau.
// Deze regels kunnen overal in de tool worden doorgetrokken (aggregatie per
// kostencode / per rubriek). CONVENTIE: het LAATSTE cijfer van de kostencode = rubriek (1..9).
const rubriekVanKostencode = (code) => Number(String(code).slice(-1)) || 0;

function regelRng(seed){ let s=(seed>>>0)||1; return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }
const rPick = (rnd, arr) => arr[Math.floor(rnd()*arr.length)];
const rInt  = (rnd, a, b) => a + Math.floor(rnd()*(b-a+1));
const r2v   = (v) => Math.round(v*100)/100;
// Hoeveelheid per eenheid: PST is een vaste post (=1), UUR/WK/ST realistische aantallen.
function hoeveelheidVoor(rnd, ehd){
  if(ehd==="PST") return 1;
  if(ehd==="UUR") return rInt(rnd,2,200);
  if(ehd==="WK"||ehd==="WKN") return rInt(rnd,1,40);
  if(ehd==="ST") return rInt(rnd,1,150);
  return r2v(rInt(rnd,1,80)+rnd());   // M2, M1, MU
}

// Per rubriek: realistische kostencodes (laatste cijfer = rubriek), omschrijvingen, eenheden, prijsbereik.
const KOSTENCODE_CONFIG = {
  1: { codes:[450001, 4500001, 451001, 470001], ehd:["UUR"], prijs:[42,68], oms:[
        "Transporteren deur op bouwplaats","Stelwerk kozijnen","Montage prefab elementen","Uitzetten en meten","Opruimen werkvloer","Aftimmerwerk algemeen","Sparingen maken"] },
  2: { codes:[500002, 510002, 250002], ehd:["PST"], prijs:[2500,25000], oms:[
        "Stelpost onvoorzien casco","Stelpost afbouw","Stelpost terreininrichting","Stelpost coordinatie nuts"] },
  3: { codes:[300003, 350003, 310003], ehd:["PST","UUR"], prijs:[100,150], oms:[
        "Ontwerpcheck HAUT","Installatieadvies","Risico-analyse Breeam","Quickscan studie steigerloos","Engineering gevel","Adviseur bouwfysica","Coordinatie werkzaamheden"] },
  4: { codes:[900004, 910004, 950004], ehd:["PST"], prijs:[5000,40000], oms:[
        "Algemene bouwplaatskosten opslag","Risicoreservering casco","Reserve prijsstijging","Opslag winst en risico"] },
  5: { codes:[501005, 520005, 586005, 682005, 1210005, 697005, 593005, 675005], ehd:["WK","PST","ST","WKN"], prijs:[60,2200], oms:[
        "Uitbreiden bouwterrein afvalscheiding","Transport aanvoer en 1e montage","Trappentoren 10 m1","Meetdiensten","Netbeheer electra","Bouwlift personen/goederen","Tweemaandelijkse controlebeurt","Transport stelconplaten","Schade-uitkering bouwplaats"] },
  6: { codes:[740006, 710006, 720006, 700006], ehd:["UUR","WK"], prijs:[55,122], oms:[
        "Huurdersbegeleiden in afvalstroom","Personeel uitv/wvb 2 uur/wk","Werkvoorbereiding UTA","Projectleiding indirect","KAM-coordinatie"] },
  7: { codes:[600007, 610007, 650007], ehd:["ST","M2","M1","PST"], prijs:[12,900], oms:[
        "Levering binnendeuren","Levering hang- en sluitwerk","Levering tegelwerk","Levering sanitair","Levering plafondplaten"] },
  8: { codes:[2155008, 2165008, 2365008, 4115008, 4610008, 4420008, 5020008, 3055008, 3615008], ehd:["ST","M2","M1","PST"], prijs:[7,3650], oms:[
        "Sauswerk plafond","Stucwerk wanden","Tegelwerk badkamers","Loodgieterswerk","Wapening vlechten","Transporteren kozijn op bouwplaats","Inbouw reservoir","Systeemwanden plaatsen","Dubbele wastafel"] },
  9: { codes:[131009, 130009, 140009], ehd:["PST"], prijs:[50000,6000000], oms:[
        "Terugbetaling lening HAUT","Termijn opdrachtgever","Verrekening meerwerk OG","Subsidie duurzaamheid"] },
};
const REGEL_RUBRIEKEN = Object.keys(KOSTENCODE_CONFIG).map(Number).filter(r=>r!==9); // rubriek 9 (Opbrengsten) is geen kostenregel — niet in begroting/besteding
const A_CODES   = ["WST 1","won 20.1","won 20.2","won 21.1","won 22","20.1","20.2"];
const ZOEKNAMEN = ["LUNING","KENTER","BRANCH","LIANDER","ENGIE","IBS","BENR","WAPENING","HEEMS","VOLKER","DURA","BAM"];
const CONTRACTREGELS = ["Schilderwerk","Tegelwerk","Wapening","Loodgieters","Systeemwanden","Binnendeuren incl. afhangen","Grondwerk","Staal"];

// ── Doelbegroting per kostendrager ──────────────────────────────────────────
// Demo-rubriek-8 codes worden afgestemd op hun inkoopcontract (begrotingsregels +
// MMW-restant uit KD_BEWAKING) zodat begroting ⇄ contract ⇄ prognose realistisch
// sluiten. Alle overige codes krijgen een realistische begroting per rubriek.
const DEMO_BUDGET = { 2155008:333000, 2165008:148000, 2365008:129000, 4115008:230000, 4610008:245000, 4420008:114000 };
const RUBR_BUDGET = { 1:[25000,60000], 2:[18000,45000], 3:[12000,40000], 4:[25000,70000], 5:[15000,70000], 6:[22000,62000], 7:[18000,55000], 8:[70000,160000] };

// Verdeel een doelbedrag over n regels met plausibele hoeveelheid×prijs; de som
// van de regelbedragen is exact het doelbedrag (laatste regel sluit af).
function verdeelBedrag(rnd, cfg, doel, n){
  const ruw = [];
  for (let j=0;j<n;j++){
    const ehd = rPick(rnd, cfg.ehd); const hv = hoeveelheidVoor(rnd, ehd);
    const pr  = r2v(cfg.prijs[0] + rnd()*(cfg.prijs[1]-cfg.prijs[0]));
    ruw.push({ ehd, hv, pr, bedrag: hv*pr });
  }
  const som = ruw.reduce((s,x)=>s+x.bedrag,0) || 1; const f = doel/som; let acc = 0;
  return ruw.map((x,j) => {
    const bedrag = j<n-1 ? r2v(x.bedrag*f) : r2v(doel-acc); acc += bedrag;
    return { ehd:x.ehd, hoeveelheid:x.hv, prijs: x.hv>0 ? r2v(bedrag/x.hv) : 0, bedrag };
  });
}

// Begrotingsregels — één doorloop over ALLE kostencodes, elk met een realistische
// begroting (demo-codes contract-afgestemd). Garandeert dat geen kostendrager leeg is.
function genBegrotingsregels(){
  const rnd = regelRng(7001); const out = []; let i = 0;
  REGEL_RUBRIEKEN.forEach(r => {
    const cfg = KOSTENCODE_CONFIG[r]; const isOA = (r===8 || r===7);
    cfg.codes.forEach(code => {
      const doel = DEMO_BUDGET[code] || r2v(RUBR_BUDGET[r][0] + rnd()*(RUBR_BUDGET[r][1]-RUBR_BUDGET[r][0]));
      const n = rInt(rnd, 2, 4);
      verdeelBedrag(rnd, cfg, doel, n).forEach(p => {
        const isUur = p.ehd==="UUR";
        out.push({
          id:`BR-${1000+i}`, kostencode:code, rubriek:r,
          blad:rInt(rnd,1,40), nr:rInt(rnd,1,800),
          omschrijving:rPick(rnd,cfg.oms),
          bedrag:p.bedrag,
          mmNr: rnd()<0.2 ? rInt(rnd,2000,2099) : null,
          hoeveelheid:p.hoeveelheid, ehd:p.ehd, prijs:p.prijs,
          aantalUren: isUur ? p.hoeveelheid : (rnd()<0.4 ? rInt(rnd,0,140) : 0),
          regel: rInt(rnd,50,6100),
          contract: isOA ? rInt(rnd,9,130) : (r>=7 ? rInt(rnd,9,130) : null),
          aCode: isOA ? rPick(rnd,A_CODES) : (r===5 ? rPick(rnd,["WST 1",""]) : ""),
          uurloon: isUur ? rInt(rnd,38,52) : 0,
          tekst:"Nee",
          omschrijvingMMwerk: rnd()<0.15 ? "MUT prijsstijgingen" : "",
          omschrijvingContractregel: isOA ? rPick(rnd,CONTRACTREGELS) : "",
        });
        i++;
      });
    });
  });
  return out;
}

// Bestedingsregels — per kostencode geboekt tot een realistisch percentage (30–80%)
// van de begroting van diezelfde code, zodat besteding ≤ begroting en elke
// kostendrager bestedingen heeft. De som per code voedt 1-op-1 de Bestedingen-tab.
function genBestedingsregels(begrRegels){
  const rnd = regelRng(8002); const out = []; let i = 0;
  const periodes = [201812,201910,202009,202101,202105,202110,202310,202503,202504];
  const begrPer = {}; begrRegels.forEach(b => { begrPer[b.kostencode] = (begrPer[b.kostencode]||0) + b.bedrag; });
  Object.keys(begrPer).map(Number).forEach(code => {
    const r = rubriekVanKostencode(code); const cfg = KOSTENCODE_CONFIG[r]; if (!cfg) return;
    const doel = r2v(begrPer[code] * (0.30 + rnd()*0.50));   // 30–80% besteed
    const n = rInt(rnd, 2, 5);
    const regels = verdeelBedrag(rnd, cfg, doel, n).map(p => ({ ...p, bestedBedrag:p.bedrag }));
    // ~1 op 4 kostendragers heeft één kleine creditboeking (terugboeking); deze blijft
    // klein t.o.v. de besteding zodat het codetotaal altijd positief en realistisch is.
    if (rnd() < 0.25) {
      const ehd = rPick(rnd, cfg.ehd); const hv = hoeveelheidVoor(rnd, ehd);
      const credit = -r2v(doel * (0.04 + rnd()*0.10));
      regels.push({ ehd, hoeveelheid:hv, prijs: hv>0 ? r2v(Math.abs(credit)/hv) : 0, bestedBedrag:credit });
    }
    regels.forEach(p => {
      const periode = rPick(rnd, periodes); const jaar = Math.floor(periode/100); const mnd = periode%100;
      out.push({
        id:`BS-${2000+i}`, kostencode:code, rubriek:r,
        omschrijving:rPick(rnd,cfg.oms),
        bestedBedrag:p.bestedBedrag, periode, boekdatum:`${rInt(rnd,1,28)}-${mnd}-${jaar}`,
        hoeveelheid:p.hoeveelheid, ehd:p.ehd, prijsPerEenheid:p.prijs,
        srt: rPick(rnd,["A","F","N"]),
        referentienr: rInt(rnd,18000,2599999),
        boekstuk: `${rnd()<0.5?"AA":"CC"}${String(jaar).slice(2)}${String(mnd).padStart(2,"0")}`,
        contract:"", sub:"",
        st: rnd()<0.85?"G":"N",
        mmNummer: rnd()<0.15 ? rInt(rnd,990,2099) : null,
        co:0, gebruikernaam:"",
        zoeknaam: (r===8||r===7) ? rPick(rnd,ZOEKNAMEN) : (rnd()<0.4 ? rPick(rnd,ZOEKNAMEN) : ""),
        week: rnd()<0.3 ? rInt(rnd,1,52) : 0,
      });
      i++;
    });
  });
  return out;
}

const BEGROTINGSREGELS = genBegrotingsregels();
const BESTEDINGSREGELS = genBestedingsregels(BEGROTINGSREGELS);

const begrotingVanKostencode = (code) => BEGROTINGSREGELS.filter(r=>r.kostencode===code).reduce((s,r)=>s+r.bedrag,0);
const bestedingVanKostencode = (code) => BESTEDINGSREGELS.filter(r=>r.kostencode===code).reduce((s,r)=>s+r.bestedBedrag,0);

// Dominante omschrijving van een kostencode (meest voorkomend over begroting + besteding)
const naamVanKostencode = (code) => {
  const tel={}; BEGROTINGSREGELS.concat(BESTEDINGSREGELS).filter(r=>r.kostencode===code)
    .forEach(r=>{ tel[r.omschrijving]=(tel[r.omschrijving]||0)+1; });
  const e = Object.entries(tel).sort((a,b)=>b[1]-a[1])[0];
  return e ? e[0] : ("Kostencode "+code);
};

// ─── Kostendrager-registry (kostencode-gedreven) ──────────────────────────────
// Eén kostendrager per kostencode die in begroting OF besteding voorkomt (geen lege).
// rubriek = laatste cijfer van de kostencode. Dit is de bron voor PER-lijst, kiezer en bladen.
const KOSTENDRAGERS = (() => {
  const codes = Array.from(new Set([...BEGROTINGSREGELS.map(r=>r.kostencode), ...BESTEDINGSREGELS.map(r=>r.kostencode)]));
  return codes.map(code => ({
    id: String(code), code, rubriek: rubriekVanKostencode(code), naam: naamVanKostencode(code),
    begrotingTotaal: begrotingVanKostencode(code), bestedingTotaal: bestedingVanKostencode(code),
  })).sort((a,b)=> a.rubriek-b.rubriek || a.code-b.code);
})();
const KD_BY_ID = Object.fromEntries(KOSTENDRAGERS.map(k=>[k.id, k]));

// KD_BEWAKING-compatibele datavorm voor één kostendrager (op kostencode-id).
// • Begroting + besteding komen ALTIJD uit de begrotings-/bestedingsregels van DEZELFDE kostencode.
// • De inkoop-/afrekenlaag (contracten, OA, invloed MMW) bestaat alleen voor de 6 her-gekoppelde
//   rubriek-8 demo-codes; overige kostendragers starten met een lege inkooplaag (in UI te vullen).
function getKdData(idOrCode){
  const id   = String(idOrCode);
  const num  = Number(id);
  const meta = KD_BY_ID[id] || { code:num, rubriek:rubriekVanKostencode(num), naam:naamVanKostencode(num),
                                 begrotingTotaal:begrotingVanKostencode(num), bestedingTotaal:bestedingVanKostencode(num) };
  const demoCC = RELINK[id];
  if (demoCC && KD_BEWAKING[demoCC]) {
    const d = KD_BEWAKING[demoCC];
    // Besteding single-source: "geboekt op contract" + "overige besteding" worden
    // afgeleid uit de centrale bestedingsregels van DEZELFDE kostencode, zodat de
    // Besteed-waarde 1-op-1 de Bestedingen-tab volgt. De inkoop-/prognoselaag
    // (inkoopbedrag, reserve inkoop, MMW, restant budget, bijstelling) blijft
    // ongewijzigd en voedt de prognose (KEW).
    const besteed = meta.bestedingTotaal;
    const opContract = r2v(besteed * 0.78);
    const overigBesteed = r2v(besteed - opContract);
    return {
      code:id, naam:meta.naam, rubriek:meta.rubriek,
      begroting:{ origineel:meta.begrotingTotaal, mutaties:0, mmwBegroting:0, invloedMMWprognose:(d.begroting&&d.begroting.invloedMMWprognose)||0 },
      contracten:(d.contracten||[]).map((c,ix)=>({ ...c, geboekteKostenBis: ix===0 ? opContract : 0 })),
      restantBudget:d.restantBudget||[],
      overigeBestedingen:[{ omschrijving:"Overige bestedingen (buiten contract)", geboektBis:overigBesteed, meenemenPrognose:overigBesteed }],
      bijstelling:d.bijstelling||[],
      resultaatVorigePeriode:d.resultaatVorigePeriode||0,
      regelBegroting:meta.begrotingTotaal, regelBesteding:meta.bestedingTotaal, heeftInkooplaag:true,
    };
  }
  // Geen inkooplaag (geen contracten/afrekenblad): de besteding blijft de centrale
  // registry (zodat Besteed == Bestedingen-tab), maar de prognose (KEW) wordt een
  // realistische schatting van de eindkosten — rond de begroting met lichte spreiding,
  // en nooit lager dan wat al besteed is. Zonder dit zou het onbestede budget als
  // "winst" verschijnen.
  const besteed   = meta.bestedingTotaal;
  const pf        = 0.94 + (Math.abs(num) % 13) / 100;           // 0,94–1,06 deterministisch per code
  const prognose  = Math.max(besteed, r2v(meta.begrotingTotaal * pf));
  return {
    code:id, naam:meta.naam, rubriek:meta.rubriek,
    begroting:{ origineel:meta.begrotingTotaal, mutaties:0, mmwBegroting:0, invloedMMWprognose:0 },
    contracten:[], restantBudget:[],
    overigeBestedingen:[{ omschrijving:"Besteding + verwachte eindkosten", geboektBis:besteed, meenemenPrognose:prognose }],
    bijstelling:[],
    resultaatVorigePeriode:0,
    regelBegroting:meta.begrotingTotaal, regelBesteding:meta.bestedingTotaal, heeftInkooplaag:false,
  };
}

// Kolomdefinities voor de twee tabbladen.
const BEGROTING_KOLOMMEN = [
  { key:"kostencode", label:"Kostencode", type:"text", w:80 },
  { key:"rubriek", label:"Rubriek", type:"rubriek", w:140 },
  { key:"blad", label:"Blad", type:"text", w:44, right:true },
  { key:"nr", label:"Nr", type:"text", w:44, right:true },
  { key:"omschrijving", label:"Omschrijving", type:"text", w:200 },
  { key:"hoeveelheid", label:"Hoev.", type:"num1", w:60, right:true },
  { key:"ehd", label:"Ehd", type:"text", w:44 },
  { key:"prijs", label:"Prijs", type:"num2", w:72, right:true },
  { key:"bedrag", label:"Bedrag", type:"eur", w:92, right:true, bold:true },
  { key:"aantalUren", label:"Aantal uren", type:"num1", w:70, right:true },
  { key:"uurloon", label:"Uurloon", type:"num0", w:60, right:true },
  { key:"contract", label:"Contract", type:"text", w:64, right:true },
  { key:"aCode", label:"A. Code", type:"text", w:64 },
  { key:"mmNr", label:"MM-nr", type:"text", w:56, right:true },
  { key:"omschrijvingContractregel", label:"Contractregel", type:"text", w:150 },
];
const BESTEDING_KOLOMMEN = [
  { key:"kostencode", label:"Kostencode", type:"text", w:80 },
  { key:"rubriek", label:"Rubriek", type:"rubriek", w:140 },
  { key:"omschrijving", label:"Omschrijving", type:"text", w:200 },
  { key:"bestedBedrag", label:"Besteed bedrag", type:"eur", w:104, right:true, bold:true },
  { key:"periode", label:"Periode", type:"text", w:58, right:true },
  { key:"boekdatum", label:"Boekdatum", type:"text", w:84 },
  { key:"hoeveelheid", label:"Hoev.", type:"num1", w:56, right:true },
  { key:"ehd", label:"Ehd", type:"text", w:44 },
  { key:"prijsPerEenheid", label:"Prijs/eenh", type:"num2", w:74, right:true },
  { key:"srt", label:"Srt", type:"text", w:38 },
  { key:"referentienr", label:"Referentienr", type:"text", w:84, right:true },
  { key:"boekstuk", label:"Boekstuk", type:"text", w:72 },
  { key:"st", label:"St", type:"text", w:34 },
  { key:"mmNummer", label:"MM nummer", type:"text", w:74, right:true },
  { key:"zoeknaam", label:"Zoeknaam", type:"text", w:84 },
  { key:"week", label:"Week", type:"text", w:46, right:true },
];

function InkooporderAanmaken({ preselectedItems, inkooporders, onComplete, onCancel }) {
  // Alleen akkoord OA MMW-regels mogen in een inkooporder
  const [items, setItems]       = useState((preselectedItems || []).filter(i=>i.status==="Akkoord"));
  const [kdId, setKdId]         = useState(preselectedItems?.[0]?.kdId || "2155008");
  const [omschrijving, setOms]  = useState("");
  const [contractNr, setContractNr] = useState("");   // hoofd/deelcontractnummer (ERP, verplicht)
  const [ioStatus, setIoStatus] = useState("Concept"); // status (ERP, verplicht)
  const [confirmed, setConf]    = useState(false);
  const [newIOId]               = useState(`IO-${Math.floor(Math.random()*900+100)}`);

  // OA's die al in een bestaande inkooporder zitten — niet opnieuw te bundelen
  const alGebundeld = new Set((inkooporders||[]).flatMap(o => o.oaIds||[]));
  // Beschikbaar = goedgekeurd (Akkoord), met akkoord-bedrag > 0, nog niet gebundeld, nog niet geselecteerd
  const beschikbaar = initOaData.filter(i =>
    i.kdId===kdId &&
    i.status==="Akkoord" &&
    (i.akkoord||0) > 0 &&
    !alGebundeld.has(i.id) &&
    !items.find(s=>s.id===i.id)
  );
  const totaal = items.reduce((s,i)=>s+(i.akkoord||0),0);
  const valid  = items.length>0 && omschrijving && contractNr && ioStatus;

  if (confirmed) {
    return (
      <div style={{ padding:"40px 28px", maxWidth:520, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>✓</div>
          <div style={{ fontSize:20, fontWeight:700, color:T.budget }}>Inkooporder aangemaakt</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:4 }}>{newIOId} — klaar voor inkoopactie</div>
        </div>
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:16 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div><div style={{ fontSize:10, color:T.textMuted }}>IO Nummer</div><div style={{ fontWeight:700 }}>{newIOId}</div></div>
            <div><div style={{ fontSize:10, color:T.textMuted }}>Kostendrager</div><div style={{ fontWeight:700 }}>{kdId}</div></div>
            <div><div style={{ fontSize:10, color:T.textMuted }}>Contractnummer</div><div style={{ fontWeight:700 }}>{contractNr}</div></div>
            <div><div style={{ fontSize:10, color:T.textMuted }}>Status</div><div style={{ fontWeight:700 }}>{ioStatus}</div></div>
            <div><div style={{ fontSize:10, color:T.textMuted }}>Totaal inkooporders</div><div style={{ fontWeight:700, color:T.cost }}>{fmt(totaal)}</div></div>
            <div><div style={{ fontSize:10, color:T.textMuted }}>Aantal OA items</div><div style={{ fontWeight:700 }}>{items.length}</div></div>
          </div>
        </div>
        <div style={{ padding:"12px 14px", background:T.costLight, borderRadius:6, borderLeft:`3px solid ${T.danger}`, marginBottom:20 }}>
          <div style={{ fontSize:12, fontWeight:600, color:T.danger }}>⚠ Inkoopactie vereist</div>
          <div style={{ fontSize:11, color:T.text, marginTop:2 }}>Voer direct een inkoopactie uit om deze kosten financieel te dekken.</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={()=>onComplete({id:newIOId, kdId, omschrijving, contractNr, ioStatus, committed:totaal, budgetOG:0, invloedMMW:0, risico:0, actieUitgevoerd:false, oaIds:items.map(i=>i.id)})} style={{...btnDanger, flex:1, justifyContent:"center"}}>
            Inkoopactie uitvoeren →
          </button>
          <button onClick={onCancel} style={{...btnSecondary, flex:1, justifyContent:"center"}}>Later</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:"24px 28px", maxWidth:660, overflow:"auto" }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:18, fontWeight:700, color:T.text }}>Inkooporder aanmaken</div>
        <div style={{ fontSize:12, color:T.textSub, marginTop:2 }}>Bundel akkoord OA MMW items tot een kostenverplichting (Goedgekeurd MMW OA)</div>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:14 }}>
        <SectionHeader title="Inkooporder details"/>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div>
            <label style={labelSt}>Kostendrager</label>
            <select value={kdId} onChange={e=>{setKdId(e.target.value);setItems([]);}} style={{...selectSt, width:"100%"}}>
              {KOSTENDRAGERS.map(k=><option key={k.id} value={k.id}>{k.id} — {k.naam}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Onderaannemer</label>
            <div style={{...inputSt, width:"100%", background:T.bg, color:T.textSub, display:"flex", alignItems:"center", cursor:"not-allowed" }}>
              {getOA(kdId)}
            </div>
          </div>
          <div>
            <label style={labelSt}>Hoofd-/deelcontractnummer *</label>
            <input value={contractNr} onChange={e=>setContractNr(e.target.value)} placeholder="Bijv. HC-2026-014 / DC-03" style={{...inputSt, width:"100%", borderColor: contractNr?T.border:T.danger}}/>
          </div>
          <div>
            <label style={labelSt}>Status *</label>
            <select value={ioStatus} onChange={e=>setIoStatus(e.target.value)} style={{...selectSt, width:"100%"}}>
              <option>Concept</option>
              <option>Ter goedkeuring</option>
              <option>Goedgekeurd</option>
              <option>Verzonden naar ERP</option>
            </select>
          </div>
          <div style={{ gridColumn:"1 / -1" }}>
            <label style={labelSt}>Omschrijving bundel *</label>
            <input value={omschrijving} onChange={e=>setOms(e.target.value)} placeholder="Omschrijving..." style={{...inputSt, width:"100%", borderColor: omschrijving?T.border:T.danger}}/>
          </div>
        </div>
      </div>

      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:14 }}>
        <SectionHeader title="Geselecteerde OA MMW items"/>
        {items.length===0
          ? <div style={{ fontSize:12, color:T.textMuted, padding:"8px 0" }}>Geen items. Voeg toe uit de lijst hieronder.</div>
          : <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, marginBottom:12 }}>
              <thead><tr style={{ borderBottom:`1px solid ${T.border}` }}>
                <th style={th}>ID</th><th style={th}>Omschrijving</th><th style={{...th,textAlign:"right"}}>Akkoord bedrag</th><th style={th}/>
              </tr></thead>
              <tbody>
                {items.map(i=>(
                  <tr key={i.id} style={{ borderBottom:`1px solid ${T.border}` }}>
                    <td style={{...td,color:T.purple,fontWeight:600}}>{i.id}</td>
                    <td style={td}>{i.omschrijving}</td>
                    <td style={{...td,textAlign:"right",fontWeight:600,color:T.cost}}>{fmt(i.akkoord)}</td>
                    <td style={td}><button onClick={()=>setItems(p=>p.filter(x=>x.id!==i.id))} style={{background:"none",border:"none",cursor:"pointer",color:T.textMuted,fontSize:14}}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
        {beschikbaar.length>0 && (
          <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:12 }}>
            <div style={{ fontSize:10, fontWeight:700, color:T.textMuted, textTransform:"uppercase", marginBottom:6 }}>Beschikbaar (akkoord, {kdId})</div>
            {beschikbaar.map(i=>(
              <div key={i.id} onClick={()=>setItems(p=>[...p,i])} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 8px", borderRadius:5, cursor:"pointer", marginBottom:3, background:T.bg }}>
                <span><span style={{color:T.purple,fontWeight:600,fontSize:11,marginRight:8}}>{i.id}</span><span style={{fontSize:11}}>{i.omschrijving}</span></span>
                <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{fontSize:11,fontWeight:600,color:T.budget}}>{fmt(i.akkoord)}</span>
                  <span style={{fontSize:10,color:T.purple}}>+ Toevoegen</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background:T.costLight, border:`1px solid ${T.cost}`, borderRadius:8, padding:"14px 18px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, color:T.cost, textTransform:"uppercase" }}>Totaal inkooporders</div>
            <div style={{ fontSize:11, color:T.textSub, marginTop:1 }}>Goedgekeurd MMW OA — te committeren bedrag</div>
          </div>
          <div style={{ fontSize:24, fontWeight:700, color:T.cost }}>{fmt(totaal)}</div>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <button onClick={()=>valid&&setConf(true)} style={{...btnPrimary, opacity:valid?1:0.45, cursor:valid?"pointer":"not-allowed"}}>
          Inkooporder aanmaken →
        </button>
        <button onClick={onCancel} style={btnSecondary}>Annuleren</button>
        {!valid && <span style={{ fontSize:11, color:T.danger }}>Vul contractnummer, status en omschrijving in, en selecteer minstens 1 akkoord item.</span>}
      </div>
    </div>
  );
}

// ─── BUDGETREGEL SELECTIE (volledig of niet) ─────────────────────────────────
function BudgetRegelSelectie({ regels, selectedBR, onToggle, showKd=false }) {
  const { sorted, sortKey:sk, sortDir:sd, toggleSort } = useSortable(regels, "id", "asc");
  const thSt = {...th, cursor:"pointer", userSelect:"none"};
  return (
    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
      <thead>
        <tr style={{ borderBottom:`1px solid ${T.border}` }}>
          <th style={{...th, width:32}}>✓</th>
          <SortHeader label="Budgetregel"  sortKey="id"          currentKey={sk} currentDir={sd} onSort={toggleSort} style={thSt}/>
          {showKd && <SortHeader label="Kostendrager" sortKey="kdId" currentKey={sk} currentDir={sd} onSort={toggleSort} style={thSt}/>}
          <SortHeader label="Type"         sortKey="type"        currentKey={sk} currentDir={sd} onSort={toggleSort} style={thSt}/>
          <SortHeader label="Bedrag"       sortKey="bedrag"      currentKey={sk} currentDir={sd} onSort={toggleSort} style={thSt} align="right"/>
          <th style={th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(br => {
          const isSelected  = selectedBR.has(br.id);
          const isGekoppeld = br.gekoppeldAanIO != null;
          const disabled    = isGekoppeld && !isSelected; // al aan andere IO gekoppeld
          return (
            <tr
              key={br.id}
              onClick={() => !disabled && onToggle(br.id)}
              style={{
                borderBottom:`1px solid ${T.border}`,
                background: isSelected ? T.budgetLight : disabled ? T.bg : T.surface,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <td style={{...td, width:32, textAlign:"center"}}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => onToggle(br.id)}
                  onClick={e => e.stopPropagation()}
                  style={{ cursor: disabled ? "not-allowed" : "pointer" }}
                />
              </td>
              <td style={td}>
                <span style={{ fontWeight:600, color:T.purple }}>{br.id}</span>
                <br/>
                <span style={{ fontSize:10, color:T.textSub }}>{br.omschrijving}</span>
              </td>
              {showKd && <td style={{...td, fontSize:11, color:T.textSub}}>{br.kdId}</td>}
              <td style={td}>
                <span style={{ padding:"2px 8px", borderRadius:10, fontSize:10, fontWeight:700, background:br.type==="Initieel"?T.budgetLight:T.purpleFade, color:br.type==="Initieel"?T.budget:T.purple }}>
                  {br.type}
                </span>
              </td>
              <td style={{...td, textAlign:"right", fontWeight:700, color: isSelected ? T.budget : T.text}}>
                {fmt(br.bedrag)}
              </td>
              <td style={td}>
                {isGekoppeld
                  ? <span style={{ fontSize:11, color:T.textMuted }}>Gekoppeld aan {br.gekoppeldAanIO}</span>
                  : <span style={{ fontSize:11, color:T.budget }}>Vrij beschikbaar</span>
                }
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── INKOOPACTIE ─────────────────────────────────────────────────────────────
function Inkoopactie({ io, inkooporders, readonly, onUpdateRisico, onComplete, onCancel }) {
  // Alleen budgetregels die nog vrij beschikbaar zijn (niet aan een IO gekoppeld)
  const kdBudget    = BUDGET_REGELS.filter(b=>b.kdId===io.kdId && !b.gekoppeldAanIO);
  const allBudget   = BUDGET_REGELS.filter(b=>b.kdId!==io.kdId && !b.gekoppeldAanIO);
  const invloedItems= initInvloedMMW.filter(i=>i.kdId===io.kdId);

  // ── Hooks (Rules of Hooks: altijd onvoorwaardelijk, vóór elke conditionele return) ──
  const [tab, setTab]           = useState(0);
  const [selectedBR, setSelectedBR] = useState(new Set());
  const [budgetKdFilter, setBudgetKdFilter] = useState("all"); // KD-filter op tab 'alle budgetregels'
  const [iaStatus, setIaStatus]       = useState("Concept");
  const [iaOmschrijving, setIaOms]    = useState(io.omschrijving || "");
  const [allocInvloed, setAI]   = useState({});
  const [risico, setRisico]     = useState(io.risico || 0);
  const [confirmed, setConf]    = useState(false);
  const [vrijval, setVrijval]       = useState({});   // {ioId: bedrag} — gedeeltelijke vrijval
  const [vrijvalOpm, setVrijvalOpm] = useState({});   // {ioId: opmerking} — toelichting bij vrijval
  // Andere IO's van dezelfde KD met risicodekking — kunnen vrijvallen
  const andereIOs = (inkooporders||[]).filter(o => o.kdId===io.kdId && o.id!==io.id && o.risico>0);

  // ── Alleen-lezen overzicht: een inkooporder is definitief, of de actie is al uitgevoerd ──
  if (readonly || io.actieUitgevoerd) {
    const ioKosten    = io.committed + io.risico; // risico = te verwachten kosten
    const hardResult  = io.budgetOG - ioKosten;
    const forecastRes = io.budgetOG + io.invloedMMW - ioKosten;
    return (
      <div style={{ padding:"32px 28px", maxWidth:580, overflow:"auto" }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, color:T.budget, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Inkoopactie — uitgevoerd</div>
          <div style={{ fontSize:20, fontWeight:700, color:T.text }}>{io.id} — {getOA(io.kdId)}</div>
          <div style={{ fontSize:12, color:T.textSub }}>{io.kdId} · {io.omschrijving}</div>
        </div>

        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
          <div style={{ padding:"10px 16px", background:T.budgetLight, borderBottom:`1px solid ${T.border}` }}>
            <span style={{ fontSize:11, fontWeight:700, color:T.budget }}>✓ Inkoopactie is uitgevoerd</span>
          </div>
          <div style={{ padding:"16px 18px" }}>
            {[
              ["Totaal inkooporders (Goedgekeurd MMW OA)", fmt(io.committed), T.cost],
              ["Budget (Goedgekeurd MMW OG)", fmt(io.budgetOG), T.budget],
              ["Invloed MMW OG (zacht budget)", io.invloedMMW > 0 ? fmt(io.invloedMMW) : "—", T.forecast],
              ["Risicodekking", io.risico > 0 ? fmt(io.risico) : "—", T.risk],
            ].map(([label, val, color]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                <span style={{ fontSize:12, color:T.textSub }}>{label}</span>
                <span style={{ fontSize:12, fontWeight:700, color }}>{val}</span>
              </div>
            ))}
            <div style={{ display:"flex", gap:32, paddingTop:14 }}>
              <div>
                <div style={{ fontSize:9, color:T.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>Resultaat</div>
                <div style={{ fontSize:20, fontWeight:700, color:hardResult>=0?T.budget:T.danger, marginTop:2 }}>{fmt(hardResult)}</div>
                <div style={{ fontSize:9, color:T.textMuted }}>Budget − (IO + Risicodekking)</div>
              </div>
              <div>
                <div style={{ fontSize:9, color:T.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>Prognose resultaat</div>
                <div style={{ fontSize:20, fontWeight:700, color:forecastRes>=0?T.budget:T.forecast, marginTop:2 }}>{fmt(forecastRes)}</div>
                <div style={{ fontSize:9, color:T.textMuted }}>+ Invloed MMW OG (zacht budget)</div>
              </div>
            </div>
          </div>
        </div>
        {io.invloedMMW > 0 && (
          <div style={{ padding:"12px 14px", background:"#FFF8E1", border:`1px solid ${T.forecast}`, borderRadius:8, marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:18, flexShrink:0 }}>⚠</span>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:T.forecast }}>Let op: Invloed MMW OG meegenomen als budget</div>
              <div style={{ fontSize:11, color:T.text, marginTop:3 }}>
                {fmt(io.invloedMMW)} aan zacht budget is meegenomen in de dekking van deze inkoopactie.
                Dit bedrag is nog niet formeel goedgekeurd door de opdrachtgever.
              </div>
            </div>
          </div>
        )}
        <button onClick={onCancel} style={btnSecondary}>← Terug naar afrekenblad</button>
      </div>
    );
  }

  const toggleBR = (id) => setSelectedBR(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const allBudgetRegels = [...kdBudget, ...allBudget];
  const totBudget  = allBudgetRegels.filter(br => selectedBR.has(br.id)).reduce((s,br)=>s+br.bedrag, 0);
  const totInvloed = Object.values(allocInvloed).reduce((s,v)=>s+(parseFloat(v)||0),0);
  const risicoNum  = parseFloat(risico)||0;
  // Vrijval risicodekking = (gedeeltelijk) bedrag dat vrijvalt uit risicodekking van andere IO's.
  // Dit valt BUITEN de dekking — het is geen budget — maar telt mee in de prognose.
  const vrijvalRisico = andereIOs.reduce((s,o)=>s+(parseFloat(vrijval[o.id])||0),0);
  // Risicodekking van DEZE IO is een KOSTENpost (telt op bij inkooporders)
  const totKosten  = io.committed + risicoNum;
  // Dekking = budget (hard) + invloed MMW (zacht). NIET risicodekking, NIET vrijval.
  const totDekking = totBudget + totInvloed;
  const nogTeDekken= totKosten - totDekking;
  // Resultaat (hard): alleen hard budget tegenover kosten
  const hardResult = totBudget - totKosten;
  // Resultaatimpact = opbrengsten (dekking) − kosten
  const resultaatImpact = totDekking - totKosten;
  // Prognose = resultaatimpact + vrijval risicodekking
  const prognose   = resultaatImpact + vrijvalRisico;
  const forecastRes= totBudget + totInvloed - totKosten; // behouden voor compat

  const iaTabs = [
    { id:0, label:"Budgetregels kostendrager" },
    { id:1, label:"Alle budgetregels" },
    { id:2, label:"Invloed MMW OG" },
  ];

  if (confirmed) {
    return (
      <div style={{ padding:"40px 28px", maxWidth:520, margin:"0 auto" }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>✓</div>
          <div style={{ fontSize:20, fontWeight:700, color:T.budget }}>Inkoopactie uitgevoerd</div>
          <div style={{ fontSize:13, color:T.textSub, marginTop:4 }}>{io.id} is financieel gedekt</div>
        </div>
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"18px 20px", marginBottom:16 }}>
          {[
            ["Totaal inkooporders", fmt(io.committed), T.cost],
            ["Budget", fmt(totBudget), T.budget],
            ["Invloed MMW OG (zacht budget)", fmt(totInvloed), T.forecast],
            ["Risicodekking", fmt(parseFloat(risico)||0), T.risk],
          ].map(([label,val,color])=>(
            <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${T.border}` }}>
              <span style={{ fontSize:12, color:T.textSub }}>{label}</span>
              <span style={{ fontSize:12, fontWeight:700, color }}>{val}</span>
            </div>
          ))}
          <div style={{ display:"flex", justifyContent:"space-between", paddingTop:10, marginTop:4, borderTop:`1px solid ${T.border}` }}>
            <span style={{ fontSize:12, fontWeight:600 }}>Resultaatimpact (opbrengsten − kosten)</span>
            <span style={{ fontSize:14, fontWeight:700, color:resultaatImpact>=0?T.budget:T.danger }}>{fmt(resultaatImpact)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", paddingTop:6 }}>
            <span style={{ fontSize:12, fontWeight:600, color:vrijvalRisico>0?T.budget:T.textMuted }}>+ Vrijval risicodekking</span>
            <span style={{ fontSize:14, fontWeight:700, color:vrijvalRisico>0?T.budget:T.textMuted }}>{vrijvalRisico>0?`+${fmt(vrijvalRisico)}`:"—"}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", paddingTop:8, marginTop:4, borderTop:`2px solid ${T.purple}33` }}>
            <span style={{ fontSize:13, fontWeight:800, color:T.purple }}>= Prognose</span>
            <span style={{ fontSize:16, fontWeight:800, color:prognose>=0?T.budget:T.forecast }}>{fmt(prognose)}</span>
          </div>
        </div>
        {totInvloed > 0 && (
          <div style={{ padding:"12px 14px", background:"#FFF8E1", border:`1px solid ${T.forecast}`, borderRadius:8, marginBottom:14, display:"flex", gap:10, alignItems:"flex-start" }}>
            <span style={{ fontSize:18, flexShrink:0 }}>⚠</span>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:T.forecast }}>Let op: Invloed MMW OG meegenomen als budget</div>
              <div style={{ fontSize:11, color:T.text, marginTop:3 }}>
                Er is {fmt(totInvloed)} aan zacht budget (Invloed MMW OG) meegenomen in de dekking.
                Dit is nog geen formeel goedgekeurd budget van de opdrachtgever.
                Bij afwijzing verslechtert het prognose resultaat direct met {fmt(totInvloed)}.
              </div>
            </div>
          </div>
        )}
        <button onClick={()=>{
          // Gedeeltelijke vrijval toepassen op andere IO's, met log-opmerking
          andereIOs.forEach(o => {
            const bedrag = parseFloat(vrijval[o.id]) || 0;
            if (bedrag > 0 && onUpdateRisico) {
              const nieuwRisico = Math.max(0, o.risico - bedrag);
              onUpdateRisico(o.id, nieuwRisico, {
                datum: new Date().toLocaleDateString("nl-NL"),
                type: "vrijval",
                bedrag,
                van: o.risico,
                naar: nieuwRisico,
                opmerking: vrijvalOpm[o.id] || "",
                bron: io.id,
              });
            }
          });
          onComplete({...io, omschrijving:iaOmschrijving, iaStatus, budgetOG:totBudget, invloedMMW:totInvloed, risico:risicoNum, actieUitgevoerd:true});
        }} style={{...btnPrimary, width:"100%", justifyContent:"center"}}>
          Terug naar afrekenblad →
        </button>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flex:1, overflow:"hidden", minHeight:0 }}>
      <div style={{ flex:1, overflow:"auto", padding:"24px 28px" }}>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:10, color:T.purple, fontWeight:700, textTransform:"uppercase" }}>Inkoopactie</div>
          <div style={{ fontSize:20, fontWeight:700, color:T.text }}>{io.id} — {getOA(io.kdId)}</div>
          <div style={{ fontSize:12, color:T.textSub }}>{io.kdId}</div>
        </div>

        {/* Status & omschrijving — bovenaan */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 18px", marginBottom:18 }}>
          <div style={{ display:"grid", gridTemplateColumns:"180px 1fr", gap:12 }}>
            <div>
              <label style={labelSt}>Status</label>
              <select value={iaStatus} onChange={e=>setIaStatus(e.target.value)} style={{...selectSt, width:"100%"}}>
                <option>Concept</option>
                <option>Ter goedkeuring</option>
                <option>Goedgekeurd</option>
                <option>Verzonden naar ERP</option>
              </select>
            </div>
            <div>
              <label style={labelSt}>Omschrijving *</label>
              <input value={iaOmschrijving} onChange={e=>setIaOms(e.target.value)} placeholder="Omschrijving van de inkoopactie..." style={{...inputSt, width:"100%", borderColor: iaOmschrijving?T.border:T.danger}}/>
            </div>
          </div>
        </div>

        {/* Te dekken bedrag */}
        <div style={{ background:T.costLight, border:`1px solid ${T.cost}`, borderRadius:8, padding:"14px 18px", marginBottom:18 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:9, fontWeight:700, color:T.cost, textTransform:"uppercase", letterSpacing:1 }}>Te dekken bedrag</div>
              <div style={{ fontSize:11, color:T.textSub, marginTop:1 }}>Goedgekeurd MMW OA · {io.id}</div>
            </div>
            <div style={{ fontSize:28, fontWeight:700, color:T.cost }}>{fmt(io.committed)}</div>
          </div>
          <div style={{ marginTop:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:3 }}>
              <span style={{ color:T.textSub }}>Gedekt</span>
              <span style={{ fontWeight:600, color:T.text }}>{fmt(totDekking)} / {fmt(io.committed)}</span>
            </div>
            <div style={{ height:6, background:"rgba(0,0,0,0.08)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${Math.min(100,(totDekking/io.committed)*100)}%`, background:nogTeDekken<=0?T.budget:T.forecast, borderRadius:3, transition:"width 0.3s" }}/>
            </div>
            <div style={{ fontSize:11, fontWeight:600, marginTop:4, color:nogTeDekken>0?T.forecast:T.budget }}>
              {nogTeDekken>0
                ? `Tekort ${fmt(nogTeDekken)} — negatieve resultaatimpact`
                : nogTeDekken<0
                  ? `Overdekking ${fmt(Math.abs(nogTeDekken))} = resultaatimpact`
                  : "Volledig gedekt — resultaatimpact € 0"
              }
            </div>
          </div>
        </div>

        {/* Drie tabs */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden", marginBottom:14 }}>
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}` }}>
            {iaTabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"10px 12px", background:tab===t.id?T.surface:T.bg, border:"none", borderBottom:tab===t.id?`2px solid ${T.purple}`:"2px solid transparent", cursor:"pointer", fontSize:11, fontWeight:tab===t.id?700:500, color:tab===t.id?T.purple:T.textSub }}>
                {t.label}
                {t.id===2 && <span style={{ marginLeft:4, fontSize:9, color:T.forecast, fontWeight:700 }}>[prognose]</span>}
              </button>
            ))}
          </div>
          <div style={{ padding:"16px 18px" }}>
            {/* Tab 0 */}
            {tab===0 && (
              <div>
                <div style={{ fontSize:11, color:T.textSub, marginBottom:10 }}>Vrij beschikbare budgetregels van kostendrager <strong>{io.kdId}</strong> (nog niet aan een inkooporder gekoppeld). Een budgetregel wordt volledig gekoppeld of niet — geen gedeeltelijke allocatie.</div>
                <BudgetRegelSelectie regels={kdBudget} selectedBR={selectedBR} onToggle={toggleBR}/>
                <div style={{ marginTop:8, fontSize:11, padding:"6px 10px", background:T.bg, borderRadius:5 }}>
                  Subtotaal: <strong style={{color:T.budget}}>{fmt(allBudgetRegels.filter(br=>selectedBR.has(br.id)&&kdBudget.includes(br)).reduce((s,br)=>s+br.bedrag,0))}</strong> — Budget opdrachtgever
                </div>
              </div>
            )}
            {/* Tab 1 */}
            {tab===1 && (
              <div>
                <div style={{ padding:"10px 12px", background:T.forecastLight, borderLeft:`3px solid ${T.forecast}`, borderRadius:5, marginBottom:12, fontSize:11 }}>
                  ⚠ U alloceert budget buiten kostendrager <strong>{io.kdId}</strong>. Dit beïnvloedt het resultaat van andere kostendragers. Alleen vrij beschikbare budgetregels worden getoond.
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:11, color:T.textSub }}>Filter kostendrager</span>
                  <select value={budgetKdFilter} onChange={e=>setBudgetKdFilter(e.target.value)} style={{...selectSt, fontSize:11}}>
                    <option value="all">Alle kostendragers</option>
                    {KOSTENDRAGERS.filter(k=>k.id!==io.kdId).map(k=><option key={k.id} value={k.id}>{k.id} — {k.naam}</option>)}
                  </select>
                </div>
                <BudgetRegelSelectie regels={budgetKdFilter==="all"?allBudget:allBudget.filter(b=>b.kdId===budgetKdFilter)} selectedBR={selectedBR} onToggle={toggleBR} showKd={true}/>
                <div style={{ marginTop:8, fontSize:11, padding:"6px 10px", background:T.bg, borderRadius:5 }}>
                  Subtotaal: <strong style={{color:T.budget}}>{fmt(allBudgetRegels.filter(br=>selectedBR.has(br.id)&&allBudget.includes(br)).reduce((s,br)=>s+br.bedrag,0))}</strong> — Budget opdrachtgever (andere kostendrager)
                </div>
              </div>
            )}
            {/* Tab 2 */}
            {tab===2 && (
              <div>
                <div style={{ padding:"10px 12px", background:"#FFF8E1", borderLeft:`3px solid ${T.forecast}`, borderRadius:5, marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:T.forecast }}>Invloed MMW OG — zacht budget</div>
                  <div style={{ fontSize:11, color:T.text, marginTop:2 }}>Selecteer een regel om het volledige bedrag als zacht budget mee te nemen. Bij afwijzing verslechtert het prognose resultaat direct.</div>
                </div>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                  <thead><tr style={{ borderBottom:`2px solid ${T.border}`, background:T.bg }}>
                    <th style={{...th,width:32}}>✓</th>
                    <th style={th}>Invloed item</th>
                    <th style={{...th,textAlign:"right"}}>Bedrag (volledig)</th>
                    <th style={th}>Status</th>
                  </tr></thead>
                  <tbody>
                    {invloedItems.map(inv=>{
                      const isSel = !!allocInvloed[inv.id];
                      return (
                        <tr key={inv.id}
                          onClick={()=>setAI(p=>p[inv.id]?Object.fromEntries(Object.entries(p).filter(([k])=>k!==inv.id)):{...p,[inv.id]:inv.bedrag})}
                          style={{ borderBottom:`1px solid ${T.border}`, background:isSel?T.forecastLight:T.surface, cursor:"pointer" }}>
                          <td style={{...td,width:32,textAlign:"center"}}>
                            <input type="checkbox" checked={isSel} onChange={()=>{}} style={{cursor:"pointer"}}/>
                          </td>
                          <td style={td}>
                            <span style={{fontWeight:600,color:T.forecast}}>{inv.id}</span>
                            <br/><span style={{fontSize:10,color:T.textSub}}>{inv.omschrijving}</span>
                          </td>
                          <td style={{...td,textAlign:"right",fontWeight:isSel?700:400,color:isSel?T.forecast:T.textSub}}>
                            {fmt(inv.bedrag)} <span style={{fontSize:9,color:T.textMuted}}>[zacht]</span>
                          </td>
                          <td style={td}>
                            <span style={{fontSize:10,padding:"2px 6px",borderRadius:10,background:inv.status==="Akkoord"?T.budgetLight:T.forecastLight,color:inv.status==="Akkoord"?T.budget:T.forecast,fontWeight:600}}>
                              {inv.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ marginTop:8, fontSize:11, padding:"6px 10px", background:"#FFF8E1", borderRadius:5 }}>
                  Geselecteerd: <strong style={{color:T.forecast}}>{fmt(totInvloed)}</strong> — zacht budget (Invloed MMW OG)
                </div>
              </div>
            )}

            {/* Tab 3 — Risicodekking */}
          </div>
        </div>

        {/* Risicodekking — opnemen of vrijvallen */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"14px 18px", marginBottom:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:12 }}>Risicodekking</div>

          {/* ── Deze IO: opnemen of vrijvallen ── */}
          <div style={{ fontSize:10, fontWeight:600, color:T.textSub, marginBottom:6 }}>
            {io.id} — {io.omschrijving}
            {io.risico>0 && <span style={{ marginLeft:8, color:T.risk, background:T.riskLight, padding:"1px 6px", borderRadius:10, fontSize:9 }}>Huidig: {fmt(io.risico)}</span>}
          </div>
          <div style={{ padding:"12px 14px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.risk }}>Risicodekking deze IO (€)</span>
              <input type="number" value={risico} onChange={e=>setRisico(e.target.value)}
                placeholder="0" style={{...inputSt, width:140, textAlign:"right", borderColor:risicoNum>0?T.risk:T.border}}/>
              {io.risico>0 && risicoNum===0 && (
                <span style={{ fontSize:10, color:T.budget, fontWeight:700, background:T.budgetLight, padding:"2px 8px", borderRadius:10 }}>✓ Volledig vrijgevallen</span>
              )}
              {io.risico>0 && risicoNum>0 && risicoNum!==io.risico && (
                <button onClick={()=>setRisico(0)} style={{ fontSize:10, padding:"3px 8px", border:`1px solid ${T.budget}`, borderRadius:5, background:T.surface, cursor:"pointer", color:T.budget, fontWeight:600 }}>↩ Volledig laten vrijvallen</button>
              )}
            </div>
            <div style={{ fontSize:10, color:T.textMuted, marginTop:6 }}>
              Te verwachten kosten voor deze inkooporder. Telt als kostenpost mee in het resultaat. Zet op 0 om de reserve volledig te laten vrijvallen.
            </div>
          </div>

          {/* ── Andere IO's van dezelfde KD met risicodekking — gedeeltelijke vrijval ── */}
          {andereIOs.length > 0 && (
            <div>
              <div style={{ fontSize:10, fontWeight:600, color:T.textSub, marginBottom:6, borderTop:`1px solid ${T.border}`, paddingTop:10 }}>
                Vrijval risicodekking andere inkooporders — {io.kdId}
                <span style={{ fontWeight:400, color:T.textMuted, marginLeft:6 }}>(gedeeltelijk mogelijk · valt buiten dekking, telt mee in prognose)</span>
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ background:T.bg }}>
                    <th style={th}>IO</th>
                    <th style={th}>Omschrijving</th>
                    <th style={{...th, textAlign:"right"}}>Reserve</th>
                    <th style={{...th, textAlign:"right", width:110}}>Laten vrijvallen</th>
                    <th style={{...th, width:150}}>Opmerking</th>
                  </tr>
                </thead>
                <tbody>
                  {andereIOs.map((andere, idx) => {
                    const bedrag = parseFloat(vrijval[andere.id]) || 0;
                    const actief = bedrag > 0;
                    return (
                      <tr key={andere.id} style={{ background:actief?T.budgetLight:idx%2===0?T.surface:"#FAFBFC", borderBottom:`1px solid ${T.border}` }}>
                        <td style={{...td, fontWeight:700, color:T.purple}}>{andere.id}</td>
                        <td style={td}>{andere.omschrijving}</td>
                        <td style={{...td, textAlign:"right", fontWeight:600, color:T.risk}}>{fmt(andere.risico)}</td>
                        <td style={{...td, textAlign:"right", padding:"4px 6px"}}>
                          <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"flex-end" }}>
                            <input type="number" value={vrijval[andere.id]||""} min={0} max={andere.risico}
                              onChange={e=>{
                                const v = Math.max(0, Math.min(andere.risico, parseFloat(e.target.value)||0));
                                setVrijval(p=> v? {...p,[andere.id]:v} : Object.fromEntries(Object.entries(p).filter(([k])=>k!==andere.id)));
                              }}
                              placeholder="0" style={{...inputSt, width:80, textAlign:"right", padding:"4px 6px", fontSize:11}}/>
                            <button onClick={()=>setVrijval(p=>({...p,[andere.id]:andere.risico}))}
                              title="Volledig vrijvallen" style={{ fontSize:9, padding:"2px 5px", border:`1px solid ${T.border}`, borderRadius:4, background:T.surface, cursor:"pointer", color:T.textSub }}>max</button>
                          </div>
                        </td>
                        <td style={{...td, padding:"4px 6px"}}>
                          <input type="text" value={vrijvalOpm[andere.id]||""} disabled={!actief}
                            onChange={e=>setVrijvalOpm(p=>({...p,[andere.id]:e.target.value}))}
                            placeholder={actief?"reden vrijval...":""}
                            style={{...inputSt, width:"100%", padding:"4px 6px", fontSize:10, opacity:actief?1:0.4}}/>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background:T.bg, borderTop:`2px solid ${T.border}` }}>
                    <td colSpan={3} style={{...td, fontWeight:700}}>Totaal vrijval risicodekking</td>
                    <td colSpan={2} style={{...td, textAlign:"right", fontWeight:700, color:T.budget}}>
                      {vrijvalRisico>0 ? `+${fmt(vrijvalRisico)}` : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Samenvatting */}
          {(risicoNum>0||vrijvalRisico>0) && (
            <div style={{ marginTop:10, padding:"8px 12px", background:T.riskLight, borderRadius:5, fontSize:11, display:"flex", justifyContent:"space-between" }}>
              <span style={{ color:T.textSub }}>Kosten deze IO (incl. risicodekking)</span>
              <span style={{ fontWeight:700, color:T.cost }}>{fmt(io.committed)} + {fmt(risicoNum)} = {fmt(totKosten)}</span>
            </div>
          )}
        </div>

        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={()=>iaOmschrijving&&setConf(true)} disabled={!iaOmschrijving} style={{...btnPrimary, opacity:iaOmschrijving?1:0.45, cursor:iaOmschrijving?"pointer":"not-allowed"}}>
            Inkoopactie bevestigen →
          </button>
          <button onClick={onCancel} style={btnSecondary}>Annuleren</button>
          {!iaOmschrijving && <span style={{ fontSize:11, color:T.danger }}>Vul een omschrijving in (bovenaan).</span>}
        </div>
      </div>

      {/* Live paneel */}
      <div style={{ width:280, borderLeft:`1px solid ${T.border}`, background:"#FBFAFC", padding:"20px 18px", flexShrink:0, overflow:"auto" }}>
        <div style={{ fontSize:11, fontWeight:700, color:T.purple, letterSpacing:0.5, marginBottom:18 }}>Live overzicht</div>

        {/* ── KOSTEN BLOK ── */}
        <div style={{ background:T.surface, border:`1px solid ${T.cost}33`, borderRadius:10, overflow:"hidden", marginBottom:14 }}>
          <div style={{ background:T.costLight, padding:"8px 12px", borderBottom:`1px solid ${T.cost}22` }}>
            <div style={{ fontSize:10, fontWeight:800, color:T.cost, textTransform:"uppercase", letterSpacing:0.8 }}>Kosten</div>
          </div>
          <div style={{ padding:"10px 12px" }}>
            {[
              ["Inkooporders", "Goedgekeurd MMW OA", fmt(io.committed)],
              ["Risicodekking", "Te verwachten kosten", fmt(risicoNum)],
            ].map(([l,sub,v])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div>
                  <div style={{ fontSize:11, color:T.text }}>{l}</div>
                  <div style={{ fontSize:9, color:T.textMuted }}>{sub}</div>
                </div>
                <span style={{ fontSize:12, fontWeight:600, color:T.text }}>{v}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:8, borderTop:`2px solid ${T.cost}22` }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.cost }}>Totaal kosten</span>
              <span style={{ fontSize:15, fontWeight:800, color:T.cost }}>{fmt(totKosten)}</span>
            </div>
          </div>
        </div>

        {/* ── DEKKING BLOK ── */}
        <div style={{ background:T.surface, border:`1px solid ${T.budget}33`, borderRadius:10, overflow:"hidden", marginBottom:18 }}>
          <div style={{ background:T.budgetLight, padding:"8px 12px", borderBottom:`1px solid ${T.budget}22` }}>
            <div style={{ fontSize:10, fontWeight:800, color:T.budget, textTransform:"uppercase", letterSpacing:0.8 }}>Dekking</div>
          </div>
          <div style={{ padding:"10px 12px" }}>
            {[
              ["Budget kostendrager", allBudgetRegels.filter(br=>selectedBR.has(br.id)&&kdBudget.includes(br)).reduce((s,b)=>s+b.bedrag,0), T.budget],
              ["Budget buiten KD",    allBudgetRegels.filter(br=>selectedBR.has(br.id)&&allBudget.includes(br)).reduce((s,b)=>s+b.bedrag,0), T.budget],
              ["Invloed MMW OG",      totInvloed, T.forecast],
            ].map(([l,v,c])=>(
              <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ fontSize:11, color:T.text }}>{l}{l==="Invloed MMW OG" && <span style={{ fontSize:9, color:T.forecast, marginLeft:4 }}>(zacht)</span>}</span>
                <span style={{ fontSize:12, fontWeight:600, color: v>0?c:T.textMuted }}>{v>0?fmt(v):"—"}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:8, borderTop:`2px solid ${T.budget}22` }}>
              <span style={{ fontSize:11, fontWeight:700, color:T.budget }}>Totaal dekking</span>
              <span style={{ fontSize:15, fontWeight:800, color:T.budget }}>{fmt(totDekking)}</span>
            </div>
          </div>
        </div>

        {/* ── RESULTAAT & PROGNOSE ── */}
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:11, color:T.textSub }}>Opbrengsten (dekking)</span>
            <span style={{ fontSize:12, fontWeight:600, color:T.budget }}>{fmt(totDekking)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:11, color:T.textSub }}>− Kosten</span>
            <span style={{ fontSize:12, fontWeight:600, color:T.cost }}>{fmt(totKosten)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:7, marginTop:1, borderTop:`1px solid ${T.border}` }}>
            <span style={{ fontSize:11, fontWeight:700, color:T.text }}>= Resultaatimpact</span>
            <span style={{ fontSize:14, fontWeight:800, color:resultaatImpact>=0?T.budget:T.danger }}>{fmt(resultaatImpact)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, padding:"5px 8px", background:vrijvalRisico>0?T.budgetLight:T.bg, borderRadius:5, border:`1px dashed ${vrijvalRisico>0?T.budget:T.border}` }}>
            <span style={{ fontSize:11, color:vrijvalRisico>0?T.budget:T.textMuted }}>+ Vrijval risicodekking</span>
            <span style={{ fontSize:12, fontWeight:700, color:vrijvalRisico>0?T.budget:T.textMuted }}>{vrijvalRisico>0?`+${fmt(vrijvalRisico)}`:"—"}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:8, marginTop:6, borderTop:`2px solid ${T.purple}22` }}>
            <span style={{ fontSize:12, fontWeight:800, color:T.purple }}>= Prognose</span>
            <span style={{ fontSize:18, fontWeight:800, color:prognose>=0?T.budget:T.forecast }}>{fmt(prognose)}</span>
          </div>
          {totInvloed>0 && (
            <div style={{ fontSize:9, color:T.forecast, marginTop:6 }}>
              Incl. {fmt(totInvloed)} zacht budget (Invloed MMW OG) — nog niet goedgekeurd door OG.
            </div>
          )}
        </div>

        {/* ── STATUS ── */}
        <div style={{ padding:"11px 12px", background: nogTeDekken>0 ? T.forecastLight : T.budgetLight, borderRadius:9, border:`1px solid ${nogTeDekken>0?T.forecast:T.budget}33` }}>
          <div style={{ fontSize:11, fontWeight:700, color: nogTeDekken>0 ? T.forecast : T.budget }}>
            {nogTeDekken>0
              ? `⚠ Resultaatimpact: ${fmt(nogTeDekken)}`
              : nogTeDekken<0
                ? `✓ Overdekking: ${fmt(Math.abs(nogTeDekken))}`
                : "✓ Volledig gedekt"
            }
          </div>
          <div style={{ fontSize:9, color:T.textMuted, marginTop:2 }}>
            {nogTeDekken>0 ? "Kosten hoger dan dekking" : nogTeDekken<0 ? "Dekking hoger dan kosten" : "Kosten = dekking"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FINANCIEEL OVERZICHT ─────────────────────────────────────────────────────
function InvloedMMWFormulier({ oa, io, bestaand, onSave, onCancel }) {
  const vandaag = new Date().toLocaleDateString("nl-NL", {day:"numeric", month:"long", year:"numeric"});
  const isEdit = !!bestaand;
  const [form, setForm] = useState({
    mmwNr:        bestaand?.oaNummer || "",
    datum:        vandaag,
    basisBegroot: false,
    nietBegroot:  false,
    bedragIo:     bestaand?.mmwBedragIoBijOG != null ? String(bestaand.mmwBedragIoBijOG) : "",
    meenemen:     bestaand ? (bestaand.invloedInPrognose||0) > 0 : false,
    opmerking:    bestaand?.opmerking || "",
  });
  const set = (k, v) => setForm(p => ({...p, [k]: v}));
  const bedragNum  = parseFloat(form.bedragIo) || 0;
  const invloedNum = form.meenemen ? bedragNum : 0;   // invloed-in-prognose = io-bij-OG zolang de toggle aanstaat
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (saving) return;
    setSaving(true);
    if (isEdit) {
      onSave({
        ...bestaand,
        oaNummer:          form.mmwNr || bestaand.oaNummer,
        mmwBedragIoBijOG:  bedragNum,
        invloedInPrognose: invloedNum,
        opmerking:         form.opmerking,
      });
      return;
    }
    const id = `INV-0${invVVCounter++}`;
    onSave({
      id,
      kdId:        oa ? oa.kdId : io.kdId,
      oaNummer:    form.mmwNr || `MPW-${invVVCounter}`,
      omschrijving: oa ? oa.omschrijving : io.omschrijving,
      mmwBedragIoBijOG:  bedragNum,
      invloedInPrognose: invloedNum,
      opmerking:   form.opmerking,
      oaId:        oa?.id || null,
    });
  };

  const field = (label, children) => (
    <div style={{ marginBottom:14 }}>
      <label style={labelSt}>{label}</label>
      {children}
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(42,34,51,0.45)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:T.bg, borderRadius:14, width:560, maxHeight:"90vh", overflow:"auto", boxShadow:"0 20px 60px rgba(61,8,80,0.28)", fontFamily:"'Segoe UI',sans-serif" }}>

        {/* Header — paarse balk, TBI-stijl */}
        <div style={{ background:`linear-gradient(100deg, ${T.purple}, #7A2E96)`, padding:"16px 22px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTopLeftRadius:14, borderTopRightRadius:14 }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:"#C1E62E", textTransform:"uppercase", letterSpacing:0.8 }}>{(isEdit && io && !oa) ? "Vlak 3 · Zacht in inkooporder" : "Vlak 4 · Invloed MMW OG"}</div>
            <div style={{ fontSize:17, fontWeight:700, color:"#fff", marginTop:1 }}>{isEdit ? "MMW io opdrachtgever bewerken" : "MMW io opdrachtgever toevoegen"}</div>
          </div>
          <button onClick={onCancel} style={{ background:"rgba(255,255,255,0.15)", border:"none", color:"#fff", cursor:"pointer", fontSize:15, fontWeight:700, lineHeight:1, width:28, height:28, borderRadius:7 }}>✕</button>
        </div>

        <div style={{ padding:"20px 22px" }}>

          {/* Meer-minderwerkgegevens (readonly context) */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 18px", marginBottom:14 }}>
            <SectionHeader title="Meer-/minderwerk"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {field("Referentie",
                <div style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, fontSize:12, color:T.text }}>{oa?.oaRefNr || io?.id || bestaand?.oaNummer || "—"}</div>
              )}
              {field("Meenemen in prognose",
                <>
                <label style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:6, border:`1px solid ${form.meenemen?T.budget:T.border}`, background:form.meenemen?T.budgetLight:T.bg, fontSize:12, color:T.text, cursor:"pointer" }}>
                  <input type="checkbox" checked={form.meenemen} onChange={e=>set("meenemen",e.target.checked)}/>
                  {form.meenemen ? "Ja - telt mee in de prognose" : "Nee - alleen io bij OG"}
                </label>
                {oa && <div style={{ fontSize:9, color:T.textMuted, marginTop:3 }}>OA-melding: {oa.status}</div>}
                </>
              )}
            </div>
            {field("Omschrijving",
              <div style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, fontSize:12, color:T.text }}>{oa?.omschrijving || io?.omschrijving || bestaand?.omschrijving || "—"}</div>
            )}
          </div>

          {/* MMW gegevens (invulbaar) */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 18px", marginBottom:14 }}>
            <SectionHeader title="MMW gegevens"/>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {field("MMW nummer",
                <input value={form.mmwNr} onChange={e=>set("mmwNr",e.target.value)} placeholder="bijv. 2000" style={inputSt}/>
              )}
              {field("Datum",
                <input value={form.datum} onChange={e=>set("datum",e.target.value)} style={inputSt}/>
              )}
            </div>
            <div style={{ display:"flex", gap:18, marginBottom:14 }}>
              <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.text, cursor:"pointer" }}>
                <input type="checkbox" checked={form.basisBegroot} onChange={e=>set("basisBegroot",e.target.checked)}/> Basis begroting
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.text, cursor:"pointer" }}>
                <input type="checkbox" checked={form.nietBegroot} onChange={e=>set("nietBegroot",e.target.checked)}/> Niet begroot
              </label>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {field("MMW bedrag io bij OG (€)",
                <input type="number" value={form.bedragIo} onChange={e=>set("bedragIo",e.target.value)} placeholder="0,00" style={{...inputSt, textAlign:"right"}}/>
              )}
              {field("Invloed MMW in prognose (€)",
                <div style={{ padding:"7px 10px", borderRadius:6, border:`1px solid ${T.border}`, background:form.meenemen?T.budgetLight:T.bg, fontSize:12, color:form.meenemen?T.budget:T.textMuted, textAlign:"right", fontWeight:700 }}>{form.meenemen ? fmt(bedragNum) : "€ 0 - niet meegenomen"}</div>
              )}
            </div>
            {bedragNum>0 && (
              <div style={{ padding:"8px 12px", background:T.purpleFade, borderRadius:6, fontSize:11, color:T.purple, marginTop:2, display:"flex", justifyContent:"space-between" }}>
                <span>{form.meenemen ? "Telt mee in de prognose" : "Nog niet in de prognose (in onderhandeling)"}</span>
                <span style={{ fontWeight:700 }}>{form.meenemen ? fmt(bedragNum) : fmt(0)}</span>
              </div>
            )}
          </div>

          {/* Opmerking */}
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"16px 18px", marginBottom:18 }}>
            <SectionHeader title="Opmerking"/>
            <textarea value={form.opmerking} onChange={e=>set("opmerking",e.target.value)} rows={3}
              placeholder="Toelichting of aantekening..." style={{...inputSt, resize:"vertical"}}/>
          </div>

          {/* Knoppen */}
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={handleSave} style={btnPrimary}>{isEdit ? "Wijzigingen opslaan" : "Opslaan en sluiten"}</button>
            <button onClick={onCancel} style={btnSecondary}>Annuleren</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlauweInput({ value, onChange, onBlur, placeholder, width }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder || "0,00"}
      style={{
        width: width || 90,
        background:"#BDD7EE",
        border:"1px solid #7BA7C9",
        borderRadius:3,
        padding:"2px 5px",
        fontSize:11,
        textAlign:"right",
        fontFamily:"inherit",
        color:"#1A1D23",
        outline:"none",
      }}
    />
  );
}

// Actieknop voor blok-koppen (lime = primaire actie, ghost = secundair). Met hover-effect.
function ActieKnop({ onClick, children, variant, title }) {
  const [hover, setHover] = useState(false);
  const lime = variant !== "ghost";
  const base = {
    display:"inline-flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700,
    padding:"5px 12px", borderRadius:16, cursor:"pointer", transition:"all .12s ease",
    fontFamily:"inherit", lineHeight:1, whiteSpace:"nowrap",
  };
  const st = lime
    ? { ...base, border:"none", background:hover?"#D2F24E":"#C1E62E", color:"#2E0640",
        boxShadow:hover?"0 2px 8px rgba(193,230,46,0.45)":"0 1px 3px rgba(0,0,0,0.18)", transform:hover?"translateY(-1px)":"none" }
    : { ...base, fontWeight:600, border:"1px solid rgba(255,255,255,0.5)",
        background:hover?"rgba(255,255,255,0.18)":"rgba(255,255,255,0.06)", color:"#fff" };
  return (
    <button onClick={onClick} title={title} style={st}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
      {children}
    </button>
  );
}

// Paars invulveld — voor de vrij invulbare cellen in het kostendragerblad (TBI-huisstijl)
function PaarsInput({ value, onChange, width, align }) {
  return (
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="0,00"
      style={{
        width: width || "100%",
        background:"#F1E5F6",
        border:"1px solid #CBA8D9",
        borderRadius:4,
        padding:"3px 7px",
        fontSize:12,
        fontWeight:600,
        textAlign: align || "right",
        fontFamily:"inherit",
        color:"#630D80",
        outline:"none",
        boxSizing:"border-box",
      }}
    />
  );
}

// ─── AFREKENBLAD — Vier vlakken met volledige OA MMW functionaliteit ─────────
// Vlak 1: Inkooporders (opsomming, uitklapbaar)
// Vlak 2: OA MMW meldingen (volledige functionaliteit: nieuw, status, prognose, selecteren→IO)
// Vlak 3: Goedgekeurd MMW OG (focus later)
// Vlak 4: Invloed MMW OG (zacht budget, blauw vrij invulbaar)

function Afrekenblad({ inkooporders, setInkooporders, oaData, setOaData, invloedData, setInvloedData, selectedKd, onSelectKd, onSelectIO, onCreateIO, onOpenKostendrager }) {
  const filterKd = selectedKd || "2155008";
  const [openIOs, setOpenIOs]     = useState({});
  const [selRelatie, setSelRelatie] = useState("__alle__");   // afrekenblad per relatie per KD
  const [histOpen, setHistOpen]   = useState(false);          // historie inklapbaar
  const [selected, setSelected]   = useState([]);      // OA-ids geselecteerd voor IO
  const [showNieuw, setShowNieuw] = useState(false);
  const [nieuwVoorKd, setNieuwVoorKd] = useState(null);
  const [editOA, setEditOA]       = useState(null);    // OA-item dat bewerkt wordt
  const [editPrognose, setEditPrognose] = useState(null);
  const [progVal, setProgVal]     = useState("");
  const [formulier, setFormulier] = useState(null);    // { oa, io } voor Invloed MMW popup
  // Sorteer-state per blok
  const [sortV1, setSortV1] = useState({key:"id", dir:"asc"});       // vlak 1 (IO's)
  const [sortV2, setSortV2] = useState({key:"oaRefNr", dir:"asc"});  // vlak 2 (losse OA's)

  // Versleepbare kolombreedtes (gedeeld tussen bovenblok en onderblok zodat het kruis recht blijft)
  // index: 0 sel/chevron, 1 id/ref, 2 status, 3 omschrijving(flex=null), 4 gemeld, 5 akkoord, 6 io, 7 prognose, 8 scheider, 9 mmwnr, 10 bedrag, 11 prognose-blauw, 12 status
  // 17 kolommen: 12 links + scheider + 4 rechts
  // 0 chevron, 1 id/ref, 2 status, 3 datum, 4 omschrijving(flex), 5 aantal, 6 eenheid, 7 prijs/eenheid,
  // 8 gemeld/committed, 9 akkoord/budget, 10 io/risico, 11 prognose/dekking, 12 scheider,
  // 13 mmwnr, 14 bedrag, 15 prognose-blauw, 16 status
  const [colW, setColW] = useState([34, 88, 80, null, 50, 52, 84, 84, 84, 74, 80, 10, 96, 116, 116, 84]);
  const dragRef = useRef(null);
  const onColDragStart = (idx, e) => {
    e.preventDefault();
    dragRef.current = { idx, startX: e.clientX, startW: colW[idx] ?? 160 };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const { idx, startX, startW } = dragRef.current;
      const delta = ev.clientX - startX;
      setColW(prev => {
        const next = [...prev];
        next[idx] = Math.max(28, startW + delta); // minimaal 28px
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  // Versleep-handvat dat in een th-cel komt (rechterrand)
  const grip = (idx) => (
    <span
      onMouseDown={(e)=>{ e.stopPropagation(); onColDragStart(idx, e); }}
      onClick={(e)=>e.stopPropagation()}
      onMouseEnter={(e)=>{ e.currentTarget.style.background = "rgba(99,13,128,0.35)"; }}
      onMouseLeave={(e)=>{ e.currentTarget.style.background = "transparent"; }}
      style={{ position:"absolute", top:0, right:-3, width:7, height:"100%", cursor:"col-resize", zIndex:3, background:"transparent", transition:"background 0.12s" }}
      title="Versleep om kolombreedte aan te passen"
    />
  );

  // Relaties binnen deze kostendrager — het afrekenblad geldt per relatie per KD.
  const relaties = [...new Set([
    ...inkooporders.filter(io=>io.kdId===filterKd).map(io=>io.relatie||""),
    ...oaData.filter(o=>o.kdId===filterKd).map(o=>o.relatie||"")
  ].filter(Boolean))];
  const relScope = (x) => selRelatie==="__alle__" || (x.relatie||"")===selRelatie;
  const ios    = inkooporders.filter(io => io.kdId === filterKd && relScope(io));
  const allOA  = oaData.filter(i  => i.kdId  === filterKd && relScope(i));
  const _scopedOaIds = new Set(allOA.map(o=>o.id));
  const _scopedIoInv = new Set(ios.flatMap(io=>io.invloedMMWIds||[]));
  const allInv = invloedData.filter(i => i.kdId === filterKd &&
    (selRelatie==="__alle__" || (i.oaId ? _scopedOaIds.has(i.oaId) : true) || _scopedIoInv.has(i.id)));
  const kd     = KOSTENDRAGERS.find(k => k.id === filterKd);

  const oaVoorIO      = (io) => allOA.filter(oa => io.oaIds.includes(oa.id));
  const alleGebundeld = new Set(ios.flatMap(io => io.oaIds));
  // Losse OA-meldingen (vlak 2): niet in een IO én niet vervallen (vervallen → historie).
  const looseOA       = allOA.filter(oa => !alleGebundeld.has(oa.id) && oa.status!=="Vervallen");
  // Concept- vs goedgekeurde inkooporders: concept = in fiattering (blok 2), goedgekeurd = hard (blok 1).
  const iosGoed    = ios.filter(ioIsGoedgekeurd);
  const iosConcept = ios.filter(io => !ioIsGoedgekeurd(io) && io.status!=="Afgekeurd");
  // Historie: alle ooit gemelde OA MMW die niet meer los meetellen (vervallen of opgenomen in een goedgekeurde IO).
  const _goedOaIds = oaIdsInGoedgekeurdeIOs(ios);
  const historieOA = allOA.filter(oa => oa.status==="Vervallen" || _goedOaIds.has(oa.id));
  // ERP-simulatie (lokaal): verstuur → markeer; goedkeuren → hard (blok 1); afkeuren → OA-meldingen weer los.
  const erpVerzend    = (ioId) => setInkooporders(prev => prev.map(o => o.id===ioId ? {...o, verzondenERP:true} : o));
  const erpGoedkeuren = (ioId) => setInkooporders(prev => prev.map(o => o.id===ioId ? {...o, status:"Goedgekeurd", verzondenERP:true} : o));
  const erpAfkeuren   = (ioId) => setInkooporders(prev => prev.map(o => o.id===ioId ? {...o, status:"Afgekeurd", oaIds:[]} : o));

  const toggleIO = (id) => setOpenIOs(p => ({...p, [id]: !p[id]}));
  const isOpen   = (id) => !!openIOs[id]; // default ingeklapt

  // OA selectie voor IO
  const toggleSel = (id) => setSelected(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  const selItems  = looseOA.filter(i => selected.includes(i.id));
  const allAkk    = selItems.length>0 && selItems.every(i => i.status==="Akkoord");
  const canIO     = selItems.length>0 && allAkk;

  // Nieuw OA toevoegen — met dedup-guard (voorkomt dubbele invoer)
  const addNew = (item) => {
    setOaData(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item]);
    setShowNieuw(false);
    setNieuwVoorKd(null);
  };

  // Bestaand OA bewerken
  const saveEditOA = (item) => { setOaData(prev => prev.map(i => i.id===item.id ? item : i)); setEditOA(null); };

  // Generieke sorteerfunctie
  const sortBy = (arr, key, dir) => {
    if (!key) return arr;
    return [...arr].sort((a,b) => {
      let va = a[key], vb = b[key];
      if (va==null) va = ""; if (vb==null) vb = "";
      const cmp = (typeof va==="number" && typeof vb==="number")
        ? va - vb
        : String(va).localeCompare(String(vb), "nl");
      return dir==="asc" ? cmp : -cmp;
    });
  };
  const toggleSortV1 = (key) => setSortV1(s => ({ key, dir: s.key===key && s.dir==="asc" ? "desc" : "asc" }));
  const toggleSortV2 = (key) => setSortV2(s => ({ key, dir: s.key===key && s.dir==="asc" ? "desc" : "asc" }));
  // Klikbare kop-cel renderer
  const sortArrow = (active, dir) => <span style={{marginLeft:3,fontSize:8,opacity:active?1:0.35}}>{active?(dir==="asc"?"▲":"▼"):"⇅"}</span>;

  // Prognose opslaan
  const savePrognose = (id) => {
    setOaData(prev => prev.map(i => i.id===id ? {...i, prognoseBedrag: parseFloat(progVal)||0} : i));
    setEditPrognose(null);
  };

  // Invloed MMW opslaan (vlak 4)
  const handleFormulierSave = (invItem) => {
    const isNew = !invloedData.some(i => i.id === invItem.id);
    // Bij koppeling aan een OA-melding: zet oaId op het invloed-item (back-link),
    // zodat vlak 3/4 consistent verschuift wanneer de OA in een inkooporder komt.
    const koppelOa = (isNew && formulier?.oa && !formulier?.bestaand) ? formulier.oa.id : null;
    const gekoppeldItem = koppelOa ? {...invItem, oaId: koppelOa} : invItem;
    setInvloedData(prev => prev.some(i => i.id === invItem.id)
      ? prev.map(i => i.id === invItem.id ? gekoppeldItem : i)   // bewerken: bestaand bijwerken
      : [...prev, gekoppeldItem]);                               // nieuw: toevoegen
    // Nieuw item koppelen aan de juiste bron
    if (koppelOa) {
      // vlak 4 vanuit een losse OA-melding → koppel aan die melding (heen-link)
      setOaData(prev => prev.map(i => i.id===formulier.oa.id ? {...i, invloedMMWId: invItem.id} : i));
    } else if (isNew && formulier?.io && !formulier?.oa && !formulier?.bestaand && setInkooporders) {
      // vlak 3 vanuit een inkooporder → koppel aan de IO
      setInkooporders(prev => prev.map(o => o.id===formulier.io.id
        ? {...o, invloedMMWIds:[...(o.invloedMMWIds||[]), invItem.id], invloedMMW:(o.invloedMMW||0)+(invItem.invloedInPrognose||0)}
        : o));
    }
    setFormulier(null);
  };


  // ── Eén paarse familie: diepte = zekerheid (vlak 1 diepst → vlak 4 lichtst) ──
  const P900="#3D0850", P800="#4F0A68", P700="#630D80", P600="#7A2E96",
        P500="#9450AC", P400="#B07FC4", P300="#CBA8D9", P200="#E3CEEC",
        P100="#F1E5F6", P050="#F8F2FB";
  const LIME="#C1E62E", LIMEDK="#9FBF1F";
  // Vlak-tinten (tekstkleur voor accenten per vlak)
  const V1=P800, V1bg=P050, V1alt="#FCFAFD";
  const V2=P500, V2bg=P050, V2row="#FFFFFF", V2alt="#FDFCFE";
  const V3=P600, V3bg=P050;
  const V4=P400, V4bg=P050, V4row="#FDFCFE";
  const SEP="#FFFFFF", SEPW=10, BLUE="#EBDDF2";  // SEP = kruis-vouw; BLUE = zacht paars invulveld
  // Kop-gradiënten per vlak (diep → licht)
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;
  const KOP3=`linear-gradient(100deg, ${P600}, ${P500})`;
  const KOP2=`linear-gradient(100deg, ${P500}, ${P400})`;
  const KOP4=`linear-gradient(100deg, ${P400}, ${P300})`;

  // Totalen
  const totV1 = iosGoed.reduce((s,io)=>s+io.committed,0);
  // Invloed MMW OG per IO = direct gekoppeld (io.invloedMMWIds) + via gebundelde OA-meldingen
  // (oa.invloedMMWId), gededupliceerd. Dit is precies wat op de inkooporder-regel getoond wordt.
  const invVoorIO = (io) => {
    // Invloed volgt zijn OA-melding: alleen de invloed van de in deze IO gebundelde OA's hoort hier (vlak 3).
    const viaOa = oaVoorIO(io).map(oa=>oa.invloedMMWId?allInv.find(i=>i.id===oa.invloedMMWId):null).filter(Boolean);
    // Plus invloed die rechtstreeks op de inkooporder is ingevoerd ZONDER eigen OA-melding (los zacht budget in de IO).
    const directGeenOa = (io.invloedMMWIds||[])
      .map(id=>allInv.find(i=>i.id===id)).filter(Boolean)
      .filter(i => !i.oaId && !allOA.some(o=>o.invloedMMWId===i.id));
    return [...viaOa, ...directGeenOa].filter((v,i,a)=>a.findIndex(x=>x.id===v.id)===i);
  };
  // Vlak 3 = alle invloed MMW die aan een inkooporder hangt (zoals getoond op de IO-regels).
  // Vlak 4 = los zacht budget (niet aan een inkooporder gekoppeld). Vlak 3 + vlak 4 = alle invloed.
  // Vlak 3 = invloed waarvan de gekoppelde OA in een GOEDGEKEURDE IO zit (of direct op zo'n IO ingevoerd).
  const _goedOaAfr = oaIdsInGoedgekeurdeIOs(ios);
  const _directGoed = new Set(); ios.filter(ioIsGoedgekeurd).forEach(io => (io.invloedMMWIds||[]).forEach(id => _directGoed.add(id)));
  const vlak3Ids = new Set();
  allInv.forEach(i => { if (invloedInVlak3(i, _goedOaAfr) || _directGoed.has(i.id)) vlak3Ids.add(i.id); });
  // Alleen "invloed in prognose" telt mee (en rolt door naar het KOS blad); "MMW bedrag io bij OG" is informatief.
  const totV3   = allInv.filter(i=> vlak3Ids.has(i.id)).reduce((s,i)=>s+(i.invloedInPrognose||0),0);
  const totV3io = allInv.filter(i=> vlak3Ids.has(i.id)).reduce((s,i)=>s+(i.mmwBedragIoBijOG||0),0);
  const totV4   = allInv.filter(i=>!vlak3Ids.has(i.id)).reduce((s,i)=>s+(i.invloedInPrognose||0),0);
  const totV4io = allInv.filter(i=>!vlak3Ids.has(i.id)).reduce((s,i)=>s+(i.mmwBedragIoBijOG||0),0);
  const totV4og = totV4;
  // Losstaande invloed MMW (vlak 4) die niet aan een losse OA-melding hangt → eigen regel,
  // anders telt het wel mee in totV4 maar staat het op geen enkele regel.
  const getoondVlak4 = new Set(looseOA.filter(o=>o.invloedMMWId).map(o=>o.invloedMMWId));
  const losseInvloed = allInv.filter(i => !vlak3Ids.has(i.id) && !getoondVlak4.has(i.id));
  const nLoose= looseOA.length;

  // Resultaat & prognose over alle inkooporders van deze kostendrager
  // Resultaat (hard) = Budget OG − (Inkooporders + Risicodekking)
  // Prognose         = Budget OG + Invloed MMW (zacht, vlak 3) − (Inkooporders + Risicodekking)
  const totBudgetOG  = iosGoed.reduce((s,io)=>s+(io.budgetOG||0),0);
  const totRisicoKD  = iosGoed.reduce((s,io)=>s+(io.risico||0),0);
  const totInvloedIO = totV3 + totV4;   // alle invloed-in-prognose (vlak 3 + vlak 4) telt mee in de prognose
  const totKostenKD  = totV1 + totRisicoKD;
  const resultaatKD  = totBudgetOG - totKostenKD;
  const prognoseKD   = totBudgetOG + totInvloedIO - totKostenKD;

  // Cel-stijlen
  const cL = (align,bold,color,bg) => ({ padding:"4px 7px", fontSize:11, textAlign:align||"left",
    fontWeight:bold?700:400, color:color||"#1A1D23", background:bg||"transparent",
    borderBottom:"1px solid rgba(0,0,0,0.06)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", verticalAlign:"middle" });
  const cR = (align,bold,color,bg) => ({ padding:"4px 7px", fontSize:11, textAlign:align||"left",
    fontWeight:bold?700:400, color:color||"#1A1D23", background:bg||"transparent",
    borderBottom:"1px solid rgba(0,0,0,0.06)", borderLeft:"1px solid rgba(0,0,0,0.06)", whiteSpace:"nowrap", verticalAlign:"middle" });
  const hL = (align,bg) => ({ padding:"4px 7px", fontSize:9, fontWeight:700, color:"#555",
    textAlign:align||"left", background:bg||T.bg, borderBottom:"2px solid rgba(0,0,0,0.15)", whiteSpace:"nowrap", letterSpacing:0.3 });
  const hR = (align,bg) => ({ padding:"4px 7px", fontSize:9, fontWeight:700, color:"#555",
    textAlign:align||"left", background:bg||T.bg, borderBottom:"2px solid rgba(0,0,0,0.15)", borderLeft:"1px solid rgba(0,0,0,0.06)", whiteSpace:"nowrap", letterSpacing:0.3 });

  const stB = (s) => {
    const m = {
      "Akkoord":{bg:P100,c:P700},
      "In onderhandeling":{bg:"#FBF3D6",c:LIMEDK},
      "Nieuw":{bg:"#EFEDF2",c:"#9C97A6"}
    };
    const st = m[s]||m.Nieuw;
    return <span style={{fontSize:9,fontWeight:700,background:st.bg,color:st.c,padding:"2px 7px",borderRadius:20}}>{s}</span>;
  };
  // Mini dekkings-staaf voor een IO: hoeveel van de inkooporder is gedekt door budget OG
  const covBar = (committed, dekking) => {
    const ratio = committed>0 ? Math.min(1, dekking/committed) : 0;
    const laag = ratio < 0.5;
    return (
      <span style={{display:"inline-block",width:48,height:6,borderRadius:3,background:P100,overflow:"hidden",verticalAlign:"middle"}}>
        <span style={{display:"block",height:"100%",borderRadius:3,width:`${Math.round(ratio*100)}%`,background:laag?LIME:P600}}/>
      </span>
    );
  };

  // Render een OA-rij (vlak 2 links + vlak 4 rechts) — herbruikbaar voor IO-groepen en losse
  const renderOaRow = (oa, idx, io, selectable) => {
    const inv  = oa.invloedMMWId ? allInv.find(i=>i.id===oa.invloedMMWId) : null;
    // Invloed volgt zijn OA-melding: OA gebundeld (in inkooporder) → vlak 3, OA los → vlak 4.
    const inIO = inv && alleGebundeld.has(oa.id);
    const bgL  = idx%2===0 ? V2row : V2alt;
    const rBg  = inIO ? V3bg : inv ? V4row : bgL;
    const isSel= selected.includes(oa.id);

    return (
      <tr key={"oa-"+oa.id} style={{ background:isSel?T.purpleFade:bgL }}>
        {/* selectie / indent */}
        <td style={{...cL("center",false,"",isSel?T.purpleFade:bgL)}}>
          {selectable
            ? <input type="checkbox" checked={isSel} onChange={()=>toggleSel(oa.id)} style={{cursor:"pointer"}}/>
            : <span style={{display:"inline-block",width:6,height:6}}/>}
        </td>
        {/* Ref — klikbaar om te bewerken */}
        <td style={{...cL("left",true,V2,isSel?T.purpleFade:bgL), cursor:"pointer"}} onClick={()=>setEditOA(oa)} title="Klik om te bewerken">
          <div style={{textDecoration:"underline"}}>{oa.oaRefNr||oa.id}</div>
          <div style={{fontSize:9,color:T.textMuted,fontWeight:400}}>{oa.id}</div>
        </td>
        <td style={{...cL("left",false,T.textSub,bgL), cursor:"pointer"}} onClick={()=>setEditOA(oa)}>{oa.datum||"—"}</td>
        <td style={{...cL("left",false,"#1A1D23",bgL), cursor:"pointer"}} onClick={()=>setEditOA(oa)}>{oa.omschrijving}</td>
        <td style={cL("right",false,T.textSub,bgL)}>{oa.aantal!=null?oa.aantal:"—"}</td>
        <td style={cL("left",false,T.textSub,bgL)}>{oa.eenheid||"—"}</td>
        <td style={cL("right",false,T.textSub,bgL)}>{oa.prijsPerEenheid?fmtN(oa.prijsPerEenheid):"—"}</td>
        <td style={cL("right",false,T.textSub,bgL)}>{fmtN(oa.gemeld)}</td>
        <td style={cL("right",Math.abs(oa.akkoord)>0.005,oa.akkoord>0?V3:(oa.akkoord<0?T.danger:T.textMuted),oa.akkoord>0?"#F4B18333":(oa.akkoord<0?"#FBEAEF":bgL))}>{Math.abs(oa.akkoord)>0.005?fmtN(oa.akkoord):"—"}</td>
        <td style={cL("right",false,oa.io>0?V2:T.textMuted,bgL)}>{oa.io>0?fmtN(oa.io):"—"}</td>
        {/* MMW in prognose — vrij invulbaar */}
        <td style={{...cL("right",oa.prognoseBedrag>0,oa.prognoseBedrag>0?V3:T.textMuted,editPrognose===oa.id?"#EFF6FF":oa.prognoseBedrag>0?BLUE:bgL), padding:"2px 4px"}}>
          {editPrognose===oa.id ? (
            <div style={{display:"flex",gap:3,alignItems:"center",justifyContent:"flex-end"}}>
              <input type="number" value={progVal} onChange={e=>setProgVal(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")savePrognose(oa.id);if(e.key==="Escape")setEditPrognose(null);}}
                style={{...inputSt,width:70,fontSize:11,textAlign:"right",padding:"2px 5px"}} autoFocus/>
              <button onClick={()=>savePrognose(oa.id)} style={{fontSize:10,background:T.budget,color:"#fff",border:"none",borderRadius:3,padding:"2px 5px",cursor:"pointer"}}>✓</button>
            </div>
          ) : (
            <div onClick={()=>{setEditPrognose(oa.id);setProgVal(String(oa.prognoseBedrag||inv?.bedrag||""));}}
              style={{cursor:"pointer",minHeight:18,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:3}} title="Klik om te bewerken">
              {oa.prognoseBedrag>0 ? <span style={{fontWeight:700,color:"#1A1D23"}}>{fmtN(oa.prognoseBedrag)}</span> : <span style={{color:T.textMuted,fontSize:9}}>—</span>}
              <span style={{fontSize:8,color:"#999"}}>✎</span>
            </div>
          )}
        </td>
        {/* Scheider */}
        <td style={{background:SEP,padding:0}}/>
        {/* VLAK 4 / 3 rechts */}
        {inv ? (
          <>
          <td style={{...cR("left",true,inIO?V3:V4,rBg), cursor:"pointer"}} onClick={()=>setFormulier({oa, io, bestaand:inv})} title="Klik om te bewerken">
            {inv.oaNummer}{inIO && <span style={{fontSize:8,color:V3,fontWeight:700,marginLeft:4}}>v3</span>}
          </td>
          <td style={{...cR("right",false,"#1A1D23",BLUE),padding:"1px 4px", cursor:"pointer"}} onClick={()=>setFormulier({oa, io, bestaand:inv})}>
            <BlauweInput value={inv.mmwBedragIoBijOG||""} onChange={()=>{}} onBlur={()=>{}} width={84}/>
          </td>
          <td style={{...cR("right",false,"#1A1D23",BLUE),padding:"1px 4px", cursor:"pointer"}} onClick={()=>setFormulier({oa, io, bestaand:inv})}>
            <BlauweInput value={inv.invloedInPrognose||""} onChange={()=>{}} onBlur={()=>{}} width={84}/>
          </td>
          <td style={{...cR("left",false,T.textMuted,rBg), cursor:"pointer"}} onClick={()=>setFormulier({oa, io, bestaand:inv})}>
            <span style={{fontSize:9,fontWeight:400,color:T.textSub}}>{inv.opmerking||"—"}</span>
          </td>
          </>
        ) : (
          <>
          <td style={cR("left",false,P200,bgL)}>—</td>
          <td style={{...cR("right",false,P400,BLUE),padding:"1px 4px",cursor:"pointer"}} onClick={()=>setFormulier({oa, io})}>
            <span style={{fontSize:9}}>+ invullen</span>
          </td>
          <td style={{...cR("right",false,P400,BLUE),padding:"1px 4px",cursor:"pointer"}} onClick={()=>setFormulier({oa, io})}>
            <span style={{fontSize:9}}>+ invullen</span>
          </td>
          <td style={cR("left",false,P200,bgL)}/>
          </>
        )}
      </tr>
    );
  };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden", fontFamily:"'Segoe UI',sans-serif", background:T.bg }}>

      {/* Popups */}
      {showNieuw && <NieuwOaFormulier kdId={nieuwVoorKd||filterKd} invloedItems={initInvloedMMW} vergelijkOAs={oaData.filter(o=>o.kdId===(nieuwVoorKd||filterKd))} onSave={addNew} onCancel={()=>{setShowNieuw(false);setNieuwVoorKd(null);}}/>}
      {editOA && <NieuwOaFormulier bestaand={editOA} invloedItems={initInvloedMMW} onSave={saveEditOA} onCancel={()=>setEditOA(null)}/>}
      {formulier && <InvloedMMWFormulier oa={formulier.oa} io={formulier.io} bestaand={formulier.bestaand} onSave={handleFormulierSave} onCancel={()=>setFormulier(null)}/>}

      {/* Toolbar */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>Afrekenblad</span>
          <span style={{ fontSize:11, color:T.textMuted }}>voor kostendrager</span>
          {/* Prominente KD-badge */}
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.purpleFade, border:`1px solid ${T.purple}33`, borderRadius:6, padding:"4px 10px" }}>
            <span style={{ fontSize:12, fontWeight:700, color:T.purple }}>{filterKd}</span>
            <span style={{ fontSize:11, color:T.text }}>{kd?.naam}</span>
            <span style={{ fontSize:10, color:T.textMuted, borderLeft:`1px solid ${T.purple}33`, paddingLeft:6 }}>{getOA(filterKd)}</span>
          </span>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {onOpenKostendrager && (
            <button onClick={onOpenKostendrager} title="Naar het KOS blad van deze KD"
              style={{ border:`1px solid ${T.purple}`, background:"#fff", color:T.purple, borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>
              KOS blad →
            </button>
          )}
          <select value={filterKd} onChange={e=>{onSelectKd(e.target.value);setSelected([]);setSelRelatie("__alle__");}} style={{...selectSt,fontSize:11}}>
            {KOSTENDRAGERS.map(k=><option key={k.id} value={k.id}>{k.id} — {k.naam}</option>)}
          </select>
          {relaties.length>0 && (
            <select value={selRelatie} onChange={e=>{setSelRelatie(e.target.value);setSelected([]);}} style={{...selectSt,fontSize:11}} title="Het afrekenblad geldt per relatie per kostendrager">
              <option value="__alle__">Alle relaties{relaties.length>1?` (${relaties.length})`:""}</option>
              {relaties.map(r=><option key={r} value={r}>{r}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* KPI strip — vier vlakken in paars-verloop */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, flexShrink:0 }}>
        {[
          {l:"Vlak 1 · Inkooporders",     v:fmt(totV1),          c:P800, depth:0, sub:`${iosGoed.length} IO's · hard`},
          {l:"Vlak 3 · Zacht in IO",      v:fmt(totV3),          c:P600, depth:1, sub:"gedekt door OG"},
          {l:"Vlak 2 · OA-meldingen",     v:String(nLoose),       c:P500, depth:2, sub:`${nLoose} nog los`},
          {l:"Vlak 4 · Los zacht budget", v:fmt(totV4),          c:P400, depth:3, sub:"nog niet gekoppeld"},
        ].map(({l,v,c,depth,sub})=>(
          <div key={l} style={{flex:1,background:P050,borderRadius:10,padding:"9px 13px",borderLeft:`4px solid ${c}`}}>
            <div style={{fontSize:9,fontWeight:700,color:c,textTransform:"uppercase",letterSpacing:0.4}}>{l}</div>
            <div style={{fontSize:17,fontWeight:800,color:T.text,marginTop:2,letterSpacing:-0.5}}>{v}</div>
            <div style={{fontSize:9,color:T.textMuted,marginTop:1}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Resultaat staat NIET op het afrekenblad — dit komt samen op het kostendragerblad. */}

      {/* Selectiebalk voor IO aanmaken */}
      {selected.length>0 && (
        <div style={{ padding:"8px 16px", background:T.purpleFade, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <span style={{ fontSize:12, color:T.purple, fontWeight:600 }}>{selItems.length} OA-melding(en) geselecteerd</span>
          {!allAkk && (
            <span style={{ fontSize:11, color:T.forecast }}>
              ⚠ {selItems.filter(i=>i.status!=="Akkoord").length} item(s) nog niet akkoord — alleen akkoord items kunnen naar een inkooporder
            </span>
          )}
          {canIO && (
            <button onClick={()=>{onCreateIO(selItems);setSelected([]);}} style={{...btnPrimary, fontSize:11, padding:"4px 12px"}}>
              + Inkooporder aanmaken ({selItems.length})
            </button>
          )}
          {!allAkk && selItems.some(i=>i.status==="Akkoord") && (
            <button onClick={()=>setSelected(selItems.filter(i=>i.status==="Akkoord").map(i=>i.id))} style={{...btnSecondary, fontSize:11, padding:"4px 12px"}}>
              Alleen akkoord houden ({selItems.filter(i=>i.status==="Akkoord").length})
            </button>
          )}
          <button onClick={()=>setSelected([])} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.textMuted}}>Deselecteer</button>
        </div>
      )}

      {/* Hoofdtabel — vier vlakken met kruis (brede witte scheiders) */}
      <div style={{ flex:1, overflow:"auto", minHeight:0, padding:"0 14px 14px" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
          <colgroup>
            <col style={{width:colW[0]}}/>{/* sel/chevron */}
            <col style={{width:colW[1]}}/>{/* id/ref */}
            <col style={{width:colW[2]}}/>{/* datum */}
            <col style={colW[3]?{width:colW[3]}:{}}/>{/* omschrijving — flex of vast */}
            <col style={{width:colW[4]}}/>{/* aantal */}
            <col style={{width:colW[5]}}/>{/* eenheid */}
            <col style={{width:colW[6]}}/>{/* prijs/eenheid */}
            <col style={{width:colW[7]}}/>{/* gemeld/committed */}
            <col style={{width:colW[8]}}/>{/* akkoord/budget */}
            <col style={{width:colW[9]}}/>{/* io/risico */}
            <col style={{width:colW[10]}}/>{/* prognose/dekking */}
            <col style={{width:colW[11]}}/>{/* KRUIS — verticale witte scheider */}
            <col style={{width:colW[12]}}/>{/* MMW nr */}
            <col style={{width:colW[13]}}/>{/* bedrag blauw */}
            <col style={{width:colW[14]}}/>{/* prognose blauw */}
            <col style={{width:colW[15]}}/>{/* status */}
          </colgroup>

          {/* ════ BOVENSTE BLOK-RIJ: VLAK 1 (links) + VLAK 3 (rechts) ════ */}
          <thead style={{ position:"sticky", top:0, zIndex:6 }}>
            {/* Blok-koppen */}
            <tr>
              <th colSpan={11} style={{ padding:"11px 16px", background:KOP1, textAlign:"left" }}>
                <span style={{ fontSize:12, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>VLAK 1 · INKOOPORDERS</span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.75)", marginLeft:10 }}>harde kosten · {fmt(totV1)}</span>
              </th>
              <th style={{ background:SEP, padding:0 }}/>
              <th colSpan={4} style={{ padding:"11px 16px", background:KOP3, textAlign:"left" }}>
                <span style={{ fontSize:12, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>VLAK 3 · MMW OG IN VERPLICHTING</span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.75)", marginLeft:10 }}>zachte dekking · in goedgekeurde IO</span>
              </th>
            </tr>
            {/* Kolomkoppen vlak 1 + 3 — klikbaar sorteren */}
            <tr>
              <th style={hL("center",V1bg)}/>
              <th style={{...hL("left",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("id")}>IO#{sortArrow(sortV1.key==="id",sortV1.dir)}{grip(1)}</th>
              <th style={{...hL("left",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("datum")}>Datum{sortArrow(sortV1.key==="datum",sortV1.dir)}{grip(2)}</th>
              <th style={{...hL("left",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("omschrijving")}>Omschrijving{sortArrow(sortV1.key==="omschrijving",sortV1.dir)}{grip(3)}</th>
              <th style={{...hL("right",V1bg),position:"relative"}}>{grip(4)}</th>
              <th style={{...hL("left",V1bg),position:"relative"}}>{grip(5)}</th>
              <th style={{...hL("right",V1bg),position:"relative"}}>{grip(6)}</th>
              <th style={{...hL("right",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("committed")}>Inkooporder{sortArrow(sortV1.key==="committed",sortV1.dir)}{grip(7)}</th>
              <th style={{...hL("right",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("budgetOG")}>Budget OG{sortArrow(sortV1.key==="budgetOG",sortV1.dir)}{grip(8)}</th>
              <th style={{...hL("right",V1bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV1("risico")}>Risico{sortArrow(sortV1.key==="risico",sortV1.dir)}{grip(9)}</th>
              <th style={{...hL("center",V1bg),position:"relative"}}>Dekking{grip(10)}</th>
              <th style={{ background:SEP, padding:0 }}/>
              <th style={{...hR("left",V3bg),position:"relative"}}>MMW nr{grip(12)}</th>
              <th style={{...hR("right",BLUE), color:"#1A1D23",position:"relative"}}>MMW bedrag<br/>io bij OG{grip(13)}</th>
              <th style={{...hR("right",BLUE), color:"#1A1D23",position:"relative"}}>Invloed MMW<br/>in prognose{grip(14)}</th>
              <th style={hR("left",V3bg)}>Opmerking</th>
            </tr>
          </thead>

          {/* IO-rijen (vlak 1 + vlak 3), uitklapbaar naar gekoppelde OA's */}
          <tbody>
            {sortBy(iosGoed, sortV1.key, sortV1.dir).map((io, ioIdx) => {
              const oaItems = oaVoorIO(io);
              // Alle invloed MMW OG van deze IO (direct + via gebundelde OA-meldingen, gededupliceerd)
              const invItems  = invVoorIO(io);
              const totInvIO  = invItems.reduce((s,i)=>s+(i.mmwBedragIoBijOG||0),0); const totInvProg = invItems.reduce((s,i)=>s+(i.invloedInPrognose||0),0);
              const ioBg    = ioIdx%2===0 ? "#fff" : V1alt;
              const open    = isOpen(io.id);
              const soloOa   = invItems.length===1 ? oaItems.find(o=>o.invloedMMWId===invItems[0].id) : null;
              const editSolo = invItems.length===1 ? (e)=>{e.stopPropagation();setFormulier({oa:soloOa, io, bestaand:invItems[0]});} : undefined;
              const soloCur  = invItems.length===1 ? "pointer" : "default";
              return (
                <>
                <tr key={"io-"+io.id} style={{background:ioBg, cursor:"pointer"}} onClick={()=>onSelectIO(io)} title="Klik om de inkoopactie te openen">
                  <td style={{...cL("center",true,V1,ioBg),cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();toggleIO(io.id);}} title="In-/uitklappen">{open?"▼":"▶"}</td>
                  <td style={{...cL("left",true,V1,ioBg)}}>{io.id}</td>
                  <td style={cL("left",false,T.textSub,ioBg)}>{io.datum||"—"}</td>
                  <td style={cL("left",false,T.text,ioBg)}>
                    <span style={{fontWeight:600}}>{io.omschrijving}</span>
                    <span style={{fontSize:9,color:T.textMuted,marginLeft:6}}>{oaItems.length} OA</span>
                  </td>
                  <td style={cL("right",false,"",ioBg)}/>
                  <td style={cL("left",false,"",ioBg)}/>
                  <td style={cL("right",false,"",ioBg)}/>
                  <td style={{...cL("right",true,T.text,ioBg), fontSize:13}}>{fmtN(io.committed)}</td>
                  <td style={cL("right",false,io.budgetOG>0?P600:T.textMuted,ioBg)}>{io.budgetOG>0?fmtN(io.budgetOG):"—"}</td>
                  <td style={cL("right",false,io.risico>0?LIMEDK:T.textMuted,ioBg)}>{io.risico>0?fmtN(io.risico):"—"}</td>
                  <td style={cL("center",false,"",ioBg)}>{covBar(io.committed, io.budgetOG + io.invloedMMW)}</td>
                  {/* KRUIS verticale scheider */}
                  <td style={{ background:SEP, padding:0 }}/>
                  {invItems.length>0 ? (
                    <>
                    <td style={{...cR("left",true,P600,ioBg), cursor:soloCur}} onClick={editSolo} title={invItems.length===1?"Klik om de invloed MMW te bewerken (status, bedragen)":"Klap de inkooporder uit om de invloed-regels afzonderlijk te bewerken"}>
                      {invItems.length===1 ? invItems[0].oaNummer : <span>{invItems.length}× invloed</span>}
                    </td>
                    <td style={{...cR("right",true,P600,ioBg),padding:"1px 8px", cursor:soloCur}} onClick={editSolo} title="Totaal invloed MMW OG (vlak 3) van deze inkooporder">{fmtN(totInvIO)}</td>
                    <td style={{...cR("right",false,T.textSub,ioBg),padding:"1px 8px", cursor:soloCur}} onClick={editSolo}>{totInvProg>0?fmtN(totInvProg):"—"}</td>
                    <td style={{...cR("left",false,P600,ioBg), cursor:soloCur}} onClick={editSolo} title="Klik om de opmerking te wijzigen"><span style={{fontSize:9,fontWeight:400,color:T.textSub}}>{invItems.length===1?(invItems[0].opmerking||"—"):(invItems.length+"× invloed")}</span></td>
                    </>
                  ) : (
                    <>
                    <td style={cR("left",false,P200,ioBg)}>—</td>
                    <td style={cR("right",false,T.textMuted,ioBg)}>—</td>
                    <td style={cR("right",false,T.textMuted,ioBg)}>—</td>
                    <td style={cR("left",false,P200,ioBg)}/>
                    </>
                  )}
                </tr>
                {/* Uitgeklapt: de OA-meldingen die in deze IO zitten — herleidbaar tot het IO-bedrag */}
                {open && oaItems.map((oa, oaIdx) => {
                  const memInv = oa.invloedMMWId ? allInv.find(i=>i.id===oa.invloedMMWId) : null;
                  return (
                  <tr key={"io-oa-"+oa.id} style={{ background:P050 }}>
                    <td style={{...cL("center",false,V2,P050)}}><span style={{fontSize:9,fontWeight:700}}>↳</span></td>
                    <td style={cL("left",false,V2,P050)}>{oa.oaRefNr||oa.id}</td>
                    <td style={cL("left",false,T.textMuted,P050)}>{oa.datum||"—"}</td>
                    <td style={cL("left",false,T.textSub,P050)}>{oa.omschrijving}</td>
                    <td style={cL("right",false,T.textMuted,P050)}>{oa.aantal!=null?oa.aantal:"—"}</td>
                    <td style={cL("left",false,T.textMuted,P050)}>{oa.eenheid||"—"}</td>
                    <td style={cL("right",false,T.textMuted,P050)}>{oa.prijsPerEenheid?fmtN(oa.prijsPerEenheid):"—"}</td>
                    <td style={cL("right",false,T.textMuted,P050)}>{fmtN(oa.gemeld)}</td>
                    <td style={cL("right",oa.akkoord>0,oa.akkoord>0?V1:T.textMuted,P050)}>{oa.akkoord>0?fmtN(oa.akkoord):"—"}</td>
                    <td style={cL("right",false,T.textMuted,P050)}>{oa.io>0?fmtN(oa.io):"—"}</td>
                    <td style={cL("right",false,T.textMuted,P050)}/>
                    <td style={{ background:SEP, padding:0 }}/>
                    {memInv ? (
                      <>
                      <td style={{...cR("left",true,P600,P050), cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io, bestaand:memInv});}} title="Klik om de invloed MMW te bewerken (status, bedragen)">{memInv.oaNummer}</td>
                      <td style={{...cR("right",false,T.text,P050),padding:"1px 8px", cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io, bestaand:memInv});}}>{memInv.mmwBedragIoBijOG?fmtN(memInv.mmwBedragIoBijOG):"—"}</td>
                      <td style={{...cR("right",false,T.textSub,P050),padding:"1px 8px", cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io, bestaand:memInv});}}>{memInv.invloedInPrognose?fmtN(memInv.invloedInPrognose):"—"}</td>
                      <td style={{...cR("left",false,P600,P050), cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io, bestaand:memInv});}} title="Klik om de opmerking te wijzigen"><span style={{fontSize:9,fontWeight:400,color:T.textSub}}>{memInv.opmerking||"—"}</span></td>
                      </>
                    ) : (
                      <>
                      <td style={cR("left",false,P200,P050)}>—</td>
                      <td style={{...cR("right",false,P400,BLUE),padding:"1px 4px", cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io});}} title="Invloed MMW (vlak 3) toevoegen aan deze melding"><span style={{fontSize:9}}>+ invullen</span></td>
                      <td style={{...cR("right",false,P400,BLUE),padding:"1px 4px", cursor:"pointer"}} onClick={(e)=>{e.stopPropagation();setFormulier({oa, io});}}><span style={{fontSize:9}}>+ invullen</span></td>
                      <td style={cR("left",false,P200,P050)}/>
                      </>
                    )}
                  </tr>
                  );
                })}
                {open && oaItems.length>0 && (() => {
                  const somAkkG = oaItems.reduce((s,o)=>s+o.akkoord,0);
                  const corrG = (io.committed||0) - somAkkG;
                  return (
                  <Fragment>
                  <tr style={{ background:P100 }}>
                    <td colSpan={7} style={{...cL("right",false,V1,P100), fontSize:10, fontStyle:"italic"}}>Som akkoord OA-meldingen →</td>
                    <td style={cL("right",true,V1,P100)}>{fmtN(somAkkG)}</td>
                    <td colSpan={3} style={{...cL("left",false,T.textMuted,P100), fontSize:9}}>= basis inkooporder {io.id}</td>
                    <td style={{ background:SEP, padding:0 }}/>
                    <td colSpan={4} style={{ background:P100, padding:0 }}/>
                  </tr>
                  <tr style={{ background:V1bg }}>
                    <td colSpan={7} style={{...cL("right",false,corrG===0?V1:T.danger,V1bg), fontSize:10, fontStyle:"italic"}}>Correctieregel (IO-bedrag − som akkoord OA) →</td>
                    <td style={cL("right",true,corrG===0?V1:T.danger,V1bg)} title="Verschil tussen het 4PS-inkooporderbedrag en de som van de gekoppelde OA-meldingen (sluit het afrekenblad op het 4PS-bedrag)">{fmtN(corrG)}</td>
                    <td colSpan={3} style={{...cL("left",false,T.textMuted,V1bg), fontSize:9}}>{corrG===0?"sluit exact op 4PS-bedrag":"verschil t.o.v. OA-meldingen"}</td>
                    <td style={{ background:SEP, padding:0 }}/>
                    <td colSpan={4} style={{ background:V1bg, padding:0 }}/>
                  </tr>
                  </Fragment>
                  );
                })()}
                </>
              );
            })}
            {/* Totaalregel vlak 1 + 3 */}
            <tr style={{ background:V1bg, fontWeight:700 }}>
              <td colSpan={7} style={{...cL("left",true,V1,V1bg)}}>Totaal inkooporders</td>
              <td style={{...cL("right",true,T.text,V1bg), fontSize:13}}>{fmtN(totV1)}</td>
              <td style={cL("right",true,P600,V1bg)}>{fmtN(iosGoed.reduce((s,io)=>s+io.budgetOG,0))}</td>
              <td style={cL("right",true,LIMEDK,V1bg)}>{fmtN(iosGoed.reduce((s,io)=>s+io.risico,0))}</td>
              <td style={cL("center",false,"",V1bg)}/>
              <td style={{ background:SEP, padding:0 }}/>
              <td style={{...cR("left",true,V3,V3bg)}}>Totaal vlak 3</td>
              <td style={cR("right",true,T.textSub,V3bg)} title="Som MMW bedrag io bij OG (informatief, telt niet mee)">{totV3io?fmtN(totV3io):"—"}</td>
              <td style={cR("right",true,V3,V3bg)} title="Som invloed MMW in prognose (telt mee)">{fmtN(totV3)}</td>
              <td style={cR("left",false,"",V3bg)}/>
            </tr>
          </tbody>

          {/* ════ KRUIS — horizontale witte band tussen boven en onder ════ */}
          <tbody>
            <tr><td colSpan={16} style={{ height:SEPW, background:SEP, padding:0 }}/></tr>
          </tbody>

          {/* ════ ONDERSTE BLOK-RIJ: VLAK 2 (links) + VLAK 4 (rechts) ════ */}
          <thead style={{ position:"sticky", top:0, zIndex:5 }}>
            {/* Blok-koppen */}
            <tr>
              <th colSpan={11} style={{ padding:"9px 16px", background:KOP2, textAlign:"left" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                  <div>
                    <span style={{ fontSize:12, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>VLAK 2 · OA MMW MELDINGEN</span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.8)", marginLeft:10 }}>nog niet gekoppeld · {looseOA.length} meldingen</span>
                  </div>
                  <button onClick={()=>{setNieuwVoorKd(filterKd);setShowNieuw(true);}}
                    style={{ display:"inline-flex", alignItems:"center", gap:5, background:T.lime, color:T.purple, border:"none", borderRadius:6, padding:"5px 12px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                    + Nieuw OA MMW
                  </button>
                </div>
              </th>
              <th style={{ background:SEP, padding:0 }}/>
              <th colSpan={4} style={{ padding:"11px 16px", background:KOP4, textAlign:"left" }}>
                <span style={{ fontSize:12, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>VLAK 4 · INVLOED MMW OG</span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.8)", marginLeft:10 }}>zachte dekking</span>
              </th>
            </tr>
            {/* Kolomkoppen vlak 2 + 4 — klikbaar sorteren */}
            <tr>
              <th style={hL("center",V2bg)}/>
              <th style={{...hL("left",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("oaRefNr")}>Ref OA{sortArrow(sortV2.key==="oaRefNr",sortV2.dir)}{grip(1)}</th>
              <th style={{...hL("left",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("datum")}>Datum{sortArrow(sortV2.key==="datum",sortV2.dir)}{grip(2)}</th>
              <th style={{...hL("left",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("omschrijving")}>Omschrijving{sortArrow(sortV2.key==="omschrijving",sortV2.dir)}{grip(3)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("aantal")}>Aantal{sortArrow(sortV2.key==="aantal",sortV2.dir)}{grip(4)}</th>
              <th style={{...hL("left",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("eenheid")}>Eenheid{sortArrow(sortV2.key==="eenheid",sortV2.dir)}{grip(5)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("prijsPerEenheid")}>Prijs/eenh.{sortArrow(sortV2.key==="prijsPerEenheid",sortV2.dir)}{grip(6)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("gemeld")}>Gemeld{sortArrow(sortV2.key==="gemeld",sortV2.dir)}{grip(7)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("akkoord")}>Akkoord{sortArrow(sortV2.key==="akkoord",sortV2.dir)}{grip(8)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("io")}>In onderh.{sortArrow(sortV2.key==="io",sortV2.dir)}{grip(9)}</th>
              <th style={{...hL("right",V2bg),cursor:"pointer",position:"relative"}} onClick={()=>toggleSortV2("prognoseBedrag")}>MMW prognose{sortArrow(sortV2.key==="prognoseBedrag",sortV2.dir)}{grip(10)}</th>
              <th style={{ background:SEP, padding:0 }}/>
              <th style={{...hR("left",V4bg),position:"relative"}}>MMW nr{grip(12)}</th>
              <th style={{...hR("right",BLUE), color:"#1A1D23",position:"relative"}}>MMW bedrag<br/>io bij OG{grip(13)}</th>
              <th style={{...hR("right",BLUE), color:"#1A1D23",position:"relative"}}>Invloed MMW<br/>in prognose{grip(14)}</th>
              <th style={hR("left",V4bg)}>Opmerking</th>
            </tr>
          </thead>

          {/* Vlak 2 — concept-inkooporders (in fiattering) + nog niet gekoppelde OA-meldingen */}
          <tbody>
            {/* ─── Concept-inkooporders: nog niet goedgekeurd in ERP (blijven hier tot ERP-terugkoppeling) ─── */}
            {iosConcept.length>0 && (
              <tr><td colSpan={16} style={{ padding:"6px 12px", background:"#F7F3DF", borderBottom:`1px solid ${LIME}`, fontSize:10, fontWeight:800, color:LIMEDK, letterSpacing:0.4 }}>CONCEPT-INKOOPORDERS · in fiattering · {iosConcept.length} (worden hard zodra ERP goedkeurt)</td></tr>
            )}
            {iosConcept.map((io) => {
              const open = isOpen(io.id);
              const oaItems = oaVoorIO(io);
              const somAkk = oaItems.reduce((s,o)=>s+o.akkoord,0);
              const correctie = (io.committed||0) - somAkk;
              const cBg = "#FCFAE9";
              return (
                <Fragment key={"cio-"+io.id}>
                <tr style={{ background:cBg }}>
                  <td style={{...cL("center",false,LIMEDK,cBg), cursor:"pointer"}} onClick={()=>toggleIO(io.id)}>{open?"▾":"▸"}</td>
                  <td style={{...cL("left",true,P700,cBg), cursor:"pointer", textDecoration:"underline"}} onClick={()=>onSelectIO(io)} title="Open de inkoopactie van deze concept-IO">{io.id}</td>
                  <td style={cL("left",false,T.textMuted,cBg)}>{io.datum||"—"}</td>
                  <td style={cL("left",false,T.text,cBg)}>{io.omschrijving} <span style={{ fontSize:8, fontWeight:800, color:LIMEDK, background:"#fff", border:`1px solid ${LIME}`, borderRadius:10, padding:"1px 6px", marginLeft:4 }}>CONCEPT</span>{io.verzondenERP && <span style={{ fontSize:8, fontWeight:700, color:P600, marginLeft:6 }}>↗ verstuurd · in fiattering</span>}</td>
                  <td style={cL("right",false,T.textMuted,cBg)}/>
                  <td style={cL("left",false,T.textMuted,cBg)}/>
                  <td style={cL("right",false,T.textMuted,cBg)}/>
                  <td style={cL("right",true,T.text,cBg)} title="Concept inkooporderbedrag (4PS)">{fmtN(io.committed)}</td>
                  <td style={cL("right",somAkk>0,somAkk>0?V1:T.textMuted,cBg)} title="Som akkoord OA-meldingen">{somAkk>0?fmtN(somAkk):"—"}</td>
                  <td style={cL("right",false,T.textMuted,cBg)}/>
                  <td style={cL("right",false,T.textMuted,cBg)}/>
                  <td style={{ background:SEP, padding:0 }}/>
                  <td colSpan={4} style={{ ...cR("right",false,T.text,cBg), padding:"3px 8px" }}>
                    <div style={{ display:"flex", gap:6, justifyContent:"flex-end", alignItems:"center", flexWrap:"wrap" }}>
                      {!io.verzondenERP && (
                        <button onClick={(e)=>{e.stopPropagation();erpVerzend(io.id);}} title="Markeer als verstuurd naar 4PS (blijft concept, in fiattering)"
                          style={{ fontSize:9, fontWeight:700, color:P700, background:"#fff", border:`1px solid ${P300}`, borderRadius:5, padding:"3px 8px", cursor:"pointer" }}>↗ Verstuur naar 4PS</button>
                      )}
                      <button onClick={(e)=>{e.stopPropagation();erpGoedkeuren(io.id);}} title="Simuleer ERP-terugkoppeling: goedgekeurd → wordt hard (blok 1)"
                        style={{ fontSize:9, fontWeight:700, color:"#fff", background:P700, border:"none", borderRadius:5, padding:"3px 8px", cursor:"pointer" }}>✓ ERP: goedkeuren</button>
                      <button onClick={(e)=>{e.stopPropagation();erpAfkeuren(io.id);}} title="Simuleer ERP-terugkoppeling: afgekeurd → OA-meldingen komen weer los"
                        style={{ fontSize:9, fontWeight:700, color:T.danger, background:"#fff", border:`1px solid ${T.danger}`, borderRadius:5, padding:"3px 8px", cursor:"pointer" }}>✗ ERP: afkeuren</button>
                    </div>
                  </td>
                </tr>
                {open && oaItems.map((oa) => (
                  <tr key={"cio-oa-"+oa.id} style={{ background:"#FFFDF4" }}>
                    <td style={cL("center",false,V2,"#FFFDF4")}><span style={{fontSize:9,fontWeight:700}}>↳</span></td>
                    <td style={cL("left",false,V2,"#FFFDF4")}>{oa.oaRefNr||oa.id}</td>
                    <td style={cL("left",false,T.textMuted,"#FFFDF4")}>{oa.datum||"—"}</td>
                    <td style={cL("left",false,T.textSub,"#FFFDF4")}>{oa.omschrijving}</td>
                    <td style={cL("right",false,T.textMuted,"#FFFDF4")}>{oa.aantal!=null?oa.aantal:"—"}</td>
                    <td style={cL("left",false,T.textMuted,"#FFFDF4")}>{oa.eenheid||"—"}</td>
                    <td style={cL("right",false,T.textMuted,"#FFFDF4")}>{oa.prijsPerEenheid?fmtN(oa.prijsPerEenheid):"—"}</td>
                    <td style={cL("right",false,T.textMuted,"#FFFDF4")}>{fmtN(oa.gemeld)}</td>
                    <td style={cL("right",oa.akkoord>0,oa.akkoord>0?V1:T.textMuted,"#FFFDF4")}>{oa.akkoord>0?fmtN(oa.akkoord):"—"}</td>
                    <td style={cL("right",false,T.textMuted,"#FFFDF4")}>{oa.io>0?fmtN(oa.io):"—"}</td>
                    <td style={cL("right",false,T.textMuted,"#FFFDF4")}/>
                    <td style={{ background:SEP, padding:0 }}/>
                    <td colSpan={4} style={cR("left",false,T.textMuted,"#FFFDF4")}/>
                  </tr>
                ))}
                {open && (
                  <tr style={{ background:"#FBF6D9" }}>
                    <td colSpan={7} style={{...cL("right",false,LIMEDK,"#FBF6D9"), fontSize:10, fontStyle:"italic"}}>Correctieregel (IO-bedrag − som akkoord OA) →</td>
                    <td style={cL("right",true,correctie===0?V1:T.danger,"#FBF6D9")} title="Sluit het verschil tussen het 4PS-inkooporderbedrag en de som van de gekoppelde OA-meldingen (kan ontstaan door een 4PS-wijziging of een aanpassing bij het aanmaken)">{fmtN(correctie)}</td>
                    <td colSpan={3} style={{...cL("left",false,T.textMuted,"#FBF6D9"), fontSize:9}}>{correctie===0?"sluit exact op 4PS-bedrag":"verschil t.o.v. OA-meldingen"}</td>
                    <td style={{ background:SEP, padding:0 }}/>
                    <td colSpan={4} style={{ background:"#FBF6D9", padding:0 }}/>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {iosConcept.length>0 && (
              <tr><td colSpan={16} style={{ padding:"4px 12px", background:V2bg, borderBottom:`1px solid ${T.border}`, fontSize:9, fontWeight:700, color:T.textMuted, letterSpacing:0.3 }}>LOSSE OA-MELDINGEN · nog niet in een inkooporder</td></tr>
            )}
            {looseOA.length===0 && (
              <tr>
                <td colSpan={11} style={{padding:"14px",textAlign:"center",fontSize:11,color:T.textMuted,background:"#fff"}}>
                  Alle OA-meldingen zijn gekoppeld aan een inkooporder. Klap een IO in vlak 1 uit om de meldingen te zien.
                </td>
                <td style={{ background:SEP, padding:0 }}/>
                <td colSpan={4} style={{ background:"#fff", padding:0 }}/>
              </tr>
            )}
            {sortBy(looseOA, sortV2.key, sortV2.dir).map((oa, idx) => renderOaRow(oa, idx, null, true))}
            {/* Losstaande invloed MMW OG (vlak 4) zonder gekoppelde OA-melding — klikbaar om te bewerken */}
            {losseInvloed.map((iv, idx) => (
              <tr key={"losInv-"+iv.id} style={{ background: idx%2===0 ? V4row : V2alt, cursor:"pointer" }}
                  onClick={()=>setFormulier({oa:null, io:null, bestaand:iv})} title="Klik om dit zachte budget te bewerken">
                <td style={cL("center",false,"",V4row)}><span style={{display:"inline-block",width:6,height:6}}/></td>
                <td style={cL("left",true,V4,V4row)}><div style={{textDecoration:"underline"}}>{iv.id}</div><div style={{fontSize:9,color:T.textMuted,fontWeight:400}}>los zacht budget</div></td>
                <td style={cL("left",false,T.textSub,V4row)}>—</td>
                <td style={cL("left",false,"#1A1D23",V4row)}>{iv.omschrijving||"Invloed MMW OG"}</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={cL("left",false,T.textMuted,V4row)}>—</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={cL("right",false,T.textMuted,V4row)}>—</td>
                <td style={{background:SEP,padding:0}}/>
                <td style={cR("left",true,V4,V4bg)}>{iv.oaNummer||iv.id}</td>
                <td style={cR("right",true,"#1A1D23",V4bg)}>{fmtN(iv.mmwBedragIoBijOG)}</td>
                <td style={cR("right",false,V4,V4bg)}>{iv.invloedInPrognose?fmtN(iv.invloedInPrognose):"—"}</td>
                <td style={cR("left",false,T.textSub,V4bg)}><span style={{fontSize:9,fontWeight:400}}>{iv.opmerking||"—"}</span></td>
              </tr>
            ))}
            {/* Totaalregel vlak 2 + 4 */}
            <tr style={{ background:V2bg, fontWeight:700 }}>
              <td colSpan={7} style={{...cL("left",true,V2,V2bg)}}>Totaal losse OA-meldingen</td>
              <td style={cL("right",true,V2,V2bg)}>{fmtN(looseOA.reduce((s,o)=>s+o.gemeld,0))}</td>
              <td style={cL("right",true,V3,V2bg)}>{fmtN(looseOA.reduce((s,o)=>s+o.akkoord,0))}</td>
              <td style={cL("right",true,V2,V2bg)}>{fmtN(looseOA.reduce((s,o)=>s+o.io,0))}</td>
              <td style={cL("right",true,V3,V2bg)}>{fmtN(looseOA.reduce((s,o)=>s+(o.prognoseBedrag||0),0))}</td>
              <td style={{ background:SEP, padding:0 }}/>
              <td style={{...cR("left",true,V4,V4bg)}}>Totaal los zacht budget</td>
              <td style={cR("right",true,T.textSub,V4bg)} title="Som MMW bedrag io bij OG (vlak 4, informatief)">{totV4io?fmtN(totV4io):"—"}</td>
              <td style={cR("right",true,V4,V4bg)} title="Som invloed MMW in prognose (vlak 4)">{fmtN(totV4)}</td>
              <td style={cR("left",false,"",V4bg)}/>
            </tr>
            {/* ─── Historie: alle ooit gemelde OA MMW (vervallen of opgenomen in een goedgekeurde IO) — tellen NIET mee ─── */}
            {historieOA.length>0 && (
              <tr><td colSpan={16} style={{ padding:0 }}>
                <button onClick={()=>setHistOpen(h=>!h)} style={{ width:"100%", textAlign:"left", background:"#F3F0F6", border:"none", borderTop:`1px solid ${T.border}`, padding:"7px 12px", fontSize:10, fontWeight:700, color:T.textMuted, cursor:"pointer", letterSpacing:0.3 }}>
                  {histOpen?"▾":"▸"} HISTORIE · {historieOA.length} eerdere OA MMW-meldingen (vervallen of opgenomen in een goedgekeurde IO) — tellen niet mee
                </button>
              </td></tr>
            )}
            {histOpen && historieOA.map((oa) => {
              const inGoed = _goedOaIds.has(oa.id);
              return (
              <tr key={"hist-"+oa.id} style={{ background:"#FAFAFB" }}>
                <td style={cL("center",false,T.textMuted,"#FAFAFB")}>—</td>
                <td style={{...cL("left",false,T.textMuted,"#FAFAFB"), textDecoration:"line-through"}}>{oa.oaRefNr||oa.id}</td>
                <td style={cL("left",false,T.textMuted,"#FAFAFB")}>{oa.datum||"—"}</td>
                <td style={{...cL("left",false,T.textMuted,"#FAFAFB"), textDecoration:"line-through"}}>{oa.omschrijving}</td>
                <td style={cL("right",false,T.textMuted,"#FAFAFB")}>{oa.aantal!=null?oa.aantal:"—"}</td>
                <td style={cL("left",false,T.textMuted,"#FAFAFB")}>{oa.eenheid||"—"}</td>
                <td style={cL("right",false,T.textMuted,"#FAFAFB")}>{oa.prijsPerEenheid?fmtN(oa.prijsPerEenheid):"—"}</td>
                <td style={{...cL("right",false,T.textMuted,"#FAFAFB"), textDecoration:"line-through"}}>{fmtN(oa.gemeld)}</td>
                <td style={cL("right",false,T.textMuted,"#FAFAFB")}>{oa.akkoord>0?fmtN(oa.akkoord):"—"}</td>
                <td style={cL("right",false,T.textMuted,"#FAFAFB")}/>
                <td style={cL("left",false,T.textMuted,"#FAFAFB")}><span style={{ fontSize:8, fontWeight:700, color:inGoed?P500:"#B0392E", background:inGoed?P100:"#FBE9E7", borderRadius:10, padding:"1px 6px" }}>{inGoed?"in goedgekeurde IO":"vervallen"}</span></td>
                <td style={{ background:SEP, padding:0 }}/>
                <td colSpan={4} style={cR("left",false,T.textMuted,"#FAFAFB")}/>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── RISICODEKKING SCHERM ────────────────────────────────────────────────────
function RisicoScherm({ inkooporders, onUpdateRisico, selectedKd, onSelectKd }) {
  const [toonAlle, setToonAlle] = useState(false); // false = alleen geselecteerde KD
  const [sortV, setSortV]       = useState({key:"id", dir:"asc"});
  const [editId, setEditId]     = useState(null);
  const [editVal, setEditVal]   = useState("");
  const [editOpm, setEditOpm]   = useState("");
  const [openLog, setOpenLog]   = useState({});   // {ioId: bool} — uitgeklapte historie
  const filterKd = selectedKd || "2155008";
  const kd  = KOSTENDRAGERS.find(k => k.id === filterKd);
  const ios = toonAlle ? inkooporders : inkooporders.filter(io=>io.kdId===filterKd);

  // Paarse familie — gelijk aan Afrekenblad
  const P900="#3D0850", P800="#4F0A68", P700="#630D80", P600="#7A2E96",
        P500="#9450AC", P400="#B07FC4", P300="#CBA8D9", P200="#E3CEEC",
        P100="#F1E5F6", P050="#F8F2FB";
  const LIME="#C1E62E", LIMEDK="#9FBF1F";
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;

  // Totalen
  const totRisico    = ios.reduce((s,io)=>s+io.risico,0);
  const totCommitted = ios.reduce((s,io)=>s+io.committed,0);
  const iosMetRisico = ios.filter(io=>io.risico>0).length;
  const gemPct       = totCommitted>0 ? (totRisico/totCommitted*100) : 0;


  // Sorteren
  const toggleSort = (key) => setSortV(p => ({ key, dir: p.key===key && p.dir==="asc" ? "desc" : "asc" }));
  const sortArrow  = (active, dir) => active ? <span style={{fontSize:8,marginLeft:3,color:P600}}>{dir==="asc"?"▲":"▼"}</span> : <span style={{fontSize:8,marginLeft:3,color:"#ccc"}}>▲</span>;
  const sortedIos  = [...ios].sort((a,b) => {
    const k = sortV.key; let av=a[k], bv=b[k];
    if (typeof av==="string") { av=av.toLowerCase(); bv=(bv||"").toLowerCase(); }
    if (av<bv) return sortV.dir==="asc"?-1:1;
    if (av>bv) return sortV.dir==="asc"?1:-1;
    return 0;
  });

  const startEdit = (io) => { setEditId(io.id); setEditVal(String(io.risico)); setEditOpm(""); };
  const saveEdit  = (io) => {
    const oud = io.risico||0, nieuw = parseFloat(editVal)||0;
    let logEntry = null;
    if (nieuw !== oud) {
      logEntry = {
        datum: new Date().toLocaleDateString("nl-NL"),
        type:  nieuw < oud ? "vrijval" : "verhoging",
        bedrag: Math.abs(oud - nieuw),
        van: oud, naar: nieuw,
        opmerking: editOpm.trim() || (nieuw < oud ? "Handmatige vrijval risicodekking" : "Handmatige verhoging risicodekking"),
        bron: "handmatig",
      };
    }
    onUpdateRisico(io.id, nieuw, logEntry);
    setEditId(null); setEditVal(""); setEditOpm("");
  };
  const cancel    = () => { setEditId(null); setEditVal(""); setEditOpm(""); };

  // Mini risico-staaf (% van IO)
  const riskBar = (committed, risico) => {
    const ratio = committed>0 ? Math.min(1, risico/committed) : 0;
    const hoog = ratio > 0.10;
    return (
      <span style={{display:"inline-block",width:48,height:6,borderRadius:3,background:P100,overflow:"hidden",verticalAlign:"middle"}}>
        <span style={{display:"block",height:"100%",borderRadius:3,width:`${Math.round(ratio*100)}%`,background:hoog?LIME:P600}}/>
      </span>
    );
  };

  const th = { padding:"6px 10px", fontSize:9, fontWeight:700, color:"#555", textAlign:"left", background:P050, borderBottom:"2px solid rgba(0,0,0,0.15)", whiteSpace:"nowrap", letterSpacing:0.3, cursor:"pointer" };
  const cell = { padding:"7px 10px", fontSize:12, borderBottom:`1px solid #F2EEF6` };

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", minHeight:0, overflow:"hidden", fontFamily:"'Segoe UI',sans-serif", background:T.bg }}>

      {/* Toolbar — gelijk aan Afrekenblad */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>Risicodekking</span>
          {!toonAlle && (
            <>
              <span style={{ fontSize:11, color:T.textMuted }}>voor kostendrager</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.purpleFade, border:`1px solid ${T.purple}33`, borderRadius:6, padding:"4px 10px" }}>
                <span style={{ fontSize:12, fontWeight:700, color:T.purple }}>{filterKd}</span>
                <span style={{ fontSize:11, color:T.text }}>{kd?.naam}</span>
                <span style={{ fontSize:10, color:T.textMuted, borderLeft:`1px solid ${T.purple}33`, paddingLeft:6 }}>{getOA(filterKd)}</span>
              </span>
            </>
          )}
          {toonAlle && <span style={{ fontSize:11, color:T.textSub }}>alle kostendragers · {ios.length} inkooporders</span>}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={()=>setToonAlle(a=>!a)} style={{...(toonAlle?btnPrimary:btnSecondary), fontSize:11, padding:"5px 12px"}}>
            {toonAlle ? "✓ Alle kostendragers" : "Toon alle kostendragers"}
          </button>
          {!toonAlle && (
            <select value={filterKd} onChange={e=>onSelectKd(e.target.value)} style={{...selectSt,fontSize:11}}>
              {KOSTENDRAGERS.map(k=><option key={k.id} value={k.id}>{k.id} — {k.naam}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* KPI strip — paars-verloop, gelijk aan Afrekenblad */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, flexShrink:0 }}>
        {[
          {l:"Totaal risicodekking", v:fmt(totRisico),    c:P800, sub:"telt aan kostenkant"},
          {l:"Inkooporders",         v:fmt(totCommitted),  c:P600, sub:`${ios.length} IO's`},
          {l:"Met risicodekking",    v:`${iosMetRisico}/${ios.length}`, c:P500, sub:"inkooporders"},
          {l:"Gemiddeld % van IO",   v:`${gemPct.toFixed(1)}%`, c:P400, sub:"dekking t.o.v. order"},
        ].map(({l,v,c,sub})=>(
          <div key={l} style={{flex:1,background:P050,borderRadius:10,padding:"9px 13px",borderLeft:`4px solid ${c}`}}>
            <div style={{fontSize:9,fontWeight:700,color:c,textTransform:"uppercase",letterSpacing:0.4}}>{l}</div>
            <div style={{fontSize:17,fontWeight:800,color:T.text,marginTop:2,letterSpacing:-0.5}}>{v}</div>
            <div style={{fontSize:9,color:T.textMuted,marginTop:1}}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Tabel */}
      <div style={{ flex:1, overflow:"auto", minHeight:0, padding:"14px 16px" }}>
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, boxShadow:"0 1px 3px rgba(99,13,128,0.04)", overflow:"hidden" }}>
          {/* Blok-kop in paars-verloop */}
          <div style={{ padding:"11px 16px", background:KOP1 }}>
            <span style={{ fontSize:12, fontWeight:800, color:"#fff", letterSpacing:0.5 }}>RISICODEKKING PER INKOOPORDER</span>
            <span style={{ fontSize:10, color:"rgba(255,255,255,0.8)", marginLeft:10 }}>te verwachten kosten · telt mee aan de kostenkant</span>
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}>
            <colgroup>
              <col style={{width:90}}/><col/><col style={{width:130}}/><col style={{width:130}}/><col style={{width:150}}/><col style={{width:130}}/>
            </colgroup>
            <thead>
              <tr>
                <th style={th} onClick={()=>toggleSort("id")}>IO#{sortArrow(sortV.key==="id",sortV.dir)}</th>
                <th style={th} onClick={()=>toggleSort("omschrijving")}>Omschrijving{sortArrow(sortV.key==="omschrijving",sortV.dir)}</th>
                <th style={{...th,textAlign:"right"}} onClick={()=>toggleSort("committed")}>Inkooporder{sortArrow(sortV.key==="committed",sortV.dir)}</th>
                <th style={{...th,textAlign:"right"}} onClick={()=>toggleSort("risico")}>Risicodekking{sortArrow(sortV.key==="risico",sortV.dir)}</th>
                <th style={{...th,textAlign:"right",cursor:"default"}}>% van IO</th>
                <th style={{...th,textAlign:"right",cursor:"default"}}/>
              </tr>
            </thead>
            <tbody>
              {sortedIos.map((io, idx) => {
                const isEdit = editId===io.id;
                const pct    = io.committed>0 ? (io.risico/io.committed*100) : 0;
                const bg     = isEdit ? P050 : idx%2===0 ? T.surface : "#FCFAFD";
                const log    = io.risicoLog || [];
                const open   = !!openLog[io.id];
                return (
                  <Fragment key={io.id}>
                  <tr style={{ background:bg, borderBottom:`1px solid #F2EEF6` }}>
                    <td style={{...cell, fontWeight:800, color:P800}}>
                      {log.length>0 && (
                        <span onClick={()=>setOpenLog(p=>({...p,[io.id]:!p[io.id]}))}
                          style={{cursor:"pointer", marginRight:5, fontSize:9, color:P600}} title="Historie">{open?"▼":"▶"}</span>
                      )}
                      {io.id}
                      {log.length>0 && <span style={{fontSize:8,marginLeft:4,color:P400,fontWeight:600}}>{log.length}×</span>}
                    </td>
                    <td style={{...cell, color:T.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{io.omschrijving}</td>
                    <td style={{...cell, textAlign:"right", fontWeight:700}}>{fmtN(io.committed)}</td>
                    <td style={{...cell, textAlign:"right"}}>
                      {isEdit ? (
                        <input type="number" value={editVal} onChange={e=>setEditVal(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter")saveEdit(io);if(e.key==="Escape")cancel();}}
                          style={{...inputSt, width:110, textAlign:"right"}} autoFocus/>
                      ) : (
                        <span style={{ fontWeight:io.risico>0?700:400, color:io.risico>0?LIMEDK:T.textMuted }}>
                          {io.risico>0 ? fmtN(io.risico) : "—"}
                        </span>
                      )}
                    </td>
                    <td style={{...cell, textAlign:"right"}}>
                      {io.risico>0 ? (
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8 }}>
                          {riskBar(io.committed, io.risico)}
                          <span style={{ fontSize:11, color:T.textSub, width:40, textAlign:"right" }}>{pct.toFixed(1)}%</span>
                        </div>
                      ) : <span style={{ color:T.textMuted }}>—</span>}
                    </td>
                    <td style={{...cell, textAlign:"right"}}>
                      {isEdit ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end" }}>
                          <input value={editOpm} onChange={e=>setEditOpm(e.target.value)} placeholder="Reden / toelichting (voor de historie)…"
                            onKeyDown={e=>{if(e.key==="Enter")saveEdit(io);if(e.key==="Escape")cancel();}}
                            style={{...inputSt, width:210, fontSize:10, padding:"3px 7px"}}/>
                          <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                            <button onClick={()=>saveEdit(io)} style={{...btnPrimary, fontSize:10, padding:"3px 10px"}}>Opslaan</button>
                            <button onClick={cancel} style={{...btnSecondary, fontSize:10, padding:"3px 8px"}}>Annuleren</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={()=>startEdit(io)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 10px", fontSize:10, cursor:"pointer", color:T.purple, fontWeight:600 }}>
                          ✎ Aanpassen
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && log.length>0 && (
                    <tr style={{ background:P050 }}>
                      <td colSpan={6} style={{ padding:"0 10px 10px 28px" }}>
                        <div style={{ fontSize:9, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.4, padding:"8px 0 4px" }}>Historie risicodekking</div>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                          <thead>
                            <tr style={{ color:T.textMuted }}>
                              <td style={{textAlign:"left", fontWeight:600, padding:"3px 8px", fontSize:9, width:90}}>Datum</td>
                              <td style={{textAlign:"left", fontWeight:600, padding:"3px 8px", fontSize:9, width:80}}>Type</td>
                              <td style={{textAlign:"right", fontWeight:600, padding:"3px 8px", fontSize:9, width:90}}>Mutatie</td>
                              <td style={{textAlign:"right", fontWeight:600, padding:"3px 8px", fontSize:9, width:120}}>Van → naar</td>
                              <td style={{textAlign:"left", fontWeight:600, padding:"3px 8px", fontSize:9}}>Opmerking</td>
                            </tr>
                          </thead>
                          <tbody>
                            {log.map((e,i)=>(
                              <tr key={i} style={{ borderTop:`1px solid ${T.border}` }}>
                                <td style={{padding:"4px 8px", color:T.textSub}}>{e.datum}</td>
                                <td style={{padding:"4px 8px"}}>
                                  <span style={{fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:10, background:T.budgetLight, color:T.budget}}>{e.type==="vrijval"?"Vrijval":e.type}</span>
                                </td>
                                <td style={{padding:"4px 8px", textAlign:"right", fontWeight:700, color:T.budget}}>−{fmtN(e.bedrag)}</td>
                                <td style={{padding:"4px 8px", textAlign:"right", color:T.textSub}}>{fmtN(e.van)} → {fmtN(e.naar)}</td>
                                <td style={{padding:"4px 8px", color:T.text}}>{e.opmerking || <span style={{color:T.textMuted, fontStyle:"italic"}}>geen toelichting</span>}{e.bron && <span style={{fontSize:9, color:T.textMuted, marginLeft:6}}>via {e.bron}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background:P050, borderTop:`2px solid ${T.border}`, fontWeight:800 }}>
                <td style={{...cell, fontWeight:800, color:P800}} colSpan={2}>Totaal ({ios.length} IO&apos;s)</td>
                <td style={{...cell, textAlign:"right", fontWeight:800}}>{fmtN(totCommitted)}</td>
                <td style={{...cell, textAlign:"right", color:LIMEDK, fontWeight:800, fontSize:13}}>{fmtN(totRisico)}</td>
                <td style={{...cell, textAlign:"right", color:T.textMuted, fontSize:11}}>{gemPct.toFixed(1)}% gem.</td>
                <td style={cell}/>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
// ─── LAAG 2 — KOSTENDRAGERBEWAKING ────────────────────────────────────────────
// Financiële kern. De rekenmethodiek VERSCHILT per rubriektype:
//  • contractgebonden (R2,3,4,7,8): KEW uit inkooporders/afrekenblad (berekenKD hieronder)
//  • arbeid (R1,6): prognose = prognose-uren × uurtarief (berekenArbeid)
//  • materieel/ABK (R5): prognose = inzetduur × tarief per materieelstuk (berekenMaterieel)
// Alle drie leveren hetzelfde resultaatobject zodat de PER-lijst uniform blijft.
function _legeKD(extra) {
  return {
    invloedMMWprognose:0, mmwInPrognose:0, aangepastBudget:0, totBeschikbareBegr:0, contract:0, begrRegelsOpdr:0,
    reserveInkoop:0, risicodekking:0, geboektBis:0, inkoopresultaat:0, nogTeBoeken:0,
    totRestant:0, totRestantNogUitGeven:0, totOverige:0, overigeGeboekt:0, totBijstelling:0,
    oaTotaal:0, oaAkkoord:0, oaInBehandeling:0, oaOnderhandeling:0, oaPrognose:0, ogVerwacht:0, ogAkkoord:0, ogVlak3:0, ogVlak4:0,
    kew:0, besteed:0, nogTeBesteden:0, pctBesteed:0, prognoseResultaat:0, deltaVorige:0,
    ...extra,
  };
}

// Arbeid (R1, R6) — tijd-gebonden bewaking op uren.
function berekenArbeid(kd) {
  const a = kd.arbeid || { periodes:[] };
  const b = kd.begroting;
  const tarief       = a.uurtarief || 0;
  const begrooteUren = (a.periodes||[]).reduce((s,p)=>s+(p.begroot||0),0);
  const geboekteUren = (a.periodes||[]).reduce((s,p)=>s+(p.geboekt||0),0);
  const prognoseUren = a.prognoseUren!=null ? a.prognoseUren : begrooteUren;
  const aangepastBudget = b.origineel + b.mutaties + b.mmwBegroting;
  const besteed = geboekteUren * tarief;
  const kew     = prognoseUren * tarief;
  const prognoseResultaat = aangepastBudget - kew;
  return _legeKD({
    aangepastBudget, totBeschikbareBegr: aangepastBudget,
    kew, besteed, nogTeBesteden: kew - besteed, pctBesteed: kew!==0 ? besteed/kew*100 : 0,
    prognoseResultaat, deltaVorige: prognoseResultaat - (kd.resultaatVorigePeriode||0),
    _arbeid: { tarief, begrooteUren, geboekteUren, prognoseUren },
  });
}

// Materieel / ABK (R5) — tijd-gebonden bewaking op inzetduur per materieelstuk.
function berekenMaterieel(kd) {
  const b = kd.begroting;
  const stukken = kd.materieel || [];
  const begrote  = stukken.reduce((s,m)=>s+(m.begrootAantal||0)*(m.tarief||0), 0);
  const geboekt  = stukken.reduce((s,m)=>s+(m.geboektAantal||0)*(m.tarief||0), 0);
  const prognose = stukken.reduce((s,m)=>s+(m.prognoseAantal||0)*(m.tarief||0), 0);
  const aangepastBudget = b.origineel + b.mutaties + b.mmwBegroting;
  const prognoseResultaat = aangepastBudget - prognose;
  return _legeKD({
    aangepastBudget, totBeschikbareBegr: aangepastBudget,
    kew: prognose, besteed: geboekt, nogTeBesteden: prognose - geboekt, pctBesteed: prognose!==0 ? geboekt/prognose*100 : 0,
    prognoseResultaat, deltaVorige: prognoseResultaat - (kd.resultaatVorigePeriode||0),
    _materieel: { begrote, geboekt, prognose },
  });
}

function berekenKD(kd, ios, allOA, allInv, alleGebundeld) {
  if (kd.arbeid)    return berekenArbeid(kd);     // R1, R6 — uren-methodiek
  if (kd.materieel) return berekenMaterieel(kd);  // R5 — materieel-methodiek
  const b = kd.begroting;
  // ── MMW-aggregaten — KOMEN UIT HET AFREKENBLAD (laag 3 is de financiële waarheid) ──
  // OA-MMW uit oaData (vlak 2), OG-MMW (invloed) uit invloedData (vlak 3 + vlak 4).
  const oaRegels = (allOA || []);
  const alleGeb = alleGebundeld || new Set();
  // Vlak 2 = de LOSSE OA-meldingen (nog niet in een inkooporder). De laag-2 MMW-totalen
  // sluiten exact aan op de vlak-2 kolomtotalen op het afrekenblad.
  const looseOA = oaRegels.filter(o => !alleGeb.has(o.id));
  const oaTotaal        = looseOA.reduce((s,o)=>s+(o.gemeld||0), 0);    // = vlak 2 totaal kolom 'gemeld'
  const oaAkkoord       = looseOA.reduce((s,o)=>s+(o.akkoord||0), 0);   // = vlak 2 totaal kolom 'akkoord'
  const oaInBehandeling = looseOA.reduce((s,o)=>s+(o.io||0), 0);        // = vlak 2 totaal kolom 'in onderh.'
  const oaPrognose      = looseOA.reduce((s,o)=>s+(o.prognoseBedrag||0), 0); // = vlak 2 totaal 'MMW in prognose' (OA-leverancier)
  const ogRegels = (allInv || []);
  // Vlak 3 = invloed gekoppeld aan een gebundelde OA (zit in een inkooporder); vlak 4 = los.
  // De invloed volgt zijn OA-melding. Een invloed zonder eigen OA is alleen vlak 3 als hij rechtstreeks
  // op een inkooporder is ingevoerd. Iets kan dus nooit tegelijk in vlak 3 én vlak 4 staan.
  const inVlak3 = (i) => {
    if (i.oaId) return alleGeb.has(i.oaId);
    const oa = oaRegels.find(o=>o.invloedMMWId===i.id);
    if (oa) return alleGeb.has(oa.id);
    return (ios||[]).some(io => (io.invloedMMWIds||[]).includes(i.id));
  };
  // Invloed MMW in prognose = afrekenblad-kolom 'Invloed MMW in prognose' (invloedInPrognose) over vlak 3 + vlak 4.
  // NIET de kolom 'MMW bedrag io bij OG' (mmwBedragIoBijOG) — dat bedrag staat nog in onderhandeling met de OG.
  const ogVlak3   = ogRegels.filter(inVlak3).reduce((s,i)=>s+(i.invloedInPrognose||0), 0);          // vlak 3 — in prognose
  const ogVlak4   = ogRegels.filter(i=>!inVlak3(i)).reduce((s,i)=>s+(i.invloedInPrognose||0), 0);   // vlak 4 — in prognose
  const ogVerwacht= ogVlak3 + ogVlak4;                                              // = Invloed MMW in prognose (afrekenblad), vlak 3 + 4
  const ogAkkoord = ogRegels.filter(i=>(i.invloedInPrognose||0)>0).reduce((s,i)=>s+(i.invloedInPrognose||0), 0);
  // Reserve inkoop = RISICODEKKING uit het afrekenblad (som van risico per inkooporder, vlak 1).
  const risicodekking  = (ios||[]).reduce((s,io)=>s+(io.risico||0), 0);
  const reserveInkoop  = risicodekking;
  // ── BLOK 1 — begroting ──
  // Invloed MMW in prognose = som ogBedrag (kolom 'Invloed MMW in prognose') uit het afrekenblad, vlak 3 + 4.
  const invloedMMWprognose = ogVerwacht;
  const aangepastBudget    = b.origineel + b.mutaties + b.mmwBegroting;            // Begroting + Mutaties + MMW begroting
  const totBeschikbareBegr = aangepastBudget + invloedMMWprognose;                 // + Invloed MMW in prognose (uit afrekenblad)
  // ── BLOK 2 — inkooporders ──
  const contract       = kd.contracten.reduce((s,c)=>s+c.inkoopBedrag, 0);         // Uitbesteed contract
  const begrRegelsOpdr = kd.contracten.reduce((s,c)=>s+c.begrotingsregels, 0);
  const geboektBis     = kd.contracten.reduce((s,c)=>s+c.geboekteKostenBis, 0);
  const inkoopresultaat= begrRegelsOpdr - contract - reserveInkoop;                // Begrotingsregels − inkoopopdracht − reserve
  const nogTeBoeken    = contract - geboektBis;
  // ── BLOK 3 — restant budget (begrotingsregels nog niet omgezet naar IO) ──
  // Vrijval = vrijgevallen (wordt niet besteed). Nog uit te geven = bedrag − vrijval = toekomstige kost.
  const totRestant            = kd.restantBudget.reduce((s,r)=>s+(r.vrijval||0), 0);                       // vrijgevallen
  const totRestantNogUitGeven = kd.restantBudget.reduce((s,r)=>s+((r.bedrag||0)-(r.vrijval||0)), 0);       // telt mee in KEW
  // ── BLOK 4 — overige bestedingen ──
  const totOverige     = kd.overigeBestedingen.reduce((s,o)=>s+o.meenemenPrognose, 0);
  const overigeGeboekt = kd.overigeBestedingen.reduce((s,o)=>s+(o.geboektBis||0), 0);
  // ── BLOK 5 — bijstelling / reservering ──
  const totBijstelling = kd.bijstelling.reduce((s,x)=>s+x.meenemenPrognose, 0);
  // ── KOSTEN EINDE WERK ──
  // KEW = Inkoopbedrag + Reserve inkoop + MMW in prognose + Restant (nog uit te geven) + Overige + Bijstelling.
  // MMW in prognose (KOSTENKANT) = het OA-meerwerk dat we in prognose nemen = vlak 2 'MMW prognose'
  // (oaPrognose = de losse OA-meldingen, nog niet in een inkooporder). Dit is wat we de onderaannemer
  // EXTRA verwachten te betalen. Dit is NIET de OG-invloed (vlak 3+4 = invloedMMWprognose); die staat als
  // DEKKING in de beschikbare begroting. Beide zijn onafhankelijk: meerwerk is alleen resultaatneutraal voor
  // zover de OG-doorbelasting de OA-kost dekt. Validatie: bij MMW = 0 → KEW = 357.209, resultaat = −24.212.
  const mmwInPrognose  = oaPrognose;
  const kew            = contract + reserveInkoop + mmwInPrognose + totRestantNogUitGeven + totOverige + totBijstelling;
  // Besteed = geboekt op contract + overige bestedingen geboekt
  const besteed        = geboektBis + overigeGeboekt;
  const nogTeBesteden  = kew - besteed;
  const pctBesteed     = kew !== 0 ? (besteed / kew * 100) : 0;
  // Prognose resultaat = Beschikbare begroting incl. invloed MMW − KEW
  //  = beschikbare − inkoopbedrag − reserve − MMW in prognose − nog uit te geven − overige − bijstelling
  const prognoseResultaat = totBeschikbareBegr - kew;
  const deltaVorige    = prognoseResultaat - (kd.resultaatVorigePeriode||0);
  return {
    invloedMMWprognose, mmwInPrognose, aangepastBudget, totBeschikbareBegr, contract, begrRegelsOpdr,
    reserveInkoop, risicodekking, geboektBis,
    inkoopresultaat, nogTeBoeken, totRestant, totRestantNogUitGeven, totOverige, overigeGeboekt, totBijstelling,
    oaTotaal, oaAkkoord, oaInBehandeling, oaOnderhandeling:oaInBehandeling, oaPrognose, ogVerwacht, ogAkkoord, ogVlak3, ogVlak4,
    kew, besteed, nogTeBesteden, pctBesteed, prognoseResultaat, deltaVorige,
  };
}

function Kostendragerbewaking({ kdId, inkooporders, oaData, invloedData, onBack, onOpenAfrekenblad, onOpenRisico }) {
  // TBI-huisstijl, gelijk aan het afrekenblad
  const P900="#3D0850", P800="#4F0A68", P700="#630D80", P600="#7A2E96",
        P500="#9450AC", P400="#B07FC4", P300="#CBA8D9", P200="#E3CEEC",
        P100="#F1E5F6", P050="#F8F2FB";
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;

  const kd = getKdData(kdId);
  // Vrij invulbare waarden — lokale state, herberekent live. Hooks vóór de conditionele return.
  const [vrijvalArr, setVrijvalArr]   = useState(() => kd ? kd.restantBudget.map(r=>r.vrijval||0) : []);
  const [overigeArr, setOverigeArr]   = useState(() => kd ? kd.overigeBestedingen.map(o=>o.meenemenPrognose||0) : []);
  const [bijstRows, setBijstRows]     = useState(() => kd ? kd.bijstelling.map(x=>({ omschrijving:x.omschrijving||"", meenemenPrognose:x.meenemenPrognose||0 })) : []);

  if (!kd) {
    return (
      <div style={{ padding:40, fontFamily:"'Segoe UI',sans-serif" }}>
        <button onClick={onBack} style={btnSecondary}>← Terug</button>
        <div style={{ marginTop:20, color:T.textSub }}>Geen kostendragerbewaking-data voor {kdId}.</div>
      </div>
    );
  }
  const ios = inkooporders.filter(io=>io.kdId===kdId);
  const allOA = (oaData||[]).filter(o=>o.kdId===kdId);
  const allInv = invloedData.filter(i=>i.kdId===kdId);
  const alleGebundeld = new Set(ios.flatMap(io=>io.oaIds||[]));
  // Werk-kopie met de ingevulde waarden → live herberekening.
  // (Invloed MMW in prognose komt uit het afrekenblad en wordt in berekenKD afgeleid.)
  const kdWerk = {
    ...kd,
    restantBudget: kd.restantBudget.map((r,i)=>({ ...r, vrijval: vrijvalArr[i] ?? r.vrijval })),
    overigeBestedingen: kd.overigeBestedingen.map((o,i)=>({ ...o, meenemenPrognose: overigeArr[i] ?? o.meenemenPrognose })),
    bijstelling: bijstRows,
  };
  const c = berekenKD(kdWerk, ios, allOA, allInv, alleGebundeld);
  // Restant budget — vrijval
  const setVrijvalAt  = (i,v) => setVrijvalArr(prev => prev.map((x,j)=>j===i?(parseFloat(v)||0):x));
  const vrijvalAlles  = () => setVrijvalArr(kd.restantBudget.map(r=>r.bedrag||0));   // alles laten vrijvallen
  const vrijvalNiets  = () => setVrijvalArr(kd.restantBudget.map(()=>0));
  // Groepeer contracten per onderaannemer/leverancier (zoals KPS-opdrachtenblok)
  const contractGroepen = (() => {
    const g = {};
    kd.contracten.forEach((ct,idx)=>{
      const key = ct.leverancier;
      if (!g[key]) g[key] = { leverancier:ct.leverancier, crediteurNr:ct.crediteurNr, rijen:[] };
      g[key].rijen.push({ ...ct, _idx:idx });
    });
    return Object.values(g);
  })();
  // Overige bestedingen — meenemen in prognose
  const setOverigeAt  = (i,v) => setOverigeArr(prev => prev.map((x,j)=>j===i?(parseFloat(v)||0):x));
  const overigeAlles  = () => setOverigeArr(kd.overigeBestedingen.map(o=>o.geboektBis||0)); // neem alle geboekte over
  // Bijstelling / reservering — meerdere regels, omschrijving + bedrag
  const setBijstOmschr = (i,v) => setBijstRows(prev => prev.map((x,j)=>j===i?{...x, omschrijving:v}:x));
  const setBijstBedrag = (i,v) => setBijstRows(prev => prev.map((x,j)=>j===i?{...x, meenemenPrognose:(parseFloat(v)||0)}:x));
  const addBijst       = () => setBijstRows(prev => [...prev, { omschrijving:"Nieuwe bijstelling", meenemenPrognose:0 }]);
  const removeBijst    = (i) => setBijstRows(prev => prev.filter((_,j)=>j!==i));

  const eur2 = (n) => new Intl.NumberFormat("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2}).format(n??0);

  // Gedeelde celstijlen (afrekenblad-look)
  const blokKop = { background:KOP1, color:"#fff", padding:"8px 16px", fontWeight:700, fontSize:11, textTransform:"uppercase", letterSpacing:0.6 };
  const th2 = { padding:"8px 12px", textAlign:"left", fontSize:9, fontWeight:700, color:T.textSub, textTransform:"uppercase", letterSpacing:0.4, whiteSpace:"nowrap", background:T.bg, verticalAlign:"bottom" };
  const td2 = { padding:"7px 12px", fontSize:12, color:T.text, whiteSpace:"nowrap", verticalAlign:"middle" };
  const tdR = { ...td2, textAlign:"right", fontVariantNumeric:"tabular-nums" };
  const totRow = { borderTop:`2px solid ${T.border}`, fontWeight:700, background:P050 };
  const softCel = { ...tdR, background:P100, color:P700, fontWeight:600 };
  const tbl = { width:"100%", borderCollapse:"collapse", background:T.surface, border:`1px solid ${T.border}` };

  // KPI-kaarten bovenaan (zoals afrekenblad)
  const kpis = [
    { l:"Beschikbare begroting", v:c.totBeschikbareBegr, c:P800, sub:"incl. invloed MMW" },
    { l:"Kosten einde werk",     v:c.kew,                c:P600, sub:"prognose" },
    { l:"Geboekte kosten",       v:c.geboektBis,         c:P500, sub:"in BIS" },
    { l:"Nog te boeken",         v:c.nogTeBoeken,        c:P400, sub:"contract − geboekt" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bg, fontFamily:"'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif" }}>
      {/* Toolbar — identiek aan afrekenblad */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>KOS blad</span>
          <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.purpleFade, border:`1px solid ${T.purple}33`, borderRadius:6, padding:"4px 10px" }}>
            <span style={{ fontSize:12, fontWeight:700, color:T.purple }}>{kd.code}</span>
            <span style={{ fontSize:11, color:T.text }}>{kd.naam}</span>
          </span>
          <span style={{ fontSize:10, color:T.textMuted, borderLeft:`1px solid ${T.border}`, paddingLeft:10 }}>
            Uit PER-regels — begroting <b style={{ color:T.text }}>{fmt(kd.regelBegroting)}</b> · besteding <b style={{ color:P700 }}>{fmt(kd.regelBesteding)}</b>
            {!kd.heeftInkooplaag && <span style={{ marginLeft:8, color:T.textMuted, fontStyle:"italic" }}>· nog geen inkooplaag</span>}
          </span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={onBack} style={{ ...btnSecondary, fontSize:11, padding:"5px 12px" }}>← PER-lijst</button>
          {onOpenAfrekenblad && <button onClick={onOpenAfrekenblad} style={{ ...btnSecondary, fontSize:11, padding:"5px 12px" }}>Afrekenblad →</button>}
          {onOpenRisico && <button onClick={onOpenRisico} style={{ ...btnSecondary, fontSize:11, padding:"5px 12px" }}>Risicodekking →</button>}
        </div>
      </div>

      {/* KPI-strip — paars-verloop kaarten */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, flexShrink:0 }}>
        {kpis.map(k=>(
          <div key={k.l} style={{ flex:1, background:P050, borderRadius:10, padding:"9px 13px", borderLeft:`4px solid ${k.c}` }}>
            <div style={{ fontSize:9, fontWeight:700, color:k.c, textTransform:"uppercase", letterSpacing:0.4 }}>{k.l}</div>
            <div style={{ fontSize:17, fontWeight:800, color:T.text, marginTop:2, letterSpacing:-0.5 }}>{eur0(k.v)}</div>
            <div style={{ fontSize:9, color:T.textMuted, marginTop:1 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Resultaat & prognose-strip */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, flexShrink:0 }}>
        <div style={{ flex:1, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"9px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.4 }}>Resultaat vorige periode</div>
            <div style={{ fontSize:8, color:T.textMuted, marginTop:1 }}>laatst bevroren prognose</div>
          </div>
          <div style={{ fontSize:18, fontWeight:800, color:(kd.resultaatVorigePeriode||0)<0?T.danger:T.budget, letterSpacing:-0.5 }}>{eur0(kd.resultaatVorigePeriode)}</div>
        </div>
        <div style={{ flex:1, background:T.surface, border:`1px solid ${T.purple}33`, borderRadius:10, padding:"9px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, color:T.purple, textTransform:"uppercase", letterSpacing:0.4 }}>Prognose resultaat</div>
            <div style={{ fontSize:8, color:T.textMuted, marginTop:1 }}>beschikbare begroting − KEW</div>
          </div>
          <div style={{ fontSize:18, fontWeight:800, color:c.prognoseResultaat<0?T.danger:T.budget, letterSpacing:-0.5 }}>{eur0(c.prognoseResultaat)}</div>
        </div>
        <div style={{ flex:1, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"9px 13px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:9, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:0.4 }}>Δ Vorige prognose</div>
            <div style={{ fontSize:8, color:T.textMuted, marginTop:1 }}>t.o.v. vorige periode</div>
          </div>
          <div style={{ fontSize:18, fontWeight:800, color:c.deltaVorige<0?T.danger:c.deltaVorige>0?T.budget:T.textSub, letterSpacing:-0.5 }}>{eur0(c.deltaVorige)}</div>
        </div>
      </div>

      {/* Besteed-voortgang */}
      <div style={{ padding:"8px 16px 12px", background:T.surface, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:5 }}>
          <span style={{ fontSize:10, fontWeight:700, color:T.textSub, textTransform:"uppercase", letterSpacing:0.4 }}>Besteed t.o.v. kosten einde werk</span>
          <span style={{ fontSize:11, color:T.textSub }}>
            <strong style={{ color:P700 }}>{eur0(c.besteed)}</strong> besteed · {eur0(c.nogTeBesteden)} nog te besteden · <strong>{c.pctBesteed.toFixed(0)}%</strong>
          </span>
        </div>
        <div style={{ height:8, background:P100, borderRadius:4, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${Math.min(100, Math.max(0, c.pctBesteed))}%`, background:`linear-gradient(90deg, ${P600}, ${P400})`, borderRadius:4 }}/>
        </div>
      </div>

      {/* Scrollbare body met de 5 blokken */}
      <div style={{ flex:1, overflow:"auto", padding:"16px" }}>

        {/* BLOK 1 — BEGROTING */}
        <div style={{ borderRadius:10, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={blokKop}>Begroting</div>
          <table style={tbl}>
            <thead><tr>
              <th style={{...th2, width:"34%"}}></th>
              <th style={{...th2, textAlign:"right"}}>Begroting</th>
              <th style={{...th2, textAlign:"right"}}>Mutaties / overboekingen</th>
              <th style={{...th2, textAlign:"right"}}>MMW begroting</th>
              <th style={{...th2, textAlign:"right"}}>Invloed MMW in prognose</th>
              <th style={{...th2, textAlign:"right"}}>Beschikbare begroting incl. MMW</th>
            </tr></thead>
            <tbody>
              <tr style={totRow}>
                <td style={td2}>Totaal begroting</td>
                <td style={tdR}>{eur2(kd.begroting.origineel)}</td>
                <td style={tdR}>{eur2(kd.begroting.mutaties)}</td>
                <td style={tdR}>{eur2(kd.begroting.mmwBegroting)}</td>
                <td style={{...softCel}} title="Totaal invloed MMW OG (vlak 3 + vlak 4) uit het afrekenblad">{eur2(c.invloedMMWprognose)}</td>
                <td style={{...tdR, color:P700, fontWeight:800}}>{eur2(c.totBeschikbareBegr)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* BLOK 2 — INKOOPORDERS (zoals KPS, eigen huisstijl) */}
        <div style={{ borderRadius:10, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={blokKop}>Inkooporders</div>
          <div style={{ overflowX:"auto" }}>
          <table style={{ ...tbl, minWidth:1080 }}>
            <thead><tr>
              <th style={th2}>Contract­nummer</th>
              <th style={th2}>Onderaannemer / leverancier</th>
              <th style={{...th2, textAlign:"right"}} title="MMW in prognose uit vlak 2 van het afrekenblad">MMW</th>
              <th style={{...th2, textAlign:"center"}}>Status contract</th>
              <th style={{...th2, textAlign:"right"}}>Begr. regels opdracht</th>
              <th style={{...th2, textAlign:"right"}}>Inkoop opdracht</th>
              <th style={{...th2, textAlign:"right"}}>Reserve inkoop</th>
              <th style={{...th2, textAlign:"right"}}>Inkoop resultaat</th>
              <th style={{...th2, textAlign:"right"}}>Geboekte kosten</th>
              <th style={{...th2, textAlign:"right"}}>Nog te boeken</th>
              <th style={{...th2, textAlign:"right"}}>Totaal</th>
            </tr></thead>
            <tbody>
              {contractGroepen.map((g,gi)=>{
                const sub = g.rijen.reduce((a,ct)=>{
                  const mmw = ct._idx===0 ? c.mmwInPrognose : 0;   // MMW in prognose = vlak 2 afrekenblad (op de eerste inkooporder)
                  const res = ct._idx===0 ? c.reserveInkoop : 0;   // reserve inkoop (= risicodekking) op de eerste inkooporder
                  const ntb = Math.max(0, ct.inkoopBedrag - ct.geboekteKostenBis);
                  a.mmw+=mmw; a.begr+=ct.begrotingsregels; a.inkoop+=ct.inkoopBedrag; a.reserve+=res;
                  a.ir+=(ct.begrotingsregels-ct.inkoopBedrag-res); a.geboekt+=ct.geboekteKostenBis; a.ntb+=ntb;
                  a.totaal+=(ct.inkoopBedrag+res);
                  return a;
                }, {mmw:0,begr:0,inkoop:0,reserve:0,ir:0,geboekt:0,ntb:0,totaal:0});
                return (
                  <Fragment key={gi}>
                    {/* Groepskop — leverancier */}
                    <tr style={{ background:P100 }}>
                      <td colSpan={11} style={{ padding:"7px 12px", fontSize:12, fontWeight:800, color:P800 }}>
                        {g.leverancier} {g.crediteurNr && <span style={{ fontWeight:600, color:P500, marginLeft:6 }}>{g.crediteurNr}</span>}
                      </td>
                    </tr>
                    {g.rijen.map((ct)=>{
                      const mmw = ct._idx===0 ? c.mmwInPrognose : 0;   // MMW in prognose = vlak 2 afrekenblad
                      const res = ct._idx===0 ? c.reserveInkoop : 0;
                      const ir = ct.begrotingsregels - ct.inkoopBedrag - res;     // Begr.regels − inkoopopdracht − reserve
                      const ntb = Math.max(0, ct.inkoopBedrag - ct.geboekteKostenBis);
                      const totaal = ct.inkoopBedrag + res;                       // verwachte kosten inkooporder = inkoop + reserve
                      return (
                        <tr key={ct.id} style={{ borderTop:`1px solid ${T.border}` }}>
                          <td style={{...td2, color:P700, fontWeight:600, cursor:"pointer", textDecoration:"underline"}}
                              onClick={onOpenAfrekenblad} title="Open afrekenblad (MMW-detail)">{ct.id}</td>
                          <td style={{...td2, cursor:"pointer"}} onClick={onOpenAfrekenblad}>
                            <span style={{ color:P700 }}>{ct.omschrijving}</span>
                          </td>
                          <td style={tdR} title={ct._idx===0?"MMW in prognose = vlak 2 afrekenblad (losse OA-meldingen)":""}>{mmw ? eur2(mmw) : "€ 0,00"}</td>
                          <td style={{...td2, textAlign:"center"}}>
                            <span style={{ fontSize:10, fontWeight:700, padding:"1px 8px", borderRadius:10, background:P100, color:P700 }}>{ct.status}</span>
                          </td>
                          <td style={tdR}>{eur2(ct.begrotingsregels)}</td>
                          <td style={tdR}>{eur2(ct.inkoopBedrag)}</td>
                          <td style={tdR} title={ct._idx===0?"Reserve inkoop = risicodekking uit afrekenblad":""}>{eur2(res)}</td>
                          <td style={{...tdR, fontWeight:700, color:ir<0?T.danger:T.budget}}>{eur2(ir)}</td>
                          <td style={tdR}>{eur2(ct.geboekteKostenBis)}</td>
                          <td style={tdR}>{ntb>0.005 ? eur2(ntb) : "€ 0,00"}</td>
                          <td style={{...tdR, fontWeight:700}}>{eur2(totaal)}</td>
                        </tr>
                      );
                    })}
                    {/* Subtotaal per leverancier */}
                    <tr style={{ background:P050, fontWeight:700, borderTop:`1px solid ${T.border}` }}>
                      <td colSpan={2} style={td2}>Totaal {g.leverancier}</td>
                      <td style={tdR}>{eur2(sub.mmw)}</td>
                      <td style={td2}></td>
                      <td style={tdR}>{eur2(sub.begr)}</td>
                      <td style={tdR}>{eur2(sub.inkoop)}</td>
                      <td style={tdR}>{eur2(sub.reserve)}</td>
                      <td style={{...tdR, color:sub.ir<0?T.danger:T.budget}}>{eur2(sub.ir)}</td>
                      <td style={tdR}>{eur2(sub.geboekt)}</td>
                      <td style={tdR}>{eur2(sub.ntb)}</td>
                      <td style={{...tdR, fontWeight:700}}>{eur2(sub.totaal)}</td>
                    </tr>
                  </Fragment>
                );
              })}
              {/* Grand total */}
              <tr style={{ background:P200, fontWeight:800, borderTop:`2px solid ${P300}` }}>
                <td colSpan={2} style={{...td2, color:P800}}>Totaal inkooporders</td>
                <td style={{...tdR, color:P800}} title="MMW in prognose = vlak 2 afrekenblad">{eur2(c.mmwInPrognose)}</td>
                <td style={td2}></td>
                <td style={{...tdR, color:P800}}>{eur2(c.begrRegelsOpdr)}</td>
                <td style={{...tdR, color:P800}}>{eur2(c.contract)}</td>
                <td style={{...tdR, color:P800}}>{eur2(c.reserveInkoop)}</td>
                <td style={{...tdR, color:c.inkoopresultaat<0?T.danger:T.budget}}>{eur2(c.inkoopresultaat)}</td>
                <td style={{...tdR, color:P800}}>{eur2(c.geboektBis)}</td>
                <td style={{...tdR, color:P800}}>{eur2(kd.contracten.reduce((s,ct)=>s+Math.max(0,ct.inkoopBedrag-ct.geboekteKostenBis),0))}</td>
                <td style={{...tdR, color:P800}}>{eur2(c.contract + c.reserveInkoop)}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <div style={{ background:P050, padding:"6px 12px", fontSize:10, color:T.textSub, borderTop:`1px solid ${T.border}` }}>
            Klik op een inkooporder om het afrekenblad te openen (volledig MMW-detail). <strong style={{color:P700}}>Inkoop resultaat = begrotingsregels − inkoopopdracht − reserve</strong>. <strong style={{color:P700}}>Totaal = inkoopopdracht + reserve inkoop</strong> = de verwachte kosten van de inkooporders. Reserve inkoop = risicodekking uit het afrekenblad (€{eur0(c.reserveInkoop)}).
          </div>
        </div>

        {/* BLOK 3 — RESTANT BUDGET */}
        <div style={{ borderRadius:10, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{...blokKop, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span>Restant budget · nog niet omgezet naar inkooporder</span>
            <span style={{ display:"flex", gap:6 }}>
              <ActieKnop onClick={vrijvalAlles} title="Geef alle restant-budgetregels volledig vrij">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
                Alles laten vrijvallen
              </ActieKnop>
              <ActieKnop onClick={vrijvalNiets} variant="ghost" title="Zet alle vrijval terug op 0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
                Reset
              </ActieKnop>
            </span>
          </div>
          <table style={tbl}>
            <thead><tr>
              <th style={th2}>Regel</th>
              <th style={th2}>Omschrijving</th>
              <th style={th2}>MMW nr</th>
              <th style={th2}>Mutatie</th>
              <th style={{...th2, textAlign:"right"}}>Aantal</th>
              <th style={th2}>Eenheid</th>
              <th style={{...th2, textAlign:"right"}}>Prijs</th>
              <th style={{...th2, textAlign:"right"}}>Bedrag</th>
              <th style={{...th2, textAlign:"right"}}>Vrijval / in kosten</th>
              <th style={{...th2, textAlign:"right"}}>Nog uit te geven</th>
              <th style={th2}>Status</th>
              <th style={th2}>Opmerking</th>
            </tr></thead>
            <tbody>
              {kd.restantBudget.map((r,i)=>{
                const vr = vrijvalArr[i] ?? r.vrijval;
                const nogUit = (r.bedrag||0) - (vr||0);
                const volledig = Math.abs(nogUit) < 0.005;
                return (
                <tr key={r.regel} style={{ borderTop:`1px solid ${T.border}` }}>
                  <td style={tdR}>{r.regel}</td>
                  <td style={td2}>{r.omschrijving}</td>
                  <td style={{...td2, color:P600}}>{r.mmwNr}</td>
                  <td style={{...td2, color:T.textSub}}>{r.mutatie}</td>
                  <td style={tdR}>{r.aantal}</td>
                  <td style={td2}>{r.eenheid}</td>
                  <td style={{...tdR, cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted", color:P700}}
                      onClick={()=>setVrijvalAt(i, r.bedrag)} title="Klik om dit bedrag te laten vrijvallen">{eur2(r.bedrag)}</td>
                  <td style={{...softCel, padding:"3px 6px"}}><PaarsInput value={vr} onChange={v=>setVrijvalAt(i,v)}/></td>
                  <td style={{...tdR, color:nogUit>0.005?T.danger:T.textSub}}>{eur2(nogUit)}</td>
                  <td style={{...td2, fontSize:10}}>{(() => { const m = BR_STATUS[budgetregelStatus(r, inkooporders)]; return <span style={{ color:m.kleur, fontWeight:700, background:m.kleur+"18", borderRadius:9, padding:"1px 7px", whiteSpace:"nowrap" }}>{m.label}</span>; })()}</td>
                  <td style={{...td2, fontSize:10, color:volledig?"#3F8F6B":T.textMuted}}>{volledig ? "✓ vrijgevallen" : (r.opmerking||"")}</td>
                </tr>
                );
              })}
              <tr style={totRow}>
                <td colSpan={7} style={td2}>Totaal restant budget</td>
                <td style={tdR}>{eur2(kd.restantBudget.reduce((s,r)=>s+(r.bedrag||0),0))}</td>
                <td style={softCel}>{eur2(c.totRestant)}</td>
                <td style={{...tdR, color:c.totRestantNogUitGeven>0?T.danger:T.textSub}}>{eur2(c.totRestantNogUitGeven)}</td>
                <td style={td2}></td>
                <td style={td2}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* BLOK 4 + 5 — OVERIGE BESTEDINGEN + BIJSTELLING */}
        <div style={{ borderRadius:10, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{...blokKop, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span>Overige bestedingen &amp; bijstelling / reservering</span>
            <ActieKnop onClick={overigeAlles} title="Neem alle geboekte bedragen over in de prognose">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
              Geboekt → prognose (alles)
            </ActieKnop>
          </div>
          <table style={tbl}>
            <thead><tr>
              <th style={{...th2, width:"50%"}}></th>
              <th style={{...th2, textAlign:"right"}}>Geboekt BIS</th>
              <th style={{...th2, textAlign:"right"}}>Meenemen in prognose</th>
              <th style={{...th2, width:34}}></th>
            </tr></thead>
            <tbody>
              <tr style={{ borderTop:`1px solid ${T.border}`, fontWeight:700, background:P050 }}>
                <td style={td2}>Overige bestedingen</td><td/><td/><td/>
              </tr>
              {kd.overigeBestedingen.map((o,i)=>(
                <tr key={i} style={{ borderTop:`1px solid ${T.border}` }}>
                  <td style={{...td2, color:P700, paddingLeft:24}}>{o.omschrijving}</td>
                  <td style={{...tdR, cursor:"pointer", textDecoration:"underline", textDecorationStyle:"dotted", color:P700}}
                      onClick={()=>setOverigeAt(i, o.geboektBis)} title="Klik om dit geboekte bedrag mee te nemen in de prognose">{eur2(o.geboektBis)}</td>
                  <td style={{...softCel, padding:"3px 6px"}}><PaarsInput value={overigeArr[i] ?? o.meenemenPrognose} onChange={v=>setOverigeAt(i,v)}/></td>
                  <td style={td2}></td>
                </tr>
              ))}
              <tr style={{ fontWeight:700 }}>
                <td style={{...td2, paddingLeft:24}}>Totaal overige bestedingen</td>
                <td style={tdR}>{eur2(kd.overigeBestedingen.reduce((s,o)=>s+o.geboektBis,0))}</td>
                <td style={tdR}>{eur2(c.totOverige)}</td>
                <td style={td2}></td>
              </tr>
              <tr style={{ borderTop:`1px solid ${T.border}`, fontWeight:700, background:P050 }}>
                <td style={td2}>Bijstelling / reservering</td><td/><td/>
                <td style={{...td2, textAlign:"right"}}>
                  <button onClick={addBijst} title="Regel toevoegen" style={{ fontSize:13, fontWeight:800, lineHeight:1, width:20, height:20, borderRadius:5, border:"none", background:P600, color:"#fff", cursor:"pointer" }}>+</button>
                </td>
              </tr>
              {bijstRows.map((x,i)=>(
                <tr key={i} style={{ borderTop:`1px solid ${T.border}` }}>
                  <td style={{ ...td2, paddingLeft:24, paddingRight:8 }}>
                    <input value={x.omschrijving} onChange={e=>setBijstOmschr(i, e.target.value)} placeholder="Omschrijving"
                      style={{ width:"100%", border:`1px solid ${T.border}`, borderRadius:5, padding:"3px 7px", fontSize:12, color:P700, fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
                  </td>
                  <td style={tdR}></td>
                  <td style={{...softCel, padding:"3px 6px"}}><PaarsInput value={x.meenemenPrognose} onChange={v=>setBijstBedrag(i,v)}/></td>
                  <td style={{...td2, textAlign:"center"}}>
                    <button onClick={()=>removeBijst(i)} title="Regel verwijderen" style={{ fontSize:13, lineHeight:1, width:20, height:20, borderRadius:5, border:`1px solid ${T.border}`, background:"transparent", color:T.danger, cursor:"pointer" }}>×</button>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight:700 }}>
                <td style={{...td2, paddingLeft:24}}>Totaal bijstelling / reservering</td>
                <td style={tdR}></td>
                <td style={tdR}>{eur2(c.totBijstelling)}</td>
                <td style={td2}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* BEREKENING — prognose kosten einde werk (optelling 6 elementen) + resultaat */}
        <div style={{ borderRadius:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
          <div style={blokKop}>Prognose kosten einde werk &amp; resultaat</div>
          <table style={{ width:"100%", borderCollapse:"collapse", background:T.surface, border:`1px solid ${T.border}` }}>
            <tbody>
              {/* Stap 1 — opbouw KEW: optelling van de zes elementen */}
              {[
                { l:"Totaal inkooporders",                   v:c.contract },
                { l:"Totaal reserve",                        v:c.reserveInkoop },
                { l:"Totaal meerwerk in prognose (OA · vlak 2)", v:c.mmwInPrognose },
                { l:"Nog uit te geven restant budgetregels", v:c.totRestantNogUitGeven },
                { l:"Overige bestedingen",                   v:c.totOverige },
                { l:"Bijstelling / reservering",             v:c.totBijstelling },
              ].map((row,i)=>(
                <tr key={i} style={{ borderTop: i===0?"none":`1px solid ${T.border}` }}>
                  <td style={{ padding:"7px 14px", fontSize:12, color:T.text }}>
                    <span style={{ display:"inline-block", width:14, color:T.textMuted, fontWeight:700 }}>{i===0?"":"+"}</span>
                    {row.l}
                  </td>
                  <td style={{ padding:"7px 14px", textAlign:"right", fontSize:12, fontWeight:600, fontVariantNumeric:"tabular-nums", color:T.text }}>
                    {eur2(Math.abs(row.v) < 0.005 ? 0 : row.v)}
                  </td>
                </tr>
              ))}
              {/* = Prognose kosten einde werk */}
              <tr style={{ background:P100, borderTop:`2px solid ${P300}` }}>
                <td style={{ padding:"9px 14px", fontSize:12, fontWeight:800, color:P800 }}>= Prognose kosten einde werk</td>
                <td style={{ padding:"9px 14px", textAlign:"right", fontSize:13, fontWeight:800, fontVariantNumeric:"tabular-nums", color:P800 }}>{eur2(c.kew)}</td>
              </tr>
              {/* Stap 2 — resultaat = beschikbare begroting − KEW */}
              <tr style={{ borderTop:`3px solid ${T.border}` }}>
                <td style={{ padding:"7px 14px", fontSize:12, fontWeight:700, color:P800 }}>
                  <span style={{ display:"inline-block", width:14 }}></span>Beschikbare begroting incl. invloed MMW
                </td>
                <td style={{ padding:"7px 14px", textAlign:"right", fontSize:12, fontWeight:700, fontVariantNumeric:"tabular-nums", color:P800 }}>{eur2(c.totBeschikbareBegr)}</td>
              </tr>
              <tr style={{ borderTop:`1px solid ${T.border}` }}>
                <td style={{ padding:"7px 14px", fontSize:12, color:T.text }}>
                  <span style={{ display:"inline-block", width:14, color:T.textMuted, fontWeight:700 }}>−</span>Prognose kosten einde werk
                </td>
                <td style={{ padding:"7px 14px", textAlign:"right", fontSize:12, fontWeight:600, fontVariantNumeric:"tabular-nums", color:T.danger }}>{eur2(c.kew)}</td>
              </tr>
              <tr style={{ background:KOP1 }}>
                <td style={{ padding:"11px 14px", fontSize:13, fontWeight:800, color:"#fff" }}>= Prognose resultaat</td>
                <td style={{ padding:"11px 14px", textAlign:"right", fontSize:16, fontWeight:800, fontVariantNumeric:"tabular-nums",
                             color:c.prognoseResultaat<0?"#FF9BB0":"#C1E62E" }}>{eur0(c.prognoseResultaat)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ background:P050, padding:"7px 14px", fontSize:10, color:T.textSub, borderTop:`1px solid ${T.border}` }}>
            De kostendrager-contractenmethodiek bepaalt alleen de kostenkant. <strong style={{color:P700}}>Prognose kosten einde werk = som van de zes elementen</strong>. Het <strong style={{color:P700}}>meerwerk in prognose</strong> is het OA-meerwerk uit vlak 2 (wat we de onderaannemer extra verwachten te betalen). Prognose resultaat = beschikbare begroting incl. invloed MMW OG − kosten einde werk. Meerwerk is resultaatneutraal voor zover de OG-doorbelasting (vlak 3 + 4) de OA-kost dekt.
          </div>
        </div>

      </div>
    </div>
  );
}


// ─── LAAG 2 — BEWAKING OP ARBEID (rubriek 1 + 6) ──────────────────────────────
// Tijd-gebonden bewaking op uren. Prognose kosten einde werk = prognose-uren × uurtarief.
function BewakingArbeid({ kdId, onBack }) {
  const P900="#3D0850", P800="#4F0A68", P700="#630D80", P600="#7A2E96", P200="#E3CEEC", P100="#F1E5F6", P050="#F8F2FB";
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;
  const entry = (KD_BEWAKING[kdId] && KD_BEWAKING[kdId].arbeid)
    ? [kdId, KD_BEWAKING[kdId]]
    : Object.entries(KD_BEWAKING).find(([,k])=>k.arbeid);
  const [uta, setUta]         = useState(() => entry ? (entry[1].arbeid.periodes||[]).map(p=>p.geboekt||0) : []);
  const [progM, setProgM]     = useState("geboekt");
  const [tkPer, setTkPer]     = useState("");
  const [tkUren, setTkUren]   = useState("");
  const [progHand, setProgHand] = useState("");
  if (!entry) return (
    <div style={{ padding:40, fontFamily:"'Segoe UI',sans-serif" }}>
      <button onClick={onBack} style={{ border:`1px solid ${T.border}`, background:"#fff", borderRadius:8, padding:"7px 14px", cursor:"pointer" }}>← PER-lijst</button>
      <div style={{ marginTop:20, color:T.textSub }}>Geen arbeids-kostendrager beschikbaar.</div>
    </div>
  );
  const [id, kd] = entry;
  const kdMeta = getKdData(kdId);   // PER-regels van de AANGEKLIKTE kostencode (begroting/besteding)
  const c = berekenArbeid(kd);
  const A = c._arbeid;
  const u0   = (v)=>new Intl.NumberFormat("nl-NL",{maximumFractionDigits:0}).format(Math.round(v||0));
  const rest = A.prognoseUren - A.geboekteUren;
  let cum=0;
  const rows = (kd.arbeid.periodes||[]).map(p=>{ cum+=(p.geboekt||0); return { ...p, cum }; });
  const maxU = Math.max(1, ...(kd.arbeid.periodes||[]).map(p=>Math.max(p.begroot||0, p.geboekt||0)));
  const rood = c.prognoseResultaat<0;

  const Card = ({ label, val, sub, kleur }) => (
    <div style={{ flex:1, minWidth:130, background:"#fff", border:`1px solid ${T.border}`, borderRadius:10, padding:"11px 13px" }}>
      <div style={{ fontSize:10, color:T.textSub, textTransform:"uppercase", letterSpacing:0.4, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color:kleur||T.text, marginTop:3 }}>{val}</div>
      {sub && <div style={{ fontSize:10, color:T.textMuted, marginTop:1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"auto", background:T.bg, fontFamily:"'Segoe UI',-apple-system,sans-serif" }}>
      {/* Toolbar */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
        <button onClick={onBack} style={{ border:`1px solid ${T.border}`, background:"#fff", borderRadius:8, padding:"6px 12px", cursor:"pointer", fontSize:12, fontWeight:600, color:T.textSub }}>← PER-lijst</button>
        <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>Bewaking op arbeid</span>
        <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:10, background:"#5B647022", color:"#5B6470", border:"1px solid #5B647044" }}>ARBEID · UREN</span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.purpleFade, border:`1px solid ${T.purple}33`, borderRadius:6, padding:"4px 10px", marginLeft:4 }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.purple }}>{kdMeta.code}</span>
          <span style={{ fontSize:11, color:T.text, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{kdMeta.naam}</span>
        </span>
        <span style={{ fontSize:10, color:T.textMuted, borderLeft:`1px solid ${T.border}`, paddingLeft:10 }}>
          Uit PER-regels — begroting <b style={{ color:T.text }}>{fmt(kdMeta.regelBegroting)}</b> · besteding <b style={{ color:P700 }}>{fmt(kdMeta.regelBesteding)}</b>
        </span>
      </div>

      {/* Kop */}
      <div style={{ background:KOP1, color:"#fff", padding:"16px 18px", flexShrink:0 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontSize:12, opacity:0.8 }}>Rubriek {kd.rubriek} · {RUBRIEKEN[kd.rubriek]} — {kd.code}</div>
            <div style={{ fontSize:20, fontWeight:800 }}>{kd.naam}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, opacity:0.8 }}>Prognose resultaat</div>
            <div style={{ fontSize:24, fontWeight:800, color:rood?"#FFB4C0":"#C1E62E" }}>{eur0(c.prognoseResultaat)}</div>
          </div>
        </div>
      </div>

      <div style={{ padding:16 }}>
        {/* KPI's — uren */}
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 }}>
          <Card label="Begrote uren"  val={u0(A.begrooteUren)} sub={eur0(c.aangepastBudget)} />
          <Card label="Geboekte uren" val={u0(A.geboekteUren)} sub={eur0(c.besteed)} kleur={P700} />
          <Card label="Prognose uren" val={u0(A.prognoseUren)} sub={eur0(c.kew)} kleur={rood?T.danger:T.text} />
          <Card label="Restant uren (prognose − geboekt)" val={u0(rest)} sub={eur0(c.nogTeBesteden)} />
          <Card label="Uurtarief" val={eur0(A.tarief)} sub="per uur" />
        </div>

        {/* ─── Periode-toewijzing · uren × tarief (UTA-voorstel) ─── */}
        {(() => {
          const per = kd.arbeid.periodes||[];
          const tarief = A.tarief;
          const begroot = per.map(p=>p.begroot||0);
          const somBegroot = begroot.reduce((a,b)=>a+b,0);
          const somGeboekt = uta.reduce((a,b)=>a+(parseFloat(b)||0),0);
          const nGeboekt = uta.filter(u=>(parseFloat(u)||0)>0).length || 1;
          let progUren;
          if (progM==="geboekt") progUren = somGeboekt;
          else if (progM==="begroot") progUren = somBegroot;
          else if (progM==="extrapolatie") progUren = Math.round(somGeboekt / nGeboekt * per.length);
          else progUren = parseFloat(progHand)||somGeboekt;
          const setUur = (i,v)=>setUta(arr=>arr.map((x,j)=>j===i?v:x));
          const kenToe = ()=>{ const idx=per.findIndex(p=>String(p.periode)===tkPer); if(idx>=0){ const add=parseFloat(tkUren)||0; setUta(arr=>arr.map((x,j)=>j===idx?((parseFloat(x)||0)+add):x)); setTkUren(""); } };
          const pl = (pp)=>`${String(pp%100).padStart(2,"0")}-${Math.floor(pp/100)}`;
          return (
          <div style={{ borderRadius:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", marginBottom:14, border:`1px solid ${T.border}` }}>
            <div style={{ background:KOP1, color:"#fff", padding:"9px 14px", fontSize:13, fontWeight:700, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <span>Periode-toewijzing · uren × tarief (UTA)</span>
              <span style={{ fontSize:10, fontWeight:600, opacity:0.85 }}>voorstel — boek uren per periode, de prognose volgt de gekozen methode</span>
            </div>
            <div style={{ padding:"10px 14px", background:"#fff", display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end", borderBottom:`1px solid ${T.border}` }}>
              <label style={{ fontSize:11, color:T.textSub }}>Prognosemethode<br/>
                <select value={progM} onChange={e=>setProgM(e.target.value)} style={{ marginTop:3, padding:"6px 9px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12 }}>
                  <option value="geboekt">Geboekt = prognose</option>
                  <option value="begroot">Lineair tot begroting</option>
                  <option value="extrapolatie">Extrapolatie (gem. × periodes)</option>
                  <option value="handmatig">Handmatig</option>
                </select>
              </label>
              {progM==="handmatig" && (
                <label style={{ fontSize:11, color:T.textSub }}>Prognose-uren (handmatig)<br/>
                  <input value={progHand} onChange={e=>setProgHand(e.target.value)} style={{ marginTop:3, padding:"6px 9px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12, width:120 }}/>
                </label>
              )}
              <span style={{ borderLeft:`1px solid ${T.border}`, paddingLeft:16, fontSize:11, color:T.textSub }}>Ken uren toe aan een periode<br/>
                <span style={{ display:"inline-flex", gap:6, marginTop:3 }}>
                  <select value={tkPer} onChange={e=>setTkPer(e.target.value)} style={{ padding:"6px 9px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12 }}>
                    <option value="">— periode —</option>
                    {per.map(p=><option key={p.periode} value={String(p.periode)}>{pl(p.periode)}</option>)}
                  </select>
                  <input value={tkUren} onChange={e=>setTkUren(e.target.value)} placeholder="uren" style={{ padding:"6px 9px", borderRadius:6, border:`1px solid ${T.border}`, fontSize:12, width:70 }}/>
                  <button onClick={kenToe} disabled={!tkPer||!tkUren} style={{ padding:"6px 12px", borderRadius:6, border:"none", background:tkPer&&tkUren?T.purple:"#ccc", color:"#fff", fontSize:12, fontWeight:700, cursor:tkPer&&tkUren?"pointer":"not-allowed" }}>+ Boeken</button>
                </span>
              </span>
            </div>
            <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead><tr style={{ background:P050 }}>
                <th style={{ textAlign:"left", padding:"7px 12px", fontSize:10, fontWeight:700, color:T.textSub, position:"sticky", left:0, background:P050 }}>Periode</th>
                <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, fontWeight:700, color:T.textSub }}>Begroot (u)</th>
                <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, fontWeight:700, color:T.textSub }}>Geboekt (u)</th>
                <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, fontWeight:700, color:T.textSub }}>Kosten (× {eur0(tarief)})</th>
              </tr></thead>
              <tbody>
                {per.map((p,i)=>(
                  <tr key={p.periode} style={{ borderTop:`1px solid ${T.border}` }}>
                    <td style={{ padding:"5px 12px", position:"sticky", left:0, background:"#fff", fontWeight:600, color:T.text }}>{pl(p.periode)}</td>
                    <td style={{ padding:"5px 12px", textAlign:"right", color:T.textSub }}>{u0(begroot[i])}</td>
                    <td style={{ padding:"3px 12px", textAlign:"right" }}><input value={uta[i]} onChange={e=>setUur(i,e.target.value)} style={{ width:80, textAlign:"right", padding:"4px 7px", borderRadius:5, border:`1px solid ${P100}`, fontSize:12, color:P700, fontWeight:600 }}/></td>
                    <td style={{ padding:"5px 12px", textAlign:"right", color:T.text }}>{eur0((parseFloat(uta[i])||0)*tarief)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop:`2px solid ${P200}`, background:P050, fontWeight:800 }}>
                  <td style={{ padding:"7px 12px", position:"sticky", left:0, background:P050 }}>Totaal geboekt</td>
                  <td style={{ padding:"7px 12px", textAlign:"right" }}>{u0(somBegroot)}</td>
                  <td style={{ padding:"7px 12px", textAlign:"right", color:P700 }}>{u0(somGeboekt)}</td>
                  <td style={{ padding:"7px 12px", textAlign:"right" }}>{eur0(somGeboekt*tarief)}</td>
                </tr>
                <tr style={{ background:rood?"#FBEAEF":"#EEF7E0", fontWeight:800 }}>
                  <td style={{ padding:"7px 12px", position:"sticky", left:0, background:rood?"#FBEAEF":"#EEF7E0" }}>Prognose ({progM})</td>
                  <td style={{ padding:"7px 12px", textAlign:"right", color:T.textMuted }}>—</td>
                  <td style={{ padding:"7px 12px", textAlign:"right", color:P700 }}>{u0(progUren)}</td>
                  <td style={{ padding:"7px 12px", textAlign:"right", color:rood?T.danger:"#3F8F6B" }}>{eur0(progUren*tarief)}</td>
                </tr>
              </tbody>
            </table>
            </div>
            <div style={{ padding:"7px 14px", background:"#fff", fontSize:10, color:T.textMuted, borderTop:`1px solid ${T.border}` }}>
              Voorstel-versie: zelfde tijdmatrix-basis als ABK, maar in <b>uren × uurtarief</b>. Periode-granulariteit (maand/week/kwartaal/jaar) en de overige prognosemethoden kun je hier verder uitbreiden.
            </div>
          </div>
          );
        })()}

        {/* Verloop in de tijd */}
        <div style={{ borderRadius:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)", marginBottom:14 }}>
          <div style={{ background:KOP1, color:"#fff", padding:"9px 14px", fontSize:13, fontWeight:700 }}>Urenverloop in de tijd</div>
          <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", fontSize:12 }}>
            <thead><tr style={{ background:P050 }}>
              <th style={{ textAlign:"left", padding:"7px 12px", fontSize:10, color:T.textSub, textTransform:"uppercase", letterSpacing:0.3 }}>Periode</th>
              <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, color:T.textSub }}>Begroot</th>
              <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, color:T.textSub }}>Geboekt</th>
              <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, color:T.textSub }}>Cum. geboekt</th>
              <th style={{ textAlign:"right", padding:"7px 12px", fontSize:10, color:T.textSub }}>Afwijking</th>
              <th style={{ textAlign:"left", padding:"7px 12px", fontSize:10, color:T.textSub, width:"34%" }}>Begroot vs geboekt</th>
            </tr></thead>
            <tbody>
              {rows.map((p,i)=>{
                const afw = (p.geboekt||0) - (p.begroot||0);
                const toekomst = (p.geboekt||0)===0;
                return (
                  <tr key={i} style={{ borderTop:`1px solid ${T.border}` }}>
                    <td style={{ padding:"6px 12px", fontWeight:600, color:toekomst?T.textMuted:T.text }}>{p.periode}{toekomst && <span style={{ fontSize:9, color:T.textMuted, fontWeight:400 }}> · nog te boeken</span>}</td>
                    <td style={{ padding:"6px 12px", textAlign:"right" }}>{u0(p.begroot)}</td>
                    <td style={{ padding:"6px 12px", textAlign:"right", fontWeight:700 }}>{toekomst?"—":u0(p.geboekt)}</td>
                    <td style={{ padding:"6px 12px", textAlign:"right", color:T.textSub }}>{toekomst?"—":u0(p.cum)}</td>
                    <td style={{ padding:"6px 12px", textAlign:"right", fontWeight:600, color:toekomst?T.textMuted:(afw>0?T.danger:T.budget) }}>{toekomst?"—":(afw>0?"+":"")+u0(afw)}</td>
                    <td style={{ padding:"6px 12px" }}>
                      <div style={{ position:"relative", height:14 }}>
                        <div style={{ position:"absolute", top:1, left:0, height:5, width:`${(p.begroot/maxU*100)||0}%`, background:"#C9CDD4", borderRadius:3 }}/>
                        <div style={{ position:"absolute", top:8, left:0, height:5, width:`${(p.geboekt/maxU*100)||0}%`, background:afw>0?T.danger:P600, borderRadius:3 }}/>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background:P100, fontWeight:800, borderTop:`2px solid ${P700}33` }}>
                <td style={{ padding:"8px 12px", color:P800 }}>Totaal</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:P800 }}>{u0(A.begrooteUren)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:P800 }}>{u0(A.geboekteUren)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:P800 }}>{u0(A.geboekteUren)}</td>
                <td style={{ padding:"8px 12px", textAlign:"right", color:(A.geboekteUren-A.begrooteUren)>0?T.danger:T.budget }}>{((A.geboekteUren-A.begrooteUren)>0?"+":"")+u0(A.geboekteUren-A.begrooteUren)}</td>
                <td style={{ padding:"8px 12px", fontSize:10, color:T.textSub }}>geboekt t.o.v. begroot tot nu</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Financiële vertaling */}
        <div style={{ borderRadius:10, overflow:"hidden", boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ background:KOP1, color:"#fff", padding:"9px 14px", fontSize:13, fontWeight:700 }}>Prognose kosten einde werk (uren × uurtarief)</div>
          <table style={{ width:"100%", borderCollapse:"collapse", background:"#fff", fontSize:12 }}>
            <tbody>
              {[
                ["Beschikbaar budget (begrote uren × tarief)", c.aangepastBudget, true],
                ["Geboekt (geboekte uren × tarief)", -c.besteed, false],
                ["Nog te besteden (restant uren × tarief)", -c.nogTeBesteden, false],
              ].map((r,i)=>(
                <tr key={i} style={{ borderTop:i===0?"none":`1px solid ${T.border}` }}>
                  <td style={{ padding:"8px 14px", color:r[2]?P800:T.text, fontWeight:r[2]?700:400 }}>
                    <span style={{ display:"inline-block", width:14, color:T.textMuted, fontWeight:700 }}>{i===0?"":"−"}</span>{r[0]}
                  </td>
                  <td style={{ padding:"8px 14px", textAlign:"right", fontWeight:700, color:r[1]<0?T.danger:(r[2]?P800:T.text) }}>{eur0(Math.abs(r[1]))}</td>
                </tr>
              ))}
              <tr style={{ background:P100, borderTop:`2px solid ${P700}` }}>
                <td style={{ padding:"9px 14px", fontWeight:800, color:P800 }}>Prognose resultaat</td>
                <td style={{ padding:"9px 14px", textAlign:"right", fontWeight:800, fontSize:14, color:rood?T.danger:T.budget }}>{eur0(c.prognoseResultaat)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ background:P050, padding:"6px 14px", fontSize:10, color:T.textSub }}>
            Arbeidscodes worden in de tijd bewaakt op uren. Voor deze rubriek geldt het afrekenblad niet; de prognose volgt uit prognose-uren × uurtarief.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LAAG 2 — RUBRIEK 5 · ABK / MATERIEELBEWAKING ─────────────────────────────
// Horizontale prognosematrix. Canoniek = WEKEN; maand/kwartaal/jaar/meerjaar zijn
// groeperingen. 9 prognosemethoden, fictieve bestedingen (maand + week), totaalblok.
// Vaste 8 regels per kostendrager. Klik een LAAG 1-regel → hierheen. Labels NL.
const ABK_GEBRUIKER = "Frank van Alphen";
const ABK_MAANDEN = ["Jan","Feb","Mrt","Apr","Mei","Jun","Jul","Aug","Sep","Okt","Nov","Dec"];
const WPJ  = 52;                              // weken per jaar (vereenvoudigd)
const ABK_JAREN  = [2025, 2026, 2027];        // zichtbare jaren ("meerdere jaren")
const ABK_HUIDIG = { jaar: 2026, week: 23 };  // 'vandaag'-marker (vaste demo-positie)

// Maand → [startweek, eindweek] volgens 4-4-5-patroon: kwartaal = 13 weken, jaar = 52.
const MAAND_LEN   = [4,4,5, 4,4,5, 4,4,5, 4,4,5];
const MAAND_RANGE = (() => { const r=[]; let w=1; MAAND_LEN.forEach(len=>{ r.push([w, w+len-1]); w+=len; }); return r; })();
function maandVanWeek(w){ for (let m=0;m<12;m++){ if (w>=MAAND_RANGE[m][0] && w<=MAAND_RANGE[m][1]) return m+1; } return 12; }
function kwartaalVanWeek(w){ return Math.min(4, Math.floor((w-1)/13)+1); }

const wkKey = (j,w) => `${j}-W${w}`;
const jj    = (j)   => String(j%100).padStart(2,"0");
const ABK_WEEKKEYS = ABK_JAREN.flatMap(j => Array.from({length:WPJ}, (_,i)=>wkKey(j,i+1)));
const ABK_HUIDIG_KEY = wkKey(ABK_HUIDIG.jaar, ABK_HUIDIG.week);
const ABK_HUIDIG_IDX = ABK_WEEKKEYS.indexOf(ABK_HUIDIG_KEY);

// Synthetische datum (dd-mm-jjjj) uit (jaar, week) — benadering voor boek-/factuurdatum in de demo.
function weekDatum(j, w, offset=0){
  const m = maandVanWeek(w);
  const dagInMaand = Math.min(28, Math.max(1, (w - MAAND_RANGE[m-1][0]) * 7 + 3 + offset));
  return `${String(dagInMaand).padStart(2,"0")}-${String(m).padStart(2,"0")}-${j}`;
}

// Bouw de zichtbare kolommen voor granulariteit + jarenbereik. Elke kolom dekt een set weken (canoniek).
function abkKolommen(gran, jaren){
  const cols = [];
  jaren.forEach(j => {
    if (gran === "jaar"){
      cols.push({ key:`${j}-Y`, label:String(j), sub:"", weken:Array.from({length:WPJ},(_,i)=>wkKey(j,i+1)) });
    } else if (gran === "kwartaal"){
      for (let q=1;q<=4;q++){
        const weken=[]; for (let w=(q-1)*13+1; w<=q*13; w++) weken.push(wkKey(j,w));
        cols.push({ key:`${j}-Q${q}`, label:`Q${q}`, sub:`’${jj(j)}`, weken });
      }
    } else if (gran === "week"){
      for (let w=1; w<=WPJ; w++) cols.push({ key:wkKey(j,w), label:`wk ${w}`, sub:`’${jj(j)}`, weken:[wkKey(j,w)] });
    } else { // maand (default)
      for (let m=1;m<=12;m++){
        const [a,b]=MAAND_RANGE[m-1]; const weken=[]; for (let w=a;w<=b;w++) weken.push(wkKey(j,w));
        cols.push({ key:`${j}-M${m}`, label:ABK_MAANDEN[m-1], sub:`’${jj(j)}`, weken });
      }
    }
  });
  return cols;
}
const abkColSom = (weekMap, col) => col.weken.reduce((s,k)=>s+(weekMap[k]||0), 0);
const abkBevatHuidig = (col) => col.weken.includes(ABK_HUIDIG_KEY);

// ══════════════════════════════════════════════════════════════════════════════
//  DEMO-DATA — project HAUT (rubriek 5)
// ══════════════════════════════════════════════════════════════════════════════
// Kostendragers — AFGELEID uit de centrale registry; begroting/besteding reconcilieren met de PER-lijst.
// invloedMMW / reservering / beknopte invoer zijn ABK-lagen (deterministische demo-scaffolding).
const ABK_KOSTENDRAGERS = KOSTENDRAGERS.filter(k => k.rubriek === 5).map((k, i) => ({
  code: k.id,
  omschrijving: k.naam,
  begroting: k.begrotingTotaal,
  invloedMMW: (i % 3 === 1) ? Math.round(k.begrotingTotaal * 0.06 / 100) * 100 : 0,   // ~1/3 met MMW
  reservering: Math.round(k.begrotingTotaal * 0.02 / 100) * 100,
  invoerBeknopt: 0,
}));

const ABK_LEVERANCIERS = ["Boels Rental","Riwal Hoogwerkers","Peri Bekistingen","Layher Steigers","Cramo Materieel","Van Wijnen Logistiek","Sans Verhuur","HKS Steigerbouw"];
const ABK_OMSCHRIJVINGEN = ["Huur torenkraan","Bouwlift termijn","Steiger op-/afbouw","Bekisting huur","Verbruik klein materieel","Hijsmateriaal","Schaftunit + voorzieningen","Bouwhek + afzetting","Transport materieel","Energie bouwplaats"];

// Bestedingen (BIS) — fictief, realistisch, verdeeld over WEKEN (en daarmee maanden) in het verleden
//    t/m 'vandaag'. Som per kostencode == centrale besteding (reconcilieert met PER-lijst).
//    ~1 op 4 boekingen bewust zonder prestatieperiode → rode signalering (req 7).
const ABK_BESTEDINGEN = (() => {
  const rnd = regelRng(54021); const out = []; let n = 0;
  const verledenWeken = ABK_WEEKKEYS.slice(0, ABK_HUIDIG_IDX + 1);   // alleen t/m heden
  ABK_KOSTENDRAGERS.forEach(kd => {
    const totaal = bestedingVanKostencode(Number(kd.code));
    if (totaal <= 0) return;
    const aantal = rInt(rnd, 3, 7);
    // verdeel het totaal in 'aantal' plausibele brokken
    const ruw = Array.from({length:aantal}, () => 0.4 + rnd());
    const somRuw = ruw.reduce((s,x)=>s+x,0);
    let acc = 0;
    ruw.forEach((f, idx) => {
      const bedrag = idx<aantal-1 ? Math.round(totaal*f/somRuw/10)*10 : Math.round((totaal-acc)*100)/100;
      acc += bedrag;
      const wkkey = rPick(rnd, verledenWeken);
      const [jr, wnr] = [parseInt(wkkey.split("-W")[0]), parseInt(wkkey.split("-W")[1])];
      const toegewezen = (n % 4 === 3) ? null : wkkey;     // ~1 op 4 niet toegewezen
      out.push({
        id: `ABKBIS-${1000+n}`, kostencode: kd.code,
        leverancier: rPick(rnd, ABK_LEVERANCIERS),
        omschrijving: rPick(rnd, ABK_OMSCHRIJVINGEN),
        bedrag,
        boekdatum: weekDatum(jr, wnr, 2),
        factuurdatum: weekDatum(jr, wnr, -4),
        prestatieWeek: toegewezen,
        voorstelWeek: wkkey,
        status: toegewezen ? "toegewezen" : "open",
      });
      n++;
    });
  });
  return out;
})();

// Nog te ontvangen facturen (NTO) — compacte demo-laag rond 'vandaag'.
const ABK_NTO = ABK_KOSTENDRAGERS.filter((_, i) => i % 2 === 0).map(k => ({
  id:`ABKNTO-${k.code}`, kostencode:k.code, week:ABK_HUIDIG_KEY,
  leverancier:"Diverse", omschrijving:"Verwachte termijn (nog te ontvangen)",
  bedrag: Math.round(k.begroting * 0.02 / 100) * 100,
}));

// Default prognose-invoer (overrides) — spreidt het resterende budget gelijkmatig over de
//    toekomstige weken (vanaf 'vandaag' t/m einde zichtbaar bereik). { [code]: { [weekKey]: bedrag } }
function abkDefaultOverrides(){
  const out = {};
  const toekomst = ABK_WEEKKEYS.slice(ABK_HUIDIG_IDX + 1);
  ABK_KOSTENDRAGERS.forEach((kd, i) => {
    if (i % 4 === 3) return;                                   // sommige dragers zonder prognose (trendsignaal)
    const besteed = bestedingVanKostencode(Number(kd.code));
    const rest = (kd.begroting + kd.invloedMMW) - besteed - kd.reservering;
    if (rest < 2000 || !toekomst.length) return;
    const per = Math.round(rest * 0.7 / toekomst.length / 10) * 10;
    if (per <= 0) return;
    out[kd.code] = {};
    toekomst.forEach(k => { out[kd.code][k] = per; });
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CENTRALE REKENFUNCTIE — alle totalen + per-periode-waarden komen hiervandaan
// ══════════════════════════════════════════════════════════════════════════════
function berekenABK(kd, ctx){
  const { overrides, bestedingen, nto } = ctx;
  const code = kd.code;
  const ov = overrides[code] || {};

  // Bestedingen per prestatieweek + niet-toegewezen
  const bestWeek = {}; let bestTot = 0; let nietToegewezen = 0; let aantalOpen = 0;
  bestedingen.filter(b => b.kostencode === code).forEach(b => {
    bestTot += b.bedrag;
    if (b.prestatieWeek) bestWeek[b.prestatieWeek] = (bestWeek[b.prestatieWeek]||0) + b.bedrag;
    else { nietToegewezen += b.bedrag; aantalOpen++; }
  });

  // NTO per week
  const ntoWeek = {}; let ntoTot = 0;
  nto.filter(n => n.kostencode === code).forEach(n => { ntoWeek[n.week] = (ntoWeek[n.week]||0) + n.bedrag; ntoTot += n.bedrag; });

  // Prognose-invoer per week (override)
  const progWeek = {}; let progTot = 0;
  Object.keys(ov).forEach(k => { const v = ov[k]; if (v) { progWeek[k] = v; progTot += v; } });

  const beknopt = kd.invoerBeknopt || 0;

  // PKEW per week = bestedingen + nto + prognose-invoer (req 8). Beknopte invoer is een lump in het totaal.
  const pkewWeek = {};
  const alleWeken = new Set([...Object.keys(bestWeek), ...Object.keys(ntoWeek), ...Object.keys(progWeek)]);
  alleWeken.forEach(k => { const v = (bestWeek[k]||0)+(ntoWeek[k]||0)+(progWeek[k]||0); if (v) pkewWeek[k] = v; });

  const begrIncMMW = (kd.begroting||0) + (kd.invloedMMW||0);
  const pkewTot    = bestTot + ntoTot + progTot + beknopt;
  const resultaat  = begrIncMMW - pkewTot - (kd.reservering||0);

  return {
    code, nietToegewezen, aantalOpen,
    // per-periode weekmaps per regel (leeg = totaal-only regel)
    weken: {
      begroting:{}, invloedMMW:{}, begrIncMMW:{},
      pkew:pkewWeek, bestedingen:bestWeek, nto:ntoWeek,
      reservering:{}, resultaat:{},
    },
    totaal: {
      begroting:kd.begroting||0, invloedMMW:kd.invloedMMW||0, begrIncMMW,
      pkew:pkewTot, bestedingen:bestTot, nto:ntoTot,
      reservering:kd.reservering||0, resultaat,
    },
    beknopt, progWeek, bestWeek, ntoWeek,
  };
}

// ── De 8 vaste regels (volgorde vast, req 6) ───────────────────────────────────
const ABK_REGELS = [
  { id:"begroting",   label:"Begroting" },
  { id:"invloedMMW",  label:"Invloed MMW" },
  { id:"begrIncMMW",  label:"Begroting inc. MMW",          sub:true },
  { id:"pkew",        label:"Prognose kosten einde werk",  accent:true, perPeriode:true, bewerkbaar:true },
  { id:"bestedingen", label:"Bestedingen",                 perPeriode:true, marker:true },
  { id:"nto",         label:"Nog te ontvangen facturen",   perPeriode:true },
  { id:"reservering", label:"Reservering" },
  { id:"resultaat",   label:"Prognose resultaat",          resultaat:true },
];

// ── Kolombreedtes (sticky links) + celhelpers ─────────────────────────────────
const ABK_W = { code:72, oms:212, totaal:106, tijd:80 };
const ABK_LEFT = { code:0, oms:ABK_W.code, totaal:ABK_W.code+ABK_W.oms };
const ABK_STICKY_W = ABK_W.code + ABK_W.oms + ABK_W.totaal;
const abkSticky = (left, w, extra={}) => ({ position:"sticky", left, minWidth:w, maxWidth:w, width:w, zIndex:2, background:T.surface, boxSizing:"border-box", ...extra });

// Bewerkbare cel (lime = bewerkbaar)
function ABKInvoerCel({ waarde, onCommit, breedte=ABK_W.tijd }){
  const [v, setV] = useState("");
  const [focus, setFocus] = useState(false);
  const tonen = focus ? v : (waarde ? eurKaal(waarde) : "");
  return (
    <input value={tonen} placeholder="–"
      onFocus={()=>{ setFocus(true); setV(waarde?String(Math.round(waarde)):""); }}
      onBlur={()=>{ setFocus(false); const n=parseFloat((v||"").replace(/\./g,"").replace(",","."))||0; onCommit(n); }}
      onChange={e=>setV(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter") e.target.blur(); }}
      style={{ width:breedte-12, textAlign:"right", fontSize:11, fontVariantNumeric:"tabular-nums",
        border:`1px solid ${T.limeDk}`, background:T.editBg, borderRadius:4, padding:"2px 4px",
        outline:"none", color:T.text, boxSizing:"border-box" }}/>
  );
}

// ── Prognose-methoden (pure) — werken op de override-map van één kostencode ────
function abkSelecteerKolommen(kolommen, vanIdx, totIdx){
  const lo=Math.min(vanIdx,totIdx), hi=Math.max(vanIdx,totIdx);
  return kolommen.slice(lo, hi+1);
}
function abkPasMethodeToe(methode, huidigeOv, kolommen, vanIdx, totIdx, bedrag){
  const ov = { ...huidigeOv };
  const cols = abkSelecteerKolommen(kolommen, vanIdx, totIdx);
  const alleWeken = cols.flatMap(c=>c.weken);
  const setW = (k,val)=>{ if (Math.abs(val) > 0.005) ov[k]=Math.round(val); else delete ov[k]; };
  if (methode==="gelijk"){
    const per = bedrag / Math.max(1, alleWeken.length);
    alleWeken.forEach(k=>setW(k, per));
  } else if (methode==="perPeriode"){
    cols.forEach(c=>{ const per=bedrag/Math.max(1,c.weken.length); c.weken.forEach(k=>setW(k,per)); });
  } else if (methode==="herhaalHuidig"){
    const huidigCol = kolommen.find(abkBevatHuidig) || cols[0];
    const tot = huidigCol ? abkColSom(huidigeOv, huidigCol) : 0;
    cols.forEach(c=>{ const per=tot/Math.max(1,c.weken.length); c.weken.forEach(k=>setW(k,per)); });
  } else if (methode==="kopieerVorige"){
    const lo=Math.min(vanIdx,totIdx), hi=Math.max(vanIdx,totIdx);
    for (let i=lo;i<=hi;i++){
      const vorige=kolommen[i-1], huidige=kolommen[i];
      if (!vorige||!huidige) continue;
      const per = abkColSom(ov, vorige) / Math.max(1, huidige.weken.length);
      huidige.weken.forEach(k=>setW(k,per));
    }
  } else if (methode==="trend"){
    const nW=alleWeken.length, gewSom=nW*(nW+1)/2 || 1;
    alleWeken.forEach((k,i)=>setW(k, bedrag*(i+1)/gewSom));
  } else if (methode==="leegmaken"){
    const startIdx=Math.min(vanIdx,totIdx);
    kolommen.slice(startIdx).forEach(c=> c.weken.forEach(k=>{ delete ov[k]; }));
  }
  return ov;
}
const ABK_METHODEN = [
  { id:"gelijk",        label:"Gelijkmatig verdelen",      bedrag:true,  bereik:true },
  { id:"perPeriode",    label:"Bedrag per periode",        bedrag:true,  bereik:true },
  { id:"trend",         label:"Trendmatig verdelen",       bedrag:true,  bereik:true },
  { id:"herhaalHuidig", label:"Huidige periode herhalen",  bedrag:false, bereik:true },
  { id:"kopieerVorige", label:"Vorige periode kopiëren",   bedrag:false, bereik:true },
  { id:"leegmaken",     label:"Leegmaken vanaf periode",   bedrag:false, bereik:true },
  { id:"beknopt",       label:"Beknopte invoer (vast bedrag)", bedrag:true, bereik:false },
];

// ── PROGNOSEVENSTER (modal) — periodebereik + methode ─────────────────────────
function Prognosevenster({ kostendragers, kolommen, onSluit, onToepassen }){
  const huidigKolIdx = Math.max(0, kolommen.findIndex(abkBevatHuidig));
  const [codeSel, setCodeSel] = useState(kostendragers[0]?.code || "");
  const [methode, setMethode] = useState("gelijk");
  const [vanIdx, setVanIdx]   = useState(huidigKolIdx);
  const [totIdx, setTotIdx]   = useState(kolommen.length-1);
  const [bedrag, setBedrag]   = useState("");
  const m = ABK_METHODEN.find(x=>x.id===methode);
  const label = (c)=> `${c.label}${c.sub?" "+c.sub:""}`;
  const apply = () => {
    onToepassen({ code:codeSel, methode, vanIdx, totIdx, bedrag: parseFloat((bedrag||"").replace(/\./g,"").replace(",","."))||0 });
  };
  const veld = { fontSize:13, padding:"7px 9px", border:`1px solid ${T.border}`, borderRadius:7, outline:"none", color:T.text, background:"#fff", width:"100%", boxSizing:"border-box" };
  const lab  = { fontSize:11, fontWeight:700, color:T.textMuted, letterSpacing:.3, marginBottom:4, display:"block", textTransform:"uppercase" };
  return (
    <div onClick={onSluit} style={{ position:"fixed", inset:0, background:"rgba(40,21,51,.45)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:560, maxWidth:"100%", boxShadow:"0 20px 60px rgba(40,21,51,.35)", overflow:"hidden" }}>
        <div style={{ background:T.budget, color:"#fff", padding:"16px 22px" }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Prognose invoeren</div>
          <div style={{ fontSize:12.5, opacity:.85 }}>Kies een methode en periodebereik — wordt verdeeld over de onderliggende weken.</div>
        </div>
        <div style={{ padding:22, display:"grid", gap:14 }}>
          <div><span style={lab}>Kostendrager</span>
            <select value={codeSel} onChange={e=>setCodeSel(e.target.value)} style={veld}>
              {kostendragers.map(k=><option key={k.code} value={k.code}>{k.code} · {k.omschrijving}</option>)}
            </select>
          </div>
          <div><span style={lab}>Methode</span>
            <select value={methode} onChange={e=>setMethode(e.target.value)} style={veld}>
              {ABK_METHODEN.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </div>
          {m.bereik && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div><span style={lab}>Van periode</span>
                <select value={vanIdx} onChange={e=>setVanIdx(+e.target.value)} style={veld}>
                  {kolommen.map((c,i)=><option key={c.key} value={i}>{label(c)}</option>)}
                </select>
              </div>
              <div><span style={lab}>{methode==="leegmaken" ? "(t/m einde)" : "Tot en met"}</span>
                <select value={totIdx} onChange={e=>setTotIdx(+e.target.value)} disabled={methode==="leegmaken"} style={{ ...veld, opacity:methode==="leegmaken"?.5:1 }}>
                  {kolommen.map((c,i)=><option key={c.key} value={i}>{label(c)}</option>)}
                </select>
              </div>
            </div>
          )}
          {m.bedrag && (
            <div><span style={lab}>{methode==="perPeriode" ? "Bedrag per periode (€)" : methode==="beknopt" ? "Vast bedrag bovenop prognose (€)" : "Totaalbedrag te verdelen (€)"}</span>
              <input value={bedrag} onChange={e=>setBedrag(e.target.value)} placeholder="0" style={veld}/>
            </div>
          )}
          <div style={{ fontSize:12, color:T.textMuted, background:T.purpleFade, borderRadius:8, padding:"9px 12px" }}>
            {methode==="gelijk" && "Verdeelt het totaalbedrag gelijk over alle weken in het bereik."}
            {methode==="perPeriode" && "Zet hetzelfde bedrag in elke periode van het bereik."}
            {methode==="trend" && "Verdeelt oplopend (lineaire trend); de som is het totaalbedrag."}
            {methode==="herhaalHuidig" && "Herhaalt het bedrag van de huidige periode over het bereik."}
            {methode==="kopieerVorige" && "Kopieert per periode de waarde van de vorige periode."}
            {methode==="leegmaken" && "Maakt de prognose-invoer leeg vanaf de gekozen periode t/m het einde."}
            {methode==="beknopt" && "Telt een vast bedrag op bij de prognose kosten einde werk (niet aan een periode gekoppeld)."}
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end", gap:10, padding:"0 22px 20px" }}>
          <button onClick={onSluit} style={{ fontSize:13, padding:"9px 16px", borderRadius:8, border:`1px solid ${T.border}`, background:"#fff", color:T.text, cursor:"pointer" }}>Annuleren</button>
          <button onClick={apply} style={{ fontSize:13, fontWeight:700, padding:"9px 18px", borderRadius:8, border:"none", background:T.budget, color:"#fff", cursor:"pointer" }}>Toepassen</button>
        </div>
      </div>
    </div>
  );
}

// ── BESTEDINGEN-DETAIL (modal) — toewijzen/vrijgeven prestatieperiode ──────────
function BestedingenVenster({ kd, bestedingen, onSluit, onToggle }){
  const rijen = bestedingen.filter(b=>b.kostencode===kd.code);
  const th = { textAlign:"left", fontSize:10.5, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.3, padding:"6px 8px", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" };
  const td = { fontSize:12, padding:"6px 8px", borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" };
  return (
    <div onClick={onSluit} style={{ position:"fixed", inset:0, background:"rgba(40,21,51,.45)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, width:1000, maxWidth:"100%", maxHeight:"86vh", boxShadow:"0 20px 60px rgba(40,21,51,.35)", overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ background:T.budget, color:"#fff", padding:"16px 22px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700 }}>Bestedingen · {kd.code} — {kd.omschrijving}</div>
            <div style={{ fontSize:12.5, opacity:.85 }}>Wijs boekingen toe aan een prestatieperiode (week). Niet-toegewezen boekingen zijn rood gemarkeerd.</div>
          </div>
          <button onClick={onSluit} style={{ fontSize:18, lineHeight:1, background:"transparent", border:"none", color:"#fff", cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ overflow:"auto", padding:"4px 14px 14px" }}>
          <table style={{ borderCollapse:"collapse", width:"100%" }}>
            <thead><tr>
              <th style={th}>Kostencode</th><th style={th}>Leverancier</th><th style={th}>Omschrijving</th>
              <th style={{ ...th, textAlign:"right" }}>Bedrag</th><th style={th}>Boekdatum</th><th style={th}>Factuurdatum</th>
              <th style={th}>Prestatieperiode</th><th style={th}>Status</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {rijen.map(b=>{
                const open = !b.prestatieWeek;
                return (
                  <tr key={b.id} style={{ background: open ? "#FBEAEA" : "transparent" }}>
                    <td style={td}>{b.kostencode}</td>
                    <td style={td}>{b.leverancier}</td>
                    <td style={{ ...td, whiteSpace:"normal", maxWidth:230 }}>{b.omschrijving}</td>
                    <td style={{ ...td, textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{eur(b.bedrag)}</td>
                    <td style={td}>{b.boekdatum}</td>
                    <td style={td}>{b.factuurdatum}</td>
                    <td style={{ ...td, fontWeight:600 }}>{b.prestatieWeek ? b.prestatieWeek.replace("-W"," · wk ") : <span style={{ color:T.danger }}>niet toegewezen</span>}</td>
                    <td style={td}>
                      <span style={{ fontSize:10.5, fontWeight:700, padding:"2px 8px", borderRadius:9,
                        background: open ? "#F6D5D5" : T.purpleFade, color: open ? T.danger : T.purple }}>
                        {open ? "open" : "toegewezen"}
                      </span>
                    </td>
                    <td style={td}>
                      <button onClick={()=>onToggle(b.id)} style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:7, cursor:"pointer",
                        border:`1px solid ${open?T.limeDk:T.border}`, background:open?T.editBg:"#fff", color:T.text }}>
                        {open ? `Toewijzen → ${b.voorstelWeek.replace("-W"," wk ")}` : "Vrijgeven"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rijen.length===0 && <tr><td colSpan={9} style={{ padding:24, textAlign:"center", color:T.textMuted, fontSize:12 }}>Geen bestedingen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Eén regel-rij (hergebruikt voor kostendrager-blokken én totaalblok) ────────
function ABKRegelRij({ regel, totaal, weekMap, kolommen, nietToegewezen, bewerkbaar, onCommitKolom, onOpenBestedingen, vetTotaal }){
  const isRes = regel.resultaat;
  const resKleur = isRes ? (totaal < 0 ? T.danger : "#2F7D5B") : T.text;
  const rijBg = regel.accent ? "#FBF7EF" : (regel.sub ? T.purpleFade : "transparent");
  const labelInhoud = (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
      {regel.marker && nietToegewezen>0 && <span title="Bestedingen niet toegewezen aan prestatieperiode" style={{ width:8, height:8, borderRadius:"50%", background:T.danger, flex:"0 0 auto" }}/>}
      <span style={{ fontWeight: regel.accent||regel.sub||isRes ? 700 : 500, color: regel.marker && nietToegewezen>0 ? T.danger : (regel.sub ? T.purple : T.text) }}>{regel.label}</span>
      {regel.marker && onOpenBestedingen && <button onClick={onOpenBestedingen} style={{ fontSize:10, fontWeight:700, marginLeft:2, padding:"1px 7px", borderRadius:8, border:`1px solid ${T.border}`, background:"#fff", color:T.purple, cursor:"pointer" }}>details</button>}
    </span>
  );
  return (
    <tr style={{ background:rijBg }}>
      <td style={abkSticky(ABK_LEFT.code, ABK_W.code, { borderBottom:`1px solid ${T.border}`, background: rijBg==="transparent"?T.surface:rijBg })}></td>
      <td style={abkSticky(ABK_LEFT.oms, ABK_W.oms, { borderBottom:`1px solid ${T.border}`, padding:"4px 10px", fontSize:12, background: rijBg==="transparent"?T.surface:rijBg })}>{labelInhoud}</td>
      <td style={abkSticky(ABK_LEFT.totaal, ABK_W.totaal, { borderBottom:`1px solid ${T.border}`, borderRight:`2px solid ${T.borderDk}`, padding:"4px 10px", textAlign:"right", fontSize:12, fontWeight:700, fontVariantNumeric:"tabular-nums", color:resKleur, background: rijBg==="transparent"?T.surface:rijBg })}>{eur(totaal)}</td>
      {kolommen.map(col=>{
        const huidig = abkBevatHuidig(col);
        const rand = { borderRight:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}`, borderLeft: huidig?`2px solid ${T.budget}`:undefined };
        if (!regel.perPeriode){
          return <td key={col.key} style={{ minWidth:ABK_W.tijd, maxWidth:ABK_W.tijd, width:ABK_W.tijd, ...rand }}></td>;
        }
        const val = abkColSom(weekMap, col);
        if (bewerkbaar && regel.bewerkbaar){
          return <td key={col.key} style={{ minWidth:ABK_W.tijd, maxWidth:ABK_W.tijd, width:ABK_W.tijd, padding:"2px 4px", textAlign:"right", ...rand }}>
            <ABKInvoerCel waarde={val} onCommit={(n)=>onCommitKolom(col, n)}/>
          </td>;
        }
        return <td key={col.key} style={{ minWidth:ABK_W.tijd, maxWidth:ABK_W.tijd, width:ABK_W.tijd, padding:"3px 7px", textAlign:"right", fontSize:11, fontVariantNumeric:"tabular-nums", color: val?T.text:T.textMuted, ...rand }}>{val?eurKaal(val):""}</td>;
      })}
    </tr>
  );
}

// ── Kostendrager-blok: groene kop + 8 regels ──────────────────────────────────
function ABKBlok({ kd, c, kolommen, onCommitKolom, onOpenBestedingen, gemarkeerd }){
  const kop = { background:T.budget, color:"#fff", padding:"6px 10px", fontSize:12.5, fontWeight:700, borderBottom:`1px solid ${T.border}` };
  return (
    <>
      <tr>
        <td style={abkSticky(ABK_LEFT.code, ABK_W.code, { ...kop, outline: gemarkeerd?`2px solid ${T.lime}`:undefined })}>{kd.code}</td>
        <td style={abkSticky(ABK_LEFT.oms, ABK_W.oms, kop)}>{kd.omschrijving}</td>
        <td style={abkSticky(ABK_LEFT.totaal, ABK_W.totaal, { ...kop, borderRight:`2px solid ${T.borderDk}`, textAlign:"right" })}>resultaat {eur(c.totaal.resultaat)}</td>
        {kolommen.map(col=>(
          <td key={col.key} style={{ minWidth:ABK_W.tijd, maxWidth:ABK_W.tijd, width:ABK_W.tijd, background:T.budget, borderBottom:`1px solid ${T.border}`, borderLeft: abkBevatHuidig(col)?`2px solid #fff`:undefined }}></td>
        ))}
      </tr>
      {ABK_REGELS.map(regel=>(
        <ABKRegelRij key={regel.id} regel={regel}
          totaal={c.totaal[regel.id]} weekMap={c.weken[regel.id]} kolommen={kolommen}
          nietToegewezen={c.nietToegewezen} bewerkbaar={true}
          onCommitKolom={(col,n)=>onCommitKolom(kd.code, col, n)}
          onOpenBestedingen={regel.marker ? ()=>onOpenBestedingen(kd) : null}/>
      ))}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  HOOFDCOMPONENT — RUBRIEK 5 / ABK
// ══════════════════════════════════════════════════════════════════════════════
function BewakingMaterieel({ kdId, onBack }){
  const [gran, setGran]                   = useState("maand");
  const [kostendragers, setKostendragers] = useState(ABK_KOSTENDRAGERS);
  const [bestedingen, setBestedingen]     = useState(ABK_BESTEDINGEN);
  const [overrides, setOverrides]         = useState(abkDefaultOverrides);
  const [nto]                             = useState(ABK_NTO);
  const [prognoseOpen, setPrognoseOpen]   = useState(false);
  const [bestKd, setBestKd]               = useState(null);

  const kolommen = useMemo(()=>abkKolommen(gran, ABK_JAREN), [gran]);
  const resultaten = useMemo(()=> kostendragers.map(kd => ({ kd, c: berekenABK(kd, { overrides, bestedingen, nto }) })),
    [kostendragers, overrides, bestedingen, nto]);

  const totaalBlok = useMemo(()=>{
    const tot = { begroting:0, invloedMMW:0, begrIncMMW:0, pkew:0, bestedingen:0, nto:0, reservering:0, resultaat:0 };
    const weken = { pkew:{}, bestedingen:{}, nto:{} };
    resultaten.forEach(({c})=>{
      Object.keys(tot).forEach(k=> tot[k]+=c.totaal[k]||0);
      ["pkew","bestedingen","nto"].forEach(rk=>{ Object.entries(c.weken[rk]||{}).forEach(([w,v])=>{ weken[rk][w]=(weken[rk][w]||0)+v; }); });
    });
    return { tot, weken, nietToegewezen: resultaten.reduce((s,{c})=>s+c.nietToegewezen,0) };
  }, [resultaten]);

  const commitKolom = (code, col, entered) => {
    const c = resultaten.find(r=>r.kd.code===code).c;
    const vast = abkColSom(c.bestWeek, col) + abkColSom(c.ntoWeek, col);
    const per = (entered - vast) / Math.max(1, col.weken.length);
    setOverrides(prev=>{
      const next = { ...prev, [code]: { ...(prev[code]||{}) } };
      col.weken.forEach(k=>{ if (Math.abs(per)>0.005) next[code][k]=Math.round(per); else delete next[code][k]; });
      return next;
    });
  };
  const pasPrognoseToe = ({ code, methode, vanIdx, totIdx, bedrag }) => {
    if (methode==="beknopt") setKostendragers(prev=>prev.map(k=>k.code===code?{...k, invoerBeknopt:Math.round(bedrag)}:k));
    else setOverrides(prev=>({ ...prev, [code]: abkPasMethodeToe(methode, prev[code]||{}, kolommen, vanIdx, totIdx, bedrag) }));
    setPrognoseOpen(false);
  };
  const toggleBesteding = (id) => setBestedingen(prev=>prev.map(b=> b.id===id ? { ...b, prestatieWeek: b.prestatieWeek?null:b.voorstelWeek, status: b.prestatieWeek?"open":"toegewezen" } : b));

  const GRANS = [["maand","Maanden"],["week","Weken"],["kwartaal","Kwartalen"],["jaar","Jaren"]];
  const knop = (actief)=>({ fontSize:12, fontWeight:700, padding:"6px 13px", borderRadius:8, cursor:"pointer",
    border:`1px solid ${actief?T.budget:T.border}`, background:actief?T.budget:"#fff", color:actief?"#fff":T.text });

  return (
    <div style={{ padding:"18px 20px 40px" }}>
      {/* kop */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:6, flexWrap:"wrap" }}>
        <button onClick={onBack} style={{ fontSize:12, padding:"6px 12px", borderRadius:8, border:`1px solid ${T.border}`, background:"#fff", color:T.text, cursor:"pointer" }}>← PER-lijst</button>
        <h2 style={{ fontSize:18, fontWeight:700, color:T.purple, margin:0 }}>Rubriek 5 — ABK (Algemene Bouwplaatskosten)</h2>
      </div>
      <p style={{ fontSize:12.5, color:T.textMuted, margin:"0 0 14px" }}>Horizontale prognosematrix. Bewerk de prognose direct in de lime cellen of via <b>Prognose invoeren</b>. Schakel de tijd-as tussen weken, maanden, kwartalen en jaren.</p>

      {/* toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        <span style={{ fontSize:11, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.4 }}>Tijd-as:</span>
        {GRANS.map(([id,lbl])=><button key={id} onClick={()=>setGran(id)} style={knop(gran===id)}>{lbl}</button>)}
        <div style={{ flex:1 }}/>
        {totaalBlok.nietToegewezen>0 && (
          <span style={{ fontSize:11.5, fontWeight:700, color:T.danger, background:"#FBEAEA", border:`1px solid #E7B7B7`, borderRadius:9, padding:"5px 11px" }}>
            ● {eur(totaalBlok.nietToegewezen)} niet toegewezen aan prestatieperiode
          </span>
        )}
        <button onClick={()=>setPrognoseOpen(true)} style={{ fontSize:12.5, fontWeight:700, padding:"7px 15px", borderRadius:8, border:"none", background:T.budget, color:"#fff", cursor:"pointer" }}>+ Prognose invoeren</button>
      </div>

      {/* legenda */}
      <div style={{ display:"flex", gap:16, marginBottom:10, fontSize:11, color:T.textMuted, flexWrap:"wrap" }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><span style={{ width:14, height:11, background:T.editBg, border:`1px solid ${T.limeDk}`, borderRadius:3 }}/> bewerkbaar (prognose-invoer)</span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:"50%", background:T.danger }}/> bestedingen niet toegewezen</span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><span style={{ width:2, height:12, background:T.budget }}/> huidige periode</span>
      </div>

      {/* matrix */}
      <div style={{ overflowX:"auto", border:`1px solid ${T.border}`, borderRadius:10 }}>
        <table style={{ borderCollapse:"collapse", background:T.surface }}>
          <thead>
            <tr>
              <th style={abkSticky(ABK_LEFT.code, ABK_W.code, { zIndex:3, top:0, padding:"8px 10px", textAlign:"left", fontSize:10.5, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.4, borderBottom:`2px solid ${T.borderDk}`, background:T.totBg })}>Code</th>
              <th style={abkSticky(ABK_LEFT.oms, ABK_W.oms, { zIndex:3, top:0, padding:"8px 10px", textAlign:"left", fontSize:10.5, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.4, borderBottom:`2px solid ${T.borderDk}`, background:T.totBg })}>Kostendrager / regel</th>
              <th style={abkSticky(ABK_LEFT.totaal, ABK_W.totaal, { zIndex:3, top:0, padding:"8px 10px", textAlign:"right", fontSize:10.5, fontWeight:700, color:T.textMuted, textTransform:"uppercase", letterSpacing:.4, borderBottom:`2px solid ${T.borderDk}`, borderRight:`2px solid ${T.borderDk}`, background:T.totBg })}>Totaal</th>
              {kolommen.map(col=>{
                const huidig = abkBevatHuidig(col);
                return (
                  <th key={col.key} style={{ minWidth:ABK_W.tijd, maxWidth:ABK_W.tijd, width:ABK_W.tijd, padding:"6px 7px 5px", textAlign:"right", borderBottom:`2px solid ${T.borderDk}`, borderRight:`1px solid ${T.border}`, borderLeft: huidig?`2px solid ${T.budget}`:undefined, background: huidig?"#FBF7EF":T.totBg, whiteSpace:"nowrap" }}>
                    <div style={{ fontSize:11.5, fontWeight:700, color: huidig?T.budget:T.text }}>{col.label}</div>
                    {col.sub && <div style={{ fontSize:9.5, color:T.textMuted }}>{col.sub}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {resultaten.map(({kd,c})=>(
              <ABKBlok key={kd.code} kd={kd} c={c} kolommen={kolommen}
                onCommitKolom={commitKolom} onOpenBestedingen={setBestKd}
                gemarkeerd={kdId && String(kdId)===String(kd.code)}/>
            ))}

            {/* TOTAALBLOK */}
            <tr>
              <td style={abkSticky(ABK_LEFT.code, ABK_W.code, { background:T.purpleDk, color:"#fff", padding:"7px 10px", fontSize:12.5, fontWeight:700, borderTop:`2px solid ${T.borderDk}` })}>TOT</td>
              <td style={abkSticky(ABK_LEFT.oms, ABK_W.oms, { background:T.purpleDk, color:"#fff", padding:"7px 10px", fontSize:12.5, fontWeight:700, borderTop:`2px solid ${T.borderDk}` })}>Totaal — alle kostendragers</td>
              <td style={abkSticky(ABK_LEFT.totaal, ABK_W.totaal, { background:T.purpleDk, color:"#fff", padding:"7px 10px", fontSize:12.5, fontWeight:700, textAlign:"right", borderRight:`2px solid ${T.borderDk}`, borderTop:`2px solid ${T.borderDk}` })}>resultaat {eur(totaalBlok.tot.resultaat)}</td>
              {kolommen.map(col=>(<td key={col.key} style={{ minWidth:ABK_W.tijd, background:T.purpleDk, borderTop:`2px solid ${T.borderDk}`, borderLeft: abkBevatHuidig(col)?`2px solid #fff`:undefined }}></td>))}
            </tr>
            {ABK_REGELS.map(regel=>{
              const weekMap = regel.perPeriode ? (totaalBlok.weken[regel.id]||{}) : {};
              return (
                <ABKRegelRij key={"tot-"+regel.id} regel={{ ...regel, bewerkbaar:false, marker:false }}
                  totaal={totaalBlok.tot[regel.id]} weekMap={weekMap} kolommen={kolommen}
                  nietToegewezen={0} bewerkbaar={false} onCommitKolom={()=>{}} onOpenBestedingen={null}/>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* rekenregel-toelichting */}
      <div style={{ marginTop:12, fontSize:11.5, color:T.textMuted, lineHeight:1.6 }}>
        <b style={{ color:T.text }}>Rekenregels.</b> Begroting inc. MMW = Begroting + Invloed MMW · Prognose kosten einde werk = Bestedingen + Nog te ontvangen facturen + prognose-invoer + beknopte invoer · Prognose resultaat = Begroting inc. MMW − Prognose kosten einde werk − Reservering.
      </div>

      {prognoseOpen && <Prognosevenster kostendragers={kostendragers} kolommen={kolommen} onSluit={()=>setPrognoseOpen(false)} onToepassen={pasPrognoseToe}/>}
      {bestKd && <BestedingenVenster kd={bestKd} bestedingen={bestedingen} onSluit={()=>setBestKd(null)} onToggle={toggleBesteding}/>}
    </div>
  );
}

// ─── LAAG 1 — PER-LIJST ───────────────────────────────────────────────────────
// Het dagelijkse werkscherm van projectcontrol. Eén regel per kostendrager, met de
// volledige financiële kolommenset. Klik een regel → kostendragerbewaking (laag 2).
// Alle bedragen komen uit dezelfde berekenKD-motor → sluiten 1-op-1 aan op laag 2 en 3.
function PERlijst({ inkooporders, oaData, invloedData, onOpenKd }) {
  const P900="#3D0850", P700="#630D80", P100="#F1E5F6", P050="#F8F2FB";
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;
  const [zoek, setZoek]           = useState("");
  const [fRubriek, setFRubriek]   = useState("alle");
  const [fNegatief, setFNeg]      = useState(false);
  const [hoverCode, setHoverCode] = useState(null);

  // ── Eén regel per kostendrager, alle bedragen via de gedeelde rekenmotor (berekenKD),
  //    zodat laag 1 ⇄ laag 2 ⇄ afrekenblad 1-op-1 aansluiten. Zwaar werk gememoïseerd. ──
  const rijen = useMemo(() => KOSTENDRAGERS.map(meta => {
    const code  = meta.id;
    const kd    = getKdData(code);
    const ios   = (inkooporders||[]).filter(io=>io.kdId===code);
    const allOA = (oaData||[]).filter(o=>o.kdId===code);
    const allInv= (invloedData||[]).filter(i=>i.kdId===code);
    const geb   = new Set(ios.flatMap(io=>io.oaIds||[]));
    const c     = berekenKD(kd, ios, allOA, allInv, geb);
    return {
      code, naam:kd.naam, rubriekNr:kd.rubriek,
      // Vlak 2 — Budget
      begroting:kd.begroting.origineel, mutaties:kd.begroting.mutaties, mmwBegroting:kd.begroting.mmwBegroting,
      aangepastBudget:c.aangepastBudget, invloedMMWprognose:c.invloedMMWprognose, totBeschikbareBegr:c.totBeschikbareBegr,
      // Vlak 3 — Contracten
      contract:c.contract, inkoopresultaat:c.inkoopresultaat, restant:c.totRestantNogUitGeven,
      reserveInkoop:c.reserveInkoop, mmwOA:c.mmwInPrognose,
      // Vlak 4 — Bestedingen
      bijstelling:c.totBijstelling, kew:c.kew, besteed:c.besteed, pctBesteed:c.pctBesteed, nogTeBesteden:c.nogTeBesteden,
      // Vlak 5 — Prognose
      prognoseResultaat:c.prognoseResultaat, resultaatVorige:kd.resultaatVorigePeriode||0, deltaVorige:c.deltaVorige,
    };
  }), [inkooporders, oaData, invloedData]);

  // Kolomdefinitie in 5 verticale vlakken (zoneband-kop). soort bepaalt opmaak/uitlijning.
  const VLAKKEN = [
    { naam:"Rubriek", bg:"#630D80", tint:"#F6F2FA", kols:[
      { key:"code", label:"Code",         soort:"code",  w:70 },
      { key:"naam", label:"Omschrijving", soort:"naam",  w:190 },
    ]},
    { naam:"Budget", bg:"#4F0A68", tint:"#F4EFF8", kols:[
      { key:"begroting",          label:"Begroting",            soort:"eur",  w:96 },
      { key:"mutaties",           label:"Mutaties",             soort:"eur",  w:84 },
      { key:"mmwBegroting",       label:"MMW begroting",        soort:"eur",  w:96 },
      { key:"aangepastBudget",    label:"Aangepast budget",     soort:"eurB", w:104 },
      { key:"invloedMMWprognose", label:"Invloed MMW i/d prog.",soort:"eur",  w:104 },
      { key:"totBeschikbareBegr", label:"Tot. beschikb. begr.", soort:"eurB", w:112 },
    ]},
    { naam:"Contracten", bg:"#1F6F8B", tint:"#EEF6F9", kols:[
      { key:"contract",        label:"Uitbesteed contract",  soort:"eur",      w:104 },
      { key:"inkoopresultaat", label:"Inkoopresultaat",      soort:"eurSigned",w:104 },
      { key:"restant",         label:"Restant budget",       soort:"eur",      w:96 },
      { key:"reserveInkoop",   label:"Reserve inkoop",       soort:"eur",      w:96 },
      { key:"mmwOA",           label:"MMW OA lev. i/d prog.",soort:"eur",      w:108 },
    ]},
    { naam:"Bestedingen", bg:"#9C6A12", tint:"#FBF5EA", kols:[
      { key:"bijstelling",   label:"Bijstelling kosten", soort:"eur", w:100 },
      { key:"kew",           label:"Kosten einde werk",  soort:"eurB",w:104 },
      { key:"besteed",       label:"Besteed",            soort:"eurB",w:96 },
      { key:"pctBesteed",    label:"% Besteed",          soort:"pct", w:120 },
      { key:"nogTeBesteden", label:"Nog te besteden",    soort:"eur", w:100 },
    ]},
    { naam:"Prognose", bg:"#2F7D5B", tint:"#EEF7F1", kols:[
      { key:"prognoseResultaat", label:"Prognose resultaat",      soort:"eurResult",w:112 },
      { key:"resultaatVorige",   label:"Resultaat vorige periode",soort:"eurSigned",w:112 },
      { key:"deltaVorige",       label:"Δ vorige prognose",       soort:"eurSigned",w:104 },
    ]},
  ];
  const ALLEKOLS = VLAKKEN.flatMap(v=>v.kols);
  const SOMKOLS  = ALLEKOLS.filter(k=>k.soort!=="code" && k.soort!=="naam" && k.soort!=="pct").map(k=>k.key);

  const rubriekNrs = Array.from(new Set(rijen.map(r=>r.rubriekNr))).sort((a,b)=>a-b);
  let zicht = rijen;
  if (zoek)              zicht = zicht.filter(r => (String(r.code)+" "+r.naam).toLowerCase().includes(zoek.toLowerCase()));
  if (fRubriek!=="alle") zicht = zicht.filter(r => String(r.rubriekNr)===String(fRubriek));
  if (fNegatief)         zicht = zicht.filter(r => r.prognoseResultaat<0);

  const sommeer = (rows) => {
    const o = {}; SOMKOLS.forEach(k=>o[k]=rows.reduce((s,r)=>s+(r[k]||0),0));
    o.pctBesteed = o.kew!==0 ? o.besteed/o.kew*100 : 0;
    return o;
  };
  const groepen = rubriekNrs.filter(nr=>zicht.some(r=>r.rubriekNr===nr))
    .map(nr => ({ nr, naam:(RUBRIEKEN[nr]||("Rubriek "+nr)), type:typeVanRubriek(nr), bestemming:schermLabelVanRubriek(nr),
                  rows: zicht.filter(r=>r.rubriekNr===nr).sort((a,b)=>a.code-b.code) }));
  const totaal = sommeer(zicht);

  // ── Celopmaak per soort ──
  const tdBase = { padding:"5px 9px", fontSize:11, borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" };
  const sigKleur = (v) => v<0 ? T.danger : (v>0 ? T.budget : T.textMuted);
  const eurOf = (v) => v ? eur0(v) : "—";
  const pctBar = (pct)=>{
    const p = (pct||0)/100; const over = p>1; const w = Math.min(100, Math.round(p*100));
    return (
      <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end" }}>
        <div style={{ width:48, height:6, background:T.border, borderRadius:3, overflow:"hidden", flexShrink:0 }}>
          <div style={{ width:w+"%", height:"100%", background: over?T.danger:(p>0.9?T.forecast:T.budget) }}/>
        </div>
        <span style={{ fontSize:10, color: over?T.danger:T.textSub, minWidth:30, textAlign:"right" }}>{Math.round(p*100)}%</span>
      </div>
    );
  };
  // Sticky linkerkolommen (Code + Omschrijving) blijven staan bij horizontaal scrollen.
  const leftOf = (key) => key==="code" ? 0 : (key==="naam" ? VLAKKEN[0].kols[0].w : null);
  const cel = (r, k, achter) => {
    const v = r[k.key];
    const sticky = leftOf(k.key)!==null;
    const base = { ...tdBase, width:k.w, minWidth:k.w, textAlign: (k.soort==="code"||k.soort==="naam") ? "left" : "right",
                   ...(sticky ? { position:"sticky", left:leftOf(k.key), zIndex:1, background:achter } : {}) };
    if (k.soort==="code")  return <td key={k.key} style={{ ...base, fontWeight:700, color:hoverCode===r.code?P700:T.text }}>{r.code}</td>;
    if (k.soort==="naam")  return <td key={k.key} style={{ ...base, color:T.textSub, maxWidth:k.w, overflow:"hidden", textOverflow:"ellipsis" }} title={r.naam}>{r.naam}</td>;
    if (k.soort==="pct")   return <td key={k.key} style={base}>{pctBar(v)}</td>;
    if (k.soort==="eurResult") return <td key={k.key} style={{ ...base, fontWeight:800, color: v<0?T.danger:T.budget }}>{eur0(v)}</td>;
    if (k.soort==="eurSigned") return <td key={k.key} style={{ ...base, fontWeight:600, color: sigKleur(v) }}>{v?eur0(v):"—"}</td>;
    if (k.soort==="eurB")  return <td key={k.key} style={{ ...base, fontWeight:700, color:T.text }}>{eurOf(v)}</td>;
    return <td key={k.key} style={{ ...base, color:T.textSub }}>{eurOf(v)}</td>;
  };
  // Totaal-/subtotaalcel
  const totCel = (o, k, bg, kleurWit) => {
    if (k.soort==="code"||k.soort==="naam") return null;
    const v = o[k.key];
    const sticky = leftOf(k.key)!==null;
    const base = { ...tdBase, width:k.w, minWidth:k.w, textAlign:"right", fontWeight:800,
                   color: kleurWit ? (k.soort==="eurResult"&&v<0?"#FFB4C0":(k.soort==="eurResult"?"#C1E62E":"#fff")) : (k.soort==="eurResult"?(v<0?T.danger:T.budget):T.text),
                   ...(sticky ? { position:"sticky", left:leftOf(k.key), zIndex:1, background:bg } : { background:bg }) };
    return <td key={k.key} style={base}>{k.soort==="pct" ? Math.round(v||0)+"%" : eur0(v)}</td>;
  };
  const typeBadge = (type, bestemming) => {
    const kl = type==="arbeid" ? "#1F6F8B" : (type==="materieel" ? "#9C6A12" : "#630D80");
    return <span style={{ fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:8, background:kl+"1A", color:kl, border:`1px solid ${kl}33`, marginLeft:8 }}>{type} → {bestemming}</span>;
  };

  const NKOL = ALLEKOLS.length;
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bg, fontFamily:"'Segoe UI',-apple-system,sans-serif" }}>
      {/* Toolbar */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, flexShrink:0, flexWrap:"wrap" }}>
        <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>PER-lijst</span>
        <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:10, background:T.purpleFade, color:T.purple, border:`1px solid ${T.purple}33` }}>KOSTENDRAGERS · VOLLEDIGE KOLOMMENSET</span>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="Zoek op kostencode of omschrijving…" style={{ flex:1, minWidth:200, padding:"6px 11px", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, outline:"none" }}/>
        <select value={fRubriek} onChange={e=>setFRubriek(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, background:T.surface, cursor:"pointer", outline:"none" }}>
          <option value="alle">Alle rubrieken</option>
          {rubriekNrs.map(nr=><option key={nr} value={nr}>R{nr} · {RUBRIEKEN[nr]}</option>)}
        </select>
        <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:T.textSub, cursor:"pointer" }}>
          <input type="checkbox" checked={fNegatief} onChange={e=>setFNeg(e.target.checked)}/> Alleen negatief resultaat
        </label>
        <span style={{ fontSize:11, color:T.textSub, fontWeight:600 }}>{zicht.length} kostendragers</span>
      </div>

      {/* Kop + KPI's */}
      <div style={{ background:KOP1, color:"#fff", padding:"14px 18px", flexShrink:0, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:12, opacity:0.8 }}>Project HAUT · totaaloverzicht per kostendrager</div>
          <div style={{ fontSize:20, fontWeight:800 }}>{zicht.length} kostendragers · {groepen.length} rubrieken</div>
        </div>
        <div style={{ display:"flex", gap:18, textAlign:"right" }}>
          <div><div style={{ fontSize:10, opacity:0.8 }}>Begroting</div><div style={{ fontSize:18, fontWeight:800 }}>{eur0(totaal.begroting)}</div></div>
          <div><div style={{ fontSize:10, opacity:0.8 }}>Kosten einde werk</div><div style={{ fontSize:18, fontWeight:800 }}>{eur0(totaal.kew)}</div></div>
          <div><div style={{ fontSize:10, opacity:0.8 }}>Besteed</div><div style={{ fontSize:18, fontWeight:800 }}>{eur0(totaal.besteed)}</div></div>
          <div><div style={{ fontSize:10, opacity:0.8 }}>Prognose resultaat</div><div style={{ fontSize:18, fontWeight:800, color: totaal.prognoseResultaat<0?"#FFB4C0":"#C1E62E" }}>{eur0(totaal.prognoseResultaat)}</div></div>
        </div>
      </div>

      {/* Brede tabel: 5 verticale vlakken (zoneband) × 21 kolommen, gegroepeerd per rubriek */}
      <div style={{ flex:1, overflow:"auto", padding:"0 0 16px" }}>
        <table style={{ borderCollapse:"separate", borderSpacing:0, width:"max-content", minWidth:"100%" }}>
          <thead>
            {/* Zoneband */}
            <tr>
              {VLAKKEN.map((v,vi)=>{
                const breedte = v.kols.reduce((s,k)=>s+k.w,0);
                const sticky = vi===0;
                return <th key={v.naam} colSpan={v.kols.length}
                  style={{ background:v.bg, color:"#fff", fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.5,
                           padding:"6px 9px", textAlign:"left", position:"sticky", top:0, zIndex:sticky?4:2, minWidth:breedte,
                           ...(sticky?{ left:0 }:{}) , borderRight:"2px solid rgba(255,255,255,0.25)" }}>{v.naam}</th>;
              })}
            </tr>
            {/* Kolomkoppen */}
            <tr>
              {VLAKKEN.map(v => v.kols.map(k=>{
                const sticky = leftOf(k.key)!==null;
                return <th key={k.key}
                  style={{ background:v.tint, color:T.textSub, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:0.3,
                           padding:"7px 9px", textAlign:(k.soort==="code"||k.soort==="naam")?"left":"right", whiteSpace:"nowrap",
                           borderBottom:`2px solid ${T.border}`, width:k.w, minWidth:k.w,
                           position:"sticky", top:26, zIndex:sticky?4:2, ...(sticky?{ left:leftOf(k.key) }:{}) }}>{k.label}</th>;
              }))}
            </tr>
          </thead>
          <tbody>
            {groepen.length===0 && <tr><td colSpan={NKOL} style={{ padding:24, textAlign:"center", color:T.textMuted, fontSize:12 }}>Geen kostendragers gevonden.</td></tr>}
            {groepen.map(g=>{
              const sub = sommeer(g.rows);
              return (
                <Fragment key={g.nr}>
                  <tr>
                    <td colSpan={NKOL} style={{ padding:"6px 10px", fontSize:11, fontWeight:800, color:T.purple, background:P050, borderBottom:`1px solid ${T.border}`, borderTop:`1px solid ${T.border}`, letterSpacing:0.3, position:"sticky", left:0 }}>
                      Rubriek {g.nr} · {g.naam}{typeBadge(g.type, g.bestemming)}<span style={{ fontWeight:400, color:T.textMuted, marginLeft:8 }}>— {g.rows.length} kostendrager(s)</span>
                    </td>
                  </tr>
                  {g.rows.map(r=>{
                    const achter = hoverCode===r.code ? P050 : T.surface;
                    return (
                      <tr key={r.code}
                          onClick={()=>onOpenKd && onOpenKd(r.code)}
                          onMouseEnter={()=>setHoverCode(r.code)} onMouseLeave={()=>setHoverCode(null)}
                          title={`Open ${g.bestemming} van kostendrager ${r.code}`}
                          style={{ background:achter, cursor:"pointer", transition:"background 0.12s" }}>
                        {ALLEKOLS.map(k=>cel(r, k, achter))}
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={{ ...tdBase, position:"sticky", left:0, zIndex:1, background:P100, fontSize:10, fontStyle:"italic", color:T.purple, textAlign:"right" }}>Subtotaal {g.naam} →</td>
                    <td style={{ ...tdBase, position:"sticky", left:VLAKKEN[0].kols[0].w, zIndex:1, background:P100 }}/>
                    {ALLEKOLS.slice(2).map(k=>totCel(sub, k, P100, false))}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...tdBase, position:"sticky", left:0, zIndex:3, background:T.purple, color:"#fff", fontWeight:800 }}>Totaal</td>
              <td style={{ ...tdBase, position:"sticky", left:VLAKKEN[0].kols[0].w, zIndex:3, background:T.purple }}/>
              {ALLEKOLS.slice(2).map(k=>totCel(totaal, k, T.purple, true))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── LOGIN ───────────────────────────────────────────────────────────────────
// ─── LAAG 1 — ACTIEBLAD (projectcontroller: taken + afwijkingen) ───────────────
// Genereert automatisch acties uit de data: afwijkingen (signalen) en taken (to-do's).
// Eén item per (kostendrager × trigger). Bedragen via dezelfde rekenmotor als de rest.
function genereerActies(inkooporders, oaData, invloedData) {
  const items = [];
  KOSTENDRAGERS.forEach((meta) => {
    const code  = meta.id;
    const kd    = getKdData(code);
    const ios   = (inkooporders||[]).filter(io=>io.kdId===code);
    const allOA = (oaData||[]).filter(o=>o.kdId===code);
    const allInv= (invloedData||[]).filter(i=>i.kdId===code);
    const geb   = new Set(ios.flatMap(io=>io.oaIds||[]));
    const c     = berekenKD(kd, ios, allOA, allInv, geb);
    const rb    = kd.rubriek;
    const m     = { kdId:code, kdCode:kd.code, kdNaam:kd.naam, rubriek:rb };
    const eigenScherm = schermVanRubriek(rb);
    const push = (trg, o) => items.push({ ...m, trg, id:`${code}|${trg}`, ...o });

    // ── AFWIJKINGEN ──
    if (c.prognoseResultaat < 0)
      push("RES", { soort:"afwijking", categorie:"Resultaat",
        ernst: c.prognoseResultaat <= -25000 ? "kritiek" : "hoog",
        titel:"Negatief prognose resultaat",
        detail:`Prognose resultaat ${fmt(c.prognoseResultaat)} — bijsturing nodig.`,
        bedrag:c.prognoseResultaat, doel:eigenScherm });

    if (c.deltaVorige <= -5000)
      push("TREND", { soort:"afwijking", categorie:"Trend",
        ernst: c.deltaVorige <= -15000 ? "hoog" : "middel",
        titel:"Resultaat verslechterd t.o.v. vorige periode",
        detail:`Daling van ${fmt(Math.abs(c.deltaVorige))} sinds de vorige prognose.`,
        bedrag:c.deltaVorige, doel:eigenScherm });

    if (typeVanRubriek(rb)==="contract" && c.inkoopresultaat < 0)
      push("INK", { soort:"afwijking", categorie:"Inkoop",
        ernst:"middel",
        titel:"Boven begroting ingekocht",
        detail:`Inkoopresultaat ${fmt(c.inkoopresultaat)} (begrotingsregels − inkoop − reserve).`,
        bedrag:c.inkoopresultaat, doel:"kdbewaking" });

    if (c.kew > 0 && (c.besteed - c.kew) >= 1000)
      push("BEST", { soort:"afwijking", categorie:"Besteding",
        ernst:"hoog",
        titel:"Bestedingen boven prognose",
        detail:`Reeds ${fmt(c.besteed)} besteed t.o.v. prognose kosten einde werk ${fmt(c.kew)}.`,
        bedrag:c.besteed - c.kew, doel:eigenScherm });

    if (kd.arbeid && c._arbeid && c._arbeid.prognoseUren > c._arbeid.begrooteUren) {
      const over = c._arbeid.prognoseUren - c._arbeid.begrooteUren;
      push("TIJD", { soort:"afwijking", categorie:"Tijd",
        ernst: over > c._arbeid.begrooteUren*0.10 ? "hoog" : "middel",
        titel:"Ureninzet boven begroting",
        detail:`Prognose ${Math.round(c._arbeid.prognoseUren)} uur vs. begroot ${Math.round(c._arbeid.begrooteUren)} uur (+${Math.round(over)} u).`,
        bedrag: over * (c._arbeid.tarief||0), doel:"arbeid" });
    }

    if (kd.materieel && c._materieel && c._materieel.prognose > c._materieel.begrote)
      push("TIJD", { soort:"afwijking", categorie:"Tijd",
        ernst:"middel",
        titel:"Materieelinzet boven begroting",
        detail:`Prognose ${fmt(c._materieel.prognose)} vs. begroot ${fmt(c._materieel.begrote)} inzet.`,
        bedrag: c._materieel.prognose - c._materieel.begrote, doel:"materieel" });

    // ── TAKEN ──
    const oaOpen = allOA.filter(o=>o.status==="In onderhandeling");
    if (oaOpen.length) {
      const som = oaOpen.reduce((s,o)=>s+(o.gemeld||0),0);
      const oudste = Math.max(0, ...oaOpen.map(o=>o.dagen||0));
      push("MMW_OA", { soort:"taak", categorie:"MMW",
        ernst: oudste > 30 ? "hoog" : "middel",
        titel:"MMW-meldingen afhandelen",
        detail:`${oaOpen.length} melding(en) in onderhandeling · ${fmt(som)}${oudste?` · oudste ${oudste} dagen open`:""}.`,
        bedrag:som, doel:"afrekenblad" });
    }

    const ioOpen = ios.filter(io=>!io.actieUitgevoerd);
    if (ioOpen.length) {
      const som = ioOpen.reduce((s,io)=>s+(io.committed||0),0);
      push("IA", { soort:"taak", categorie:"Inkoopactie",
        ernst:"hoog",
        titel:"Inkoopactie uitvoeren",
        detail:`${ioOpen.length} inkooporder(s) nog niet verwerkt (${fmt(som)} gecommitteerd): ${ioOpen.map(io=>io.id).join(", ")}.`,
        bedrag:som, doel:"afrekenblad" });
    }

    const invOpen = allInv.filter(i=>i.status==="Verwacht");
    if (invOpen.length) {
      const som = invOpen.reduce((s,i)=>s+(i.bedrag||0),0);
      push("MMW_OG", { soort:"taak", categorie:"MMW",
        ernst:"middel",
        titel:"Invloed MMW laten goedkeuren (OG)",
        detail:`${invOpen.length} post(en) · ${fmt(som)} zacht budget nog niet goedgekeurd door opdrachtgever.`,
        bedrag:som, doel:"afrekenblad" });
    }

    const ioRisico = ios.filter(io=>(io.risico||0)>0);
    if (ioRisico.length) {
      const som = ioRisico.reduce((s,io)=>s+(io.risico||0),0);
      push("RISICO", { soort:"taak", categorie:"Risico",
        ernst: som >= 15000 ? "middel" : "laag",
        titel:"Risicodekking beoordelen",
        detail:`${fmt(som)} risicodekking op ${ioRisico.length} inkooporder(s) — herijken of laten vrijvallen.`,
        bedrag:som, doel:"risico" });
    }

    const restOpen = (kd.restantBudget||[]).filter(r=>(r.nogUitTeGeven||0)>0);
    if (restOpen.length) {
      const som = restOpen.reduce((s,r)=>s+(r.nogUitTeGeven||0),0);
      push("BUDGET", { soort:"taak", categorie:"Budget",
        ernst:"laag",
        titel:"Restant budget: besteden of laten vrijvallen",
        detail:`${fmt(som)} nog uit te geven over ${restOpen.length} budgetregel(s).`,
        bedrag:som, doel:"kdbewaking" });
    }
  });
  return items;
}

function Actieblad({ inkooporders, oaData, invloedData, onOpenActie }) {
  const P900="#3D0850", P800="#4F0A68", P700="#630D80", P600="#7A2E96", P200="#E3CEEC", P100="#F1E5F6", P050="#F8F2FB";
  const KOP1=`linear-gradient(100deg, ${P900}, ${P700})`;

  const [afgehandeld, setAfgehandeld] = useState(() => new Set());
  const [fSoort, setFSoort]   = useState("alle");   // (legacy) alle | afwijking | taak
  const [tab, setTab]         = useState("taken");  // taken | analyse
  const [fErnst, setFErnst]   = useState("alle");
  const [fRubriek, setFRubriek] = useState("alle");
  const [toonAf, setToonAf]   = useState(false);

  const alle = useMemo(() => genereerActies(inkooporders, oaData, invloedData), [inkooporders, oaData, invloedData]);

  const ERNST = {
    kritiek: { rang:0, kleur:"#B5546B", licht:"#FBEAEF", label:"Kritiek" },
    hoog:    { rang:1, kleur:"#C0612E", licht:"#FBF0E8", label:"Hoog" },
    middel:  { rang:2, kleur:"#9C7A12", licht:"#FAF6E6", label:"Middel" },
    laag:    { rang:3, kleur:"#5B6470", licht:"#F2F4F6", label:"Laag" },
  };
  const typeKleur = { contract:"#630D80", arbeid:"#5B6470", materieel:"#9C6A12", opbrengst:"#2F7D5B" };

  const open = alle.filter(a => !afgehandeld.has(a.id));
  const kpiKritiek  = open.filter(a => a.ernst==="kritiek").length;
  const kpiTaken    = open.filter(a => a.soort==="taak").length;
  const kpiAfw      = open.filter(a => a.soort==="afwijking").length;
  const kpiNegRes   = alle.filter(a => a.trg==="RES").reduce((s,a)=>s+(a.bedrag||0),0);
  const kpiMMW      = alle.filter(a => a.categorie==="MMW").reduce((s,a)=>s+(a.bedrag||0),0);

  const zicht = alle.filter(a =>
    (a.soort === (tab==="taken" ? "taak" : "afwijking")) &&
    (fErnst==="alle"   || a.ernst===fErnst) &&
    (fRubriek==="alle" || String(a.rubriek)===fRubriek) &&
    (toonAf || !afgehandeld.has(a.id))
  );
  const gesorteerd = [...zicht].sort((a,b) =>
    ERNST[a.ernst].rang - ERNST[b.ernst].rang || Math.abs(b.bedrag||0) - Math.abs(a.bedrag||0));
  const groepen = ["kritiek","hoog","middel","laag"]
    .map(e => ({ ernst:e, rows: gesorteerd.filter(r => r.ernst===e) }))
    .filter(g => g.rows.length);

  const rubriekenInData = [...new Set(alle.map(a=>a.rubriek))].sort((a,b)=>a-b);
  const toggleAf = (id) => setAfgehandeld(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });


  const selectSt = { padding:"6px 10px", border:`1px solid ${T.border}`, borderRadius:7, fontSize:12, background:T.surface, color:T.text, cursor:"pointer", outline:"none" };

  const Kpi = ({ label, waarde, kleur, sub }) => (
    <div style={{ flex:1, background:P050, borderRadius:10, padding:"10px 13px", borderLeft:`4px solid ${kleur}` }}>
      <div style={{ fontSize:9, fontWeight:700, color:kleur, textTransform:"uppercase", letterSpacing:0.4 }}>{label}</div>
      <div style={{ fontSize:19, fontWeight:800, color:T.text, marginTop:2, letterSpacing:-0.4 }}>{waarde}</div>
      {sub && <div style={{ fontSize:9, color:T.textMuted, marginTop:1 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bg, fontFamily:"'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif" }}>
      {/* Toolbar */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>Actieblad</span>
          <span style={{ fontSize:11, color:T.textSub }}>projectcontroller · taken &amp; afwijkingen</span>
        </div>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.purpleFade, border:`1px solid ${T.purple}33`, borderRadius:6, padding:"4px 10px" }}>
          <span style={{ fontSize:12, fontWeight:700, color:T.purple }}>HAUT</span>
          <span style={{ fontSize:11, color:T.text }}>houten woontoren · Amsterdam</span>
        </span>
      </div>

      {/* KPI-strip */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, flexShrink:0 }}>
        <Kpi label="Kritieke afwijkingen" waarde={kpiKritiek} kleur="#B5546B" sub="direct bijsturen" />
        <Kpi label="Open afwijkingen" waarde={kpiAfw} kleur="#C0612E" sub="signalen" />
        <Kpi label="Open taken" waarde={kpiTaken} kleur={P600} sub="nog te doen" />
        <Kpi label="Negatief resultaat" waarde={eur0(kpiNegRes)} kleur="#B5546B" sub="som negatieve prognoses" />
        <Kpi label="Openstaand MMW" waarde={eur0(kpiMMW)} kleur="#9C7A12" sub="onderhandeling + verwacht" />
      </div>

      {/* Filters */}
      <div style={{ padding:"8px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ display:"flex", border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
          {[{k:"taken",l:`Taken (${kpiTaken})`},{k:"analyse",l:`Analyse (${kpiAfw})`}].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)} style={{ padding:"6px 18px", border:"none", background: tab===t.k ? T.purple : "#fff", color: tab===t.k ? "#fff" : T.textSub, fontSize:12, fontWeight:700, cursor:"pointer" }}>{t.l}</button>
          ))}
        </div>
        <select value={fErnst} onChange={e=>setFErnst(e.target.value)} style={selectSt}>
          <option value="alle">Alle ernst</option>
          <option value="kritiek">Kritiek</option>
          <option value="hoog">Hoog</option>
          <option value="middel">Middel</option>
          <option value="laag">Laag</option>
        </select>
        <select value={fRubriek} onChange={e=>setFRubriek(e.target.value)} style={selectSt}>
          <option value="alle">Alle rubrieken</option>
          {rubriekenInData.map(nr => <option key={nr} value={String(nr)}>{nr} · {RUBRIEKEN[nr]}</option>)}
        </select>
        <label style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12, color:T.textSub, cursor:"pointer", marginLeft:"auto" }}>
          <input type="checkbox" checked={toonAf} onChange={e=>setToonAf(e.target.checked)} />
          Toon afgehandeld ({afgehandeld.size})
        </label>
      </div>

      {/* Lijst */}
      <div style={{ flex:1, overflow:"auto", padding:"12px 16px" }}>
        {groepen.length===0 && (
          <div style={{ textAlign:"center", padding:"60px 20px", color:T.textMuted }}>
            <div style={{ fontSize:32, marginBottom:8 }}>✓</div>
            <div style={{ fontSize:14, fontWeight:700, color:T.text }}>Alles bij</div>
            <div style={{ fontSize:12, marginTop:4 }}>Geen openstaande acties die aan de filters voldoen.</div>
          </div>
        )}

        {groepen.map(g => {
          const meta = ERNST[g.ernst];
          return (
            <div key={g.ernst} style={{ marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{ width:10, height:10, borderRadius:3, background:meta.kleur }}/>
                <span style={{ fontSize:12, fontWeight:800, color:meta.kleur, textTransform:"uppercase", letterSpacing:0.5 }}>{meta.label}</span>
                <span style={{ fontSize:11, color:T.textSub }}>· {g.rows.length}</span>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {g.rows.map(a => {
                  const isAf = afgehandeld.has(a.id);
                  const isAfw = a.soort==="afwijking";
                  return (
                    <div key={a.id} style={{
                      display:"flex", alignItems:"stretch", background:T.surface, border:`1px solid ${T.border}`,
                      borderLeft:`4px solid ${meta.kleur}`, borderRadius:10, overflow:"hidden", opacity:isAf?0.55:1 }}>
                      {/* Inhoud */}
                      <div style={{ flex:1, padding:"10px 14px", minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3, flexWrap:"wrap" }}>
                          <span style={{ fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:5, textTransform:"uppercase", letterSpacing:0.4,
                            background:isAfw?"#FBEAEF":P100, color:isAfw?"#B5546B":P700 }}>{isAfw?"Afwijking":"Taak"}</span>
                          <span style={{ fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:5, background:T.bg, color:T.textSub, border:`1px solid ${T.border}` }}>{a.categorie}</span>
                          <span style={{ fontSize:13, fontWeight:700, color:T.text, textDecoration:isAf?"line-through":"none" }}>{a.titel}</span>
                        </div>
                        <div style={{ fontSize:11, color:T.textSub, marginBottom:6 }}>{a.detail}</div>
                        <div style={{ display:"inline-flex", alignItems:"center", gap:7, background:T.bg, border:`1px solid ${T.border}`, borderRadius:6, padding:"3px 9px" }}>
                          <span style={{ width:8, height:8, borderRadius:"50%", background:typeKleur[typeVanRubriek(a.rubriek)], flexShrink:0 }}/>
                          <span style={{ fontSize:11, fontWeight:700, color:T.purple }}>{a.kdCode}</span>
                          <span style={{ fontSize:11, color:T.text }}>{a.kdNaam}</span>
                          <span style={{ fontSize:10, color:T.textMuted }}>· R{a.rubriek} {RUBRIEKEN[a.rubriek]}</span>
                        </div>
                      </div>
                      {/* Bedrag + acties */}
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center", gap:7, padding:"10px 14px", borderLeft:`1px solid ${T.border}`, background:P050, minWidth:150 }}>
                        <div style={{ fontSize:15, fontWeight:800, color:(a.bedrag||0)<0?"#B5546B":T.text, letterSpacing:-0.4 }}>{eur0(a.bedrag)}</div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>onOpenActie(a.kdId, a.doel)}
                            style={{ fontSize:11, fontWeight:700, padding:"5px 11px", borderRadius:7, border:"none", background:T.purple, color:"#fff", cursor:"pointer" }}>Open →</button>
                          <button onClick={()=>toggleAf(a.id)} title={isAf?"Heropenen":"Markeer als afgehandeld"}
                            style={{ fontSize:11, fontWeight:700, padding:"5px 10px", borderRadius:7, cursor:"pointer",
                              border:`1px solid ${isAf?T.border:T.budget}`, background:isAf?T.surface:"#fff", color:isAf?T.textSub:T.budget }}>
                            {isAf?"Heropenen":"✓ Afhandelen"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background:P050, padding:"7px 16px", fontSize:10, color:T.textSub, borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
        Automatisch gegenereerd uit de actuele data — afwijkingen (signalen) en taken (to-do&apos;s) over alle kostendragers. Afhandelen geldt voor deze sessie. Klik <strong style={{color:P700}}>Open →</strong> om naar de bron te springen.
      </div>
    </div>
  );
}


const APP_WACHTWOORD = "JPvanEesteren2026!";
const GEBRUIKERS = [
  { naam:"Frank van Alphen",  rol:"Business Improvement" },
  { naam:"Chris Louman",      rol:"Business Improvement" },
  { naam:"Charles Bronzwaer", rol:"Business Improvement" },
  { naam:"Jan Koolbergen",    rol:"Business Improvement" },
];

function LoginScherm({ onLogin }) {
  const [gekozen, setGekozen]   = useState(null);   // gekozen gebruikersnaam
  const [wachtwoord, setWw]     = useState("");
  const [fout, setFout]         = useState(false);

  const initialen = (naam) => naam.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();

  const probeer = () => {
    if (wachtwoord === APP_WACHTWOORD) {
      onLogin(gekozen);
    } else {
      setFout(true);
    }
  };

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif", background:T.purple, overflow:"hidden" }}>
      {/* decoratieve vlakken — JPE-stijl */}
      <div style={{ position:"absolute", top:-80, right:-80, width:280, height:280, borderRadius:"50%", background:"rgba(255,255,255,0.05)", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", bottom:-100, left:-60, width:240, height:240, borderRadius:"50%", background:"rgba(193,230,46,0.07)", pointerEvents:"none" }}/>

      <div style={{ width:420, background:T.surface, borderRadius:14, padding:"36px 36px 30px", boxShadow:"0 20px 60px rgba(0,0,0,0.3)", position:"relative", zIndex:1 }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <div style={{ width:38, height:38, background:T.lime, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <span style={{ fontWeight:800, color:T.purple, fontSize:15 }}>JPE</span>
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:T.purple, letterSpacing:-0.3 }}>KPS 3.0</div>
            <div style={{ fontSize:10, color:T.textMuted }}>Financiële beheersing · J.P. van Eesteren</div>
          </div>
        </div>

        {!gekozen ? (
          <>
            <div style={{ fontSize:13, fontWeight:600, color:T.text, margin:"22px 0 12px" }}>Kies je gebruiker</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {GEBRUIKERS.map(u => (
                <button key={u.naam} onClick={()=>{ setGekozen(u.naam); setFout(false); setWw(""); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", border:`1px solid ${T.border}`, borderRadius:9, background:T.surface, cursor:"pointer", textAlign:"left", transition:"all 0.12s" }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=T.purple;e.currentTarget.style.background=T.purpleFade;}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.surface;}}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:T.purple, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, flexShrink:0 }}>{initialen(u.naam)}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{u.naam}</div>
                    <div style={{ fontSize:11, color:T.textMuted }}>{u.rol}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:12, margin:"22px 0 16px", padding:"11px 14px", background:T.purpleFade, borderRadius:9 }}>
              <div style={{ width:36, height:36, borderRadius:"50%", background:T.purple, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13, flexShrink:0 }}>{initialen(gekozen)}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.text }}>{gekozen}</div>
                <button onClick={()=>{ setGekozen(null); setWw(""); setFout(false); }} style={{ fontSize:11, color:T.purple, background:"none", border:"none", padding:0, cursor:"pointer", textDecoration:"underline" }}>andere gebruiker</button>
              </div>
            </div>
            <label style={{ fontSize:11, fontWeight:600, color:T.textSub, display:"block", marginBottom:6 }}>Wachtwoord</label>
            <input type="password" value={wachtwoord} autoFocus
              onChange={e=>{ setWw(e.target.value); setFout(false); }}
              onKeyDown={e=>{ if(e.key==="Enter") probeer(); }}
              placeholder="Voer wachtwoord in"
              style={{ width:"100%", padding:"10px 12px", border:`1px solid ${fout?T.danger:T.border}`, borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }}/>
            {fout && <div style={{ fontSize:11, color:T.danger, marginTop:7 }}>Onjuist wachtwoord. Probeer opnieuw.</div>}
            <button onClick={probeer} disabled={!wachtwoord}
              style={{ width:"100%", marginTop:16, padding:"11px", background:T.purple, color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:wachtwoord?"pointer":"not-allowed", opacity:wachtwoord?1:0.5 }}>
              Inloggen
            </button>
          </>
        )}
        <div style={{ fontSize:10, color:T.textMuted, textAlign:"center", marginTop:22 }}>Interne tool · uitsluitend voor geautoriseerde gebruikers</div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

// ─── TABBLAD — CENTRALE REGELS (begroting / bestedingen) ─────────────────────
function RegelTabel({ titel, badge, regels, kolommen, defaultSortKey, bedragVeld, bedragLabel }) {
  const [zoek, setZoek]       = useState("");
  const [rubriek, setRubriek] = useState("alle");
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState("asc");
  const toggleSort = (k) => { if (sortKey===k) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir("asc"); } };

  const nf   = (v,d)=> new Intl.NumberFormat("nl-NL",{minimumFractionDigits:d,maximumFractionDigits:d}).format(v||0);
  const fmtCel = (r, col) => {
    const v = r[col.key];
    if (v==null || v==="") return "—";
    switch(col.type){
      case "eur":  return eur0(v);
      case "num2": return nf(v,2);
      case "num1": return nf(v,1);
      case "num0": return nf(v,0);
      case "rubriek": return `R${v} · ${RUBRIEKEN[v]||"?"}`;
      default: return String(v);
    }
  };

  const zoekL = zoek.trim().toLowerCase();
  const gefilterd = regels.filter(r =>
    (rubriek==="alle" || r.rubriek===Number(rubriek)) &&
    (zoekL==="" || String(r.kostencode).includes(zoekL) || (r.omschrijving||"").toLowerCase().includes(zoekL))
  );
  const gesorteerd = [...gefilterd].sort((a,b)=>{
    let va=a[sortKey], vb=b[sortKey]; if(va==null)va=""; if(vb==null)vb="";
    if(typeof va==="number" && typeof vb==="number") return sortDir==="asc"?va-vb:vb-va;
    return sortDir==="asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
  const totaal = gefilterd.reduce((s,r)=>s+(r[bedragVeld]||0),0);
  const perRubriek = {}; gefilterd.forEach(r=>{ perRubriek[r.rubriek]=(perRubriek[r.rubriek]||0)+(r[bedragVeld]||0); });
  const rubriekenAanwezig = [...new Set(regels.map(r=>r.rubriek))].sort((a,b)=>a-b);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden", background:T.bg, fontFamily:"'Segoe UI',-apple-system,sans-serif" }}>
      {/* Toolbar */}
      <div style={{ padding:"10px 16px", background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:12, flexShrink:0, flexWrap:"wrap" }}>
        <span style={{ fontSize:14, fontWeight:700, color:T.purple }}>{titel}</span>
        <span style={{ fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:10, background:T.purpleFade, color:T.purple, border:`1px solid ${T.purple}33` }}>{badge}</span>
        <input value={zoek} onChange={e=>setZoek(e.target.value)} placeholder="Zoek op kostencode of omschrijving…" style={{ flex:1, minWidth:200, padding:"6px 11px", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, outline:"none" }}/>
        <select value={rubriek} onChange={e=>setRubriek(e.target.value)} style={{ padding:"6px 10px", border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, background:T.surface, cursor:"pointer", outline:"none" }}>
          <option value="alle">Alle rubrieken</option>
          {rubriekenAanwezig.map(r=><option key={r} value={r}>R{r} · {RUBRIEKEN[r]}</option>)}
        </select>
        <span style={{ fontSize:11, color:T.textSub, fontWeight:600 }}>{gefilterd.length} regels</span>
      </div>

      {/* Rubriek-totalen */}
      <div style={{ padding:"10px 16px", display:"flex", gap:8, flexWrap:"wrap", flexShrink:0, borderBottom:`1px solid ${T.border}`, background:T.bg }}>
        <div style={{ background:T.purple, color:"#fff", borderRadius:8, padding:"7px 13px", minWidth:130 }}>
          <div style={{ fontSize:9, opacity:0.8, textTransform:"uppercase", letterSpacing:0.4, fontWeight:700 }}>Totaal {bedragLabel}</div>
          <div style={{ fontSize:16, fontWeight:800 }}>{eur0(totaal)}</div>
        </div>
        {rubriekenAanwezig.filter(r=>perRubriek[r]).map(r=>(
          <div key={r} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 11px", minWidth:108 }}>
            <div style={{ fontSize:9, color:T.textSub, fontWeight:700 }}>R{r} · {RUBRIEKEN[r]}</div>
            <div style={{ fontSize:13, fontWeight:700, color:T.text }}>{eur0(perRubriek[r])}</div>
          </div>
        ))}
      </div>

      {/* Tabel */}
      <div style={{ flex:1, overflow:"auto", padding:"0 16px 16px" }}>
        <table style={{ borderCollapse:"collapse", width:"100%", minWidth:1000 }}>
          <thead>
            <tr>
              {kolommen.map(col=>(
                <th key={col.key} onClick={()=>toggleSort(col.key)}
                  style={{ padding:"7px 9px", fontSize:9, fontWeight:700, color:T.textSub, textTransform:"uppercase", letterSpacing:0.3, textAlign:col.right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", borderBottom:`2px solid ${T.border}`, position:"sticky", top:0, background:T.surface, minWidth:col.w, zIndex:1 }}>
                  {col.label}{sortKey===col.key?(sortDir==="asc"?" ▲":" ▼"):""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gesorteerd.map((r,i)=>(
              <tr key={r.id} style={{ background: i%2===0?T.surface:T.bg }}>
                {kolommen.map(col=>{
                  const neg = col.type==="eur" && (r[col.key]||0)<0;
                  return (
                    <td key={col.key} title={col.type==="text"?String(r[col.key]??""):undefined}
                      style={{ padding:"5px 9px", fontSize:11, textAlign:col.right?"right":"left",
                        color: neg?T.danger:(col.bold?T.text:(col.type==="rubriek"?T.purple:T.textSub)),
                        fontWeight: col.bold?700:(col.type==="rubriek"?600:400),
                        whiteSpace:"nowrap", borderBottom:`1px solid ${T.border}`, fontVariantNumeric:"tabular-nums",
                        maxWidth:(col.key==="omschrijving"||col.key==="omschrijvingContractregel")?240:undefined, overflow:"hidden", textOverflow:"ellipsis" }}>
                      {fmtCel(r,col)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {gesorteerd.length===0 && <tr><td colSpan={kolommen.length} style={{ padding:24, textAlign:"center", color:T.textMuted, fontSize:12 }}>Geen regels gevonden.</td></tr>}
          </tbody>
          <tfoot>
            <tr style={{ background:T.purpleFade }}>
              {kolommen.map((col,ci)=>(
                <td key={col.key} style={{ padding:"7px 9px", fontSize:11, textAlign:col.right?"right":"left", color:T.purple, fontWeight:700, borderTop:`2px solid ${T.purple}33`, whiteSpace:"nowrap" }}>
                  {ci===0 ? "Totaal" : (col.key===bedragVeld ? eur0(totaal) : "")}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BegrotingRegelsTab() {
  return <RegelTabel titel="Begrotingsregels" badge="CENTRALE BEGROTING" regels={BEGROTINGSREGELS} kolommen={BEGROTING_KOLOMMEN} defaultSortKey="kostencode" bedragVeld="bedrag" bedragLabel="begroting"/>;
}
function BestedingRegelsTab() {
  return <RegelTabel titel="Bestedingsregels" badge="CENTRALE BESTEDINGEN" regels={BESTEDINGSREGELS} kolommen={BESTEDING_KOLOMMEN} defaultSortKey="kostencode" bedragVeld="bestedBedrag" bedragLabel="besteed"/>;
}

export default function App() {
  // ── Authenticatie (sessie) ──
  const [currentUser, setCurrentUser] = useState("Frank van Alphen"); // TIJDELIJK: authenticatie uit — zet terug op null om login weer aan te zetten
  const [screen, setScreen]         = useState("actieblad");
  const [selectedKd, setSelectedKd] = useState("2155008");
  const [recentKds, setRecentKds]   = useState(["2155008","2165008","2365008"]); // meest recent gebruikt
  const [kdSearch, setKdSearch]     = useState("");
  const [selectedIO, setSelectedIO]     = useState(null);
  const [iaReadonly, setIaReadonly]     = useState(false); // true = alleen overzicht (klik op bestaande IO)
  const [preselectedOA, setPreOA]       = useState(null);
  const [inkooporders, setInkooporders] = useState(initInkooporders);
  const [oaData, setOaData]             = useState(initOaData);
  const [invloedData, setInvloedData]   = useState(initInvloedMMW);

  // Kies een kostendrager — werkt door over dashboard/afrekenblad/risico en houdt 'recent' bij
  const chooseKd = (kdId) => {
    setSelectedKd(kdId);
    setRecentKds(prev => [kdId, ...prev.filter(id => id !== kdId)].slice(0, 5));
  };

  const addInkooporder = (nieuwIO) => {
    setInkooporders(prev => {
      const idx = prev.findIndex(io => io.id === nieuwIO.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = nieuwIO;
        return next;
      }
      return [...prev, nieuwIO];
    });
  };

  const updateRisico = (ioId, nieuwRisico, logEntry) => {
    setInkooporders(prev =>
      prev.map(io => {
        if (io.id !== ioId) return io;
        const log = io.risicoLog || [];
        return {
          ...io,
          risico: nieuwRisico,
          risicoLog: logEntry ? [...log, logEntry] : log,
        };
      })
    );
  };

  // ── FASE 1 — statushandlers ────────────────────────────────────────────────
  // Concept-IO versturen naar 4PS: status blijft Concept (in fiattering), blijft in blok 2.
  const verzendIOnaarERP = (ioId) =>
    setInkooporders(prev => prev.map(io => io.id===ioId ? { ...io, verzondenERP:true } : io));

  // ERP-simulatie — de ENIGE weg naar Goedgekeurd/Afgekeurd (nooit handmatig).
  //   besluit "Goedgekeurd": optioneel een aangepast 4PS-bedrag (werkt committed bij → correctieregel sluit).
  //                          Gevolg (afgeleid): IO → blok 1, budgetregels gearresteerd, invloed vlak 4→3,
  //                          OA's verhuizen naar de blok-1-historie (doorgestreept in blok 2).
  //   besluit "Afgekeurd":   IO → Afgekeurd; gekoppelde OA's komen weer los, budgetregels weer vrij (afgeleid).
  const simuleerERP = (ioId, besluit, opties={}) =>
    setInkooporders(prev => prev.map(io => {
      if (io.id !== ioId) return io;
      if (besluit === "Goedgekeurd") {
        const nieuwBedrag = (opties.nieuwBedrag!=null && !isNaN(opties.nieuwBedrag)) ? Number(opties.nieuwBedrag) : io.committed;
        return { ...io, status:"Goedgekeurd", verzondenERP:true, committed:nieuwBedrag, erpDatum:opties.datum||io.datum };
      }
      return { ...io, status:"Afgekeurd", verzondenERP:true, erpDatum:opties.datum||io.datum };
    }));

  // OA-melding handmatig op een andere status zetten (Nieuw/In onderhandeling/Akkoord/Vervallen).
  const setOAStatus = (oaId, status) =>
    setOaData(prev => prev.map(o => o.id===oaId ? { ...o, status } : o));

  // OA-melding handmatig loskoppelen van een (concept-)IO → terug naar los in blok 2.
  const koppelOAlos = (oaId, ioId) =>
    setInkooporders(prev => prev.map(io => io.id===ioId ? { ...io, oaIds:(io.oaIds||[]).filter(id=>id!==oaId) } : io));


  const nav = [
    { id:"actieblad",   label:"Actieblad",           icon:"◉", groep:"Hele project" },
    { id:"perlijst",    label:"PER-lijst",           icon:"☰", groep:"Hele project" },
    { id:"begroting",   label:"Begroting",           icon:"▦", groep:"Hele project" },
    { id:"bestedingen", label:"Bestedingen",         icon:"€", groep:"Hele project" },
    { id:"arbeid",      label:"Arbeid",              icon:"◷", groep:"Per kostendrager" },
    { id:"materieel",   label:"ABK",                 icon:"▤", groep:"Per kostendrager" },
    { id:"kdbewaking",  label:"KOS blad",            icon:"▣", groep:"Per kostendrager" },
    { id:"risico",      label:"Risicodekking",       icon:"◆", groep:"Per kostendrager" },
    { id:"afrekenblad", label:"Afrekenblad",         icon:"⊞", groep:"Per kostendrager" },
  ];

  const handleSelectIO = (io) => {
    setSelectedIO(io.id);   // sla alleen het ID op, niet het object
    setIaReadonly(true);    // klik op bestaande inkooporder = alleen overzicht (definitief)
    setScreen("inkoopactie");
  };

  // Breadcrumb labels
  const crumb = {
    actieblad:   ["KPS 3.0", "Actieblad"],
    afrekenblad: ["KPS 3.0", "Afrekenblad"],
    risico:      ["KPS 3.0", "Risicodekking"],
    arbeid:      ["KPS 3.0", "Bewaking arbeid (uren)"],
    materieel:   ["KPS 3.0", "Bewaking materieel (ABK)"],
    kdbewaking:  ["KPS 3.0", "KOS blad"],
    begroting:   ["KPS 3.0", "Begrotingsregels"],
    bestedingen: ["KPS 3.0", "Bestedingsregels"],
    nieuwio:     ["KPS 3.0", "Afrekenblad", "Inkooporder aanmaken"],
    inkoopactie: ["KPS 3.0", "Afrekenblad", selectedIO, "Inkoopactie"],
  }[screen] || ["KPS 3.0"];

  // Niet ingelogd → toon loginscherm
  if (!currentUser) {
    return <LoginScherm onLogin={setCurrentUser}/>;
  }

  return (
    <div style={{ position:"absolute", inset:0, display:"flex", fontFamily:"'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif", background:T.bg, color:T.text, overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width:220, background:T.purple, display:"flex", flexDirection:"column", flexShrink:0, overflowY:"auto", overflowX:"hidden" }}>

        {/* Decoratief vlak — JPE-stijl rechtsboven */}
        <div style={{ position:"absolute", top:-40, right:-40, width:140, height:140, borderRadius:"50%", background:"rgba(255,255,255,0.05)", pointerEvents:"none" }}/>
        <div style={{ position:"absolute", top:20, right:-20, width:80, height:80, borderRadius:"50%", background:"rgba(255,255,255,0.04)", pointerEvents:"none" }}/>

        {/* Logo */}
        <div style={{ padding:"22px 20px 18px", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* JPE logo mark */}
            <div style={{ width:32, height:32, background:T.lime, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ fontSize:13, fontWeight:900, color:T.purple, letterSpacing:-1 }}>JP</span>
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:"#fff", letterSpacing:0.2, lineHeight:1.1 }}>jp van eesteren</div>
              <div style={{ fontSize:8, color:"rgba(255,255,255,0.45)", letterSpacing:1, textTransform:"uppercase" }}>| TBI</div>
            </div>
          </div>
          <div style={{ marginTop:12, fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.9)", letterSpacing:0.3 }}>KPS 3.0</div>
          <div style={{ fontSize:9, color:"rgba(255,255,255,0.4)", marginTop:1, letterSpacing:0.3 }}>Financiële beheersing</div>
        </div>

        {/* Project */}
        <div style={{ padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, marginBottom:4 }}>Project</div>
          <div style={{ fontSize:12, color:"#fff", fontWeight:600 }}>HAUT — houten woontoren</div>
        </div>

        {/* Kostendrager kiezer — top 5 recent + zoeken */}
        <div style={{ padding:"14px 20px", borderBottom:"1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, marginBottom:8 }}>Kostendrager</div>

          {/* Zoekbalk */}
          <input
            value={kdSearch}
            onChange={e=>setKdSearch(e.target.value)}
            placeholder="Zoek kostendrager..."
            style={{ width:"100%", boxSizing:"border-box", fontSize:11, padding:"6px 9px", borderRadius:6, border:"1px solid rgba(255,255,255,0.2)", background:"rgba(255,255,255,0.08)", color:"#fff", outline:"none", marginBottom:8 }}
          />

          {(() => {
            const q = kdSearch.trim().toLowerCase();
            // Bij zoeken: toon matches (max 8). Anders: toon recent gebruikte (max 5).
            const lijst = q
              ? KOSTENDRAGERS.filter(kd => kd.id.toLowerCase().includes(q) || kd.naam.toLowerCase().includes(q)).slice(0, 8)
              : recentKds.map(id => KOSTENDRAGERS.find(kd => kd.id===id)).filter(Boolean).slice(0, 5);
            return (
              <>
                {!q && <div style={{ fontSize:8, color:"rgba(255,255,255,0.3)", marginBottom:4, letterSpacing:0.5 }}>RECENT GEBRUIKT</div>}
                {lijst.length===0 && <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", padding:"6px 0" }}>Geen kostendrager gevonden</div>}
                {lijst.map(kd => {
                  const active = selectedKd===kd.id;
                  return (
                    <div
                      key={kd.id}
                      onClick={()=>{ chooseKd(kd.id); setKdSearch(""); if(screen!=="afrekenblad"&&screen!=="risico") setScreen("afrekenblad"); }}
                      style={{ padding:"7px 10px", borderRadius:6, marginBottom:2, cursor:"pointer", background:active?"rgba(255,255,255,0.14)":"transparent", borderLeft:active?`3px solid ${T.lime}`:"3px solid transparent", transition:"all 0.15s" }}
                    >
                      <div style={{ fontSize:11, color:"#fff", fontWeight:active?700:400, letterSpacing:0.1 }}>{kd.id}</div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.45)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginTop:1 }}>{kd.naam}</div>
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>

        {/* Navigatie */}
        <div style={{ padding:"14px 12px", flex:1 }}>
          {nav.map((n, i) => {
            const active = screen===n.id;
            const nieuweGroep = i===0 || nav[i-1].groep !== n.groep;
            return (
              <Fragment key={n.id}>
                {nieuweGroep && (
                  <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, margin: i===0 ? "0 0 8px 8px" : "16px 0 8px 8px" }}>{n.groep}</div>
                )}
                <button
                  onClick={()=>{
                    // Laag-2 schermen tonen één kostendrager; kies er een passende bij het type
                    const huidigType = typeVanRubriek(rubriekVanKostencode(Number(selectedKd)));
                    if (n.id==="arbeid" && huidigType!=="arbeid") {
                      const k = KOSTENDRAGERS.find(kd=>typeVanRubriek(kd.rubriek)==="arbeid"); if (k) chooseKd(k.id);
                    } else if (n.id==="materieel" && huidigType!=="materieel") {
                      const k = KOSTENDRAGERS.find(kd=>kd.rubriek===5); if (k) chooseKd(k.id);
                    } else if (n.id==="kdbewaking" && huidigType!=="contract") {
                      // bij voorkeur een her-gekoppelde rubriek-8 kostendrager (met inkoop-/afrekendemo)
                      const k = KOSTENDRAGERS.find(kd=>RELINK[kd.id]) || KOSTENDRAGERS.find(kd=>CONTRACT_RUBRIEKEN.includes(kd.rubriek)); if (k) chooseKd(k.id);
                    }
                    setScreen(n.id);
                  }}
                  style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 10px", borderRadius:7, border:"none", background:active?"rgba(255,255,255,0.14)":"transparent", cursor:"pointer", marginBottom:2, textAlign:"left", borderLeft:active?`3px solid ${T.lime}`:"3px solid transparent" }}
                >
                  <span style={{ fontSize:15, color:active?"#fff":"rgba(255,255,255,0.5)", flexShrink:0 }}>{n.icon}</span>
                  <div>
                    <div style={{ fontSize:12, color:active?"#fff":"rgba(255,255,255,0.6)", fontWeight:active?600:400 }}>{n.label}</div>
                  </div>
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* Gebruiker onderaan */}
        <div style={{ padding:"14px 20px", borderTop:"1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:"rgba(255,255,255,0.15)", border:"1.5px solid rgba(255,255,255,0.3)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:10, fontWeight:700, flexShrink:0 }}>
              {currentUser.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.8)", fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{currentUser}</div>
              <div style={{ fontSize:8, color:"rgba(255,255,255,0.35)", marginTop:1 }}>Business Improvement</div>
            </div>
          </div>
          <button onClick={()=>setCurrentUser(null)}
            style={{ width:"100%", padding:"6px", background:"rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.7)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, fontSize:10, fontWeight:600, cursor:"pointer" }}>
            Uitloggen
          </button>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0, minHeight:0 }}>

        {/* Topbar — JPE stijl met breadcrumb */}
        <div style={{ minHeight:48, background:T.surface, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", padding:"0 28px", gap:0, flexShrink:0 }}>
          {/* Breadcrumb */}
          <div style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
            {crumb.filter(Boolean).map((c, i, arr) => (
              <span key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:12, color: i===arr.length-1 ? T.text : T.textMuted, fontWeight: i===arr.length-1 ? 600 : 400 }}>{c}</span>
                {i < arr.length-1 && <span style={{ color:T.border, fontSize:12 }}>›</span>}
              </span>
            ))}
          </div>

          {/* Terug-knop bij subschermen */}
          {(screen==="nieuwio"||screen==="inkoopactie") && (
            <button onClick={()=>setScreen("afrekenblad")} style={{ ...btnSecondary, fontSize:11, padding:"5px 12px", marginRight:12 }}>
              ← Terug
            </button>
          )}

          {/* Rechts: notificaties + avatar */}
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:T.purple, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700 }}>RZ</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:"hidden", display:"flex", minHeight:0 }}>
          {screen==="afrekenblad" && <Afrekenblad inkooporders={inkooporders} setInkooporders={setInkooporders} oaData={oaData} setOaData={setOaData} invloedData={invloedData} setInvloedData={setInvloedData} selectedKd={selectedKd} onSelectKd={chooseKd} onSelectIO={handleSelectIO} onCreateIO={(items)=>{ setPreOA(items); setScreen("nieuwio"); }} onOpenKostendrager={()=>setScreen("kdbewaking")}/>}
          {screen==="actieblad"   && <Actieblad inkooporders={inkooporders} oaData={oaData} invloedData={invloedData} onOpenActie={(kdId, scherm)=>{ chooseKd(kdId); setScreen(scherm); }}/>}
          {screen==="perlijst"    && <PERlijst inkooporders={inkooporders} oaData={oaData} invloedData={invloedData} onOpenKd={(id)=>{ chooseKd(String(id)); setScreen(schermVanRubriek(rubriekVanKostencode(Number(id)))); }}/>}
          {screen==="begroting"   && <BegrotingRegelsTab/>}
          {screen==="bestedingen" && <BestedingRegelsTab/>}
          {screen==="kdbewaking"  && <Kostendragerbewaking key={selectedKd} kdId={selectedKd} inkooporders={inkooporders} oaData={oaData} invloedData={invloedData} onBack={()=>setScreen("perlijst")} onOpenAfrekenblad={()=>setScreen("afrekenblad")} onOpenRisico={()=>setScreen("risico")}/>}
          {screen==="arbeid"      && <BewakingArbeid    key={selectedKd} kdId={selectedKd} onBack={()=>setScreen("perlijst")}/>}
          {screen==="materieel"   && <BewakingMaterieel key="materieel" kdId={selectedKd} onBack={()=>setScreen("perlijst")}/>}
          {screen==="risico"      && <RisicoScherm inkooporders={inkooporders} onUpdateRisico={updateRisico} selectedKd={selectedKd} onSelectKd={chooseKd}/>}
          {screen==="nieuwio"     && <InkooporderAanmaken preselectedItems={preselectedOA} inkooporders={inkooporders} onComplete={(io)=>{ addInkooporder(io); setSelectedIO(io.id); setIaReadonly(false); setScreen("inkoopactie"); }} onCancel={()=>setScreen("afrekenblad")}/>}
          {screen==="inkoopactie" && selectedIO && (() => {
            // Haal altijd de meest actuele IO op uit state — nooit een verouderde snapshot
            const liveIO = inkooporders.find(io => io.id === selectedIO);
            return liveIO
              ? <Inkoopactie io={liveIO} inkooporders={inkooporders} readonly={iaReadonly} onUpdateRisico={updateRisico} onComplete={(io)=>{ addInkooporder(io); setSelectedIO(io.id); setScreen("afrekenblad"); }} onCancel={()=>setScreen("afrekenblad")}/>
              : null;
          })()}
        </div>
      </div>
    </div>
  );
}
