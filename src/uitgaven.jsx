import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { me } from "./api.js";
import { formatEUR, effYear, effMonth, distributeEven, sumMonths, MND_KORT } from "./lib.js";
import { detectChain, applySluitpost } from "./financieel.js";
import { T, Btn, Card, Money, MoneyInput, Banner, SectionTitle, MaandKiezer, MaandTabel, ScrollTabel, Chip, Keuze, inputStyle } from "./ui.jsx";

// ---- Uitgaven-tabblad ----
// De negen analyseweergaven: begroot vs besteed, per maand, blokjes, vergelijking, trend,
// per winkel, subposten, bundels en abonnementen. Uitgaven() is de router ertussen.

function AbonnementenScan({ categories, lines, actualByCat, monthsElapsed }) {
  const aboCats = categories.filter((c) => c.groupId === "abonnementen" && c.type === "expense");
  if (aboCats.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Geen posten in de groep Abonnementen. Voeg ze toe op <b>Begroting</b>, dan verschijnen ze hier met hun jaarbedrag.</div></Card>;
  const rows = aboCats.map((c) => {
    const monthly = (lines[c.id] || {}).average || 0;
    const actualYTD = Math.abs(sumMonths(actualByCat[c.id] || []));
    return { id: c.id, naam: c.naam, monthly, yearly: monthly * 12, actualYTD };
  }).sort((a, b) => b.yearly - a.yearly);
  const totMonthly = rows.reduce((s, r) => s + r.monthly, 0), totYearly = totMonthly * 12, totActual = rows.reduce((s, r) => s + r.actualYTD, 0);
  const gcols = "1fr 118px 118px 128px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: 18, background: "#f3f8f6", border: `1px solid ${T.accent}` }}>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 4 }}>Je abonnementen kosten je samen</div>
        <div style={{ fontSize: 28, fontWeight: 800 }}>{formatEUR(totYearly)} <span style={{ fontSize: 15, fontWeight: 600, color: T.sub }}>per jaar</span></div>
        <div style={{ fontSize: 13, color: T.sub, marginTop: 4 }}>= {formatEUR(totMonthly)} per maand begroot · {formatEUR(totActual)} werkelijk besteed dit jaar</div>
      </Card>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Abonnement</span><span style={{ textAlign: "right" }}>Per maand</span><span style={{ textAlign: "right" }}>Per jaar</span><span style={{ textAlign: "right" }}>Besteed dit jaar</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, alignItems: "center", padding: "9px 16px", borderTop: `1px solid ${T.line}` }}>
            <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{r.naam}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13 }}>{r.monthly ? formatEUR(r.monthly) : "—"}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>{r.yearly ? formatEUR(r.yearly) : "—"}</span>
            <span style={{ textAlign: "right", fontFamily: T.mono, fontSize: 13, color: T.sub }}>{r.actualYTD ? formatEUR(r.actualYTD) : "—"}</span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: gcols, gap: 10, alignItems: "center", padding: "12px 16px", borderTop: `2px solid ${T.line}`, background: "#f7faf9" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Totaal</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700 }}>{formatEUR(totMonthly)}</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 800 }}>{formatEUR(totYearly)}</span>
          <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700, color: T.sub }}>{formatEUR(totActual)}</span>
        </div>
      </Card>
      <div style={{ fontSize: 12, color: T.sub }}>Tip: zet elke maandprijs bij de post op <b>Begroting</b>. Een abonnement dat je nauwelijks gebruikt is vaak de makkelijkste besparing.</div>
    </div>
  );
}
function Sparkline({ values, width = 130, height = 30 }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const step = n > 1 ? width / (n - 1) : width;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 5) - 3).toFixed(1)}`).join(" ");
  const last = values.length ? values[values.length - 1] : 0;
  const lx = (n - 1) * step, ly = height - (last / max) * (height - 5) - 3;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {n > 1 && <polyline points={pts} fill="none" stroke={T.accent} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
      {n > 0 && <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill={T.accent} />}
    </svg>
  );
}
function TrendView({ categories, actualByCat, names, monthsElapsed }) {
  const rows = categories.filter((c) => c.type === "expense").map((c) => {
    const monthly = (actualByCat[c.id] || Array.from({ length: 12 }, () => 0)).map((v) => Math.abs(v)).slice(0, monthsElapsed);
    const total = monthly.reduce((s, v) => s + v, 0);
    const thisM = monthly[monthsElapsed - 1] || 0;
    const avg = monthsElapsed > 0 ? total / monthsElapsed : 0;
    return { c, monthly, total, thisM, avg };
  }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  if (rows.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen uitgaven om een trend te tonen.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Per post het verloop over de maanden. De pijl vergelijkt deze maand ({names[monthsElapsed - 1]}) met je gemiddelde — omhoog (rood) is meer uitgeven dan gemiddeld.</div>
      <Card style={{ overflow: "hidden" }}>
        {rows.map((r, i) => {
          const diff = r.thisM - r.avg;
          const up = diff > r.avg * 0.05, down = diff < -r.avg * 0.05;
          return (
            <div key={r.c.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px 150px", gap: 12, alignItems: "center", padding: "10px 16px", borderTop: i ? `1px solid ${T.line}` : "none" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.c.naam.split(":")[0]}</div>
                <div style={{ fontSize: 11.5, color: T.sub }}>deze maand {formatEUR(r.thisM)} · gem {formatEUR(Math.round(r.avg))}</div>
              </div>
              <Sparkline values={r.monthly} />
              <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 700, color: up ? T.neg : down ? T.pos : T.sub }}>
                {up ? "↑" : down ? "↓" : "→"} {diff === 0 ? "gelijk" : `${diff > 0 ? "+" : "−"}${formatEUR(Math.abs(diff))}`} <span style={{ color: T.sub, fontWeight: 400 }}>vs gem</span>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

function Uitgaven({ groups, categories, budgets, year, years = [], transactions, onAddCategory, onSetYtd, onSetSubBudget }) {
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState("vergelijking"); // startweergave: begroot naast werkelijk
  const [viewYearId, setViewYearId] = useState(year.id);
  const vY = years.find((y) => y.id === viewYearId) || year;
  const monthsElapsed = useMemo(() => { let m = 1; for (const t of transactions) if (effYear(t) === vY.jaartal) m = Math.max(m, effMonth(t)); return m; }, [transactions, vY]);
  const lines = useMemo(() => applySluitpost(categories, budgets[vY.id] || {}), [categories, budgets, vY]);
  const blocksByCat = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (effYear(t) !== vY.jaartal) continue;
      for (const a of t.allocations) {
        if (!map[a.categoryId]) map[a.categoryId] = [];
        map[a.categoryId].push({ id: t.id, date: t.date, amountCents: a.amountCents, note: t.note || "", flagged: !!t.flagged, label: t.omschrijving || t.name || "" });
      }
    }
    for (const k in map) map[k].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return map;
  }, [transactions, vY]);
  const actualByCat = useMemo(() => {
    const map = {};
    for (const t of transactions) {
      if (effYear(t) !== vY.jaartal) continue;
      const m = effMonth(t);
      for (const a of t.allocations) {
        if (!map[a.categoryId]) map[a.categoryId] = Array.from({ length: 12 }, () => 0);
        map[a.categoryId][m - 1] += a.amountCents;
      }
    }
    return map;
  }, [transactions, vY]);
  const names = MND_KORT;
  const yearTxCount = transactions.filter((t) => effYear(t) === vY.jaartal).length;
  const totalIncome = categories.filter((c) => c.type === "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const totalOut = categories.filter((c) => c.type !== "income").reduce((s, c) => s + Math.abs(sumMonths(actualByCat[c.id] || [])), 0);
  const cols = "1fr 110px 110px 110px 60px";
  const sortedYears = [...years].sort((a, b) => a.jaartal - b.jaartal);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SectionTitle>Uitgaven {vY.jaartal}</SectionTitle>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {sortedYears.length > 1 && (
            <div style={{ display: "inline-flex", gap: 4 }}>
              {sortedYears.map((y) => (
                <button key={y.id} onClick={() => setViewYearId(y.id)} style={{ padding: "5px 11px", borderRadius: 8, border: `1px solid ${y.id === viewYearId ? T.accent : T.line}`, background: y.id === viewYearId ? T.accentSoft : T.panel, color: y.id === viewYearId ? T.accent : T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.mono }}>{y.jaartal}</button>
              ))}
            </div>
          )}
          <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 9, overflow: "hidden" }}>
            {[["vergelijking", "Vergelijking"], ["maand", "Per maand"], ["blokjes", "Blokjes per post"], ["trend", "Trend"], ["winkels", "Per winkel"], ["subposten", "Subposten"], ["abonnementen", "Abonnementen"]].map(([v, lbl]) => (
              <button key={v} onClick={() => setView(v)} style={{ padding: "7px 13px", border: "none", background: view === v ? T.accent : T.panel, color: view === v ? "#fff" : T.sub, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Inkomsten dit jaar</div><Money cents={totalIncome} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Uitgaven &amp; sparen dit jaar</div><Money cents={totalOut} bold size={20} /></Card>
        <Card style={{ padding: 16, flex: 1, minWidth: 175 }}><div style={{ fontSize: 12, color: T.sub, marginBottom: 4 }}>Verschil</div><Money cents={totalIncome - totalOut} sign bold size={20} /></Card>
      </div>
      {yearTxCount === 0 && <div style={{ marginBottom: 16 }}><Banner tone="neutral">Nog geen transacties in {vY.jaartal}. Importeer je ING-bestand onder <b>Import</b> om je uitgaven hier te zien.</Banner></div>}
      {view === "vergelijking" && (
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub }}>
          <span>Post</span><span style={{ textAlign: "right" }}>Begroot</span><span style={{ textAlign: "right" }}>Werkelijk</span><span style={{ textAlign: "right" }}>Verschil</span><span />
        </div>
        {groups.map((g) => {
          const cats = categories.filter((c) => c.groupId === g.id);
          let gB = 0, gA = 0;
          for (const c of cats) { gB += Math.abs(sumMonths((lines[c.id] || { months: distributeEven(0) }).months)); gA += Math.abs(sumMonths(actualByCat[c.id] || [])); }
          return (
            <div key={g.id}>
              <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "9px 16px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>
                <span>{g.naam}</span>
                <span style={{ textAlign: "right", fontFamily: T.mono, color: T.sub }}>{formatEUR(gB)}</span>
                <span style={{ textAlign: "right", fontFamily: T.mono }}>{formatEUR(gA)}</span>
                <span /><span />
              </div>
              {cats.map((c) => {
                const budgetAbs = Math.abs(sumMonths((lines[c.id] || { months: distributeEven(0) }).months));
                const actualMonths = actualByCat[c.id] || Array.from({ length: 12 }, () => 0);
                const actualAbs = Math.abs(sumMonths(actualMonths));
                const diff = c.type === "income" ? actualAbs - budgetAbs : budgetAbs - actualAbs; // + = gunstig
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id} style={{ borderTop: `1px solid ${T.line}` }}>
                    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "8px 16px" }}>
                      <span style={{ fontSize: 13 }}>{c.naam}</span>
                      <span style={{ textAlign: "right" }}><Money cents={budgetAbs} muted /></span>
                      <span style={{ textAlign: "right" }}><Money cents={actualAbs} /></span>
                      <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, color: diff >= 0 ? T.pos : T.neg }}>{diff >= 0 ? "+ " : "− "}{formatEUR(Math.abs(diff))}</span>
                      <span style={{ textAlign: "right" }}><Btn variant="ghost" size="sm" onClick={() => setExpanded(isOpen ? null : c.id)}>{isOpen ? "sluit" : "mnd"}</Btn></span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "4px 16px 12px", background: "#fafcfb", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
                        {actualMonths.map((m, i) => (
                          <div key={i} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 10, color: T.sub }}>{names[i]}</div>
                            <div style={{ fontSize: 12, fontFamily: T.mono }}>{m === 0 ? "—" : formatEUR(Math.abs(m))}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </Card>
      )}
      {view === "blokjes" && <BlokjesView groups={groups} categories={categories} blocksByCat={blocksByCat} names={names} />}
      {view === "winkels" && <WinkelMatrix categories={categories} transactions={transactions} vY={vY} />}
      {view === "subposten" && <SubpostView categories={categories} transactions={transactions} vY={vY} monthsElapsed={monthsElapsed} onSetSubBudget={onSetSubBudget} />}
      {view === "maand" && <MaandMatrix groups={groups} categories={categories} lines={lines} actualByCat={actualByCat} />}
      {view === "trend" && <TrendView categories={categories} actualByCat={actualByCat} names={names} monthsElapsed={monthsElapsed} />}
      {view === "abonnementen" && <AbonnementenScan categories={categories} lines={lines} actualByCat={actualByCat} monthsElapsed={monthsElapsed} />}
    </div>
  );
}

function MaandMatrix({ groups, categories, lines, actualByCat }) {
  const [mode, setMode] = useState("werkelijk"); // werkelijk | begroot
  const src = (cid) => mode === "begroot" ? (lines[cid] ? lines[cid].months : Array.from({ length: 12 }, () => 0)) : (actualByCat[cid] || Array.from({ length: 12 }, () => 0));
  const secties = groups
    .map((g) => ({ id: g.id, titel: g.naam, rijen: categories.filter((c) => c.groupId === g.id && sumMonths(src(c.id)) !== 0).map((c) => ({ id: c.id, label: c.naam, ms: src(c.id).map((v) => Math.abs(v)) })) }))
    .filter((x) => x.rijen.length > 0);
  return (
    <ScrollTabel>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
          {[["werkelijk", "Werkelijk"], ["begroot", "Begroot"]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} style={{ padding: "5px 11px", border: "none", background: mode === v ? T.accent : T.panel, color: mode === v ? "#fff" : T.sub, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>
      <MaandTabel kopLabel="Post" labelMin={170} secties={secties} />
    </ScrollTabel>
  );
}
function WinkelMatrix({ categories, transactions, vY }) {
  const superCats = categories.filter((c) => /boodschap|supermarkt|speciaalzaak|drogist/i.test(c.naam) && c.type !== "income");
  const superIds = new Set(superCats.map((c) => c.id));
  const byChain = {}; // keten -> 12 maanden
  for (const t of transactions) {
    if (effYear(t) !== vY.jaartal) continue;
    const m = effMonth(t);
    for (const a of (t.allocations || [])) {
      if (!superIds.has(a.categoryId)) continue;
      const chain = detectChain(t.name);
      if (!byChain[chain]) byChain[chain] = Array.from({ length: 12 }, () => 0);
      byChain[chain][m - 1] += Math.abs(a.amountCents);
    }
  }
  const rijen = Object.entries(byChain)
    .map(([chain, ms]) => ({ id: chain, label: chain, ms, tot: sumMonths(ms) }))
    .sort((a, b) => b.tot - a.tot);
  if (superCats.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Geen boodschappen-post gevonden om uit te splitsen.</div></Card>;
  return (
    <ScrollTabel>
      <div style={{ marginBottom: 10 }}><Banner tone="neutral">Je boodschappen ({superCats.map((c) => c.naam).join(", ")}) per winkelketen per maand. Ketens worden herkend aan de naam van de transactie; staat een winkel onder een rare naam, voeg dan een regel toe of laat het me weten.</Banner></div>
      <MaandTabel kopLabel="Winkel" labelMin={150} secties={[{ id: "winkels", rijen }]} leeg={<div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen boodschappen-transacties in {vY.jaartal}.</div>} />
    </ScrollTabel>
  );
}

function SubpostView({ categories, transactions, vY, monthsElapsed = 12, onSetSubBudget }) {
  const postsWithSubs = categories.filter((c) => (c.subs || []).length > 0);
  if (postsWithSubs.length === 0) return <Card style={{ padding: 18 }}><div style={{ fontSize: 13, color: T.sub }}>Nog geen posten met subposten. Ga naar <b>Posten</b>, klik bij een uitgavepost op <b>subs</b> en voeg subposten toe (bijv. Boodschappen → AH/Jumbo, of Maud → Kleding/inventaris/verbruik/overige). Daarna kies je per transactie een subpost.</div></Card>;
  const data = postsWithSubs.map((c) => {
    const map = {}; let untagged = 0, total = 0;
    for (const t of transactions) { if (effYear(t) !== vY.jaartal) continue; for (const a of t.allocations) { if (a.categoryId !== c.id) continue; const v = Math.abs(a.amountCents); total += v; if (a.sub && (c.subs || []).includes(a.sub)) map[a.sub] = (map[a.sub] || 0) + v; else untagged += v; } }
    const rows = (c.subs || []).map((s) => ({ label: s, val: map[s] || 0, target: (c.subBudgets || {})[s] || 0 }));
    if (untagged > 0) rows.push({ label: "— zonder subpost —", val: untagged, muted: true, target: 0 });
    return { c, rows, total };
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>De werkelijke uitgaven per subpost binnen een post ({vY.jaartal}). Zet per subpost een <b>maanddoel</b>, dan zie ik of je erbinnen blijft (vergeleken t/m maand {monthsElapsed}). De begroting blijft op de hoofdpost.</div>
      {data.map(({ c, rows, total }) => (
        <Card key={c.id} style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f0f4f3", gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.naam}</span>
            <span style={{ fontFamily: T.mono, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{formatEUR(total)}</span>
          </div>
          {rows.map((r) => {
            const hasTarget = r.target > 0;
            const ytdTarget = r.target * monthsElapsed;
            const denom = hasTarget ? ytdTarget : total;
            const pct = denom > 0 ? Math.min(100, Math.round((r.val / denom) * 100)) : 0;
            const over = hasTarget && r.val > ytdTarget;
            return (
              <div key={r.label} style={{ padding: "8px 16px", borderTop: `1px solid ${T.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: r.muted ? T.sub : T.ink, fontStyle: r.muted ? "italic" : "normal" }}>{r.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {!r.muted && onSetSubBudget && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, color: T.sub }}>doel/mnd</span><MoneyInput cents={r.target} width={90} onChange={(v) => onSetSubBudget(c.id, r.label, v)} /></span>}
                    <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{formatEUR(r.val)}{hasTarget ? <span style={{ color: over ? T.neg : T.sub, fontWeight: 400 }}> / {formatEUR(ytdTarget)}{over ? " ⚠" : ""}</span> : <span style={{ color: T.sub, fontWeight: 400 }}> · {total > 0 ? Math.round((r.val / total) * 100) : 0}%</span>}</span>
                  </span>
                </div>
                <div style={{ height: 6, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: r.muted ? "#c7d0ce" : over ? T.neg : T.accent }} /></div>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}

