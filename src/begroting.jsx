import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { loadXLSX, eur, formatEUR, distributeEven, sumMonths, checkDistribution, MND_KORT } from "./lib.js";
import { SLUITPOST_ID, applySluitpost, budgetTotals, parseBudgetRows } from "./financieel.js";
import { T, Icon, Btn, Card, Money, MoneyInput, Banner, SectionTitle, inputStyle } from "./ui.jsx";
import { Uitgaven } from "./uitgaven.jsx";

// ---- Begroting-tabblad ----
// Bedragen per post per maand invullen, beginstand zetten en een begroting overnemen
// uit Excel of uit het vorige jaar.

function AddLine({ label, onAdd, indent = false }) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [amount, setAmount] = useState(0);
  const pad = indent ? "8px 16px 8px 28px" : "8px 16px";
  const add = () => { const n = naam.trim(); if (!n) return; onAdd(n, amount); setNaam(""); setAmount(0); setOpen(false); };
  if (!open) return (
    <div style={{ padding: pad, borderTop: `1px solid ${T.line}` }}>
      <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>+ {label}</Btn>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: pad, borderTop: `1px solid ${T.line}`, background: "#fafcfb", flexWrap: "wrap" }}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Naam van de post" style={{ ...inputStyle, width: 220, padding: "6px 10px", fontSize: 13 }} />
      <span style={{ fontSize: 12, color: T.sub }}>per maand</span>
      <MoneyInput cents={amount} width={110} onChange={setAmount} />
      <Btn size="sm" onClick={add}>Toevoegen</Btn>
      <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); setNaam(""); setAmount(0); }}>Annuleren</Btn>
    </div>
  );
}

