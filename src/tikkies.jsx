import { ExpectedBackEditor } from "./txrow.jsx";
// ---- Tabblad "Tikkies & delen" ----
// Alles wat terug moet komen op één plek: losse voorschotten/settlements én gedeelde bundels
// (tikkie: bundel delen, per persoon bijhouden, betalingen herkennen en koppelen).
// Rekenwerk zit in financieel.js; dit bestand is puur presentatie + de klik-acties.
import React, { useState } from "react";
import { formatEUR } from "./lib.js";
import { bundleStats, bundleShareCents, bundleSuggestions, allBundleSuggestions, cleanPayerName, isDefaultPersonName, settlementsOf, unassignedOf, recoveredFor, expectedBackOf } from "./financieel.js";
import { T, Card, Btn, Chip, Keuze, inputStyle } from "./ui.jsx";

// Het tabblad zelf: eerst de losse voorschotten, dan de gedeelde bundels.
function TikkiesEnDelen(props) {
  const { transactions, categories, bundles = [] } = props;
  const heeftVoorschot = (transactions || []).some((t) => t.advance);
  const heeftBundel = (bundles || []).length > 0 || (transactions || []).some((t) => (t.bundle || "").trim());

  // Nog nergens mee begonnen: één rustige uitleg in plaats van twee lege secties.
  if (!heeftVoorschot && !heeftBundel) {
    return (
      <Card style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Tikkies &amp; delen</div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.5 }}>
          Hier houd je bij wat er nog terug moet komen. Twee manieren:
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div><b>Voorschot</b> — zet op een transactie de tikkie-schakelaar aan (in het Transacties-scherm) en geef aan hoeveel je terugverwacht. Handig voor één los bedrag dat je voorschiet.</div>
            <div><b>Gedeelde bundel</b> — geef meerdere transacties hetzelfde bundel-label, kom hier terug, en deel het totaal door het aantal personen. De app herkent binnengekomen tikkies vanzelf.</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {heeftVoorschot && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Voorschotten</div>
          <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10 }}>Losse bedragen die je hebt voorgeschoten en terugverwacht.</div>
          <VoorschotPaneel {...props} />
        </div>
      )}
      {heeftBundel && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>Gedeelde bundels</div>
          <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 10 }}>Bundel uitgaven, deel het bedrag en stuur een tikkie. Betaalde tikkies worden herkend.</div>
          <DelenPaneel
            transactions={transactions} categories={categories} bundles={bundles}
            onSetSize={props.onSetBundleSize} onRenamePerson={props.onRenameBundlePerson}
            onRemoveBundle={props.onRemoveBundle} onLinkPayment={props.onLinkBundlePayment} onUnlinkPayment={props.onUnlinkBundlePayment} />
        </div>
      )}
    </div>
  );
}

