import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useHuishoudboekje } from "./store.jsx";
import { getUsers, login as apiLogin, changePassword as apiChangePassword, getActivity, getSnapshots, getSnapshot } from "./api.js";
import { formatEUR, fmtWhen } from "./lib.js";
import { applySluitpost, budgetTotals, txYearActuals } from "./financieel.js";
import { T, Btn, Card, Money, Banner, SectionTitle, inputStyle, pwInput, pwBtn } from "./ui.jsx";
import { Bijlagen } from "./txrow.jsx";

// ---- Account, jaren, gegevens en mobiel ----
// Inloggen en wachtwoord wijzigen, jaar wisselen/aanmaken, back-up en activiteitenlog,
// plus MobileHome: het compacte startscherm op de telefoon.

function YearSwitcher({ years, activeYearId, onSelect, onNew }) {
  const sorted = [...years].sort((a, b) => a.jaartal - b.jaartal);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {sorted.map((y) => {
        const on = y.id === activeYearId;
        return (
          <button key={y.id} onClick={() => onSelect(y.id)} style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accentSoft : T.panel, color: on ? T.accent : T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: T.mono }}>{y.jaartal}</button>
        );
      })}
      <button onClick={onNew} title="Nieuw begrotingsjaar opstellen" style={{ padding: "5px 11px", borderRadius: 8, border: `1px dashed ${T.line}`, background: T.panel, color: T.sub, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ jaar</button>
    </div>
  );
}

function NewYearDialog({ years, budgets, categories, transactions, onCreate, onClose }) {
  const maxY = Math.max(...years.map((y) => y.jaartal));
  const [jaartal, setJaartal] = useState(maxY + 1);
  const [basis, setBasis] = useState("copy");
  const exists = years.some((y) => y.jaartal === Number(jaartal));
  const prevBudget = budgetTotals(categories, applySluitpost(categories, budgets[String(maxY)] || {}));
  const prevActuals = txYearActuals(transactions, categories, maxY);
  const prevSpent = prevActuals.reduce((s, a) => s + a.expense, 0);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,24,22,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 16 }}>
      <Card onClick={(e) => e.stopPropagation()} style={{ padding: 24, width: "100%", maxWidth: 470, background: T.panel }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Nieuw begrotingsjaar opstellen</div>
        <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6, marginBottom: 16 }}>
          De beste aanpak: <b>neem vorig jaar als basis</b> en pas posten aan op wat je werkelijk uitgaf en op bekende veranderingen — een nieuwe verzekering, hogere energie, een kind erbij. De sluitpost houdt het automatisch kloppend.
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1, padding: "10px 12px", background: T.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>{maxY} begroot (uit&sparen)</div>
            <Money cents={prevBudget.outflow} bold size={16} />
          </div>
          <div style={{ flex: 1, padding: "10px 12px", background: T.bg, borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>{maxY} werkelijk uitgegeven</div>
            <Money cents={prevSpent} bold size={16} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>Welk jaar?</div>
          <input type="number" value={jaartal} onChange={(e) => setJaartal(e.target.value)} style={{ ...inputStyle, width: 140 }} />
          {exists && <div style={{ fontSize: 12, color: T.warn, marginTop: 6 }}>Dat jaar bestaat al — je gaat ernaartoe.</div>}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: T.sub, marginBottom: 6 }}>Beginpunt</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[["copy", `Neem ${maxY} over`], ["empty", "Begin leeg"]].map(([v, lbl]) => {
              const on = basis === v;
              return <button key={v} onClick={() => setBasis(v)} disabled={exists} style={{ flex: 1, padding: "10px", borderRadius: 8, cursor: exists ? "default" : "pointer", fontSize: 13, fontWeight: 600, border: `1px solid ${on ? T.accent : T.line}`, background: on ? T.accentSoft : T.panel, color: on ? T.accent : T.sub, opacity: exists ? 0.5 : 1 }}>{lbl}</button>;
            })}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>Annuleren</Btn>
          <Btn onClick={() => onCreate(Number(jaartal), basis)}>{exists ? "Ga naar jaar" : "Jaar aanmaken"}</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ===================================================================== */
/* AUTHENTICATIE, LOGBOEK & WERKRUIMTE                                    */
/* ===================================================================== */