function AddSubcategory({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const add = () => { const n = naam.trim(); if (!n) return; onAdd(n); setNaam(""); setOpen(false); };
  if (!open) return (
    <div style={{ padding: "9px 16px", borderTop: `1px solid ${T.line}`, background: "#fbfdfc" }}>
      <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>+ nieuwe subcategorie onder Uitgaven</Btn>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}`, background: "#fbfdfc", flexWrap: "wrap" }}>
      <input autoFocus value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Naam subcategorie (bijv. Vervoer)" style={{ ...inputStyle, width: 240, padding: "6px 10px", fontSize: 13 }} />
      <Btn size="sm" onClick={add}>Toevoegen</Btn>
      <Btn variant="ghost" size="sm" onClick={() => { setOpen(false); setNaam(""); }}>Annuleren</Btn>
    </div>
  );
}

function Beginstand({ groups, categories, year, onSetYtd }) {
  const ytd = year.ytdSeed || {};
  const total = categories.reduce((s, c) => s + (ytd[c.id] || 0), 0);
  return (
    <Card style={{ overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "12px 16px", background: T.accentSoft, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Beginstand {year.jaartal} — al besteed/ontvangen tot nu toe</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>Begin je halverwege het jaar? Vul per post in wat er dit jaar al is besteed of ontvangen vóórdat je begon te importeren. Dit telt mee als startpunt in <b>Uitgaven › Begroot vs besteed</b>. Posten zonder beginstand laat je op 0 staan.</div>
      </div>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id);
        if (cats.length === 0) return null;
        const gt = cats.reduce((s, c) => s + (ytd[c.id] || 0), 0);
        return (
          <div key={g.id}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>
              <span>{g.naam}</span>
              <span style={{ fontFamily: T.mono, color: T.sub }}>{formatEUR(gt)}</span>
            </div>
            {cats.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "6px 16px", borderTop: `1px solid ${T.line}` }}>
                <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam.split(":")[0]}</span>
                <MoneyInput cents={ytd[c.id] || 0} width={110} onChange={(v) => onSetYtd(year.id, c.id, v)} />
              </div>
            ))}
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px", background: "#eef3f1", fontWeight: 800, fontSize: 13 }}>
        <span>Totaal ingevulde beginstand</span>
        <span style={{ fontFamily: T.mono }}>{formatEUR(total)}</span>
      </div>
    </Card>
  );
}

function Begroting({ groups, categories, budgets, year, onSaveLine, onImportBudget, onAddCategory, onAddGroup, onAcceptSluitpost, prevYear, prevActualByCat, onSetYtd }) {
  const [expanded, setExpanded] = useState(null);
  const [drag, setDrag] = useState(false);
  const [showBeginstand, setShowBeginstand] = useState(false);
  const [impResult, setImpResult] = useState(null);
  const fileRef = useRef(null);
  const lines = applySluitpost(categories, budgets[year.id] || {});
  const lineFor = (cid) => lines[cid] || { average: 0, months: distributeEven(0) };
  const totals = budgetTotals(categories, lines);
  const sluitAnnual = sumMonths(lineFor(SLUITPOST_ID).months);
  const sluitAccepted = year.sluitpostAcceptedCents != null && year.sluitpostAcceptedCents === sluitAnnual;
  const hasPrev = !!(prevYear && prevActualByCat);
  const cols = hasPrev ? "1fr 130px 110px 120px 80px" : "1fr 130px 120px 80px";

  const incomeGroupId = (groups.find((g) => categories.some((c) => c.groupId === g.id && c.type === "income")) || groups[0] || {}).id;
  const savingsGroupId = (groups.find((g) => categories.some((c) => c.groupId === g.id && c.type === "savings")) || {}).id;
  const incomeGroupIds = new Set(categories.filter((c) => c.type === "income").map((c) => c.groupId));
  const savingsGroupIds = new Set(categories.filter((c) => c.type === "savings").map((c) => c.groupId));
  const incomeCats = categories.filter((c) => c.type === "income");
  const savingsCats = categories.filter((c) => c.type === "savings");
  const expenseGroups = groups.filter((g) => !incomeGroupIds.has(g.id) && !savingsGroupIds.has(g.id));
  const annualOf = (cid) => sumMonths(lineFor(cid).months);
  const sumCats = (cs) => cs.reduce((a, c) => a + annualOf(c.id), 0);
  const expenseTotal = expenseGroups.reduce((a, g) => a + sumCats(categories.filter((c) => c.groupId === g.id)), 0);

  const renderLine = (c) => {
    const line = lineFor(c.id), annual = sumMonths(line.months), isOpen = expanded === c.id;
    const prevA = hasPrev ? (prevActualByCat[c.id] || 0) : 0;
    if (c.id === SLUITPOST_ID) return (
      <div key={c.id} style={{ borderTop: `1px solid ${T.line}`, background: "#fcf9e8" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 10, padding: "8px 16px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{c.naam} <span style={{ fontSize: 11, color: T.warn, fontWeight: 600 }}>· sluitpost</span></span>
          <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{formatEUR(Math.round(annual / 12))}</div>
          {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(Math.abs(prevA)) : "—"}</div>}
          <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} bold /></div>
          <div />
        </div>
      </div>
    );
    return (
      <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 10, padding: "8px 16px" }}>
          <span style={{ fontSize: 14 }}>{c.naam}{c.noteSuggested && <span title="opmerking voorgesteld" style={{ marginLeft: 6, color: T.warn }}>•</span>}</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
            <MoneyInput cents={line.average} width={110} onChange={(v) => onSaveLine(c.id, v, distributeEven(v))} />
          </div>
          {hasPrev && <div style={{ textAlign: "right", fontSize: 12, color: T.sub }}>{prevA ? formatEUR(Math.abs(prevA)) : "—"}</div>}
          <div style={{ textAlign: "right", fontSize: 13 }}><Money cents={annual} muted /></div>
          <div style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "maanden"}</Btn></div>
        </div>
        {isOpen && <MonthEditor line={line} onSave={(months) => { onSaveLine(c.id, line.average, months); setExpanded(null); }} />}
      </div>
    );
  };
  const bigHeader = (titel, bedrag) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: T.accentSoft, borderTop: `1px solid ${T.line}` }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: T.accent, letterSpacing: 0.4, textTransform: "uppercase" }}>{titel}</span>
      <span style={{ fontFamily: T.mono, fontWeight: 700, color: T.accent }}>{formatEUR(bedrag)}/jaar</span>
    </div>
  );
  const subHeader = (titel, bedrag) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 16px 9px 22px", background: "#f0f4f3", borderTop: `1px solid ${T.line}`, borderLeft: `3px solid ${T.accent}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{titel}</span>
      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.sub }}>{formatEUR(bedrag)}/jaar</span>
    </div>
  );

  const handleFile = async (file) => {
    if (!file) return;
    setImpResult(null);
    try {
      let rows;
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      } else {
        const text = await file.text();
        const head = (text.split(/\r?\n/)[0] || "").toLowerCase();
        if (/naam \/ omschrijving|mutatiesoort|saldo na mutatie|bedrag \(eur\)/.test(head)) { setImpResult({ bank: true }); return; }
        const delim = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
        rows = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => l.split(delim));
      }
      const { updates, unmatched } = parseBudgetRows(rows, categories);
      const n = Object.keys(updates).length;
      if (n > 0) onImportBudget(updates);
      setImpResult({ matched: n, unmatched });
    } catch (e) {
      setImpResult({ error: e.message || "onbekende fout" });
    }
  };

  return (
    <div>
      <SectionTitle right={onSetYtd && <Btn variant={showBeginstand ? "secondary" : "ghost"} size="sm" onClick={() => setShowBeginstand((s) => !s)}>{showBeginstand ? "Beginstand sluiten" : "Beginstand instellen"}</Btn>}>Begroting {year.jaartal}</SectionTitle>
      {showBeginstand && onSetYtd && <Beginstand groups={groups} categories={categories} year={year} onSetYtd={onSetYtd} />}

      <Card style={{ padding: 0, marginBottom: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150, padding: "14px 18px", borderRight: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Inkomsten / jaar</div>
            <Money cents={totals.income} bold size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 150, padding: "14px 18px", borderRight: `1px solid ${T.line}` }}>
            <div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Uitgaven &amp; sparen / jaar</div>
            <Money cents={totals.outflow} bold size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 200, padding: "14px 18px", background: sluitAccepted ? T.accentSoft : T.warnSoft }}>
            <div style={{ fontSize: 12, color: sluitAccepted ? T.accent : "#9a6a14", marginBottom: 4, fontWeight: 600 }}>Sluitpost · gezamenlijke spaarrekening</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Money cents={sluitAnnual} bold size={18} />
              {sluitAccepted
                ? <span style={{ fontSize: 12, color: T.pos, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon d={<polyline points="20 6 9 17 4 12" />} size={14} /> akkoord</span>
                : <Btn size="sm" onClick={() => onAcceptSluitpost && onAcceptSluitpost(sluitAnnual)}>Accepteren</Btn>}
            </div>
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${T.line}`, fontSize: 12, color: sluitAccepted ? T.sub : "#9a6a14" }}>
          {sluitAccepted
            ? <>Het verschil tussen inkomsten en uitgaven komt op de <b>gezamenlijke spaarrekening</b>. Je hebt dit bedrag geaccepteerd.</>
            : <>Het verschil tussen inkomsten en uitgaven komt op de <b>gezamenlijke spaarrekening</b>. Controleer het bedrag hierboven en klik op <b>Accepteren</b> om de begroting te bevestigen. Wijzig je later een post, dan vraagt hij opnieuw om akkoord.</>}
        </div>
      </Card>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: `2px dashed ${drag ? T.accent : T.line}`, background: drag ? T.accentSoft : T.panel, borderRadius: T.radius, padding: "16px 18px", marginBottom: 14, cursor: "pointer", textAlign: "center" }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sleep hier je begroting · alleen postnaam + maandbedrag</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>Excel of CSV · dit is níét voor je bankafschrift — dat hoort op de Import-tab</div>
      </div>
      {impResult && (
        <div style={{ marginBottom: 16 }}>
          {impResult.bank ? <Banner tone="warn">Dit lijkt je <b>bankafschrift</b>, niet je begroting. Sleep dit bestand op de <b>Import</b>-tab — daar lees je je transacties in.</Banner>
            : impResult.error ? <Banner tone="neg">Kon het bestand niet lezen: {impResult.error}. Tip: bewaar je Excel-tabblad als CSV en sleep dat.</Banner>
            : <Banner tone={impResult.unmatched.length ? "warn" : "ok"}>
                {impResult.matched} post(en) herkend en bijgewerkt; de begroting is automatisch sluitend gemaakt.
                {impResult.unmatched.length > 0 && <div style={{ marginTop: 6, fontSize: 13 }}>Niet aan een post gekoppeld ({impResult.unmatched.length}): {impResult.unmatched.slice(0, 8).join(", ")}{impResult.unmatched.length > 8 ? "…" : ""}</div>}
              </Banner>}
        </div>
      )}

      {hasPrev && <div style={{ marginBottom: 14 }}><Banner tone="neutral">Tip: de kolom <b>{prevYear.jaartal} werkelijk</b> laat zien wat je vorig jaar echt uitgaf. Gebruik dat als ijkpunt en pas posten aan op bekende veranderingen.</Banner></div>}

      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Post</span><span style={{ textAlign: "right" }}>per maand</span>{hasPrev && <span style={{ textAlign: "right" }}>{prevYear.jaartal} werkelijk</span>}<span style={{ textAlign: "right" }}>per jaar</span><span />
        </div>

        {bigHeader("Inkomsten", sumCats(incomeCats))}
        {incomeCats.map(renderLine)}
        <AddLine label="nieuwe inkomstenpost" onAdd={(n, a) => onAddCategory(incomeGroupId, n, "income", a)} />

        {bigHeader("Uitgaven", expenseTotal)}
        {expenseGroups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id}>
              {subHeader(g.naam, sumCats(cats))}
              {cats.map(renderLine)}
              <AddLine label={"nieuwe post in " + g.naam} indent onAdd={(n, a) => onAddCategory(g.id, n, "expense", a)} />
            </div>
          );
        })}
        <AddSubcategory onAdd={onAddGroup} />

        {bigHeader("Sparen", sumCats(savingsCats))}
        {savingsCats.map(renderLine)}
        {savingsGroupId && <AddLine label="nieuwe spaarpost" onAdd={(n, a) => onAddCategory(savingsGroupId, n, "savings", a)} />}
      </Card>
    </div>
  );
}
function MonthEditor({ line, onSave }) {
  const [months, setMonths] = useState(line.months.slice());
  useEffect(() => { setMonths(line.months.slice()); }, [line]);
  const names = MND_KORT;
  const check = checkDistribution(line.average, months);
  return (
    <div style={{ padding: "4px 16px 14px", background: "#fafcfb" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 10 }}>
        {months.map((m, i) => (
          <div key={i}>
            <div style={{ fontSize: 10, color: T.sub, marginBottom: 2 }}>{names[i]}</div>
            <MoneyInput cents={m} width="100%" onChange={(v) => { const n = months.slice(); n[i] = v; setMonths(n); }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: check.ok ? T.pos : T.neg }}>{check.ok ? `Sluit aan op ${formatEUR(check.target)}` : `Wijkt ${formatEUR(Math.abs(check.diff))} af van ${formatEUR(check.target)}`}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={() => setMonths(distributeEven(line.average))}>Verdeel gelijk</Btn>
          <Btn size="sm" disabled={!check.ok} onClick={() => onSave(months)}>Opslaan</Btn>
        </div>
      </div>
    </div>
  );
}

export { AddLine, AddSubcategory, Beginstand, Begroting, MonthEditor };
