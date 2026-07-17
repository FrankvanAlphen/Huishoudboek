import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { loadXLSX, effYear, norm, dedupHash } from "./lib.js";
import { reconcileImport, ruleMatches, categorize, parseINGRows, parseINGCsv, SAMPLE_CSV, SLUITPOST_ID } from "./financieel.js";
import { T, Btn, Card, MoneyInput, Banner, Toggle, SectionTitle, inputStyle } from "./ui.jsx";
import { Uitgaven } from "./uitgaven.jsx";
import { Transacties } from "./transacties.jsx";
import { Begroting } from "./begroting.jsx";

// ---- Beheer: posten, regels en import ----
// Posten en subposten inrichten, automatische regels beheren (incl. hygienecontrole),
// en bankafschriften importeren met dubbeldetectie.

function SubEditor({ subs, onChange }) {
  const [val, setVal] = useState("");
  const list = subs || [];
  const add = () => { const v = val.trim(); if (!v || list.includes(v)) { setVal(""); return; } onChange([...list, v]); setVal(""); };
  return (
    <div style={{ padding: "10px 16px 14px 16px", background: "#fafcfb", borderTop: `1px dashed ${T.line}` }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Subposten verdelen het <b>werkelijke</b> bedrag van deze post (de begroting blijft op de hoofdpost). Je kiest per transactie een subpost; het totaal per subpost zie je onder <b>Uitgaven › Subposten</b>.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {list.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.accentSoft, color: T.accent, borderRadius: 999, padding: "4px 10px", fontSize: 12.5, fontWeight: 600 }}>
            {s}
            <button onClick={() => onChange(list.filter((x) => x !== s))} title="verwijder subpost" style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
          </span>
        ))}
        {list.length === 0 && <span style={{ fontSize: 12, color: T.sub }}>nog geen subposten</span>}
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="subpost toevoegen" style={{ ...inputStyle, width: 170, padding: "5px 9px", fontSize: 12.5 }} />
        <Btn size="sm" variant="secondary" onClick={add}>+ Toevoegen</Btn>
      </div>
    </div>
  );
}