function BlokjesView({ groups, categories, blocksByCat, names }) {
  const dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${names[Number(iso.slice(5, 7)) - 1]}`;
  const [fMaand, setFMaand] = useState(0); // 0 = hele jaar
  const blocksOf = (cid) => (blocksByCat[cid] || []).filter((b) => !fMaand || Number(String(b.date).slice(5, 7)) === fMaand);
  const anyData = Object.values(blocksByCat).some((b) => b && b.length);
  if (!anyData) return <Card style={{ padding: 18 }}><div style={{ fontSize: 14, color: T.sub }}>Nog geen transacties om als blokjes te tonen. Importeer eerst je ING-bestand onder <b>Import</b>.</div></Card>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.sub }}>Per post zie je hier elke transactie als los blokje — met bedrag, een eventuele notitie en de datum. Geld terug op een uitgavepost staat groen (dat verlaagt de post).</div>
      <MaandKiezer value={fMaand} onChange={setFMaand} variant="chips" allLabel="hele jaar" />
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && blocksOf(c.id).length > 0);
        if (cats.length === 0) return null;
        return (
          <Card key={g.id} style={{ overflow: "hidden" }}>
            <div style={{ padding: "9px 16px", background: "#f0f4f3", fontSize: 13, fontWeight: 700 }}>{g.naam}</div>
            {cats.map((c) => {
              const blocks = blocksOf(c.id);
              const net = blocks.reduce((s, b) => s + b.amountCents, 0);
              return (
                <div key={c.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "12px 16px", borderTop: `1px solid ${T.line}` }}>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>{c.naam}</div>
                    <div style={{ fontSize: 12, fontFamily: T.mono, color: T.sub, marginTop: 2 }}>{formatEUR(Math.abs(net))} · {blocks.length}×</div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, flex: 1 }}>
                    {blocks.map((b, i) => {
                      const back = b.amountCents > 0 && c.type !== "income"; // teruggave op uitgavepost
                      const border = back ? "#bfe3c4" : b.flagged ? T.warn : T.line;
                      const bg = back ? "#eef7ee" : b.flagged ? "#fdf6e9" : "#fafcfb";
                      const col = back ? T.pos : T.ink;
                      return (
                        <div key={b.id + "-" + i} title={b.label} style={{ display: "inline-flex", flexDirection: "column", gap: 2, border: `1px solid ${border}`, background: bg, borderRadius: 9, padding: "6px 9px", minWidth: 62, maxWidth: 150 }}>
                          <span style={{ fontFamily: T.mono, fontWeight: 700, fontSize: 12.5, color: col }}>{back ? "+ " : ""}{formatEUR(Math.abs(b.amountCents))}</span>
                          {b.note && <span style={{ fontSize: 10.5, color: T.sub, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.note}</span>}
                          <span style={{ fontSize: 9.5, color: T.sub }}>{dayLabel(b.date)} {b.flagged ? "★" : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

export { AbonnementenScan, Sparkline, TrendView, Uitgaven, MaandMatrix, WinkelMatrix, SubpostView, BlokjesView };