function DataBackup({ dbReady, onExport, onImport, onRestoreSnapshot }) {
  const fileRef = useRef(null);
  const [snaps, setSnaps] = useState(null);
  const [busy, setBusy] = useState(false);
  const loadSnaps = () => { setBusy(true); getSnapshots().then((r) => setSnaps(r.snapshots || [])).catch(() => setSnaps([])).finally(() => setBusy(false)); };
  const restore = async (id) => {
    if (!confirm("Deze versie terugzetten? De huidige gegevens worden vervangen (je kunt daarna weer een eerdere versie kiezen).")) return;
    try { const r = await getSnapshot(id); if (r && r.state && onRestoreSnapshot) onRestoreSnapshot(r.state); } catch { alert("Kon deze versie niet ophalen."); }
  };
  return (
    <Card style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Gegevens &amp; backup</div>
      <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 12 }}>Download af en toe een backup als extra zekerheid naast de database. Een backup bevat je volledige huishoudboekje (begroting, transacties, regels, vermogen) en kun je later weer terugzetten.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Btn size="sm" onClick={onExport}>⬇ Backup downloaden</Btn>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={(e) => { onImport(e.target.files[0]); e.target.value = ""; }} />
        <Btn size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()}>⬆ Backup terugzetten</Btn>
        {dbReady && <Btn size="sm" variant="ghost" onClick={loadSnaps}>{snaps == null ? "Herstelpunten tonen" : "Vernieuwen"}</Btn>}
      </div>
      {dbReady && snaps != null && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${T.line}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.sub, marginBottom: 6 }}>Automatische herstelpunten <span style={{ fontWeight: 400 }}>· de laatste 40 opgeslagen versies</span></div>
          {busy && <div style={{ fontSize: 12.5, color: T.sub }}>Laden…</div>}
          {!busy && snaps.length === 0 && <div style={{ fontSize: 12.5, color: T.sub }}>Nog geen herstelpunten.</div>}
          {!busy && snaps.map((s) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 12.5, padding: "5px 0", borderTop: `1px solid ${T.line}` }}>
              <span>{fmtWhen(s.at)} <span style={{ color: T.sub }}>· {s.updatedBy || "onbekend"} · v{s.rev}</span></span>
              <Btn size="sm" variant="secondary" onClick={() => restore(s.id)}>Terugzetten</Btn>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
