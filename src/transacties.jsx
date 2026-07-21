import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatEUR, MND_KORT, batchesOf, effYear, effMonth, batchColor, fmtDateTime } from "./lib.js";
import { guessKeyword, unknownSavingsCodes, ruleMatches, rankSuggestions } from "./financieel.js";
import { T, Btn, Card, inputStyle, MaandKiezer, Chip, MoneyInput, SectionTitle, Badge, PeriodControl} from "./ui.jsx";
import { TX_COLS, TxRow, PostPicker, VermogenHint, SplitEditor, RuleLearn } from "./txrow.jsx";
import { useHuishoudboekje } from "./store.jsx";

// ---- Transacties-tabblad ----
// De lijst met filters/zoeken/nalopen, plus de losse gereedschappen eromheen:
// handmatige transactie, voorschottenpaneel, opschonen en de importcontrole.
// De regel zelf woont in txrow.jsx.

function DataCleanup({ year, years = [], txCount, transactions = [], onClearRange, onClearYear, onClearAll, onResetAll, onClearBatch }) {
  const months = MND_KORT;
  const yearList = (years.length ? years : [year]).map((y) => y.jaartal).sort((a, b) => a - b);
  const [fy, setFy] = useState(year.jaartal), [fm, setFm] = useState(1);
  const [ty, setTy] = useState(year.jaartal), [tm, setTm] = useState(12);
  const [sm, setSm] = useState(1), [smY, setSmY] = useState(year.jaartal); // losse maand
  const [confirm, setConfirm] = useState(null); // 'month' | 'range' | 'year' | 'all' | 'reset'
  const ss = { ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 12 };
  const fromKey = fy * 100 + fm, toKey = ty * 100 + tm;
  const monthKey = smY * 100 + sm;
  const ConfirmRow = ({ id, label, onYes, danger }) => confirm === id ? (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.neg }}>Zeker weten?</span>
      <Btn size="sm" variant="danger" onClick={() => { onYes(); setConfirm(null); }}>{label}</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Annuleer</Btn>
    </span>
  ) : <Btn size="sm" variant={danger ? "danger" : "secondary"} onClick={() => setConfirm(id)}>{label}</Btn>;
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid #f0dcb8`, background: "#fffdf8" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Gegevens opschonen</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Hiermee verwijder je ingelezen transacties. Je begroting, posten en regels blijven staan (tenzij je hieronder "opnieuw beginnen" kiest).</div>

      {(() => {
        // Laatste import terugdraaien — handig als je net het verkeerde bestand inlas.
        const batches = batchesOf(transactions);
        const laatste = batches[0];
        if (!onClearBatch || !laatste) return null;
        const wanneer = fmtDateTime(laatste.at);
        return (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 13, color: T.sub, minWidth: 64 }}>Laatste import</span>
            <span style={{ fontSize: 12.5 }}>{laatste.count} transactie{laatste.count > 1 ? "s" : ""}{wanneer ? ` · ingelezen ${wanneer}` : ""}</span>
            <ConfirmRow id="batch" label="Verwijder laatste import" onYes={() => onClearBatch(laatste.id)} />
          </div>
        );
      })()}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: T.sub, minWidth: 64 }}>Eén maand</span>
        <select value={sm} onChange={(e) => setSm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={smY} onChange={(e) => setSmY(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <ConfirmRow id="month" label={`Wis ${months[sm - 1]} ${smY}`} onYes={() => onClearRange(monthKey, monthKey)} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: T.sub, minWidth: 64 }}>Periode van</span>
        <select value={fm} onChange={(e) => setFm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 13, color: T.sub }}>t/m</span>
        <select value={tm} onChange={(e) => setTm(Number(e.target.value))} style={ss}>{months.map((nm, i) => <option key={i} value={i + 1}>{nm}</option>)}</select>
        <select value={ty} onChange={(e) => setTy(Number(e.target.value))} style={ss}>{yearList.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        <ConfirmRow id="range" label={`Verwijder ${months[fm - 1]} ${fy} t/m ${months[tm - 1]} ${ty}`} onYes={() => onClearRange(Math.min(fromKey, toKey), Math.max(fromKey, toKey))} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
        <ConfirmRow id="year" label={`Wis heel ${year.jaartal}`} onYes={onClearYear} />
        <ConfirmRow id="all" label="Wis álle transacties (alle jaren)" onYes={onClearAll} />
        <ConfirmRow id="reset" label="Opnieuw beginnen — wis alles behalve regels & inlog" onYes={onResetAll} danger />
      </div>
      {confirm === "reset" && <div style={{ fontSize: 12, color: T.neg, marginTop: 8 }}>Dit wist transacties, begrotingsbedragen, startsaldo en spaarsaldi en zet de posten terug naar de standaard. Je <b>regels</b> en <b>inlogaccounts</b> blijven.</div>}
      <div style={{ fontSize: 12, color: T.sub, marginTop: 10 }}>Op dit moment {txCount} transactie(s) in totaal.</div>
    </Card>
  );
}