function VoorschotPaneel({ transactions, categories, onLinkSettle, onUnlinkSettle, onUnsettle, onPatch }) {
  const dt = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`;
  const catLabel = (t) => (t.allocations || []).map((a) => (categories.find((c) => c.id === a.categoryId) || {}).naam).filter(Boolean).join(", ") || "nog niet ingedeeld";
  const partFor = (inc, advId) => (settlementsOf(inc).find((s) => s.advanceId === advId) || {}).amountCents || 0;
  const linkedTo = (advId) => transactions.filter((t) => t.amountCents > 0 && settlementsOf(t).some((s) => s.advanceId === advId)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const advances = transactions.filter((t) => t.advance).map((adv) => { const owed = expectedBackOf(adv); const recovered = recoveredFor(adv.id, transactions); return { adv, owed, recovered, remaining: owed - recovered, applied: linkedTo(adv.id) }; });
  const open = advances.filter((a) => a.remaining > 0).sort((a, b) => (a.adv.date < b.adv.date ? 1 : -1));
  const done = advances.filter((a) => a.remaining <= 0).sort((a, b) => (a.adv.date < b.adv.date ? 1 : -1));
  const candidatesFor = (a) => transactions.filter((t) => t.amountCents > 0 && t.id !== a.adv.id && t.date >= a.adv.date && unassignedOf(t) > 0 && !settlementsOf(t).some((s) => s.advanceId === a.adv.id)).sort((x, y) => Math.abs(a.remaining - unassignedOf(x)) - Math.abs(a.remaining - unassignedOf(y)) || (x.date < y.date ? -1 : 1));
  const toggle = (a, inc, on) => { if (on) { onUnlinkSettle(inc.id, a.adv.id); } else { const amt = Math.min(a.remaining, unassignedOf(inc)); if (amt > 0) onLinkSettle(inc.id, a.adv.id, amt); } };
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid ${T.accent}`, background: "#f3f8f6" }}>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Markeer bij het verwerken een bedrag waar je een tikkie voor stuurt en geef aan hoeveel je terugverwacht (mag een deel zijn). Komt geld binnen, vink het dan hieronder aan onder de bijbehorende tikkie — ik koppel telkens zoveel als er nog openstaat. <b>Eén binnengekomen bedrag kun je zo over meerdere tikkies verdelen</b> (vink het onder elke tikkie aan). De terugbetaling wordt naar verhouding op dezelfde post(en) geboekt.</div>

      {open.length === 0 && <div style={{ fontSize: 13, color: T.sub }}>Geen openstaande tikkies. 👍</div>}
      {open.map((a) => {
        const cands = candidatesFor(a).slice(0, 10);
        const rows = [...a.applied.map((inc) => ({ inc, on: true })), ...cands.map((inc) => ({ inc, on: false }))];
        return (
          <div key={a.adv.id} style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: 10, marginBottom: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{dt(a.adv.date)} · {a.adv.name}</div>
                <div style={{ fontSize: 12, color: T.sub }}>{catLabel(a.adv)} · {a.recovered > 0 ? <>al terug <b>{formatEUR(a.recovered)}</b> · nog open <b style={{ color: T.warn }}>{formatEUR(a.remaining)}</b></> : <>verwacht terug <b>{formatEUR(a.owed)}</b></>}</div>
              </div>
              <span style={{ fontFamily: T.mono, fontWeight: 700, color: a.adv.amountCents < 0 ? T.neg : T.pos, flexShrink: 0 }}>{formatEUR(a.adv.amountCents)}</span>
            </div>
            {(a.adv.allocations || []).length === 0 && <div style={{ fontSize: 11.5, color: T.warn, marginTop: 5 }}>Tip: geef deze uitgave eerst een post, dan boekt de terugbetaling automatisch op de juiste plek.</div>}
            {onPatch && a.recovered === 0 && <div style={{ marginTop: 6 }}><ExpectedBackEditor amountCents={a.adv.amountCents} value={a.owed} onChange={(v) => onPatch(a.adv.id, { expectedBackCents: v })} /></div>}
            <div style={{ marginTop: 8 }}>
              {rows.length === 0 ? <div style={{ fontSize: 12, color: T.warn }}>Nog geen binnengekomen bedragen om te koppelen. Zodra geld binnen is, kun je 'm hier aanvinken.</div> : (
                <>
                  <div style={{ fontSize: 12, color: T.sub, marginBottom: 5 }}>Vink aan welk binnengekomen geld bij deze tikkie hoort — dichtstbijzijnde eerst:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {rows.map(({ inc, on }) => { const part = partFor(inc, a.adv.id); const vrij = unassignedOf(inc); const full = Math.abs(inc.amountCents); return (
                      <label key={inc.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 9px", background: on ? "#eef7f1" : "#f7faf9", border: `1px solid ${on ? T.accent : T.line}`, borderRadius: 7, cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(a, inc, on)} />
                        <span style={{ fontSize: 12.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{dt(inc.date)} · {inc.name}{on && part !== full ? <span style={{ color: T.sub }}> · {formatEUR(part)} hiervan</span> : !on && vrij !== full ? <span style={{ color: T.sub }}> · nog {formatEUR(vrij)} vrij</span> : null}</span>
                        <span style={{ fontFamily: T.mono, color: T.pos, flexShrink: 0 }}>{formatEUR(inc.amountCents)}</span>
                      </label>
                    ); })}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Volledig verrekend</div>
          {done.map((a) => (
            <div key={a.adv.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{dt(a.adv.date)} · {a.adv.name} · {formatEUR(a.owed)}</div>
              <div style={{ paddingLeft: 4 }}>{a.applied.map((inc) => { const part = partFor(inc, a.adv.id); const full = Math.abs(inc.amountCents); return (
                <div key={inc.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: T.pos }}>✓ {dt(inc.date)} · {inc.name} · {formatEUR(part)}{part !== full ? <span style={{ color: T.sub }}> (van {formatEUR(full)})</span> : null}</span>
                  <button onClick={() => onUnlinkSettle(inc.id, a.adv.id)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>ontkoppel</button>
                </div>
              ); })}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}


function DelenPaneel({ transactions, categories, bundles = [], onSetSize, onRenamePerson, onRemoveBundle, onLinkPayment, onUnlinkPayment }) {
  const [open, setOpen] = useState("");        // welke bundel is uitgeklapt voor delen
  const [eigenAantal, setEigenAantal] = useState("");   // "meer dan 5": zelf een aantal invullen
  const [handKies, setHandKies] = useState("");        // bij welke persoon kies je zelf een betaling

  // Voorstel accepteren: koppel de betaling en neem meteen de naam uit de bank over,
  // maar alleen zolang de naam nog de door de app verzonnen "Persoon N" is.
  const accepteer = (key, p, sug) => {
    if (!sug || !onLinkPayment) return;
    onLinkPayment(sug.tx.id, key, p.id, sug.bedrag);
    if (sug.naam && isDefaultPersonName(p.naam) && onRenamePerson) onRenamePerson(key, p.id, sug.naam);
  };
  const [bevestig, setBevestig] = useState(""); // welke bundel vraagt om bevestiging van verwijderen

  // Bundels komen uit de labels op transacties; de deel-informatie hangt er los aan.
  const byBundle = {};
  for (const t of transactions) {
    const raw = (t.bundle || "").trim();
    if (!raw) continue;
    const k = raw.toLowerCase();
    if (!byBundle[k]) byBundle[k] = { key: k, naam: raw, total: 0, items: [] };
    byBundle[k].total += t.amountCents;
    byBundle[k].items.push(t);
  }
  const lijst = Object.values(byBundle).map((d) => {
    const def = bundles.find((b) => b.key === d.key) || { key: d.key, naam: d.naam, people: [] };
    return { ...d, def, stats: bundleStats(def, transactions), items: d.items.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) };
  }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  if (lijst.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen bundels. Geef transacties hetzelfde bundel-label (bij het verwerken of via de transactieregel) om ze samen te tellen en te delen.</div></Card>;

  // Inkomende betalingen die nog nergens aan hangen: kandidaten om aan een persoon te koppelen.
  const kandidaten = transactions.filter((t) => t.amountCents > 0 && unassignedOf(t) > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  // Voorstellen in één keer voor álle bundels, met gedeelde claim-set: zo wordt dezelfde
  // binnengekomen betaling nooit bij twee bundels tegelijk voorgesteld.
  const alleVoorstellen = allBundleSuggestions(lijst.map((b) => b.def), transactions);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Bundels tellen transacties met hetzelfde label bij elkaar op. Deel je een bundel, dan wordt het totaal gelijk verdeeld over jou en de anderen — je ziet per persoon wat er nog open staat.</div>
      {lijst.map((b) => {
        const st = b.stats;
        const gedeeld = (b.def.people || []).length > 0;
        const voorstellen = alleVoorstellen[b.key] || {};
        const gevonden = Object.keys(voorstellen).length;
        const isOpen = open === b.key;
        return (
          <Card key={b.key} style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#eef3f1", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{b.naam}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 15, color: b.total < 0 ? T.neg : T.pos }}>{formatEUR(b.total)}</span>
                <Btn size="sm" variant={isOpen ? "secondary" : "ghost"} onClick={() => { setOpen(isOpen ? "" : b.key); setBevestig(""); }}>{gedeeld ? "Delen ▾" : "Delen…"}</Btn>
              </span>
            </div>

            {gedeeld && (
              <div style={{ padding: "8px 14px", borderTop: `1px solid ${T.line}`, background: st.klaar ? "#f2f9f4" : "#fffdf5", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
                <span>Ieders deel: <b style={{ fontFamily: T.mono }}>{formatEUR(st.share)}</b> <span style={{ color: T.sub }}>({(b.def.people || []).length + 1} personen)</span></span>
                <span>Jouw deel: <b style={{ fontFamily: T.mono }}>{formatEUR(st.mijnDeel)}</b></span>
                <span>Terugverwacht: <b style={{ fontFamily: T.mono }}>{formatEUR(st.expectedBack)}</b></span>
                {st.klaar ? <span style={{ color: T.pos, fontWeight: 700 }}>✓ helemaal binnen</span>
                          : <span style={{ color: T.warn, fontWeight: 700 }}>nog open: <span style={{ fontFamily: T.mono }}>{formatEUR(st.open)}</span></span>}
              </div>
            )}

            {isOpen && (
              <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
                {(() => {
                  const aantal = (b.def.people || []).length + 1;   // totaal aantal personen incl. jij
                  const deel = bundleShareCents(Math.abs(b.total), (b.def.people || []).length);
                  const mijn = Math.abs(b.total) - deel * (aantal - 1);
                  return (
                    <>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: T.sub }}>Delen door</span>
                        {[2, 3, 4, 5].map((k) => (
                          <Btn key={k} size="sm" variant={aantal === k ? "secondary" : "ghost"} onClick={() => { setEigenAantal(""); onSetSize(b.key, k); }}>{k}</Btn>
                        ))}
                        <Btn size="sm" variant={aantal > 5 ? "secondary" : "ghost"} onClick={() => setEigenAantal(String(aantal > 5 ? aantal : 6))}>meer dan 5…</Btn>
                        {eigenAantal !== "" && (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input type="number" min="2" max="50" value={eigenAantal} onChange={(e) => setEigenAantal(e.target.value)}
                                   onKeyDown={(e) => { if (e.key === "Enter" && Number(eigenAantal) >= 2) { onSetSize(b.key, Number(eigenAantal)); setEigenAantal(""); } }}
                                   style={{ ...inputStyle, width: 72 }} />
                            <Btn size="sm" onClick={() => { if (Number(eigenAantal) >= 2) { onSetSize(b.key, Number(eigenAantal)); setEigenAantal(""); } }}>Zet</Btn>
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: T.sub }}>personen, jij meegerekend</span>
                      </div>
                      {aantal > 1 && (
                        <div style={{ fontSize: 12.5, background: "#f3f8f6", border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 9px" }}>
                          Stuur elk van de {aantal - 1} ander{aantal - 1 > 1 ? "en" : ""} een tikkie van <b style={{ fontFamily: T.mono, fontSize: 14 }}>{formatEUR(deel)}</b>. Jouw eigen deel is <b style={{ fontFamily: T.mono }}>{formatEUR(mijn)}</b>{mijn !== deel ? <span style={{ color: T.sub }}> — door het afronden van de tikkie een paar cent minder dan de rest.</span> : null}
                        </div>
                      )}
                    </>
                  );
                })()}
                {(b.def.people || []).map((p) => {
                  const ps = st.people.find((x) => x.id === p.id) || { paid: 0, open: 0, share: 0, klaar: false };
                  const sug = voorstellen[p.id];
                  const handmatig = handKies === b.key + p.id;
                  return (
                    <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px", border: `1px solid ${sug ? T.accent : T.line}`, borderRadius: 7, background: ps.klaar ? "#f2f9f4" : sug ? "#f7fbf9" : "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <input value={p.naam} onChange={(e) => onRenamePerson && onRenamePerson(b.key, p.id, e.target.value)}
                               placeholder="naam" style={{ ...inputStyle, width: 118, fontWeight: 600, fontSize: 13 }} />
                        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.sub }}>{formatEUR(ps.paid)} / {formatEUR(ps.share)}</span>
                        {ps.klaar ? <Chip active size="sm" tone="solid">betaald ✓</Chip> : <Chip size="sm" title="nog niet (volledig) betaald">open {formatEUR(ps.open)}</Chip>}
                        <span style={{ flex: 1 }} />
                        {ps.paid > 0 && onUnlinkPayment && (
                          <Btn size="sm" variant="ghost" title="koppeling(en) van deze persoon ongedaan maken"
                               onClick={() => transactions.filter((t) => settlementsOf(t).some((x) => x.bundleKey === b.key && x.personId === p.id)).forEach((t) => onUnlinkPayment(t.id, b.key, p.id))}>↺</Btn>
                        )}
                      </div>
                      {/* Voorstel: de app denkt deze betaling bij deze persoon te herkennen. Eén klik = koppelen. */}
                      {sug && !handmatig && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                          <span style={{ color: T.sub }}>{sug.zeker ? "Betaald door" : "Mogelijk"}</span>
                          <b>{sug.naam || sug.tx.name}</b>
                          <span style={{ fontFamily: T.mono }}>{formatEUR(sug.bedrag)}</span>
                          <span style={{ color: T.sub }}>op {sug.tx.date.slice(8, 10)}-{sug.tx.date.slice(5, 7)}</span>
                          {sug.over > 0 && <span style={{ fontSize: 11.5, color: T.sub }}>({formatEUR(sug.over)} blijft over)</span>}
                          <Btn size="sm" onClick={() => accepteer(b.key, p, sug)}>Koppel</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setHandKies(b.key + p.id)}>andere…</Btn>
                        </div>
                      )}
                      {/* Geen voorstel, of jij wilt zelf kiezen: dan pas de lijst met alle vrije betalingen. */}
                      {!ps.klaar && onLinkPayment && (!sug || handmatig) && (
                        kandidaten.length > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
                            <span style={{ color: T.sub }}>Koppel zelf een binnengekomen betaling:</span>
                            <Keuze value="" onChange={(v) => { if (!v) return; const inc = transactions.find((t) => t.id === v); if (inc) { accepteer(b.key, p, { tx: inc, bedrag: Math.min(ps.open, unassignedOf(inc)), naam: cleanPayerName(inc.name) }); setHandKies(""); } }}
                                   opties={[{ value: "", label: "kies een betaling…" }, ...kandidaten.map((t) => ({ value: t.id, label: `${t.date.slice(8, 10)}-${t.date.slice(5, 7)} · ${t.name} · ${formatEUR(unassignedOf(t))}` }))]} />
                            {handmatig && <Btn size="sm" variant="ghost" onClick={() => setHandKies("")}>terug</Btn>}
                          </div>
                        ) : <div style={{ fontSize: 12, color: T.sub }}>Nog geen binnengekomen betaling die hierbij past.</div>
                      )}
                    </div>
                  );
                })}
                {/* Alles in één klik: alleen tonen als er echt meer dan één voorstel ligt. */}
                {gevonden > 1 && onLinkPayment && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, background: "#f3f8f6", border: `1px solid ${T.accent}`, borderRadius: 7, padding: "7px 9px" }}>
                    <span><b>{gevonden}</b> betaling{gevonden > 1 ? "en" : ""} herkend bij deze bundel.</span>
                    <Btn size="sm" onClick={() => (b.def.people || []).forEach((p) => voorstellen[p.id] && accepteer(b.key, p, voorstellen[p.id]))}>Koppel alle {gevonden}</Btn>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1 }} />
                  {onRemoveBundle && (bevestig === b.key
                    ? <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: T.warn }}>Label bij {b.items.length} transactie{b.items.length > 1 ? "s" : ""} weghalen? De transacties blijven staan.</span>
                        <Btn size="sm" variant="danger" onClick={() => { onRemoveBundle(b.key); setBevestig(""); setOpen(""); }}>Ja, verwijder</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setBevestig("")}>Nee</Btn>
                      </span>
                    : <Btn size="sm" variant="ghost" onClick={() => setBevestig(b.key)}>Bundel verwijderen</Btn>)}
                </div>
              </div>
            )}

            {b.items.map((t) => { const cat = (t.allocations || []).map((a) => (categories.find((c) => c.id === a.categoryId) || {}).naam).filter(Boolean).join(" + ");
              return (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "78px 1fr auto", gap: 10, alignItems: "center", padding: "7px 14px", borderTop: `1px solid ${T.line}`, fontSize: 12.5 }}>
                  <span style={{ fontFamily: T.mono, color: T.sub }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)}-{t.date.slice(2, 4)}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}{cat ? ` · ${cat}` : ""}</span>
                  <span style={{ fontFamily: T.mono, color: t.amountCents < 0 ? T.neg : T.pos }}>{formatEUR(t.amountCents)}</span>
                </div>
              ); })}
          </Card>
        );
      })}
    </div>
  );
}


export { TikkiesEnDelen };