function Activiteit() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    let on = true;
    getActivity().then((r) => on && setItems(r.activity || [])).catch(() => on && setItems([]));
    return () => { on = false; };
  }, []);
  return (
    <div>
      <SectionTitle>Activiteit</SectionTitle>
      <div style={{ marginBottom: 14 }}><Banner tone="neutral">Hier zie je wie wat heeft gedaan: inloggen, importeren, de begroting en regels aanpassen, en wachtwoordwijzigingen.</Banner></div>
      <Card style={{ overflow: "hidden" }}>
        {items === null && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Bezig met laden…</div>}
        {items && items.length === 0 && <div style={{ padding: 16, fontSize: 13, color: T.sub }}>Nog geen activiteit vastgelegd.</div>}
        {items && items.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr 130px", gap: 10, alignItems: "center", padding: "10px 16px", borderTop: i ? `1px solid ${T.line}` : "none" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{it.displayName}</span>
            <span style={{ fontSize: 13 }}>{it.action}</span>
            <span style={{ fontSize: 12, color: T.sub, textAlign: "right", fontFamily: T.mono }}>{fmtWhen(it.at)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ------------------------------------------------ Wachtwoord wijzigen */
function ChangePasswordCard({ displayName, forced, onDone, onCancel }) {
  const [cur, setCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!forced && cur.length === 0) { setErr("Vul je huidige wachtwoord in."); return; }
    if (pw1.length < 8) { setErr("Kies minstens 8 tekens."); return; }
    if (pw1 !== pw2) { setErr("De twee wachtwoorden zijn niet gelijk."); return; }
    setBusy(true); setErr("");
    try { await apiChangePassword(pw1, cur); onDone(); }
    catch (e) {
      const msg = String((e && e.message) || "");
      setErr(msg.includes("huidig-wachtwoord-onjuist") || msg.includes("401") ? "Je huidige wachtwoord klopt niet." : "Wijzigen mislukt, probeer het opnieuw.");
      setBusy(false);
    }
  };
  return (
    <div style={{ width: "100%", maxWidth: 380 }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{forced ? `Welkom, ${displayName}` : "Wachtwoord wijzigen"}</div>
      <div style={{ fontSize: 13, color: T.sub, marginBottom: 16 }}>{forced ? "Kies bij de eerste keer inloggen een eigen, nieuw wachtwoord (minstens 8 tekens)." : "Kies een nieuw wachtwoord (minstens 8 tekens)."}</div>
      {!forced && <input type="password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Huidig wachtwoord" style={pwInput(false)} />}
      <input type="password" autoFocus={forced} value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Nieuw wachtwoord" style={pwInput(false)} />
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Herhaal nieuw wachtwoord" style={pwInput(false)} />
      {err && <div style={{ fontSize: 12, color: T.neg, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={busy} style={pwBtn(busy)}>{busy ? "Bezig…" : "Opslaan"}</button>
        {!forced && <button onClick={onCancel} style={{ ...pwBtn(false), background: T.panel, color: T.sub, border: `1px solid ${T.line}` }}>Annuleren</button>}
      </div>
    </div>
  );
}
function ChangePasswordScreen({ user, onDone }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, color: T.ink, padding: 16 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <ChangePasswordCard displayName={user.displayName} forced onDone={onDone} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Inlogscherm */
function LoginScreen({ onSuccess }) {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getUsers().then((r) => { setUsers(r.users || []); if (r.users && r.users[0]) setUsername(r.users[0].username); }).catch(() => {});
  }, []);
  const submit = async () => {
    if (!username || !pw) return;
    setBusy(true); setErr("");
    try { const r = await apiLogin(username, pw); onSuccess(r); }
    catch { setErr("Onjuiste gebruiker of wachtwoord."); setBusy(false); }
  };
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: T.bg, fontFamily: T.sans, color: T.ink, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 380, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 14, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: T.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800 }}>€</div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>Huishoudboekje</div>
        </div>
        <div style={{ fontSize: 13, color: T.sub, marginBottom: 10 }}>Wie ben je?</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {users.map((u) => (
            <button key={u.username} onClick={() => { setUsername(u.username); setErr(""); }} style={{ flex: 1, padding: "10px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, border: `1px solid ${username === u.username ? T.accent : T.line}`, background: username === u.username ? T.accentSoft : T.panel, color: username === u.username ? T.accent : T.sub }}>{u.displayName}</button>
          ))}
        </div>
        <input type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Wachtwoord" style={pwInput(!!err)} />
        {err && <div style={{ fontSize: 12, color: T.neg, marginBottom: 10 }}>{err}</div>}
        <button onClick={submit} disabled={busy || !pw || !username} style={pwBtn(busy || !pw || !username)}>{busy ? "Bezig…" : "Inloggen"}</button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Werkruimte */
// ---- Mobiel startscherm: drie grote acties (verwerken · bonnetje · taak) + taken en saldo ----
function MobileHome({ bankNow, teSorteren, transactions, tasks, onStartReview, onToggleTask, onRemoveTask, onOpenTx }) {
  const { user, other, attachCounts, addTask: onAddTask } = useHuishoudboekje();
  const otherName = other.name;
  const [mode, setMode] = useState(null); // null | "bijlage" | "taak"
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState(null);
  const recent = useMemo(() => {
    const list = transactions.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const filtered = q ? list.filter((t) => `${t.name} ${t.description || ""}`.toLowerCase().includes(q.toLowerCase())) : list;
    return filtered.slice(0, 30);
  }, [transactions, q]);
  const picked = recent.find((t) => t.id === pickedId) || transactions.find((t) => t.id === pickedId) || null;
  const openForMe = tasks.filter((t) => !t.done && t.to === user.username);
  const openByMe = tasks.filter((t) => !t.done && t.from === user.username);
  const txById = (id) => transactions.find((t) => t.id === id);
  const closePicker = () => { setMode(null); setPickedId(null); setQ(""); };
  const actionCard = (emoji, title, sub, onClick, badge) => (
    <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left", border: `1px solid ${T.line}`, background: T.panel, borderRadius: 14, padding: "16px 16px", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      <span style={{ fontSize: 26 }}>{emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15.5, fontWeight: 800, color: T.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: T.sub, marginTop: 2 }}>{sub}</span>
      </span>
      {badge > 0 && <span style={{ fontSize: 12, fontWeight: 800, minWidth: 24, textAlign: "center", padding: "3px 8px", borderRadius: 999, background: T.warn, color: "#fff" }}>{badge}</span>}
      <span style={{ color: T.sub }}>›</span>
    </button>
  );
  const txRowBtn = (t) => (
    <button key={t.id} onClick={() => setPickedId(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: "none", borderTop: `1px solid ${T.line}`, background: pickedId === t.id ? T.accentSoft : "transparent", padding: "10px 6px", cursor: "pointer" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
        <span style={{ display: "block", fontSize: 11, color: T.sub }}>{t.date.slice(8, 10)}-{t.date.slice(5, 7)}{attachCounts && attachCounts[t.id] ? ` · 📎 ${attachCounts[t.id]}` : ""}</span>
      </span>
      <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: t.amountCents < 0 ? T.neg : T.pos, flexShrink: 0 }}>{t.amountCents < 0 ? "−" : "+"} {formatEUR(Math.abs(t.amountCents))}</span>
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 12.5, color: T.sub }}>Huidig saldo betaalrekening</span>
        <Money cents={bankNow} sign bold size={20} />
      </Card>
      {actionCard("✓", "Transacties verwerken", teSorteren > 0 ? "loop de nieuwe transacties één voor één na" : "alles is verwerkt — niets te doen", () => onStartReview(), teSorteren)}
      {actionCard("📎", "Bonnetje of factuur koppelen", "kies een transactie en voeg een foto of PDF toe", () => { setMode(mode === "bijlage" ? null : "bijlage"); setPickedId(null); }, 0)}
      {actionCard("👤", `Taak voor ${otherName}`, "\u201ckijk hier even naar\u201d bij een transactie", () => { setMode(mode === "taak" ? null : "taak"); setPickedId(null); }, openForMe.length)}
      {mode && (
        <Card style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{mode === "bijlage" ? "Kies de transactie voor de bijlage" : `Kies de transactie voor ${otherName}`}</div>
            <Btn size="sm" variant="ghost" onClick={closePicker}>×</Btn>
          </div>
          {!picked && (
            <>
              <input value={q} onChange={(e) => { setQ(e.target.value); setPickedId(null); }} placeholder="zoek op naam of mededeling" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14, marginBottom: 4 }} />
              <div style={{ maxHeight: 300, overflowY: "auto" }}>{recent.map(txRowBtn)}</div>
            </>
          )}
          {picked && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: T.accentSoft, borderRadius: 9, padding: "10px 12px" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: T.sub }}>{picked.date.slice(8, 10)}-{picked.date.slice(5, 7)} · {picked.amountCents < 0 ? "−" : "+"} {formatEUR(Math.abs(picked.amountCents))}</span>
              </span>
              <Btn size="sm" variant="ghost" onClick={() => setPickedId(null)}>andere kiezen</Btn>
            </div>
          )}
          {picked && mode === "bijlage" && <Bijlagen tx={picked} />}
          {picked && mode === "taak" && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.line}` }}>
              <MobileTaakForm otherName={otherName} onSubmit={(note) => { onAddTask(picked.id, note); closePicker(); }} />
            </div>
          )}
        </Card>
      )}
      {(openForMe.length > 0 || openByMe.length > 0) && (
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Taken</div>
          {openForMe.map((t) => {
            const tx = txById(t.txId);
            return (
              <div key={t.id} style={{ padding: "9px 0", borderTop: `1px solid ${T.line}` }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tx ? tx.name : "transactie"}{tx ? ` · ${tx.amountCents < 0 ? "−" : "+"} ${formatEUR(Math.abs(tx.amountCents))}` : ""}</div>
                {t.note && <div style={{ fontSize: 12.5, color: T.sub, marginTop: 2 }}>“{t.note}”</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 7 }}>
                  <Btn size="sm" onClick={() => onToggleTask(t.id)}>✓ Afgehandeld</Btn>
                  <Btn size="sm" variant="secondary" onClick={() => onOpenTx(t.txId)}>Openen</Btn>
                </div>
              </div>
            );
          })}
          {openByMe.map((t) => {
            const tx = txById(t.txId);
            return (
              <div key={t.id} style={{ padding: "9px 0", borderTop: `1px solid ${T.line}` }}>
                <div style={{ fontSize: 12.5, color: T.sub }}>Klaargezet voor {otherName}: <b style={{ color: T.ink }}>{tx ? tx.name : "transactie"}</b>{t.note ? ` — \u201c${t.note}\u201d` : ""}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Btn size="sm" variant="ghost" onClick={() => onRemoveTask(t.id)}>× intrekken</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => onOpenTx(t.txId)}>openen</Btn>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
function MobileTaakForm({ otherName, onSubmit }) {
  const [note, setNote] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="korte toelichting (optioneel)" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px", fontSize: 14 }} />
      <Btn onClick={() => onSubmit(note.trim())}>Klaarzetten voor {otherName}</Btn>
    </div>
  );
}

export { YearSwitcher, NewYearDialog, DataBackup, Activiteit, ChangePasswordCard, ChangePasswordScreen, LoginScreen, MobileHome, MobileTaakForm };