function ManualTxForm({ onAdd, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [name, setName] = useState("");
  const [oms, setOms] = useState("");
  const [bedrag, setBedrag] = useState(0);
  const [richting, setRichting] = useState("af"); // af | bij
  const valid = date && bedrag > 0 && name.trim();
  const submit = () => { if (!valid) return; onAdd({ date, name: name.trim(), omschrijving: oms.trim(), amountCents: (richting === "af" ? -1 : 1) * bedrag }); setName(""); setOms(""); setBedrag(0); setRichting("af"); onClose && onClose(); };
  return (
    <Card style={{ padding: 16, marginBottom: 14, border: `1px solid ${T.accent}`, background: "#f3f8f6" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Losse transactie toevoegen</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Voor iets dat niet in je bankexport staat (bijvoorbeeld contant geld). Je regels en spaarrekening-codes worden meteen toegepast.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ fontSize: 12, color: T.sub }}>Datum<br /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
        <label style={{ fontSize: 12, color: T.sub, flex: 1, minWidth: 180 }}>Naam / winkel<br /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. Markt, contant" style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
        <label style={{ fontSize: 12, color: T.sub }}>Bedrag<br /><div style={{ marginTop: 3 }}><MoneyInput cents={bedrag} width={120} onChange={setBedrag} /></div></label>
        <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 7, overflow: "hidden", height: 34 }}>
          {[["af", "Af (uit)"], ["bij", "Bij (in)"]].map(([v, l]) => (
            <button key={v} onClick={() => setRichting(v)} style={{ padding: "0 12px", border: "none", borderLeft: v === "bij" ? `1px solid ${T.line}` : "none", background: richting === v ? (v === "af" ? T.neg : T.pos) : "#fff", color: richting === v ? "#fff" : T.sub, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 12, color: T.sub }}>Omschrijving (optioneel)<br /><input value={oms} onChange={(e) => setOms(e.target.value)} placeholder="waar ging het om?" style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, marginTop: 3 }} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Btn size="sm" disabled={!valid} onClick={submit}>Toevoegen</Btn>
        <Btn size="sm" variant="ghost" onClick={() => onClose && onClose()}>Sluiten</Btn>
      </div>
    </Card>
  );
}