function Posten({ groups, categories, transactions, year, onToggleNote, onUpdateCategory, onDeleteCategory, onAddCategory }) {
  const used = new Set();
  for (const t of transactions) for (const a of t.allocations) used.add(a.categoryId);
  const countYear = {};
  for (const t of transactions) { if (year && effYear(t) !== year.jaartal) continue; const seen = new Set(); for (const a of t.allocations) { if (seen.has(a.categoryId)) continue; seen.add(a.categoryId); countYear[a.categoryId] = (countYear[a.categoryId] || 0) + 1; } }
  const [subOpen, setSubOpen] = useState(null);
  return (
    <div>
      <SectionTitle>Posten beheren</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Hier hernoem je posten, kies je het type, of verwijder je ze. Met <b>max/jaar</b> waarschuw ik bij mogelijke dubbele boekingen. Met <b>subposten</b> splits je een uitgavepost verder uit (bijv. Boodschappen → per winkel, of Maud → Kleding/inventaris/verbruik/overige) terwijl de begroting op de hoofdpost blijft. <b>Nieuwe posten voeg je toe bij Begroting.</b></Banner></div>
      <Card style={{ overflowX: "auto" }}>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          return (
            <div key={g.id}>
              <div style={{ padding: "10px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
              {cats.map((c) => {
                const isSluit = c.id === SLUITPOST_ID;
                const inUse = used.has(c.id);
                const cnt = countYear[c.id] || 0;
                const over = c.freqPerYear && cnt > c.freqPerYear;
                const canSub = !isSluit && c.type !== "income";
                const nSub = (c.subs || []).length;
                const isSubOpen = subOpen === c.id;
                return (
                  <div key={c.id}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 104px 82px 118px 94px 80px 64px", minWidth: 660, gap: 10, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}`, background: isSluit ? "#fcf9e8" : undefined }}>
                      <input value={c.naam} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { naam: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, border: isSluit ? "none" : `1px solid ${T.line}`, background: isSluit ? "transparent" : "#fff" }} />
                      <select value={c.type} disabled={isSluit} onChange={(e) => onUpdateCategory(c.id, { type: e.target.value })} style={{ ...inputStyle, padding: "6px 10px", fontSize: 13, opacity: isSluit ? 0.6 : 1 }}>
                        <option value="expense">uitgave</option>
                        <option value="savings">sparen</option>
                        <option value="income">inkomsten</option>
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12, color: T.sub }}>opm.</span>
                        <Toggle on={c.noteSuggested} onClick={() => onToggleNote(c.id)} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }} title="hoe vaak deze post per jaar mag voorkomen (leeg = geen limiet)">
                        <span style={{ fontSize: 11, color: T.sub }}>max/jr</span>
                        <input type="number" min="0" value={c.freqPerYear || ""} onChange={(e) => onUpdateCategory(c.id, { freqPerYear: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })} placeholder="—" style={{ ...inputStyle, width: 44, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
                        <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: over ? T.neg : "#9aa8a5" }} title="aantal keer dit jaar geboekt">{cnt}×</span>
                      </div>
                      <div style={{ textAlign: "center" }}>{c.type === "expense" ? <button onClick={() => onUpdateCategory(c.id, { vast: !c.vast })} title="vaste (verplichte) of variabele (vrij besteedbare) last" style={{ border: `1px solid ${T.line}`, background: c.vast ? "#eef0ff" : "#f0f7f0", color: c.vast ? "#4338ca" : T.pos, borderRadius: 7, padding: "4px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>{c.vast ? "vast" : "variabel"}</button> : <span />}</div>
                      <div style={{ textAlign: "center" }}>
                        {canSub ? <button onClick={() => setSubOpen(isSubOpen ? null : c.id)} style={{ border: `1px solid ${nSub ? T.accent : T.line}`, background: nSub ? T.accentSoft : "#fff", color: nSub ? T.accent : T.sub, borderRadius: 7, padding: "4px 8px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>subs{nSub ? ` (${nSub})` : ""} {isSubOpen ? "▴" : "▾"}</button> : <span />}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {isSluit ? <span style={{ fontSize: 11, color: T.sub }}>automatisch</span>
                          : inUse ? <span style={{ fontSize: 11, color: T.sub }} title="heeft transacties">in gebruik</span>
                          : <Btn variant="danger" size="sm" onClick={() => onDeleteCategory(c.id)}>Verwijder</Btn>}
                      </div>
                    </div>
                    {isSubOpen && canSub && <SubEditor subs={c.subs} onChange={(subs) => onUpdateCategory(c.id, { subs: subs.length ? subs : undefined })} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function RuleHygiene({ rules, categories, transactions = [], onBulkDelete }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'unused' | null
  const catName = (id) => (categories.find((c) => c.id === id) || {}).naam || "(onbekende post)";
  const hasCond = (c) => c.field === "amount" ? (c.operator === "amountRange" ? (c.min != null || c.max != null) : c.amount != null) : !!String(c.value || "").trim();
  const norm = (r) => { const c = (r.conditions && r.conditions[0]) || {}; const amt = c.field === "amount" ? `${c.operator}:${c.amount ?? ""}:${c.min ?? ""}:${c.max ?? ""}` : ""; return { field: c.field, op: c.operator, val: String(c.value || "").trim().toLowerCase(), amt, has: hasCond(c) }; };
  const byFull = {};
  for (const r of rules) { const n = norm(r); const k = `${r.categoryId}|${n.field}|${n.op}|${n.val}|${n.amt}`; (byFull[k] = byFull[k] || []).push(r); }
  const dupExtra = []; for (const k in byFull) if (byFull[k].length > 1) dupExtra.push(...byFull[k].slice(1).map((r) => r.id));
  const byTrig = {};
  for (const r of rules) { const n = norm(r); if (!n.has) continue; const k = `${n.field}|${n.op}|${n.val}|${n.amt}`; (byTrig[k] = byTrig[k] || []).push(r); }
  const conflicts = Object.values(byTrig).filter((arr) => new Set(arr.map((r) => r.categoryId)).size > 1);
  const emptyIds = rules.filter((r) => !norm(r).has).map((r) => r.id);
  const hit = {}; for (const r of rules) hit[r.id] = 0;
  for (const t of transactions) for (const r of rules) if (ruleMatches(t, r)) hit[r.id]++;
  const unused = transactions.length ? rules.filter((r) => hit[r.id] === 0) : [];
  const issues = dupExtra.length + conflicts.length + emptyIds.length;
  const pill = (txt, tone) => <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: tone === "ok" ? "#e7f4ec" : T.warnSoft, color: tone === "ok" ? T.pos : "#9a6a14" }}>{txt}</span>;
  return (
    <Card style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Regels opschonen</span>
        {issues === 0 ? pill("alles ziet er netjes uit", "ok") : <>
          {dupExtra.length > 0 && pill(`${dupExtra.length} dubbel`)}
          {conflicts.length > 0 && pill(`${conflicts.length} conflict${conflicts.length > 1 ? "en" : ""}`)}
          {emptyIds.length > 0 && pill(`${emptyIds.length} leeg`)}
        </>}
        {transactions.length > 0 && unused.length > 0 && pill(`${unused.length} ongebruikt`)}
        <button onClick={() => setOpen((o) => !o)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{open ? "verberg" : "bekijk & opschonen"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: T.sub }}>{rules.length} regels in totaal{transactions.length > 0 ? ` · gemeten op ${transactions.length} transacties` : " · importeer transacties om ongebruikte regels te vinden"}.</div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn size="sm" variant={dupExtra.length ? "secondary" : "ghost"} disabled={!dupExtra.length} onClick={() => onBulkDelete(dupExtra)}>Ontdubbel ({dupExtra.length})</Btn>
            <Btn size="sm" variant={emptyIds.length ? "secondary" : "ghost"} disabled={!emptyIds.length} onClick={() => onBulkDelete(emptyIds)}>Verwijder lege ({emptyIds.length})</Btn>
            {confirm === "unused"
              ? <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ fontSize: 12, color: T.neg }}>Zeker weten?</span><Btn size="sm" variant="danger" onClick={() => { onBulkDelete(unused.map((r) => r.id)); setConfirm(null); }}>Ja, verwijder {unused.length}</Btn><Btn size="sm" variant="ghost" onClick={() => setConfirm(null)}>Annuleer</Btn></span>
              : <Btn size="sm" variant={unused.length ? "secondary" : "ghost"} disabled={!unused.length} onClick={() => setConfirm("unused")}>Verwijder ongebruikte ({unused.length})</Btn>}
          </div>

          {conflicts.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Conflicten — zelfde trefwoord, verschillende post (kies zelf welke klopt):</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {conflicts.slice(0, 8).map((arr, i) => (
                  <div key={i} style={{ fontSize: 12.5, background: T.warnSoft, border: `1px solid #f0dcb8`, borderRadius: 7, padding: "7px 10px" }}>
                    <b style={{ fontFamily: T.mono }}>"{norm(arr[0]).val}"</b> → {[...new Set(arr.map((r) => catName(r.categoryId)))].join("  ·  ")}
                  </div>
                ))}
              </div>
            </div>
          )}

          {transactions.length > 0 && unused.length > 0 && (
            <div style={{ fontSize: 12, color: T.sub }}>Ongebruikt = matcht geen enkele bestaande transactie. Soms bewust (voor toekomstige uitgaven); verwijder alleen wat je niet meer nodig hebt.</div>
          )}
        </div>
      )}
    </Card>
  );
}

function Regels({ rules, categories, groups, transactions = [], onToggle, onDelete, onBulkDelete, onUpdate, onAdd, onAddDefaults }) {
  const fl = { both: "naam of omschrijving", name: "naam", iban: "tegenrekening", description: "omschrijving", mededelingen: "mededelingen (volledig)", mutationType: "mutatiesoort", amount: "bedrag" };
  const ol = { contains: "bevat", equals: "is", startsWith: "begint met" };
  const isAmt = (f) => f === "amount";
  const opsFor = (f) => isAmt(f) ? { equals: "is exact", amountRange: "tussen" } : ol;
  const fieldChange = (cond, set, f) => { if (isAmt(f)) set({ field: f, operator: "equals", value: "", amount: cond.amount || 0, min: undefined, max: undefined }); else set({ field: f, operator: cond.operator === "amountRange" ? "contains" : cond.operator, value: cond.value || "", amount: undefined, min: undefined, max: undefined }); };
  const valEditor = (cond, set, big) => {
    if (isAmt(cond.field)) {
      if (cond.operator === "amountRange") return (
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <MoneyInput cents={cond.min || 0} width={big ? 110 : 66} onChange={(v) => set({ min: v })} />
          <span style={{ color: T.sub }}>–</span>
          <MoneyInput cents={cond.max || 0} width={big ? 110 : 66} onChange={(v) => set({ max: v })} />
        </span>);
      return <MoneyInput cents={cond.amount || 0} width={big ? 140 : 92} onChange={(v) => set({ amount: v })} />;
    }
    return <input value={cond.value || ""} onChange={(e) => set({ value: e.target.value })} placeholder={big ? "bijv. albert heijn" : ""} style={{ ...inputStyle, padding: big ? "7px 10px" : "5px 8px", fontSize: big ? 13 : 12, fontFamily: T.mono }} />;
  };
  const condValid = (c) => isAmt(c.field) ? (c.operator === "amountRange" ? ((c.min || 0) > 0 || (c.max || 0) > 0) : (c.amount || 0) > 0) : !!String(c.value || "").trim();
  const buildCond = (c) => isAmt(c.field) ? (c.operator === "amountRange" ? { field: "amount", operator: "amountRange", min: c.min || undefined, max: c.max || undefined } : { field: "amount", operator: "equals", amount: c.amount }) : { field: c.field, operator: c.operator, value: String(c.value || "").trim() };
  const [sortKey, setSortKey] = useState("priority");
  const [sortDir, setSortDir] = useState(1);
  const catName = (id) => (categories.find((c) => c.id === id) || {}).naam || "";
  const condOf = (r) => r.conditions[0] || {};
  const hitsMap = {};
  for (const r of rules) hitsMap[r.id] = 0;
  for (const t of transactions) for (const r of rules) if (r.conditions && r.conditions.length && ruleMatches(t, r)) hitsMap[r.id]++;
  const sortVal = (r) => {
    if (sortKey === "active") return r.active ? 1 : 0;
    if (sortKey === "field") return fl[condOf(r).field] || "";
    if (sortKey === "operator") return ol[condOf(r).operator] || "";
    if (sortKey === "value") return String(condOf(r).value || "").toLowerCase();
    if (sortKey === "category") return catName(r.categoryId).toLowerCase();
    if (sortKey === "hits") return hitsMap[r.id] || 0;
    return r.priority;
  };
  const sorted = [...rules].sort((a, b) => { const va = sortVal(a), vb = sortVal(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return c * sortDir || (a.priority - b.priority); });
  const toggleSort = (k) => { if (sortKey === k) setSortDir((d) => -d); else { setSortKey(k); setSortDir(1); } };
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ field: "both", operator: "contains", value: "", categoryId: "", priority: 50 });
  const grid = "46px 150px 88px 1fr 1.15fr 48px 64px 56px";
  const Th = ({ k, children, center }) => (
    <button onClick={() => toggleSort(k)} style={{ display: "flex", alignItems: "center", justifyContent: center ? "center" : "flex-start", gap: 3, border: "none", background: "transparent", padding: 0, fontSize: 11, fontWeight: 700, color: sortKey === k ? T.accent : T.sub, cursor: "pointer" }}>{children}{sortKey === k && <span>{sortDir > 0 ? "▲" : "▼"}</span>}</button>
  );
  const catOptions = groups.map((g) => (
    <optgroup key={g.id} label={g.naam}>
      {categories.filter((c) => c.groupId === g.id).map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
    </optgroup>
  ));
  const submitNew = () => {
    if (!condValid(nf) || !nf.categoryId) return;
    onAdd({ categoryId: nf.categoryId, priority: Number(nf.priority) || 50, conditions: [buildCond(nf)] });
    setNf({ field: "both", operator: "contains", value: "", categoryId: "", priority: 50 });
    setAdding(false);
  };
  return (
    <div>
      <SectionTitle right={<div style={{ display: "flex", gap: 8 }}>{onAddDefaults && <Btn variant="secondary" size="sm" onClick={onAddDefaults}>Standaardregels</Btn>}<Btn size="sm" onClick={() => setAdding((a) => !a)}>+ Nieuwe regel</Btn></div>}>Regels</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Regels categoriseren je transacties automatisch. Ze ontstaan vanzelf via "Onthoud dit" bij het importeren, maar je kunt ze hier ook zelf maken en aanpassen. Lagere prioriteit gaat vóór.</Banner></div>

      <RuleHygiene rules={rules} categories={categories} transactions={transactions} onBulkDelete={onBulkDelete} />

      {adding && (
        <Card style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Nieuwe regel: als…</div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 130px 1fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <select value={nf.field} onChange={(e) => fieldChange(nf, (p) => setNf({ ...nf, ...p }), e.target.value)} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={nf.operator} onChange={(e) => setNf({ ...nf, operator: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}>{Object.entries(opsFor(nf.field)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {valEditor(nf, (p) => setNf({ ...nf, ...p }), true)}
          </div>
          {isAmt(nf.field) && <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Het bedrag wordt vergeleken zonder plus/min — een uitgave van € 12,99 matcht dus op "12,99". Handig voor vaste lasten en abonnementen.</div>}
          <div style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 8px" }}>…dan op post</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8, alignItems: "center" }}>
            <select value={nf.categoryId} onChange={(e) => setNf({ ...nf, categoryId: e.target.value })} style={{ ...inputStyle, padding: "7px 10px", fontSize: 13 }}><option value="">— kies post —</option>{catOptions}</select>
            <input type="number" value={nf.priority} onChange={(e) => setNf({ ...nf, priority: e.target.value })} title="prioriteit (lager = eerst)" style={{ ...inputStyle, padding: "7px 10px", fontSize: 13, textAlign: "center" }} />
            <Btn size="sm" onClick={submitNew} disabled={!condValid(nf) || !nf.categoryId}>Toevoegen</Btn>
          </div>
        </Card>
      )}

      <Card style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, minWidth: 700, gap: 8, padding: "9px 16px", background: "#eef3f1" }}>
          <Th k="active">Actief</Th><Th k="field">Veld</Th><Th k="operator">Operator</Th><Th k="value">Waarde</Th><Th k="category">Post</Th><Th k="priority" center>Prio</Th><Th k="hits" center>Raak</Th><span />
        </div>
        {sorted.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen regels. Maak er een met "+ Nieuwe regel".</div>}
        {sorted.map((r) => {
          const cond = r.conditions[0] || { field: "name", operator: "contains", value: "" };
          const setCond = (patch) => onUpdate(r.id, { conditions: [{ ...cond, ...patch }] });
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: grid, minWidth: 700, gap: 8, alignItems: "center", padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
              <Toggle on={r.active} onClick={() => onToggle(r.id)} />
              <select value={cond.field} onChange={(e) => fieldChange(cond, setCond, e.target.value)} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(fl).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select value={cond.operator} onChange={(e) => setCond({ operator: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{Object.entries(opsFor(cond.field)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {valEditor(cond, setCond, false)}
              <select value={r.categoryId} onChange={(e) => onUpdate(r.id, { categoryId: e.target.value })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12 }}>{catOptions}</select>
              <input type="number" value={r.priority} onChange={(e) => onUpdate(r.id, { priority: Number(e.target.value) || 0 })} style={{ ...inputStyle, padding: "5px 6px", fontSize: 12, textAlign: "center" }} />
              <span title="aantal transacties dat deze regel nu raakt" style={{ textAlign: "center", fontSize: 12, fontWeight: 700, fontFamily: T.mono, color: hitsMap[r.id] ? T.pos : "#c0392b" }}>{hitsMap[r.id] || 0}</span>
              <Btn variant="danger" size="sm" onClick={() => onDelete(r.id)}>Wis</Btn>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Import({ categories, groups, rules, existingHashes, history = [], onCommit, onStartReview }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null); // { committed, dupCount, errors, autoCount, uncategorized }
  const [phase, setPhase] = useState("upload"); // upload | summary | done
  const [result, setResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const processTxns = (txns, errors) => {
    const reconciled = reconcileImport(txns.map((t, i) => ({ ...t, id: "tx-" + dedupHash(t) + "-" + i })), existingHashes);
    const news = reconciled.filter((r) => r.isNew);
    const dupCount = reconciled.length - news.length;
    let autoCount = 0;
    const committed = news.map((r) => {
      const tx = { ...r.item, hash: r.hash };
      const match = categorize(tx, rules, categories);
      let allocations = [];
      if (match) { allocations = [{ categoryId: match.categoryId, amountCents: tx.amountCents }]; autoCount++; }
      return { ...tx, allocations, note: "", flagged: false };
    });
    setParsed({ committed, dupCount, errors: errors || [], autoCount, uncategorized: committed.length - autoCount });
    setPhase("summary");
  };
  const runWith = (csv) => {
    const head = (String(csv).split(/\r?\n/)[0] || "").toLowerCase();
    if (!/datum/.test(head) || !/bedrag|af bij|mutatiesoort/.test(head)) {
      setParsed({ committed: [], dupCount: 0, errors: ["Dit lijkt geen ING-bestand. Verwacht een kop met o.a. 'Datum' en 'Bedrag (EUR)'."], autoCount: 0, uncategorized: 0 });
      setPhase("summary"); return;
    }
    const { txns, errors } = parseINGCsv(csv);
    processTxns(txns, errors);
  };
  const runWithRows = (rows) => {
    const { txns, errors } = parseINGRows(rows);
    if (txns.length === 0 && errors.length) {
      setParsed({ committed: [], dupCount: 0, errors, autoCount: 0, uncategorized: 0 });
      setPhase("summary"); return;
    }
    processTxns(txns, errors);
  };
  const run = () => runWith(text);
  const handleFile = async (file) => {
    if (!file) return;
    try {
      if (/\.xlsx?$/i.test(file.name) || /\.xls$/i.test(file.name)) {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        runWithRows(rows);
      } else {
        const csv = await file.text();
        setText(csv); runWith(csv);
      }
    } catch (e) {
      setParsed({ committed: [], dupCount: 0, errors: ["Kon het bestand niet lezen: " + (e.message || "onbekend")], autoCount: 0, uncategorized: 0 });
      setPhase("summary");
    }
  };

  const doImport = () => {
    onCommit(parsed.committed, []);
    setResult({ count: parsed.committed.length, auto: parsed.autoCount, uncategorized: parsed.uncategorized, rules: 0 });
    setPhase("done");
  };
  const finishReview = (work, learned) => {
    onCommit(work, learned);
    const unc = work.filter((t) => !t.allocations || t.allocations.length === 0).length;
    setResult({ count: work.length, auto: work.length - unc, uncategorized: unc, rules: (learned || []).length });
    setPhase("done");
  };

  if (phase === "upload") return (
    <div>
      <SectionTitle>Importeren — je ING-bestand</SectionTitle>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: `2px dashed ${drag ? T.accent : T.line}`, background: drag ? T.accentSoft : T.panel, borderRadius: T.radius, padding: "22px 18px", marginBottom: 14, cursor: "pointer", textAlign: "center" }}
      >
        <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Sleep je ING-bestand hierheen (CSV of Excel)</div>
        <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>of klik om je gedownloade bestand te kiezen · herkende transacties worden meteen ingedeeld, de rest zet je daarna op Transacties</div>
      </div>
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 8 }}>Of plak de inhoud van je ING-export hieronder.</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Datum;Naam / Omschrijving;Rekening;Tegenrekening;…"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: T.mono, fontSize: 12, padding: 10, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Btn onClick={run} disabled={!text.trim()}>Verwerk</Btn>
          <Btn variant="secondary" onClick={() => setText(SAMPLE_CSV)}>Laad mijn ING-voorbeeld</Btn>
        </div>
      </Card>
    </div>
  );

  if (phase === "summary") {
    const n = parsed.committed.length;
    return (
      <div>
        <SectionTitle>Importeren — overzicht</SectionTitle>
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Banner tone="neutral"><b>{n}</b> nieuw · <b>{parsed.dupCount}</b> al eerder geïmporteerd</Banner>
          {parsed.errors.length > 0 && <Banner tone="warn">{parsed.errors.length === 1 ? parsed.errors[0] : `${parsed.errors.length} regel(s) niet gelezen`}</Banner>}
        </div>
        {n === 0 ? (
          <Card style={{ padding: 18, marginBottom: 16 }}><div style={{ fontSize: 14 }}>{parsed.dupCount > 0 ? "Alle transacties in dit bestand waren al eerder ingelezen — er is niets nieuws toe te voegen." : "Geen nieuwe transacties gevonden."}</div></Card>
        ) : (
          <Card style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <div><b style={{ color: T.pos }}>{parsed.autoCount}</b> automatisch herkend door je regels en spaarrekening-codes.</div>
              <div><b style={{ color: T.warn }}>{parsed.uncategorized}</b> nog toe te kennen — die loop je zo samen na, of vind je later op <b>Transacties</b>.</div>
            </div>
          </Card>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {n > 0 && <Btn onClick={() => { onCommit(parsed.committed, []); if (onStartReview) onStartReview(); }}>Toevoegen &amp; begeleid nalopen ({n})</Btn>}
          {n > 0 && <Btn variant="secondary" onClick={doImport}>Alleen toevoegen</Btn>}
          <Btn variant="ghost" onClick={() => { setParsed(null); setPhase("upload"); }}>Terug</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Importeren — klaar</SectionTitle>
      <Banner tone="ok">{result.count} transactie(s) toegevoegd: {result.auto} ingedeeld{result.uncategorized > 0 ? `, ${result.uncategorized} nog toe te kennen op Transacties` : ""}{result.rules ? `, en ${result.rules} nieuwe regel(s) geleerd` : ""}.</Banner>
      <div style={{ marginTop: 14 }}><Btn variant="secondary" onClick={() => { setText(""); setParsed(null); setResult(null); setPhase("upload"); }}>Nog een bestand importeren</Btn></div>
    </div>
  );
}

/* ============================================ TRANSACTIES & VERMOGEN */

export { SubEditor, Posten, RuleHygiene, Regels, Import };
