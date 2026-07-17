import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { parseDecimalToCents, formatEUR, editEUR, MND_KORT, MND_LANG } from "./lib.js";
import { catAllowed } from "./financieel.js";

// ---- Componentbibliotheek ----
// Het thema (T) en de bouwstenen die overal terugkomen: Btn, Card, Chip, Keuze,
// MaandKiezer, MaandTabel (de engine onder MaandMatrix/WinkelMatrix), ScrollTabel.
// Schermen composeren hiermee in plaats van eigen styling te herhalen.
// Nieuw UI-patroon dat op twee plekken nodig is? Hier zetten, niet kopieren.

const T = {
  bg: "#f4f7f6", panel: "#ffffff", line: "#e3eae9", ink: "#16201e", sub: "#62716e",
  accent: "#0f766e", accentSoft: "#e7f1ef", pos: "#15803d", neg: "#b4232a",
  warn: "#b45309", warnSoft: "#fdf2e2", radius: 10,
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

/* --------------------------------------------------------------- Geld/datum */
// Vangt onverwachte render-fouten op zodat één fout niet de hele app wit maakt.
// De data staat veilig op de server; verversen herstelt de weergave.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("UI-fout:", error, info && info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, padding: 20 }}>
        <div style={{ maxWidth: 520, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 24 }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Er ging iets mis in de weergave</div>
          <div style={{ fontSize: 13, color: T.sub, marginBottom: 12 }}>Je gegevens zijn veilig opgeslagen op de server. Ververs de pagina om verder te gaan. Blijft dit gebeuren, noteer dan deze melding: <span style={{ fontFamily: T.mono }}>{String((this.state.error && this.state.error.message) || this.state.error)}</span></div>
          <button onClick={() => window.location.reload()} style={{ border: "none", background: T.accent, color: "#fff", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>Pagina verversen</button>
        </div>
      </div>
    );
  }
}
// Detecteer een smal (telefoon)scherm, zodat de layout zich kan aanpassen.
function useIsMobile(bp = 760) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
}
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const icons = {
  overzicht: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  begroting: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  posten: <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  import: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  regels: <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></>,
  uitgaven: <><line x1="4" y1="20" x2="4" y2="11" /><line x1="10" y1="20" x2="10" y2="4" /><line x1="16" y1="20" x2="16" y2="14" /></>,
  transacties: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  vermogen: <><path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" /><path d="M16 12h.01" /><path d="M3 9h18" /></>,
};
function Btn({ children, onClick, variant = "primary", disabled, size = "md", title }) {
  const base = { fontFamily: T.sans, fontWeight: 600, border: "1px solid transparent", borderRadius: 8, cursor: disabled ? "default" : "pointer", padding: size === "sm" ? "5px 10px" : "9px 15px", fontSize: size === "sm" ? 13 : 14, lineHeight: 1.2, whiteSpace: "nowrap" };
  const styles = {
    primary: { background: disabled ? "#9ec5c0" : T.accent, color: "#fff" },
    secondary: { background: T.panel, color: T.ink, borderColor: T.line },
    ghost: { background: "transparent", color: T.accent },
    danger: { background: T.panel, color: T.neg, borderColor: "#f0d2d2" },
  };
  return <button title={title} onClick={onClick} disabled={disabled} style={{ ...base, ...styles[variant] }}>{children}</button>;
}
const Card = ({ children, style, ...rest }) => <div {...rest} style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: T.radius, ...style }}>{children}</div>;
function Money({ cents, sign = false, bold = false, muted = false, size }) {
  const color = !sign ? (muted ? T.sub : T.ink) : cents > 0 ? T.pos : cents < 0 ? T.neg : T.sub;
  return <span style={{ fontFamily: T.mono, fontVariantNumeric: "tabular-nums", color, fontWeight: bold ? 700 : 500, fontSize: size }}>{formatEUR(cents)}</span>;
}
function MoneyInput({ cents, onChange, width = 110, align = "right" }) {
  const [focused, setFocused] = useState(false);
  const [str, setStr] = useState("");
  const display = focused ? str : (cents != null ? editEUR(cents) : "");
  return <input value={display} inputMode="decimal"
    onFocus={() => { setStr(cents != null ? editEUR(cents) : ""); setFocused(true); }}
    onChange={(e) => { setStr(e.target.value); const t = e.target.value.trim(); if (t === "") return; try { onChange(parseDecimalToCents(t)); } catch {} }}
    onBlur={() => { setFocused(false); const t = str.trim(); if (t === "") onChange(0); else { try { onChange(parseDecimalToCents(t)); } catch {} } }}
    style={{ width, textAlign: align, fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, padding: "6px 8px", border: `1px solid ${T.line}`, borderRadius: 7, outline: "none" }} />;
}
const Badge = ({ children, tone = "neutral" }) => {
  const tones = { neutral: [T.accentSoft, T.accent], income: ["#e6f4ec", T.pos], savings: ["#eef0ff", "#4338ca"], expense: ["#f1f5f4", T.sub] };
  const [bg, fg] = tones[tone] || tones.neutral;
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>{children}</span>;
};
const Banner = ({ tone = "neutral", children }) => {
  const tones = { ok: ["#e8f5ee", T.pos, "#bfe2cd"], warn: [T.warnSoft, T.warn, "#f0dcb8"], neg: ["#fbe9e9", T.neg, "#f0cfcf"], neutral: [T.accentSoft, T.accent, "#cfe5e1"] };
  const [bg, fg, bd] = tones[tone];
  return <div style={{ background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: T.radius, padding: "12px 16px", fontSize: 14 }}>{children}</div>;
};
const Toggle = ({ on, onClick }) => (
  <button onClick={onClick} style={{ width: 38, height: 22, borderRadius: 999, border: "none", cursor: "pointer", background: on ? T.accent : "#cdd6d4", position: "relative" }}>
    <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff" }} />
  </button>
);
const SectionTitle = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 14px" }}>
    <h2 style={{ fontSize: 17, margin: 0 }}>{children}</h2>{right}
  </div>
);
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 14, border: `1px solid ${T.line}`, borderRadius: 7, outline: "none", fontFamily: T.sans };