function UnknownSavingsRow({ u, savingsCats, onCreate, onLink }) {
  const preMatch = savingsCats.find((c) => c.naam.toUpperCase().includes(u.code.toUpperCase()));
  const [naam, setNaam] = useState(u.hint || "");
  const [linkTo, setLinkTo] = useState(preMatch ? preMatch.id : "");
  const richting = u.inCents > 0 && u.outCents > 0 ? "in- en uitgaand" : u.inCents > 0 ? "geld binnengekomen" : "geld naartoe";
  return (
    <div style={{ padding: "10px 0", borderTop: `1px solid ${T.line}` }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>Code <span style={{ fontFamily: T.mono }}>{u.code}</span>{u.hint ? ` · ${u.hint}` : ""}</div>
      <div style={{ fontSize: 11.5, color: T.sub, marginBottom: 8 }}>{u.count} transactie{u.count > 1 ? "s" : ""} · {richting}</div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        {savingsCats.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.sub }}>Koppel aan bestaande rekening</span>
            <select value={linkTo} onChange={(e) => setLinkTo(e.target.value)} style={{ ...inputStyle, width: 220, padding: "6px 8px", fontSize: 13 }}>
              <option value="">— kies rekening —</option>
              {savingsCats.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
            </select>
            <Btn size="sm" disabled={!linkTo} onClick={() => linkTo && onLink(linkTo, u.code)}>Koppel</Btn>
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.sub }}>of nieuw</span>
          <input value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="naam nieuwe rekening" style={{ ...inputStyle, width: 190, padding: "6px 8px", fontSize: 13 }} />
          <Btn size="sm" variant="secondary" onClick={() => onCreate(u.code, naam.trim() || `Spaarrekening ${u.code}`)}>Aanmaken</Btn>
        </div>
      </div>
    </div>
  );
}
function OnbekendeSpaarrekeningen({ transactions, categories, onCreateSavings, onLinkSavings }) {
  const unknown = unknownSavingsCodes(transactions, categories);
  if (unknown.length === 0) return null;
  const savingsCats = categories.filter((c) => c.type === "savings");
  return (
    <Card style={{ padding: 14, marginBottom: 14, border: `1px solid ${T.warn}`, background: T.warnSoft }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Spaarrekening-mutatie{unknown.length > 1 ? "s" : ""} nog niet gekoppeld</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 4 }}>Er gaat geld van of naar een spaarrekening (herkend aan de code in de mededelingen) die nog niet aan een rekening hangt. <b>Koppel de code aan je bestaande rekening</b> — het Vermogen-tabblad rekent alle bij- en afschrijvingen met deze code er dan vanzelf aan toe. Je boekingen op posten (bijv. Tussenrekening) blijven gewoon staan. Of maak een nieuwe rekening aan.</div>
      {unknown.map((u) => <UnknownSavingsRow key={u.code} u={u} savingsCats={savingsCats} onCreate={onCreateSavings} onLink={onLinkSavings} />)}
    </Card>
  );
}

