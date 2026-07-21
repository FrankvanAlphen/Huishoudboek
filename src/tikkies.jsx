// ============================================================================
// Tikkies & delen — één systeem: bundels.
// Je bundelt bestaande transacties, verdeelt het totaal (door personen óf een bedrag per
// persoon), en vinkt handmatig af wie betaald heeft. Is iedereen betaald, dan verhuist de
// bundel naar "Afgehandeld". Geen los voorschot, geen automatische herkenning meer.
// ============================================================================
import React, { useState, useMemo } from "react";
import { T, Btn, Card, MoneyInput, Toggle, inputStyle } from "./ui.jsx";
import { formatEUR, uid } from "./lib.js";
import { bundleTxnsById, bundleStand } from "./financieel.js";

const money = (c) => <span style={{ fontFamily: T.mono }}>{formatEUR(c)}</span>;

// ---------------------------------------------------------------------------
// Nieuwe bundel maken: transacties (uitgaven) aanvinken en een naam geven.
// ---------------------------------------------------------------------------
function NieuweBundel({ transactions, bestaandeTxIds, onMaak, onAnnuleer }) {
  const [naam, setNaam] = useState("");
  const [gekozen, setGekozen] = useState(() => new Set());
  const [zoek, setZoek] = useState("");

  const beschikbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return (transactions || [])
      .filter((t) => t.amountCents < 0 && !bestaandeTxIds.has(t.id))
      .filter((t) => !q || (t.name || "").toLowerCase().includes(q) || (t.note || "").toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [transactions, bestaandeTxIds, zoek]);

  const totaal = beschikbaar.filter((t) => gekozen.has(t.id)).reduce((s, t) => s + Math.abs(t.amountCents), 0);
  const toggle = (id) => setGekozen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Card style={{ padding: 18, marginBottom: 16, border: `1px solid ${T.accent}` }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Nieuwe bundel</div>
      <input value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam (bijv. Etentje vrijdag)" style={{ ...inputStyle, marginBottom: 10 }} />
      <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek transacties…" style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${T.line}`, borderRadius: 8 }}>
        {beschikbaar.length === 0
          ? <div style={{ padding: 12, fontSize: 12.5, color: T.sub }}>Geen uitgaven gevonden.</div>
          : beschikbaar.slice(0, 60).map((t) => (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderBottom: `1px solid ${T.line}`, cursor: "pointer", background: gekozen.has(t.id) ? "#f2f9f4" : "transparent" }}>
              <input type="checkbox" checked={gekozen.has(t.id)} onChange={() => toggle(t.id)} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{t.name || "—"}</span>
              <span style={{ fontSize: 11.5, color: T.sub }}>{t.date}</span>
              <span style={{ fontFamily: T.mono, fontSize: 12.5 }}>{formatEUR(Math.abs(t.amountCents))}</span>
            </label>
          ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <div style={{ fontSize: 13 }}>{gekozen.size} gekozen · totaal {money(totaal)}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" onClick={onAnnuleer}>Annuleren</Btn>
          <Btn disabled={gekozen.size === 0 || !naam.trim()} onClick={() => onMaak(naam.trim(), [...gekozen])}>Bundel maken</Btn>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Eén open bundel: verdelen (personen of bedrag per persoon) + afvinken.
// ---------------------------------------------------------------------------
function BundelKaart({ bundle, transactions, onWijzig, onVerwijder, onAfhandelen }) {
  const [open, setOpen] = useState(false);
  const [nieuwPersoon, setNieuwPersoon] = useState("");
  const stand = useMemo(() => bundleStand(bundle, transactions), [bundle, transactions]);
  const txs = useMemo(() => bundleTxnsById(transactions, bundle), [transactions, bundle]);

  const patch = (velden) => onWijzig({ ...bundle, ...velden });
  const zetPersoon = (id, velden) => patch({ personen: (bundle.personen || []).map((p) => (p.id === id ? { ...p, ...velden } : p)) });
  const voegPersoonToe = () => {
    const naam = nieuwPersoon.trim(); if (!naam) return;
    patch({ personen: [...(bundle.personen || []), { id: uid(), naam, bedragCents: null, betaald: false }] });
    setNieuwPersoon("");
  };
  const verwijderPersoon = (id) => patch({ personen: (bundle.personen || []).filter((p) => p.id !== id) });
  const verwijderTx = (txId) => patch({ txIds: (bundle.txIds || []).filter((x) => x !== txId) });

  const modus = bundle.verdeelModus || "personen";

  return (
    <Card style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{bundle.naam}</div>
        <div style={{ fontSize: 13 }}>Totaal {money(stand.total)}</div>
      </div>

      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", color: T.sub, cursor: "pointer", fontSize: 12, padding: 0, marginBottom: open ? 8 : 10 }}>
        {open ? "▾" : "▸"} {txs.length} transactie{txs.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, marginBottom: 12 }}>
          {txs.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: `1px solid ${T.line}`, fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>{t.name || "—"}</span>
              <span style={{ color: T.sub, fontSize: 11.5 }}>{t.date}</span>
              <span style={{ fontFamily: T.mono }}>{formatEUR(Math.abs(t.amountCents))}</span>
              <button onClick={() => verwijderTx(t.id)} title="Uit bundel halen" style={{ background: "none", border: "none", color: T.neg, cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}
          {txs.length === 0 && <div style={{ padding: 10, fontSize: 12, color: T.sub }}>Geen transacties meer — verwijder de bundel of voeg transacties toe via het Transacties-scherm.</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <Btn size="sm" variant={modus === "personen" ? "secondary" : "ghost"} onClick={() => patch({ verdeelModus: "personen" })}>Gelijk delen</Btn>
        <Btn size="sm" variant={modus === "bedrag" ? "secondary" : "ghost"} onClick={() => patch({ verdeelModus: "bedrag" })}>Bedrag per persoon</Btn>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10 }}>
        <Toggle on={!!bundle.ikDoeMee} onClick={() => patch({ ikDoeMee: !bundle.ikDoeMee })} />
        Ik doe zelf mee (tel mee als betaler)
      </label>

      {(stand.personen || []).length === 0
        ? <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 8 }}>Nog geen personen. Voeg hieronder namen toe.</div>
        : <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            {stand.personen.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", border: `1px solid ${T.line}`, borderRadius: 7, background: p.betaald ? "#f2f9f4" : "transparent" }}>
                <input type="checkbox" checked={!!p.betaald} onChange={() => zetPersoon(p.id, { betaald: !p.betaald })} title="Betaald" />
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, textDecoration: p.betaald ? "line-through" : "none", color: p.betaald ? T.sub : T.ink }}>{p.naam}</span>
                {modus === "bedrag"
                  ? <MoneyInput cents={p.bedrag} onChange={(c) => zetPersoon(p.id, { bedragCents: c })} width={90} />
                  : <span style={{ fontFamily: T.mono, fontSize: 12.5 }}>{formatEUR(p.bedrag)}</span>}
                <button onClick={() => verwijderPersoon(p.id)} title="Verwijderen" style={{ background: "none", border: "none", color: T.neg, cursor: "pointer", fontSize: 15 }}>×</button>
              </div>
            ))}
          </div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input value={nieuwPersoon} onChange={(e) => setNieuwPersoon(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") voegPersoonToe(); }} placeholder="Naam toevoegen" style={{ ...inputStyle, flex: 1 }} />
        <Btn size="sm" onClick={voegPersoonToe}>+ Persoon</Btn>
      </div>

      <div style={{ fontSize: 12.5, color: T.sub, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
        <div>Anderen samen: {money(stand.somAnderen)}{stand.ikDoeMee && <> · jouw deel: {money(stand.mijnDeel)}</>}</div>
        {modus === "bedrag" && stand.verschil !== 0 && (
          <div style={{ color: T.warn, marginTop: 4 }}>
            {stand.verschil > 0
              ? <>Er blijft {money(stand.verschil)} onverdeeld{stand.ikDoeMee ? " (komt bovenop jouw deel)" : ""}.</>
              : <>De verdeling is {money(-stand.verschil)} méér dan het totaal.</>}
          </div>
        )}
        <div style={{ marginTop: 6 }}>{stand.betaaldAantal} van {stand.aantalPersonen} betaald · nog open {money(stand.openBedrag)}</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <Btn size="sm" variant="ghost" onClick={onVerwijder}>Bundel verwijderen</Btn>
        <Btn size="sm" disabled={!stand.iedereenBetaald} onClick={onAfhandelen} title={stand.iedereenBetaald ? "Naar afgehandeld" : "Eerst iedereen afvinken"}>Afhandelen</Btn>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Afgehandelde bundel (compact, terugzetbaar).
// ---------------------------------------------------------------------------
function AfgehandeldeKaart({ bundle, transactions, onHeropen }) {
  const [bevestig, setBevestig] = useState(false);
  const stand = useMemo(() => bundleStand(bundle, transactions), [bundle, transactions]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: `1px solid ${T.line}`, borderRadius: 8, marginBottom: 6, fontSize: 12.5 }}>
      <span style={{ fontWeight: 700 }}>{bundle.naam}</span>
      <span style={{ color: T.sub }}>{stand.aantalPersonen} personen · {formatEUR(stand.total)}</span>
      <span style={{ flex: 1 }} />
      {bevestig
        ? <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: T.sub, fontSize: 11.5 }}>Terug naar open?</span>
            <Btn size="sm" variant="secondary" onClick={() => { onHeropen(); setBevestig(false); }}>Ja</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setBevestig(false)}>Nee</Btn>
          </span>
        : <Btn size="sm" variant="ghost" onClick={() => setBevestig(true)}>Heropenen</Btn>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Het tabblad zelf.
// ---------------------------------------------------------------------------
function TikkiesEnDelen({ transactions, bundles = [], onMaakBundel, onWijzigBundel, onVerwijderBundel, onAfhandelen, onHeropen }) {
  const [maakNieuw, setMaakNieuw] = useState(false);
  const bestaandeTxIds = useMemo(() => {
    const s = new Set();
    for (const b of bundles) for (const id of (b.txIds || [])) s.add(id);
    return s;
  }, [bundles]);

  const open = bundles.filter((b) => !b.afgehandeld);
  const klaar = bundles.filter((b) => b.afgehandeld);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Tikkies &amp; delen</div>
        {!maakNieuw && <Btn size="sm" onClick={() => setMaakNieuw(true)}>+ Nieuwe bundel</Btn>}
      </div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 6 }}>Bundel je uitgaven, verdeel het bedrag en vink af wie betaald heeft. Is iedereen rond, dan handel je de bundel af.</div>

      {maakNieuw && (
        <NieuweBundel
          transactions={transactions}
          bestaandeTxIds={bestaandeTxIds}
          onAnnuleer={() => setMaakNieuw(false)}
          onMaak={(naam, txIds) => { onMaakBundel(naam, txIds); setMaakNieuw(false); }}
        />
      )}

      {open.length === 0 && !maakNieuw && (
        <Card style={{ padding: 18 }}>
          <div style={{ fontSize: 12.5, color: T.sub }}>Nog geen open bundels. Maak er een aan om uitgaven te delen en tikkies bij te houden.</div>
        </Card>
      )}

      {open.map((b) => (
        <BundelKaart
          key={b.id} bundle={b} transactions={transactions}
          onWijzig={onWijzigBundel}
          onVerwijder={() => onVerwijderBundel(b.id)}
          onAfhandelen={() => onAfhandelen(b.id)}
        />
      ))}

      {klaar.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: T.sub }}>Afgehandelde tikkies</div>
          {klaar.map((b) => (
            <AfgehandeldeKaart key={b.id} bundle={b} transactions={transactions} onHeropen={() => onHeropen(b.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export { TikkiesEnDelen };
