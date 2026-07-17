import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { formatEUR, MND_KORT, MND_LANG } from "./lib.js";
import { T, Btn, Card, Money, MoneyInput, SectionTitle, MaandKiezer } from "./ui.jsx";
import { Uitgaven } from "./uitgaven.jsx";
import { Transacties } from "./transacties.jsx";

// ---- Overzicht (dashboard) ----
// Drie kernblokken: nalopen, maand-resultaat en uitgaven per maand. De rest zit achter
// "Meer inzicht". Rekent zelf niets uit: alle cijfers komen als props uit App.jsx.

function Overzicht({ vitals, monthly = [], topPostsByMonth = [], teSorteren = 0, onDrill, currentMonth, jaar, openActions, forecast, forecastYear = null, reconciliation = null, agingAdvances = [], openingBalanceCents, bankBalanceCents, saldoGaps = 0, chainOpening = null, freqAlerts = [], topDeviations = [], missingRecurring = [], recurringTotal = 0, recurringPaid = 0, savingsRate = null, vastMonthly = 0, varMonthly = 0, onSetOpeningBalance, onGoto, onReview }) {
  const [reopen, setReopen] = useState(false);
  const [more, setMore] = useState(false); // extra dashboard-kaarten inklapbaar
  const [selMonth, setSelMonth] = useState(currentMonth); // gekozen maand voor het maand-resultaatblok
  useEffect(() => { setSelMonth(currentMonth); }, [currentMonth, jaar]);
  const tile = (label, node, sub, onClick) => (
    <Card onClick={onClick} style={{ padding: 18, flex: 1, minWidth: 190, cursor: onClick ? "pointer" : "default" }}>
      <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 700, fontFamily: T.mono, fontVariantNumeric: "tabular-nums" }}>{node}</div>
      {sub && <div style={{ fontSize: 12, color: T.sub, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
  const mn = MND_KORT;
  const oa = openActions || { teSorteren: 0, gemarkeerd: 0, count: 0, items: [] };
  const fc = forecast || { accountBalance: 0, remainingOut: 0, remainingInc: 0, projectedEnd: 0, openingSet: false, month: currentMonth };
  const haalt = fc.projectedEnd >= 0;
  const haveBank = bankBalanceCents != null;          // banksaldo bekend uit de geïmporteerde "Saldo na mutatie"-kolom
  const diff = haveBank ? fc.accountBalance - bankBalanceCents : 0; // app minus bank
  const bankMatch = haveBank && diff === 0;
  const openingSet = fc.openingSet;
  const gaps = saldoGaps > 0;
  const canReconcile = chainOpening != null;
  const reconcile = () => { if (canReconcile) onSetOpeningBalance(chainOpening); setReopen(false); };
  const _today = new Date();
  const _daysInMonth = new Date(_today.getFullYear(), _today.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, _daysInMonth - _today.getDate() + 1);
  const perDay = Math.max(0, fc.projectedEnd) / daysLeft;
  return (
    <div>
      {teSorteren > 0 && (
        <Card style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${T.warn}`, background: T.warnSoft }}>
          <div style={{ fontSize: 13 }}><b>{teSorteren}</b> transactie{teSorteren > 1 ? "s" : ""} nog toe te kennen — loop ze in één keer na.</div>
          <Btn size="sm" onClick={() => onReview && onReview()}>▶ Nalopen starten</Btn>
        </Card>
      )}

      {monthly.length === 12 && (() => {
        const mn2 = MND_LANG;
        const r = monthly[selMonth - 1] || { income: 0, expense: 0, net: 0, budgetNet: 0, toSavings: 0, fromSavings: 0 };
        const prev = selMonth > 1 ? monthly[selMonth - 2] : null;
        const nettoSpaar = r.toSavings - r.fromSavings;          // + = per saldo naar spaar, − = per saldo uit buffer gehaald
        const exclSpaar = r.net + nettoSpaar;                     // resultaat zonder spaarmutaties (huishoud-resultaat)
        // Leesbare inkomsten/uitgaven: haal de spaarbuffer-bewegingen uit de gewone in-/uitgaven,
        // zodat een buffer-opname niet als "negatieve uitgave" verschijnt.
        const zuiverInkomsten = r.income - r.fromSavings;
        const zuiverUitgaven = r.expense - r.toSavings;
        const hasData = r.income !== 0 || r.expense !== 0;
        const monthsWithData = monthly.map((m, i) => (m.income !== 0 || m.expense !== 0 ? i + 1 : null)).filter(Boolean);
        return (
          <Card style={{ padding: 18, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Maand-resultaat</div>
              <MaandKiezer value={selMonth} onChange={setSelMonth} months={monthsWithData.length ? monthsWithData : [currentMonth]} allLabel={null} lang jaar={jaar} />
            </div>
            {!hasData ? (
              <div style={{ fontSize: 13, color: T.sub }}>Geen transacties in {mn2[selMonth - 1]}.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 0, flexWrap: "wrap", alignItems: "stretch" }}>
                  <div style={{ flex: 1, minWidth: 130, padding: "4px 16px 4px 0" }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Inkomsten</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.pos }}>{formatEUR(zuiverInkomsten)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 130, padding: "4px 16px", borderLeft: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Uitgaven</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.neg }}>{formatEUR(zuiverUitgaven)}</div>
                  </div>
                  <div style={{ flex: 1.2, minWidth: 150, padding: "4px 0 4px 16px", borderLeft: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, color: T.sub, marginBottom: 3 }}>Over / tekort deze maand</div>
                    <div style={{ fontSize: 24, fontWeight: 800, fontFamily: T.mono, color: exclSpaar >= 0 ? T.pos : T.neg }}>{exclSpaar >= 0 ? "+" : "−"}{formatEUR(Math.abs(exclSpaar))}</div>
                    <div style={{ fontSize: 11.5, color: T.sub, marginTop: 2 }}>
                      {(() => { const vsB = exclSpaar - r.budgetNet; return vsB >= 0 ? <span style={{ color: T.pos }}>{formatEUR(vsB)} beter dan begroot</span> : <span style={{ color: T.neg }}>{formatEUR(Math.abs(vsB))} onder begroting</span>; })()}
                      {prev && (() => { const vsP = exclSpaar - (prev.net + (prev.toSavings - prev.fromSavings)); return <> · {vsP >= 0 ? "+" : "−"}{formatEUR(Math.abs(vsP))} vs vorige maand</>; })()}
                    </div>
                  </div>
                </div>
                {(r.toSavings > 0 || r.fromSavings > 0) && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.line}`, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                    <div style={{ fontSize: 12.5, color: T.sub }}>
                      Spaarbuffer:
                      {r.toSavings > 0 && <> <b style={{ color: T.ink }}>{formatEUR(r.toSavings)}</b> ingelegd</>}
                      {r.toSavings > 0 && r.fromSavings > 0 && " ·"}
                      {r.fromSavings > 0 && <> <b style={{ color: T.ink }}>{formatEUR(r.fromSavings)}</b> opgenomen</>}
                      {" → netto "}
                      <b style={{ color: nettoSpaar >= 0 ? T.pos : "#9a6a14" }}>{nettoSpaar >= 0 ? `${formatEUR(nettoSpaar)} naar spaar` : `${formatEUR(Math.abs(nettoSpaar))} uit buffer`}</b>
                    </div>
                    <div style={{ fontSize: 12.5, color: T.sub, marginLeft: "auto", background: "#f3f8f6", border: `1px solid ${T.line}`, borderRadius: 8, padding: "5px 11px" }}>
                      Betaalrekening deze maand: <b style={{ color: r.net >= 0 ? T.pos : T.neg }}>{r.net >= 0 ? "+" : "−"}{formatEUR(Math.abs(r.net))}</b>
                    </div>
                  </div>
                )}
                {topPostsByMonth[selMonth - 1] && topPostsByMonth[selMonth - 1].length > 0 && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 4 }}>Grootste uitgaven in {mn2[selMonth - 1]} <span style={{ fontWeight: 400 }}>· klik voor de transacties</span></div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {topPostsByMonth[selMonth - 1].map((p) => (
                        <button key={p.id} onClick={() => onDrill && onDrill({ maand: selMonth, categoryId: p.id })} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 12.5, padding: "5px 2px", border: "none", borderTop: `1px solid ${T.line}`, background: "transparent", cursor: "pointer", textAlign: "left", color: T.ink, width: "100%" }}>
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.naam}</span>
                          <span style={{ fontFamily: T.mono, flexShrink: 0, color: T.neg }}>{formatEUR(p.cents)} <span style={{ color: T.sub }}>›</span></span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" variant="secondary" onClick={() => onDrill && onDrill({ maand: selMonth })}>Alle transacties van {mn2[selMonth - 1]} bekijken</Btn>
                </div>
              </>
            )}
          </Card>
        );
      })()}

      {monthly.length === 12 && (() => {
        const short = MND_KORT;
        const rows = monthly.map((m, i) => ({ i, has: m.income !== 0 || m.expense !== 0, ink: m.income - m.fromSavings, uit: m.expense - m.toSavings }));
        const maxUit = Math.max(1, ...rows.map((r) => r.uit));
        if (!rows.some((r) => r.has)) return null;
        return (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Uitgaven per maand <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· klik op een maand voor de transacties</span></div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {rows.map((r) => {
                if (!r.has && r.i + 1 > currentMonth) return null;
                const res = r.ink - r.uit;
                return (
                  <button key={r.i} onClick={() => r.has && onDrill && onDrill({ maand: r.i + 1 })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", border: "none", borderTop: r.i ? `1px solid ${T.line}` : "none", background: "transparent", cursor: r.has ? "pointer" : "default", textAlign: "left", width: "100%" }}>
                    <span style={{ width: 34, flexShrink: 0, fontSize: 12, color: r.i + 1 === currentMonth ? T.accent : T.sub, fontWeight: r.i + 1 === currentMonth ? 800 : 600 }}>{short[r.i]}</span>
                    <span style={{ flex: 1, height: 8, background: "#eef3f1", borderRadius: 999, overflow: "hidden" }}><span style={{ display: "block", width: `${Math.min(100, Math.round((r.uit / maxUit) * 100))}%`, height: "100%", background: T.neg, opacity: 0.5 }} /></span>
                    <span style={{ width: 96, textAlign: "right", fontFamily: T.mono, fontSize: 12, color: T.neg, flexShrink: 0 }}>{r.has ? `− ${formatEUR(r.uit)}` : "—"}</span>
                    <span style={{ width: 96, textAlign: "right", fontFamily: T.mono, fontSize: 12, color: res >= 0 ? T.pos : T.neg, flexShrink: 0 }}>{r.has ? `${res >= 0 ? "+" : "−"} ${formatEUR(Math.abs(res))}` : ""}</span>
                    <span style={{ color: T.sub, flexShrink: 0, fontSize: 12 }}>{r.has ? "›" : " "}</span>
                  </button>
                );
              })}
            </div>
          </Card>
        );
      })()}

      <button onClick={() => setMore((v) => !v)} style={{ width: "100%", textAlign: "left", border: `1px dashed ${T.line}`, background: "transparent", color: T.sub, borderRadius: 10, padding: "11px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 16 }}>
        {more ? "▴ Minder tonen" : "▾ Meer inzicht — saldo & afletteren, prognose, voorschotten, vaste lasten, afwijkingen"}
      </button>
      {more && (<>
      <SectionTitle>Overzicht · t/m {mn[currentMonth - 1]} {jaar}</SectionTitle>

      {!openingSet && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14", marginBottom: 4 }}>Stel eerst je startsaldo in</div>
          {canReconcile ? (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Je startsaldo is de stand van je betaalrekening vóór je eerste geïmporteerde transactie. Die haal ik uit de saldokolom van je import: <b>{formatEUR(chainOpening)}</b>. Daarna hoort je startsaldo <b>vast te blijven</b> — nieuwe transacties corrigeren je saldo, niet andersom.</div>
              <Btn onClick={reconcile}>Startsaldo instellen &amp; sluitend maken ({formatEUR(chainOpening)})</Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#7a5a1a", marginBottom: 10 }}>Vul het saldo van je ING-rekening in zoals het was vóór je eerste transactie. Tip: importeer je ING-bestand met de saldokolom, dan zet ik dit met één knop goed én kan ik controleren of je transacties sluiten.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.sub }}>Startsaldo</span>
                <MoneyInput cents={openingBalanceCents || 0} width={150} onChange={(v) => onSetOpeningBalance(v)} />
              </div>
            </>
          )}
        </Card>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <Card style={{ padding: 18, flex: 2, minWidth: 240, background: "#f3f8f6", border: `1px solid ${T.accent}` }}>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 6 }}>Huidig saldo</div>
          <div style={{ fontSize: 30, fontWeight: 800 }}><Money cents={fc.accountBalance} sign bold size={30} /></div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>startsaldo + alle mutaties</div>
          {openingSet && gaps && (
            <div style={{ marginTop: 10, background: "#fbe9e9", border: `1px solid ${T.neg}`, borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.neg }}>⚠ Je transacties sluiten niet</div>
              <div style={{ fontSize: 12, color: "#7a2a2a", margin: "4px 0 8px" }}>De bankmutaties sluiten op {saldoGaps} plek{saldoGaps > 1 ? "ken" : ""} niet op elkaar aan. Er ontbreken transacties of er staan dubbele in — je startsaldo blijft staan, dit los je op door de ontbrekende periode te importeren of een dubbele te verwijderen.</div>
              <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>
            </div>
          )}
          {openingSet && !gaps && haveBank && (
            bankMatch
              ? <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: T.pos, display: "flex", alignItems: "center", gap: 6 }}>✓ Je saldo sluit met je bank ({formatEUR(bankBalanceCents)})</div>
              : <div style={{ marginTop: 10, fontSize: 12.5, color: T.sub, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>Je bankmutaties sluiten netjes op elkaar aan. Je huidige saldo wijkt {formatEUR(Math.abs(diff))} af van het banksaldo uit je import ({formatEUR(bankBalanceCents)}) — dat kan kloppen als je handmatige (contante) transacties hebt toegevoegd. Klopt dat niet, controleer dan je startsaldo via "opnieuw instellen".</div>
          )}
          {openingSet && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: T.sub }}>Startsaldo <b style={{ fontFamily: T.mono, color: T.ink }}>{formatEUR(openingBalanceCents || 0)}</b> · vast</span>
              <button onClick={() => setReopen((s) => !s)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{reopen ? "annuleren" : "opnieuw instellen"}</button>
            </div>
          )}
          {openingSet && reopen && (
            <div style={{ marginTop: 8, background: T.warnSoft, border: "1px solid #f0dcb8", borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ fontSize: 12, color: "#7a5a1a", marginBottom: 8 }}>Normaal hoef je dit niet: je startsaldo hoort vast te blijven en transacties corrigeren je saldo. Wijzig het alleen als je echt opnieuw wil aansluiten.</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {canReconcile && <Btn size="sm" onClick={reconcile}>Uit saldo-keten ({formatEUR(chainOpening)})</Btn>}
                <span style={{ fontSize: 12, color: T.sub }}>of handmatig:</span>
                <MoneyInput cents={openingBalanceCents || 0} width={140} onChange={(v) => onSetOpeningBalance(v)} />
              </div>
            </div>
          )}
        </Card>
        <Card style={{ padding: 18, flex: 1, minWidth: 240, background: haalt ? "#eef7f0" : "#fdeeee", border: `1px solid ${haalt ? T.pos : T.neg}` }}>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 6 }}>Red ik het in {mn[fc.month - 1]}?</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: haalt ? T.pos : T.neg }}>{haalt ? "Ja" : "Krap"} · <Money cents={fc.projectedEnd} sign bold size={22} /></div>
          <div style={{ fontSize: 12, color: T.sub, marginTop: 8, lineHeight: 1.6 }}>
            Huidig saldo <b>{formatEUR(fc.accountBalance)}</b><br />
            + nog te verwachten inkomsten <b style={{ color: T.pos }}>{formatEUR(fc.remainingInc)}</b><br />
            − nog te verwachten uitgaven <b style={{ color: T.neg }}>{formatEUR(fc.remainingOut)}</b><br />
            = verwacht saldo eind van de maand
          </div>
          {fc.openingSet && fc.projectedEnd > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${haalt ? "#cfe6d3" : "#f3cccc"}`, fontSize: 13 }}>Veilig te besteden: <b>≈ {formatEUR(perDay)} per dag</b> <span style={{ color: T.sub }}>· nog {daysLeft} dag{daysLeft > 1 ? "en" : ""} deze maand</span></div>}
        </Card>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        {tile("Gereserveerd vermogen", <Money cents={vitals.vermogen} bold />, `${vitals.potCount} rekeningen · bekijk opbouw`, () => onGoto && onGoto("vermogen"))}
        {savingsRate && tile("Besparingsratio deze maand", <span style={{ color: savingsRate.rate == null ? T.ink : savingsRate.rate >= 0 ? T.pos : T.neg }}>{savingsRate.rate != null ? `${Math.round(savingsRate.rate * 100)}%` : "—"}</span>, savingsRate.rate != null ? `${formatEUR(savingsRate.saved)} opzij van ${formatEUR(savingsRate.income)}` : "nog geen inkomsten deze maand")}
      </div>

      {forecastYear && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: forecastYear.budgetRunout.length ? 10 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Prognose jaareinde {jaar} <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· op basis van je begroting + tempo tot nu toe</span></div>
            <div style={{ fontSize: 15, fontWeight: 800, color: forecastYear.projectedYearEnd >= 0 ? T.pos : T.neg }}>≈ <Money cents={forecastYear.projectedYearEnd} sign bold size={16} /></div>
          </div>
          <div style={{ fontSize: 12, color: T.sub }}>Beginsaldo {formatEUR(forecastYear.carryIn)} + werkelijk t/m nu {forecastYear.actualNetYTD >= 0 ? "+" : "−"}{formatEUR(Math.abs(forecastYear.actualNetYTD))} + begroot restant {forecastYear.budgetNetRest >= 0 ? "+" : "−"}{formatEUR(Math.abs(forecastYear.budgetNetRest))}{Math.abs(forecastYear.bias) > 50 ? `, met correctie voor je maandpatroon (${forecastYear.bias >= 0 ? "+" : "−"}${formatEUR(Math.abs(Math.round(forecastYear.bias)))}/mnd)` : ""}.</div>
          {forecastYear.budgetRunout.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Op dit tempo raakt het jaarbudget eerder op:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {forecastYear.budgetRunout.map((b) => (
                  <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.naam}</span>
                    <span style={{ flexShrink: 0, color: b.runoutMonth <= currentMonth + 1 ? T.neg : "#9a6a14" }}>{b.pace}% van jaarbudget/tempo · op rond {["", ...MND_KORT][Math.min(12, b.runoutMonth)]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {reconciliation && (
        <Card style={{ padding: "12px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${reconciliation.gaps ? "#f0dcb8" : "#cfe6d4"}`, background: reconciliation.gaps ? T.warnSoft : "#f2f9f4" }}>
          <div style={{ fontSize: 13 }}>
            {reconciliation.gaps > 0
              ? <><b style={{ color: "#9a6a14" }}>Saldoketen heeft {reconciliation.gaps} onderbreking{reconciliation.gaps > 1 ? "en" : ""}</b> — er lijken transacties te ontbreken. Controleer je import.</>
              : reconciliation.through > 0
                ? <><b style={{ color: "#1f6b3a" }}>✓ Administratie sluit t/m {["", ...MND_LANG][reconciliation.through]}</b> — banksaldo en boekingen lopen gelijk.</>
                : <>Nog geen sluitende maand om af te letteren.</>}
          </div>
          <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Transacties</Btn>
        </Card>
      )}

      {agingAdvances.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid ${agingAdvances.some((a) => a.days >= 30) ? "#f0dcb8" : T.line}`, background: agingAdvances.some((a) => a.days >= 30) ? T.warnSoft : T.panel }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: agingAdvances.some((a) => a.days >= 30) ? "#9a6a14" : T.ink }}>Openstaande voorschotten · {agingAdvances.length}</div>
            <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Afhandelen</Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {agingAdvances.slice(0, 6).map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                <span style={{ flexShrink: 0 }}><b>{formatEUR(a.remaining)}</b> open · <span style={{ color: a.days >= 30 ? T.neg : T.sub }}>{a.days} dag{a.days === 1 ? "" : "en"}</span></span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(vastMonthly > 0 || varMonthly > 0) && (() => {
        const totM = vastMonthly + varMonthly;
        const vp = totM > 0 ? Math.round((vastMonthly / totM) * 100) : 0;
        return (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Vaste vs. variabele lasten <span style={{ fontWeight: 400, color: T.sub, fontSize: 12 }}>· per maand (begroot)</span></div>
              <div style={{ fontSize: 12, color: T.sub }}>Vast <b style={{ color: "#4338ca" }}>{formatEUR(vastMonthly)}</b> · Variabel <b style={{ color: T.pos }}>{formatEUR(varMonthly)}</b></div>
            </div>
            <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: "#eef3f1" }}>
              <div style={{ width: `${vp}%`, background: "#6366f1" }} />
              <div style={{ width: `${100 - vp}%`, background: T.pos }} />
            </div>
            <div style={{ fontSize: 12, color: T.sub, marginTop: 6 }}>{vp}% van je begrote uitgaven ligt vast; {100 - vp}% is vrij besteedbaar. Pas per post aan op <button onClick={() => onGoto && onGoto("posten")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 12 }}>Posten</button>.</div>
          </Card>
        );
      })()}

      {recurringTotal > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid ${missingRecurring.length ? "#f0dcb8" : T.line}`, background: missingRecurring.length ? T.warnSoft : T.panel }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: missingRecurring.length ? 8 : 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: missingRecurring.length ? "#9a6a14" : T.ink }}>Vaste lasten deze maand · {recurringPaid}/{recurringTotal} binnen</div>
            {missingRecurring.length > 0 && <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>}
          </div>
          {missingRecurring.length === 0
            ? <div style={{ fontSize: 13, color: T.pos, fontWeight: 600 }}>✓ Al je maandelijkse vaste lasten zijn deze maand binnen.</div>
            : <>
                <div style={{ fontSize: 12, color: "#7a5a1a", marginBottom: 6 }}>Deze maandelijkse posten zag ik deze maand nog niet — ze moeten mogelijk nog binnenkomen, of importeer even de recentste periode:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {missingRecurring.map((m) => <span key={m.id} style={{ fontSize: 12.5, background: "#fff", border: "1px solid #f0dcb8", borderRadius: 999, padding: "3px 10px" }}>○ {m.naam}{m.avg ? ` · ~${formatEUR(m.avg)}` : ""}</span>)}
                </div>
              </>}
        </Card>
      )}

      {freqAlerts.length > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14", marginBottom: 8 }}>Mogelijke dubbele boekingen · {jaar}</div>
          {freqAlerts.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "4px 0" }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{a.naam.split(":")[0]}</span>
              <span style={{ color: T.neg, fontWeight: 600, flexShrink: 0 }}>{a.count}× geboekt · max {a.max}×</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: "#7a5a1a" }}>Vaker geboekt dan je verwacht — controleer op een dubbele, of pas de max/jaar aan op Posten.</div>
            <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Bekijk transacties</Btn>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Btn onClick={() => onGoto && onGoto("import")}>+ Nieuwe uitgaven importeren</Btn>
        {oa.teSorteren > 0 && <Btn variant="secondary" onClick={() => onReview && onReview()}>{oa.teSorteren} nog toe te kennen — nu nalopen</Btn>}
      </div>

      {oa.count > 0 && (
        <Card style={{ padding: 16, marginBottom: 16, border: `1px solid #f0dcb8`, background: T.warnSoft }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: oa.items.length ? 10 : 0, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#9a6a14" }}>Openstaande acties · {oa.teSorteren} toe te kennen · {oa.gemarkeerd} gemarkeerd</div>
            <div style={{ display: "flex", gap: 8 }}>
              {oa.teSorteren > 0 && <Btn size="sm" onClick={() => onReview && onReview()}>Nu nalopen</Btn>}
              <Btn size="sm" variant="secondary" onClick={() => onGoto && onGoto("transacties")}>Alle transacties</Btn>
            </div>
          </div>
          {oa.items.slice(0, 5).map((t, i) => (
            <div key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: i ? `1px solid #f0dcb8` : "none", fontSize: 13 }}>
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)} · {t.name}{t.note ? ` · ${t.note}` : ""}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color: t.amountCents < 0 ? T.neg : T.pos }}>{formatEUR(t.amountCents)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: t.reason === "toe te kennen" ? "#fff" : "#eef0ff", color: t.reason === "toe te kennen" ? T.warn : "#4338ca" }}>{t.reason}</span>
              </span>
            </div>
          ))}
          {oa.count > 5 && <div style={{ fontSize: 12, color: "#9a6a14", marginTop: 8 }}>en nog {oa.count - 5} meer…</div>}
        </Card>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Card style={{ padding: 18, flex: 1, minWidth: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Grootste afwijkingen</div>
            {topDeviations.length > 0 && <button onClick={() => onGoto && onGoto("uitgaven")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>alle uitgaven →</button>}
          </div>
          {topDeviations.length === 0 && <div style={{ fontSize: 13, color: T.sub }}>Importeer je ING-CSV en zet een begroting om afwijkingen te zien.</div>}
          {topDeviations.map((d, i) => {
            const over = d.dev > 0;
            return (
              <div key={d.id} style={{ padding: "7px 0", borderTop: i ? `1px solid ${T.line}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.naam}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 700, color: over ? T.neg : T.pos, flexShrink: 0 }}>{over ? "+" : ""}{formatEUR(d.dev)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: T.sub }}>{formatEUR(d.actual)} besteed · {d.budget > 0 ? `begroot ${formatEUR(d.budget)}` : "niet begroot"}</div>
              </div>
            );
          })}
        </Card>
      </div>
      </>)}
    </div>
  );
}

export { Overzicht };