function Transacties({ groups, categories, year, years = [], transactions, rules = [], onOpenTikkies, onClearBatch, onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne, onClearYear, onClearRange, onClearAll, onResetAll, onAddManual, onLinkSettle, onUnlinkSettle, onUnsettle, onCreateSavings, onLinkSavings, reviewedBatches = [], onMarkBatchReviewed, kickReview, preset = null, onPresetConsumed }) {
  const { isMobile } = useHuishoudboekje();
  const [showCleanup, setShowCleanup] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [batchFilter, setBatchFilter] = useState(null);
  const batches = useMemo(() => batchesOf(transactions), [transactions]);
  const newestBatch = batches[0] || null;
  const newestUnreviewed = newestBatch && !reviewedBatches.includes(newestBatch.id) ? newestBatch : null;
  const [maand, setMaand] = useState(0);
  const [status, setStatus] = useState("alle");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(""); // filter op post
  const [focusId, setFocusId] = useState(null); // focus op één transactie (vanaf taak/doorklik)
  const [reviewing, setReviewing] = useState(false);
  // Doorklik vanaf het dashboard: filters overnemen en preset weer vrijgeven.
  useEffect(() => {
    if (!preset) return;
    setMaand(preset.maand != null ? preset.maand : 0);
    setCat(preset.categoryId || "");
    setFocusId(preset.txId || null);
    setStatus("alle"); setBatchFilter(null); setQ(""); setReviewing(false);
    if (onPresetConsumed) onPresetConsumed();
  }, [preset]);
  const names = ["alle maanden", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
  const yearTx = useMemo(() => transactions.filter((t) => effYear(t) === year.jaartal).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), [transactions, year]);
  const teSorterenItems = yearTx.filter((t) => !t.allocations || t.allocations.length === 0);
  const teSorteren = teSorterenItems.length;
  useEffect(() => { if (kickReview && teSorteren > 0) setReviewing(true); }, [kickReview]);
  const gemarkeerd = yearTx.filter((t) => t.flagged).length;
  const shown = yearTx.filter((t) => {
    if (batchFilter && t.batchId !== batchFilter) return false;
    if (maand && effMonth(t) !== maand) return false;
    if (status === "sorteren" && t.allocations && t.allocations.length > 0) return false;
    if (status === "gemarkeerd" && !t.flagged) return false;
    if (focusId && t.id !== focusId) return false;
    if (cat && !(t.allocations || []).some((a) => a.categoryId === cat)) return false;
    if (q) { const hay = (t.name + " " + (t.description || "") + " " + (t.note || "")).toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
    return true;
  });
  const PAGE = 100;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [batchFilter, maand, status, q, cat, focusId, year]);
  const visible = shown.slice(0, limit);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Transacties {year.jaartal}</SectionTitle>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {teSorteren > 0 && !reviewing && <Btn size="sm" onClick={() => setReviewing(true)}>▶ Nalopen ({teSorteren})</Btn>}
          {onAddManual && <Btn variant={showManual ? "secondary" : "ghost"} size="sm" onClick={() => { setShowManual((s) => !s); setShowCleanup(false); }}>{showManual ? "Sluiten" : "+ Losse transactie"}</Btn>}
          {onOpenTikkies && <Btn variant="ghost" size="sm" onClick={onOpenTikkies}>{`Tikkies & delen →`}</Btn>}
          {(onClearRange || onClearYear) && <Btn variant={showCleanup ? "secondary" : "ghost"} size="sm" onClick={() => { setShowCleanup((s) => !s); setShowManual(false); }}>{showCleanup ? "Opschonen sluiten" : "Opschonen / wissen"}</Btn>}
        </div>
      </div>
      {onCreateSavings && <OnbekendeSpaarrekeningen transactions={transactions} categories={categories} onCreateSavings={onCreateSavings} onLinkSavings={onLinkSavings} />}
      {showManual && <div style={{ marginTop: 12 }}><ManualTxForm onAdd={onAddManual} onClose={() => setShowManual(false)} /></div>}
      {showCleanup && <div style={{ marginTop: 12 }}><DataCleanup year={year} years={years} txCount={transactions.length} transactions={transactions} onClearBatch={onClearBatch} onClearRange={onClearRange} onClearYear={onClearYear} onClearAll={onClearAll} onResetAll={onResetAll} /></div>}
      {reviewing ? (
        <div style={{ marginTop: 12 }}>
          <ImportReview items={teSorterenItems} groups={groups} categories={categories} rules={rules} history={transactions} transactions={transactions} years={years} title={`Transacties ${year.jaartal} nalopen`} onSaveOne={onSaveOne} onAddRule={onAddRule} onClose={() => setReviewing(false)} onOpenTikkies={onOpenTikkies} />
        </div>
      ) : (
      <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, marginTop: 4 }}>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Transacties</div><div style={{ fontSize: 20, fontWeight: 700 }}>{yearTx.length}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Nog toe te kennen</div><div style={{ fontSize: 20, fontWeight: 700, color: teSorteren ? T.warn : T.pos }}>{teSorteren}</div></Card>
        <Card style={{ padding: 14, flex: 1, minWidth: 150 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Gemarkeerd</div><div style={{ fontSize: 20, fontWeight: 700, color: gemarkeerd ? T.warn : T.ink }}>{gemarkeerd}</div></Card>
      </div>
      {newestUnreviewed && (
        <Card style={{ padding: "12px 14px", marginBottom: 14, borderLeft: `4px solid ${batchColor(newestUnreviewed.id)}`, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: batchColor(newestUnreviewed.id), flexShrink: 0 }} />
            <span style={{ fontSize: 13, minWidth: 0 }}><b>Laatste import:</b> {newestUnreviewed.count} nieuwe transactie{newestUnreviewed.count > 1 ? "s" : ""}{newestUnreviewed.at ? ` · ${fmtDateTime(newestUnreviewed.at)}` : ""}. Ze hebben dit kleurtje gekregen zodat je ze snel even kunt nalopen.</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <Btn size="sm" variant="secondary" onClick={() => setBatchFilter(batchFilter === newestUnreviewed.id ? null : newestUnreviewed.id)}>{batchFilter === newestUnreviewed.id ? "Toon alles" : "Toon alleen deze"}</Btn>
            <Btn size="sm" onClick={() => { if (onMarkBatchReviewed) onMarkBatchReviewed(newestUnreviewed.id); setBatchFilter(null); }}>Gecontroleerd</Btn>
          </div>
        </Card>
      )}
      {teSorteren > 0 && onSaveOne && (
        <div style={{ marginBottom: 14 }}>
          <Btn onClick={() => setReviewing(true)}>Toe te kennen nalopen ({teSorteren}) →</Btn>
          <span style={{ fontSize: 12, color: T.sub, marginLeft: 10 }}>Loop ze één voor één na in het begeleidingsscherm; je kunt altijd stoppen en later verder.</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <MaandKiezer value={maand} onChange={setMaand} allLabel="alle maanden" lang />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, width: "auto", maxWidth: 230, padding: "7px 10px", fontSize: 13 }}>
          <option value="">alle posten</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.naam}>{categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.naam.split(":")[0]}</option>)}</optgroup>
          ))}
        </select>
        {[["alle", "Alle"], ["sorteren", "Toe te kennen"], ["gemarkeerd", "Gemarkeerd"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setStatus(v)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${status === v ? T.accent : T.line}`, background: status === v ? T.accentSoft : T.panel, color: status === v ? T.accent : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{lbl}</button>
        ))}
        {newestBatch && <button onClick={() => setBatchFilter(batchFilter === newestBatch.id ? null : newestBatch.id)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${batchFilter === newestBatch.id ? batchColor(newestBatch.id) : T.line}`, background: batchFilter === newestBatch.id ? "#fafcff" : T.panel, color: batchFilter === newestBatch.id ? T.ink : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: batchColor(newestBatch.id) }} />Laatste import ({newestBatch.count})</button>}
        {batchFilter && batchFilter !== (newestBatch && newestBatch.id) && <button onClick={() => setBatchFilter(null)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>× toon alles</button>}
        {focusId && <button onClick={() => setFocusId(null)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.accent}`, background: T.accentSoft, color: T.accent, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>× focus op 1 transactie wissen</button>}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="zoek op naam, mededeling of notitie" style={{ ...inputStyle, flex: 1, minWidth: 160, padding: "7px 10px", fontSize: 13 }} />
      </div>
      {yearTx.length === 0 ? (
        <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties in {year.jaartal}. Importeer je ING-CSV onder <b>Import</b>.</div></Card>
      ) : (
        <Card style={{ overflow: "hidden" }}>
          <div style={{ display: isMobile ? "none" : "grid", gridTemplateColumns: TX_COLS, gap: 10, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
            <span>Datum</span><span>Omschrijving</span><span style={{ textAlign: "right" }}>Bedrag</span><span>Post</span><span style={{ textAlign: "center" }}>Mark</span><span />
          </div>
          {visible.map((t) => <TxRow key={t.id} tx={t} groups={groups} categories={categories} rules={rules} history={transactions} years={years} newBatchId={newestUnreviewed ? newestUnreviewed.id : null} onSetAllocations={onSetAllocations} onSetNote={onSetNote} onToggleFlag={onToggleFlag} onAddRule={onAddRule} onSaveOne={onSaveOne} />)}
          {shown.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Geen transacties met dit filter.</div>}
          {shown.length > visible.length && (
            <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.line}`, display: "flex", justifyContent: "center", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: T.sub }}>{visible.length} van {shown.length} getoond</span>
              <Btn size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Toon {Math.min(PAGE, shown.length - visible.length)} meer</Btn>
              {shown.length - visible.length > PAGE && <Btn size="sm" variant="ghost" onClick={() => setLimit(shown.length)}>Toon alles</Btn>}
            </div>
          )}
        </Card>
      )}
      </>
      )}
    </div>
  );
}