/** Betrouwbare, gegroepeerde keuzelijst voor posten. sign<0 = uitgave/sparen, sign>0 = inkomsten. */
function CatSelect({ categories, groups, value, onChange, sign = 0, placeholder = "— kies post —", style }) {
  // uitgave (sign<0): geen inkomstenposten. inkomst (sign>0): álles mag — ook een uitgavepost (teruggave/voorgeschoten) of een spaarpost (opname).
  const allow = (c) => catAllowed(c, sign);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 13, ...style }}>
      <option value="">{placeholder}</option>
      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id && allow(c));
        if (!cats.length) return null;
        return <optgroup key={g.id} label={g.naam}>{cats.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}</optgroup>;
      })}
    </select>
  );
}

/* Optioneel: laat een transactie in een andere maand/jaar meetellen dan z'n datum. */
function PeriodControl({ tx, years = [], onChange }) {
  const months = MND_KORT;
  const cur = tx.periodDate || tx.date;
  const y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  const overridden = !!tx.periodDate;
  const yearOpts = Array.from(new Set([...(years || []).map((yy) => yy.jaartal), Number(tx.date.slice(0, 4))])).sort((a, b) => a - b);
  const set = (yy, mm) => onChange(`${yy}-${String(mm).padStart(2, "0")}-01`);
  const ss = { ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12 };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Telt mee voor</span>
      <select value={m} onChange={(e) => set(y, Number(e.target.value))} style={ss}>{months.map((nm, idx) => <option key={idx} value={idx + 1}>{nm}</option>)}</select>
      <select value={y} onChange={(e) => set(Number(e.target.value), m)} style={ss}>{yearOpts.map((yy) => <option key={yy} value={yy}>{yy}</option>)}</select>
      {overridden
        ? <button onClick={() => onChange(null)} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>↺ datum ({tx.date.slice(8, 10)}-{tx.date.slice(5, 7)}-{tx.date.slice(0, 4)})</button>
        : <span style={{ fontSize: 11, color: T.sub }}>(standaard: de transactiedatum)</span>}
    </div>
  );
}
function chipStyle(active) {
  return { border: `1px solid ${active ? T.accent : T.line}`, background: active ? T.accentSoft : T.panel, color: active ? T.accent : T.sub, borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
}
const pwInput = (err) => ({ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, border: `1px solid ${err ? T.neg : T.line}`, borderRadius: 8, outline: "none", marginBottom: 10 });
const pwBtn = (disabled) => ({ flex: 1, padding: "10px 14px", fontSize: 14, fontWeight: 700, border: "none", borderRadius: 8, cursor: disabled ? "default" : "pointer", background: disabled ? "#9ec5c0" : T.accent, color: "#fff" });

// ---- Basiscomponenten: één dialect voor terugkerende UI-patronen ----
// Chip: dé filter-/keuzeknop. Vervangt losse borderRadius:999-knoppen door één component.
function Chip({ active = false, onClick, children, size = "md", tone = "accent", title }) {
  const pad = size === "sm" ? "2px 10px" : size === "lg" ? "5px 13px" : "5px 11px";
  const fs = size === "sm" ? 11 : size === "lg" ? 13 : 12;
  const solid = tone === "solid" && active;
  return (
    <button onClick={onClick} title={title} style={{
      padding: pad, fontSize: fs, fontWeight: 600, cursor: "pointer", borderRadius: 999, whiteSpace: "nowrap",
      border: `1px solid ${active ? T.accent : T.line}`,
      background: solid ? T.accent : active ? T.accentSoft : T.panel,
      color: solid ? "#fff" : active ? T.accent : T.sub,
      maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
    }}>{children}</button>
  );
}
// Keuze: dé select. Overal dezelfde maat, rand en gedrag.
function Keuze({ value, onChange, children, width = "auto", maxWidth, size = "md" }) {
  return (
    <select value={value} onChange={onChange} style={{
      ...inputStyle, width, maxWidth, cursor: "pointer",
      padding: size === "sm" ? "6px 10px" : "7px 10px",
      fontSize: 13, fontWeight: 600, color: T.ink, background: T.panel,
    }}>{children}</select>
  );
}
// MaandKiezer: één component voor de maandkeuze, in twee verschijningsvormen.
// variant "select" (compact, dashboard/filters) of "chips" (breed, blokjesweergave).
function MaandKiezer({ value, onChange, variant = "select", months = null, allLabel = "hele jaar", lang = false, jaar = null }) {
  const namen = lang ? MND_LANG : MND_KORT;
  const opties = months || Array.from({ length: 12 }, (_, i) => i + 1);
  if (variant === "chips") {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {allLabel && <Chip active={value === 0} onClick={() => onChange(0)}>{allLabel}</Chip>}
        {opties.map((m) => <Chip key={m} active={value === m} onClick={() => onChange(m)}>{namen[m - 1]}</Chip>)}
      </div>
    );
  }
  return (
    <Keuze value={value} onChange={(e) => onChange(Number(e.target.value))} size="sm">
      {allLabel && <option value={0}>{allLabel}</option>}
      {opties.map((m) => <option key={m} value={m}>{namen[m - 1]}{jaar ? ` ${jaar}` : ""}</option>)}
    </Keuze>
  );
}
// ScrollTabel: brede tabellen scrollen binnen hun eigen kader i.p.v. de pagina te verbreden.
function ScrollTabel({ children, style }) {
  return <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", ...style }}>{children}</div>;
}

