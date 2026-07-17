import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatEUR, MND_KORT } from "./lib.js";
import { potFlows, potMutations, potHistory } from "./financieel.js";
import { T, Card, Money, MoneyInput, Banner, SectionTitle, inputStyle, chipStyle } from "./ui.jsx";

// ---- Vermogen-tabblad ----
// Saldi per spaarrekening met drilldown naar de onderliggende mutaties, en het
// jaarverloop als grafiek. Rekenwerk zit in financieel.js (potFlows/potHistory).

// Maandelijks vermogensverloop als lijngrafiek (custom SVG, geen externe library).
// Toont het totaal (dik) en per rekening een dunne lijn; kies onder de grafiek wat je toont.
function VermogenChart({ history, jaartal }) {
  const [mode, setMode] = useState("total"); // "total" of een rekening-id
  if (!history || history.perAccount.length === 0) return null;
  const monthsWithData = history.total.some((v, i) => i > 0 ? history.total[i] !== history.total[i - 1] : v !== history.startTotal) || history.startTotal !== 0;
  const W = 640, H = 220, padL = 62, padR = 16, padT = 14, padB = 26;
  const labels = MND_KORT;
  const series = mode === "total" ? history.total : (history.perAccount.find((a) => a.id === mode) || { series: [] }).series;
  const startVal = mode === "total" ? history.startTotal : (history.perAccount.find((a) => a.id === mode) || { start: 0 }).start;
  // 13 punten: startsaldo (x=0) + 12 maandeindes
  const points = [startVal, ...series];
  const maxV = Math.max(...points, 1), minV = Math.min(...points, 0);
  const range = maxV - minV || 1;
  const x = (i) => padL + (i / 12) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - minV) / range) * (H - padT - padB);
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${x(12).toFixed(1)} ${y(minV).toFixed(1)} L ${x(0).toFixed(1)} ${y(minV).toFixed(1)} Z`;
  // y-as-ticks
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => minV + (range * i) / ticks);
  const curName = mode === "total" ? "Totaal vermogen" : (history.perAccount.find((a) => a.id === mode) || {}).naam;
  const curEnd = points[12];
  return (
    <Card style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>Vermogensverloop {jaartal} <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· {curName}</span></div>
        <div style={{ fontSize: 13, color: T.sub }}>eind: <b style={{ color: T.ink }}>{formatEUR(curEnd)}</b> <span style={{ color: curEnd - startVal >= 0 ? T.pos : T.neg }}>({curEnd - startVal >= 0 ? "+" : "−"}{formatEUR(Math.abs(curEnd - startVal))} dit jaar)</span></div>
      </div>
      {!monthsWithData ? (
        <div style={{ fontSize: 12.5, color: T.sub, padding: "20px 0" }}>Nog geen mutaties dit jaar om te tonen.</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {tickVals.map((tv, i) => (
              <g key={i}>
                <line x1={padL} y1={y(tv)} x2={W - padR} y2={y(tv)} stroke={T.line} strokeWidth="1" />
                <text x={padL - 8} y={y(tv) + 3} textAnchor="end" fontSize="9" fill={T.sub}>{Math.round(tv / 100000) === tv / 100000 ? `€${Math.round(tv / 100000)}k` : `€${(tv / 100).toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`}</text>
              </g>
            ))}
            {minV < 0 && <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#c9d3d0" strokeWidth="1.5" strokeDasharray="3 3" />}
            <path d={areaPath} fill={T.accent} opacity="0.08" />
            <path d={path} fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={T.accent} />)}
            {["start", ...labels].map((lb, i) => (i === 0 || i % 2 === 1) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill={T.sub}>{lb}</text>)}
          </svg>
          {history.perAccount.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button onClick={() => setMode("total")} style={chipStyle(mode === "total")}>Totaal</button>
              {history.perAccount.map((a) => <button key={a.id} onClick={() => setMode(a.id)} style={chipStyle(mode === a.id)}>{a.naam}</button>)}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
function Vermogen({ pots, categories, transactions, year, budgetLines = {}, onSetPotOpening, onSetSpaarcode, onSetPotTarget }) {
  const potOf = (cid) => pots.find((x) => x.categoryId === cid) || {};
  const [openId, setOpenId] = useState(null);
  const flows = useMemo(() => potFlows(transactions, categories), [transactions, categories]);
  const mutations = useMemo(() => potMutations(transactions, categories), [transactions, categories]);
  const history = useMemo(() => (year ? potHistory(transactions, categories, pots, year.jaartal) : null), [transactions, categories, pots, year]);
  const rows = categories.filter((c) => c.type === "savings").map((c) => {
    const f = flows.get(c.id) || { dep: 0, wd: 0, depDerived: 0, wdDerived: 0 };
    const dep = f.dep, wd = f.wd, depDerived = f.depDerived || 0, wdDerived = f.wdDerived || 0;
    const p = potOf(c.id);
    const opening = p.opening || 0, target = p.target || 0;
    const contrib = (budgetLines[c.id] || {}).average || 0;
    return { categoryId: c.id, naam: c.naam, spaarcode: c.spaarcode || "", opening, dep, wd, depDerived, wdDerived, current: opening + dep - wd, target, contrib };
  });
  const tot = rows.reduce((a, r) => ({ opening: a.opening + r.opening, dep: a.dep + r.dep, wd: a.wd + r.wd, current: a.current + r.current }), { opening: 0, dep: 0, wd: 0, current: 0 });
  const cols = "1fr 130px 100px 100px 120px";
  return (
    <div>
      <SectionTitle>Vermogen · opbouw per rekening</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Per spaar- of reserveringsrekening: het <b>startsaldo</b>, wat er bij/af ging en het huidige saldo. Vul de <b>code of tegenrekening-IBAN</b> in, dan herkent de app stortingen en opnames automatisch — <b>ook als de transactie zelf op een andere post staat</b> (bijv. Tussenrekening): bij "Naar Spaardeposito X…" of "Van Oranje spaarrekening M…" in de mededelingen wordt de juiste rekening vanzelf bij- of afgeboekt. Zet een <b>doel</b> en ik toon de voortgang — met een maandinleg in je begroting ook een prognose.</Banner></div>
      {history && <VermogenChart history={history} jaartal={year.jaartal} />}
      <Card style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, minWidth: 560, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Rekening</span><span style={{ textAlign: "right" }}>Startsaldo</span><span style={{ textAlign: "right" }}>Bij</span><span style={{ textAlign: "right" }}>Af</span><span style={{ textAlign: "right" }}>Huidig saldo</span>
        </div>
        {rows.map((r, i) => {
          const pct = r.target > 0 ? Math.min(100, Math.round((r.current / r.target) * 100)) : 0;
          const remaining = Math.max(0, r.target - r.current);
          const months = r.target > 0 && r.contrib > 0 && remaining > 0 ? Math.ceil(remaining / r.contrib) : 0;
          const reached = r.target > 0 && r.current >= r.target;
          return (
            <div key={i} style={{ borderTop: `1px solid ${T.line}` }}>
              <div style={{ display: "grid", gridTemplateColumns: cols, minWidth: 560, gap: 10, alignItems: "center", padding: "10px 16px 6px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.naam}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
                    {onSetSpaarcode && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 11, color: T.sub }}>Code/IBAN</span><input value={r.spaarcode} onChange={(e) => onSetSpaarcode(r.categoryId, e.target.value.trim())} placeholder="bijv. H17729888" style={{ ...inputStyle, width: 145, padding: "3px 7px", fontSize: 11, fontFamily: T.mono }} /></span>}
                    {onSetPotTarget && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ fontSize: 11, color: T.sub }}>Doel</span><MoneyInput cents={r.target} width={100} onChange={(v) => onSetPotTarget(r.categoryId, v)} /></span>}
                    {(r.depDerived > 0 || r.wdDerived > 0) && <span style={{ fontSize: 11, color: T.sub }} title="Overboekingen die op een andere post staan (bijv. Tussenrekening) maar via de code in de mededelingen aan deze rekening zijn toegerekend.">waarvan uit mededelingen: {r.depDerived > 0 ? `+ ${formatEUR(r.depDerived)}` : ""}{r.depDerived > 0 && r.wdDerived > 0 ? " · " : ""}{r.wdDerived > 0 ? `− ${formatEUR(r.wdDerived)}` : ""}</span>}
                    {(mutations.get(r.categoryId) || []).length > 0 && <button onClick={() => setOpenId(openId === r.categoryId ? null : r.categoryId)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: 0 }}>{openId === r.categoryId ? "▴ mutaties verbergen" : `▾ ${(mutations.get(r.categoryId) || []).length} mutatie${(mutations.get(r.categoryId) || []).length > 1 ? "s" : ""} tonen`}</button>}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>{onSetPotOpening ? <MoneyInput cents={r.opening} width={120} onChange={(v) => onSetPotOpening(r.categoryId, v)} /> : <Money cents={r.opening} muted />}</div>
                <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.dep ? "+ " + formatEUR(r.dep) : "—"}</span>
                <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.wd ? "− " + formatEUR(r.wd) : "—"}</span>
                <span style={{ textAlign: "right" }}><Money cents={r.current} bold /></span>
              </div>
              {r.target > 0 && (
                <div style={{ padding: "0 16px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: T.sub, marginBottom: 3 }}>
                    <span style={{ minWidth: 0 }}>{reached ? <b style={{ color: T.pos }}>✓ Doel bereikt</b> : <>nog <b>{formatEUR(remaining)}</b> tot {formatEUR(r.target)}{months ? ` · ~${months} mnd bij ${formatEUR(r.contrib)}/mnd` : ""}</>}</span>
                    <span style={{ flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: reached ? T.pos : T.accent }} /></div>
                </div>
              )}
              {openId === r.categoryId && (
                <div style={{ margin: "0 16px 12px", background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 12px" }}>
                  {(mutations.get(r.categoryId) || []).map((m, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12, padding: "3px 0", borderTop: j ? `1px solid ${T.line}` : "none" }}>
                      <span style={{ color: T.sub, flexShrink: 0, fontFamily: T.mono }}>{m.date.slice(8, 10)}-{m.date.slice(5, 7)}-{m.date.slice(0, 4)}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.name}{m.derived ? <span style={{ color: T.sub }}> · uit mededelingen{m.via ? ` (staat op: ${m.via})` : ""}</span> : <span style={{ color: T.sub }}> · direct geboekt</span>}</span>
                      <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", flexShrink: 0, color: m.deltaCents >= 0 ? T.pos : T.neg }}>{m.deltaCents >= 0 ? "+ " : "− "}{formatEUR(Math.abs(m.deltaCents))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: cols, minWidth: 560, gap: 10, alignItems: "center", padding: "12px 16px", borderTop: `2px solid ${T.line}`, background: "#f7faf9" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Totaal vermogen</span>
          <span style={{ textAlign: "right", paddingRight: 4 }}><Money cents={tot.opening} muted /></span>
          <span style={{ textAlign: "right", color: T.pos, fontFamily: T.mono, fontSize: 13 }}>{tot.dep ? "+ " + formatEUR(tot.dep) : "—"}</span>
          <span style={{ textAlign: "right", color: T.neg, fontFamily: T.mono, fontSize: 13 }}>{tot.wd ? "− " + formatEUR(tot.wd) : "—"}</span>
          <span style={{ textAlign: "right" }}><Money cents={tot.current} bold size={16} /></span>
        </div>
      </Card>
    </div>
  );
}

/* ============================================ BEGELEIDE TRANSACTIEVERWERKING (slaat direct op) */

export { VermogenChart, Vermogen };