function ImportReview({ items, groups, categories, rules = [], history = [], transactions = [], years = [], title = "Transacties nalopen", onSaveOne, onAddRule, onClose, onOpenTikkies }) {
  const [work, setWork] = useState(() => items.map((t) => ({ ...t })));
  const [i, setI] = useState(0);
  const [splitting, setSplitting] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [autoLearn, setAutoLearn] = useState(false);
  const total = work.length;
  if (total === 0) return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Niets meer toe te kennen — alles is ingedeeld. <button onClick={onClose} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600 }}>Terug</button></div></Card>
    </div>
  );
  const cur = work[i];
  const sign = cur.amountCents < 0 ? -1 : 1;
  const allocs = cur.allocations || [];
  const isSplit = allocs.length > 1;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const teSorteren = work.filter((t) => !t.allocations || t.allocations.length === 0).length;

  // elke wijziging wordt meteen opgeslagen, zodat er nooit werk verloren gaat
  const update = (patch) => { setWork((w) => w.map((t, j) => (j === i ? { ...t, ...patch } : t))); if (onSaveOne) onSaveOne(cur.id, patch); };
  const setSingle = (catId) => update({ allocations: catId ? [{ categoryId: catId, amountCents: cur.amountCents }] : [] });
  const learnRule = (rule) => {
    if (onAddRule) onAddRule(rule); // direct toevoegen aan Regels
    setWork((w) => w.map((t, j) => {
      if (j > i && (!t.allocations || t.allocations.length === 0) && ruleMatches(t, rule)) {
        const na = [{ categoryId: rule.categoryId, amountCents: t.amountCents }];
        if (onSaveOne) onSaveOne(t.id, { allocations: na });
        return { ...t, allocations: na };
      }
      return t;
    }));
  };
  const go = (d) => { setSplitting(false); setI((x) => Math.max(0, Math.min(total - 1, x + d))); };
  const ranked = !isSplit ? rankSuggestions(cur, rules, categories, history) : [];
  const dt = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`;
  const sameCond = (r, kw) => r.conditions && r.conditions[0] && r.conditions[0].field === "both" && r.conditions[0].operator === "contains" && String(r.conditions[0].value).toLowerCase() === kw;
  const subsOfCat = (catId) => ((categories.find((c) => c.id === catId) || {}).subs) || [];
  const choosePost = (catId) => {
    setSingle(catId);
    if (autoLearn && catId) {
      const kw = (guessKeyword(cur.name) || guessKeyword(cur.omschrijving || cur.description || "") || "").trim().toLowerCase();
      if (kw && !rules.some((r) => sameCond(r, kw) && r.categoryId === catId)) learnRule({ categoryId: catId, priority: 35, conditions: [{ field: "both", operator: "contains", value: kw }] });
    }
    const hasSubs = catId && subsOfCat(catId).length > 0;
    if (autoNext && catId && !hasSubs && i < total - 1) go(1); // bij subposten: eerst de subkeuze, dan pas door
  };
  const chooseSub = (sub) => { update({ allocations: [{ categoryId: singleCat, amountCents: cur.amountCents, sub: sub || undefined }] }); if (autoNext && i < total - 1) go(1); };

  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13, color: T.sub }}>Transactie {i + 1} van {total}</span>
        <span style={{ fontSize: 13, color: teSorteren ? T.warn : T.pos }}>{teSorteren} nog toe te kennen</span>
      </div>
      <div style={{ height: 4, background: "#eef2f1", borderRadius: 2, marginBottom: 14 }}><div style={{ height: 4, width: `${((i + 1) / total) * 100}%`, background: T.accent, borderRadius: 2 }} /></div>

      <Card style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{cur.name}</div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{cur.date.slice(8, 10)}-{cur.date.slice(5, 7)}-{cur.date.slice(0, 4)}</span><Badge>{cur.mutationType}</Badge>{cur.iban && <span style={{ fontFamily: T.mono }}>{cur.iban}</span>}</div>
          </div>
          <div style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 22, color: sign < 0 ? T.neg : T.pos, whiteSpace: "nowrap" }}>{formatEUR(cur.amountCents)}</div>
        </div>
        <div style={{ background: T.accentSoft, border: `1px solid ${T.accent}`, borderRadius: 9, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: T.accent, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>Omschrijving</div>
          <div style={{ fontSize: 16, color: T.ink, fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>{cur.omschrijving || cur.description || cur.name}</div>
          {cur.description && cur.description !== cur.omschrijving && cur.description !== cur.name && <div style={{ fontSize: 13, color: T.sub, marginTop: 7, lineHeight: 1.45, wordBreak: "break-word" }}><b style={{ color: T.sub }}>Volledige mededelingen: </b>{cur.description}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
          <input value={cur.note || ""} onChange={(e) => update({ note: e.target.value })} placeholder="Eigen omschrijving — vervangt de bank-omschrijving in je overzichten" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: sign < 0 ? 10 : 14, cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={!!cur.flagged} onChange={(e) => update({ flagged: e.target.checked })} />
          Markeer als "nog uitzoeken"
        </label>
        <div style={{ marginBottom: 14 }}><PeriodControl tx={cur} years={years} onChange={(pd) => update({ periodDate: pd })} /></div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Waar hoort dit bij?</div>
        {isSplit
          ? <div style={{ fontSize: 13, marginBottom: 4 }}>Verdeeld over {allocs.length} posten. <button onClick={() => setSplitting(true)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600 }}>wijzig</button> · <button onClick={() => setSingle("")} style={{ border: "none", background: "transparent", color: T.sub, cursor: "pointer" }}>maak leeg</button></div>
          : <PostPicker key={cur.id} categories={categories} groups={groups} sign={sign} value={singleCat} suggestions={ranked} onChange={choosePost} autoFocus />}
        {sign > 0 && !isSplit && <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>Geld terug dat je had voorgeschoten? Kies de <b>uitgavepost</b> waarop je het had geboekt — die post wordt dan per saldo lager.</div>}
        <div style={{ marginTop: 8 }}><VermogenHint tx={cur} categories={categories} /></div>
        {!isSplit && singleCat && subsOfCat(singleCat).length > 0 && (
          <div style={{ marginTop: 10, background: "#fff", border: `1px solid ${T.accent}`, borderRadius: 9, padding: "10px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Stap 2 — kies een subpost van "{(categories.find((c) => c.id === singleCat) || {}).naam}":</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {subsOfCat(singleCat).map((s) => { const on = allocs[0] && allocs[0].sub === s; return (
                <Chip key={s} active={on} tone="solid" size="lg" onClick={() => chooseSub(on ? "" : s)}>{s}</Chip>
              ); })}
              <Chip size="lg" onClick={() => chooseSub("")}>geen subpost</Chip>
            </div>
          </div>
        )}
        {splitting && <div style={{ marginTop: 10 }}><SplitEditor tx={cur} categories={categories} groups={groups} onSave={(a) => { update({ allocations: a }); setSplitting(false); }} onCancel={() => setSplitting(false)} /></div>}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, color: T.sub }}>
              <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} />
              Snel doorklikken — ga automatisch door na je keuze
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, color: T.sub }}>
              <input type="checkbox" checked={autoLearn} onChange={(e) => setAutoLearn(e.target.checked)} />
              Leer automatisch een regel van mijn keuze <span style={{ color: T.sub, fontSize: 11 }}>(maakt de regels slimmer)</span>
            </label>
          </div>
          {!splitting && !isSplit && <Btn variant="ghost" size="sm" onClick={() => setSplitting(true)}>Verdeel over meerdere posten</Btn>}
        </div>

        {singleCat && !autoLearn && <div style={{ marginTop: 12 }}><RuleLearn tx={cur} categoryId={singleCat} onAddRule={learnRule} /></div>}
        {autoLearn && singleCat && <div style={{ marginTop: 10, fontSize: 12, color: T.pos }}>✓ van deze keuze wordt automatisch een regel gemaakt</div>}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <Btn variant="ghost" onClick={onClose}>Sluiten</Btn>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: T.pos }}>✓ automatisch opgeslagen</span>
          <Btn variant="secondary" onClick={() => go(-1)} disabled={i === 0}>Vorige</Btn>
          {i < total - 1 ? <Btn onClick={() => go(1)}>Volgende</Btn> : <Btn onClick={onClose}>Klaar</Btn>}
        </div>
      </div>
      <div style={{ marginTop: 10, textAlign: "right" }}><button onClick={onClose} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Stoppen en later verder →</button></div>
    </div>
  );
}

/* ===================================================================== APP */

export { DataCleanup, ManualTxForm, UnknownSavingsRow, OnbekendeSpaarrekeningen, Transacties, ImportReview };