// MaandTabel: dé engine voor "rijen × 12 maanden + totaal"-tabellen (MaandMatrix, WinkelMatrix).
// Regelt kolomraster, sticky kopregel, horizontaal scrollen en de totaalregel op één plek.
// secties: [{ id, titel?, rijen: [{ id, label, ms: number[12] }] }]  — ms in centen, al positief bedoeld.
function MaandTabel({ kopLabel = "Post", labelMin = 170, secties = [], leeg = null }) {
  const grid = `minmax(${labelMin}px, 1.5fr) repeat(12, 72px) 92px`;
  const minW = labelMin + 12 * 72 + 92 + 13 * 6;
  const nowrap = { whiteSpace: "nowrap" };
  const cel = (v) => (v === 0 ? <span style={{ color: "#cbd5d1" }}>—</span> : formatEUR(v));
  const rijen = secties.flatMap((x) => x.rijen);
  const colTotals = Array.from({ length: 12 }, (_, i) => rijen.reduce((sum, r) => sum + (r.ms[i] || 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return (
    <Card style={{ overflow: "auto" }}>
      <div style={{ minWidth: minW }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", background: "#eef3f1", fontSize: 11, fontWeight: 700, color: T.sub, position: "sticky", top: 0 }}>
          <span style={nowrap}>{kopLabel}</span>
          {MND_KORT.map((nm) => <span key={nm} style={{ textAlign: "right", ...nowrap }}>{nm}</span>)}
          <span style={{ textAlign: "right", ...nowrap }}>totaal</span>
        </div>
        {rijen.length === 0 && leeg}
        {secties.map((sec) => (
          <div key={sec.id}>
            {sec.titel && <div style={{ padding: "7px 14px", background: "#f0f4f3", fontSize: 12, fontWeight: 700 }}>{sec.titel}</div>}
            {sec.rijen.map((r) => {
              const tot = r.ms.reduce((a, b) => a + b, 0);
              return (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "6px 14px", borderTop: `1px solid ${T.line}`, fontSize: 12 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                  {r.ms.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", ...nowrap }}>{cel(v)}</span>)}
                  <span style={{ textAlign: "right", fontFamily: T.mono, fontWeight: 700, ...nowrap }}>{formatEUR(tot)}</span>
                </div>
              );
            })}
          </div>
        ))}
        {rijen.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, padding: "9px 14px", borderTop: `2px solid ${T.line}`, background: "#f7faf9", fontSize: 12, fontWeight: 700 }}>
            <span style={nowrap}>Totaal</span>
            {colTotals.map((v, i) => <span key={i} style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{v === 0 ? "—" : formatEUR(v)}</span>)}
            <span style={{ textAlign: "right", fontFamily: T.mono, ...nowrap }}>{formatEUR(grand)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export { Chip, Keuze, MaandTabel, MaandKiezer, ScrollTabel, T, ErrorBoundary, useIsMobile, Icon, icons, Btn, Card, Money, MoneyInput, Badge, Banner, Toggle, SectionTitle, inputStyle, CatSelect, PeriodControl, chipStyle, pwInput, pwBtn };
