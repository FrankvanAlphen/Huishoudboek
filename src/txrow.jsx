import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useHuishoudboekje } from "./store.jsx";
import { uploadAttachment, listAttachments, deleteAttachment, attachmentUrl } from "./api.js";
import { formatEUR, fmtDateTime, batchColor, effMonth, effYear } from "./lib.js";
import { savingsCatForTx, derivedPotMutation, catAllowed, guessKeyword, rankSuggestions, settlementsOf, unassignedOf } from "./financieel.js";
import { T, Btn, MoneyInput, inputStyle, CatSelect, Chip, Icon, Toggle, PeriodControl, useIsMobile} from "./ui.jsx";

// ---- De transactieregel ----
// Alles wat een enkele transactie toont en bewerkt: de regel zelf (TxRow), de postkiezer,
// splitsen, voorschot-terugverwacht, bijlagen en het klaarzetten van een taak.
// Haalt gebruiker/bijlagetellingen/taken uit de context (store.jsx), niet uit props.

// Bedrag dat je van een voorschot terugverwacht, met snelknoppen om de rekening te delen door N personen.
function RuleLearn({ tx, categoryId, onAddRule }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [field, setField] = useState("both"); // name | description | both
  const [kw, setKw] = useState(() => guessKeyword(tx.name) || guessKeyword(tx.omschrijving));
  const pickField = (f) => { setField(f); if (f === "name") setKw(guessKeyword(tx.name)); else if (f === "description") setKw(guessKeyword(tx.omschrijving || tx.description || "")); };
  if (done) return <span style={{ fontSize: 12, color: T.pos }}>✓ regel toegevoegd aan Regels — voortaan automatisch</span>;
  if (!open) return <Btn variant="ghost" size="sm" onClick={() => setOpen(true)}>Onthoud deze keuze…</Btn>;
  const make = () => { const v = kw.trim().toLowerCase(); if (!v) return; onAddRule({ categoryId, priority: 35, conditions: [{ field, operator: "contains", value: v }] }); setDone(true); };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Onthoud: alles met</span>
      <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="trefwoord" style={{ ...inputStyle, width: 150, padding: "4px 8px", fontSize: 12, fontFamily: T.mono }} />
      <span style={{ fontSize: 12, color: T.sub }}>in</span>
      <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 7, overflow: "hidden" }}>
        {[["both", "naam of omschr."], ["name", "naam"], ["description", "omschrijving"]].map(([v, l]) => (
          <button key={v} onClick={() => pickField(v)} style={{ padding: "4px 9px", border: "none", borderLeft: v !== "both" ? `1px solid ${T.line}` : "none", background: field === v ? T.accent : "#fff", color: field === v ? "#fff" : T.sub, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      <Btn size="sm" variant="secondary" onClick={make}>Onthoud</Btn>
    </div>
  );
}

const TX_COLS = "78px 1fr 96px 200px 40px 34px";

function ExpectedBackEditor({ amountCents, value, onChange }) {
  const full = Math.abs(amountCents);
  const cur = value != null ? value : full;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: T.sub }}>Verwacht terug:</span>
      <MoneyInput cents={cur} width={100} onChange={onChange} />
      <span style={{ fontSize: 11.5, color: T.sub }}>van {formatEUR(full)}</span>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: T.sub }}>delen door</span>
        {[2, 3, 4, 5, 6].map((n) => (
          <button key={n} onClick={() => onChange(Math.round((full * (n - 1)) / n))} title={`Samen met ${n} personen: jij houdt ${formatEUR(Math.round(full / n))}, je verwacht ${formatEUR(Math.round((full * (n - 1)) / n))} terug`} style={{ border: `1px solid ${T.line}`, background: "#fff", color: T.accent, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>÷{n}</button>
        ))}
      </span>
    </div>
  );
}
// Laat op een transactie zien wat er met het Vermogen gebeurt op basis van de mededelingen:
// groen = de vermogensrekening wordt automatisch bij-/afgeboekt; oranje = er staat een expliciete
// spaarcode in de mededelingen die nog aan geen enkele rekening gekoppeld is.
function VermogenHint({ tx, categories }) {
  const d = derivedPotMutation(tx, categories);
  if (d) {
    const c = (categories || []).find((x) => x.id === d.categoryId);
    const naar = d.amountCents < 0; // geld eraf = storting op de rekening
    return (
      <div style={{ fontSize: 12, background: "#eef7f0", border: "1px solid #cfe6d4", color: "#1f6b3a", borderRadius: 7, padding: "6px 10px" }}>
        Vermogen: <b>{c ? c.naam : "rekening"}</b> wordt {naar ? "verhoogd" : "verlaagd"} met <b>{formatEUR(Math.abs(d.amountCents))}</b> — herkend uit de mededelingen; de post hierboven blijft gewoon staan.
      </div>
    );
  }
  const hit = savingsCatForTx(tx, categories);
  if (hit && hit.unlinkedCode) {
    return (
      <div style={{ fontSize: 12, background: T.warnSoft, border: `1px solid ${T.warn}`, color: "#7a5a12", borderRadius: 7, padding: "6px 10px" }}>
        In de mededelingen staat spaarcode <b style={{ fontFamily: T.mono }}>{hit.unlinkedCode}</b>, maar die is nog aan géén vermogensrekening gekoppeld — het Vermogen-tabblad verwerkt deze overboeking dus <b>niet</b>. Vul de code in bij de juiste rekening (tabblad Vermogen, veld Code/IBAN).
      </div>
    );
  }
  return null;
}
function PostPicker({ categories, groups, sign = 0, value, onChange, suggestions = [], autoFocus = false }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [focused, setFocused] = useState(false);
  const groupName = (id) => (groups.find((g) => g.id === id) || {}).naam || "";
  const allow = (c) => catAllowed(c, sign);
  const byId = (id) => categories.find((c) => c.id === id);
  const pool = categories.filter(allow);
  const ql = q.trim().toLowerCase();
  const matches = ql ? pool.filter((c) => (c.naam + " " + groupName(c.groupId)).toLowerCase().includes(ql)) : pool;
  const pick = (cid) => { onChange(cid); setQ(""); setFocused(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (matches[hi]) pick(matches[hi].id); }
    else if (e.key === "Escape") { setFocused(false); }
  };
  const sel = value ? byId(value) : null;
  const showList = ql.length > 0; // lijst alleen tonen bij typen, zodat knoppen niet verspringen
  return (
    <div>
      {sel && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 11px", background: T.accent, color: "#fff", borderRadius: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.85 }}>Gekozen post:</span>
          <b style={{ fontSize: 14 }}>{sel.naam}</b>
          <button onClick={() => onChange("")} style={{ marginLeft: "auto", border: "1px solid rgba(255,255,255,0.6)", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "2px 8px" }}>maak leeg</button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: T.sub, alignSelf: "center" }}>Snelkeuze:</span>
          {suggestions.map((cid) => { const c = byId(cid); if (!c) return null; const on = value === cid;
            return <Chip key={cid} active={on} tone="solid" size="lg" onClick={() => pick(cid)}>{c.naam}</Chip>; })}
        </div>
      )}
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setHi(0); }}
        onKeyDown={onKey}
        placeholder={sel ? "Typ om een andere post te kiezen…" : "Typ om te zoeken (↵ kiest de eerste)…"}
        style={{ ...inputStyle, fontSize: 13, padding: "8px 10px", border: `1px solid ${sel ? T.accent : T.line}` }}
      />
      {showList && (
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 8, marginTop: 6, maxHeight: 230, overflowY: "auto", background: "#fff" }}>
          {matches.length === 0 && <div style={{ padding: "10px 12px", fontSize: 13, color: T.sub }}>Geen post gevonden — pas je zoekterm aan.</div>}
          {matches.map((c, idx) => (
            <button
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); pick(c.id); }}
              onMouseEnter={() => setHi(idx)}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", border: "none", borderTop: idx ? `1px solid ${T.line}` : "none", background: idx === hi ? T.accentSoft : (value === c.id ? "#eef3f1" : "#fff"), padding: "8px 12px", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: value === c.id ? 700 : 500 }}>{c.naam}</span>
              <span style={{ fontSize: 11, color: T.sub, whiteSpace: "nowrap" }}>{groupName(c.groupId)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function SplitEditor({ tx, categories, groups, onSave, onCancel }) {
  const sign = tx.amountCents < 0 ? -1 : 1;
  const total = Math.abs(tx.amountCents);
  const init = (tx.allocations && tx.allocations.length > 1)
    ? tx.allocations.map((a) => ({ categoryId: a.categoryId, mag: Math.abs(a.amountCents), note: a.note || "", sub: a.sub || "" }))
    : (tx.allocations && tx.allocations.length === 1
      ? [{ categoryId: tx.allocations[0].categoryId, mag: total, note: tx.allocations[0].note || "", sub: tx.allocations[0].sub || "" }, { categoryId: "", mag: 0, note: "", sub: "" }]
      : [{ categoryId: "", mag: total, note: "", sub: "" }, { categoryId: "", mag: 0, note: "", sub: "" }]);
  const [rows, setRows] = useState(init);
  const subsOf = (cid) => (categories.find((c) => c.id === cid) || {}).subs || [];
  const sum = rows.reduce((s, r) => s + (r.mag || 0), 0);
  const remaining = total - sum;
  const filled = rows.filter((r) => r.mag > 0 && r.categoryId);
  const balanced = remaining === 0 && rows.filter((r) => r.mag > 0).every((r) => r.categoryId) && filled.length >= 1;
  const upd = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const verdeelEvenredig = () => setRows((rs) => { const n = rs.length || 1; const base = Math.floor(total / n); const rest = total - base * n; return rs.map((r, i) => ({ ...r, mag: base + (i === 0 ? rest : 0) })); });
  return (
    <div style={{ background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Verdeel {formatEUR(tx.amountCents)} over posten</div>
        <Btn size="sm" variant="ghost" onClick={verdeelEvenredig}>Evenredig verdelen</Btn>
      </div>
      {rows.map((r, i) => { const subs = subsOf(r.categoryId); return (
        <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 7, padding: 8, marginBottom: 6, background: "#fff" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 32px", gap: 8, alignItems: "center" }}>
            <CatSelect categories={categories} groups={groups} value={r.categoryId} sign={sign} onChange={(v) => upd(i, { categoryId: v, sub: "" })} />
            <MoneyInput cents={r.mag} onChange={(v) => upd(i, { mag: v })} />
            <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="regel weg" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <input value={r.note} onChange={(e) => upd(i, { note: e.target.value })} placeholder="omschrijving voor dit deel (optioneel)" style={{ ...inputStyle, flex: 1, minWidth: 140, padding: "5px 8px", fontSize: 12 }} />
            {subs.length > 0 && (
              <select value={r.sub} onChange={(e) => upd(i, { sub: e.target.value })} title="subpost" style={{ ...inputStyle, width: 150, padding: "5px 6px", fontSize: 12 }}>
                <option value="">— subpost —</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>
      ); })}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { categoryId: "", mag: remaining > 0 ? remaining : 0, note: "", sub: "" }])}>+ post</Btn>
          <span style={{ fontSize: 12, color: remaining === 0 ? T.pos : T.warn }}>{remaining === 0 ? "precies verdeeld" : remaining > 0 ? `nog ${formatEUR(remaining)} te verdelen` : `${formatEUR(-remaining)} te veel`}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={onCancel}>Annuleren</Btn>
          <Btn size="sm" disabled={!balanced} onClick={() => onSave(filled.map((r) => { const o = { categoryId: r.categoryId, amountCents: sign * r.mag }; if ((r.note || "").trim()) o.note = r.note.trim(); if ((r.sub || "").trim()) o.sub = r.sub.trim(); return o; }))}>Opslaan</Btn>
        </div>
      </div>
    </div>
  );
}

// Comprimeer een foto op het apparaat vóór upload (max 1600px, JPEG ~80%); PDF's gaan ongewijzigd.
async function fileToUploadPayload(file) {
  const MAX_RAW = 6 * 1024 * 1024;
  const isImage = /^image\//.test(file.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name || "");
  if (isImage) {
    const toJpeg = (w, h, draw) => {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(w, h, 1));
      c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
      draw(c.getContext("2d"), c.width, c.height);
      const d = c.toDataURL("image/jpeg", 0.8);
      return { filename: (file.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", data: d.split(",")[1] };
    };
    try { const bmp = await createImageBitmap(file); return toJpeg(bmp.width, bmp.height, (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h)); } catch { /* val door naar <img>-route */ }
    // Fallback voor o.a. iPhone-foto's (HEIC): een <img>-element kan formaten decoderen die createImageBitmap niet aankan.
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("decode")); im.src = url; });
      const out = toJpeg(img.naturalWidth, img.naturalHeight, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
      URL.revokeObjectURL(url);
      return out;
    } catch { throw new Error("Deze foto kan niet worden gelezen op dit apparaat — maak eventueel een schermafbeelding van de foto en upload die."); }
  }
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) throw new Error("Alleen foto's of PDF-bestanden.");
  if (file.size > MAX_RAW) throw new Error("Bestand is groter dan 6 MB.");
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("lezen mislukt")); r.readAsDataURL(file); });
  return { filename: file.name, mime: "application/pdf", data: b64 };
}
// Bijlagen bij één transactie: uploaden (camera/galerij/PDF), bekijken en verwijderen.
function Bijlagen({ tx }) {
  const { refreshAttachCounts } = useHuishoudboekje();
  const onChanged = refreshAttachCounts;
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const load = useCallback(() => { listAttachments(tx.id).then((r) => setItems(r.attachments || [])).catch(() => setItems([])); }, [tx.id]);
  useEffect(() => { load(); }, [load]);
  const pick = async (file) => {
    if (!file) return;
    setErr(""); setBusy(true);
    try {
      const payload = await fileToUploadPayload(file);
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(payload.mime)) throw new Error("Alleen foto's (jpg/png/webp) of PDF.");
      await uploadAttachment({ txId: tx.id, ...payload });
      load(); if (onChanged) onChanged();
      setFlash("✓ toegevoegd"); setTimeout(() => setFlash(""), 2500);
    } catch (e) { setErr(e && e.message ? e.message : "Uploaden mislukt."); }
    finally { setBusy(false); }
  };
  const remove = async (id) => { if (!confirm("Deze bijlage verwijderen?")) return; try { await deleteAttachment(id); load(); if (onChanged) onChanged(); } catch {} };
  return (
    <div style={{ marginTop: 8, background: "#f7faf9", border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
        <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf,.heic,.heif" style={{ display: "none" }} onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
        <Btn size="sm" onClick={() => camRef.current && camRef.current.click()} disabled={busy}>{busy ? "Bezig…" : "📷 Foto maken"}</Btn>
        <Btn size="sm" variant="secondary" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>📁 Bestand kiezen</Btn>
        {flash && <span style={{ fontSize: 12.5, color: T.pos, fontWeight: 700 }}>{flash}</span>}
        {!flash && <span style={{ fontSize: 11.5, color: T.sub }}>foto's worden automatisch verkleind · max 6 MB</span>}
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 12, color: T.neg }}>{err}</div>}
      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          {items.map((a) => (
            <div key={a.id} style={{ position: "relative", border: `1px solid ${T.line}`, borderRadius: 8, background: "#fff", padding: 6, width: 96 }}>
              {/^image\//.test(a.mime)
                ? <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer"><img src={attachmentUrl(a.id)} alt={a.filename} style={{ width: 82, height: 82, objectFit: "cover", borderRadius: 5, display: "block" }} /></a>
                : <a href={attachmentUrl(a.id)} target="_blank" rel="noreferrer" style={{ width: 82, height: 82, display: "grid", placeItems: "center", background: "#fdf2f2", borderRadius: 5, textDecoration: "none", fontSize: 20 }}>📄</a>}
              <div style={{ fontSize: 9.5, color: T.sub, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.filename}</div>
              <button onClick={() => remove(a.id)} title="verwijderen" style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: "50%", border: `1px solid ${T.line}`, background: "#fff", color: T.neg, cursor: "pointer", fontSize: 11, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {items == null && <div style={{ marginTop: 8, fontSize: 12, color: T.sub }}>Bijlagen laden…</div>}
      {items && items.length === 0 && <div style={{ marginTop: 8, fontSize: 12, color: T.sub }}>Nog geen bijlagen bij deze transactie.</div>}
    </div>
  );
}
// "Kijk hier even naar": zet een taak voor de ander klaar, gekoppeld aan deze transactie.
function TaakKnop({ tx }) {
  const { other, addTask: onAddTask } = useHuishoudboekje();
  const otherName = other.name;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span style={{ fontSize: 12.5, color: T.pos, fontWeight: 700 }}>✓ Klaargezet voor {otherName}</span>;
  if (!open) return <Btn size="sm" variant="ghost" onClick={() => setOpen(true)}>→ Taak voor {otherName}</Btn>;
  const submit = () => { onAddTask(tx.id, note.trim()); setNote(""); setDone(true); setTimeout(() => { setDone(false); setOpen(false); }, 2200); };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="korte toelichting (optioneel)" style={{ border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 9px", fontSize: 12.5, width: 220, maxWidth: "60vw" }} />
      <Btn size="sm" onClick={submit}>Klaarzetten</Btn>
      <Btn size="sm" variant="ghost" onClick={() => setOpen(false)}>×</Btn>
    </span>
  );
}
function TxRowBase({ tx, groups, categories, rules = [], history = [], years = [], newBatchId = null, onSetAllocations, onSetNote, onToggleFlag, onAddRule, onSaveOne }) {
  const { attachCounts } = useHuishoudboekje();
  const isMobile = useIsMobile();
  const [showAttach, setShowAttach] = useState(false);
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const sign = tx.amountCents < 0 ? -1 : 1;
  const allocs = tx.allocations || [];
  const isSplit = allocs.length > 1;
  const uncategorized = allocs.length === 0;
  const singleCat = allocs.length === 1 ? allocs[0].categoryId : "";
  const pickSingle = (catId) => onSetAllocations(tx.id, catId ? [{ categoryId: catId, amountCents: tx.amountCents }] : []);
  const singleSubs = (categories.find((c) => c.id === singleCat) || {}).subs || [];
  const setSingleSub = (sub) => onSetAllocations(tx.id, [{ ...allocs[0], categoryId: singleCat, amountCents: tx.amountCents, sub: sub || undefined }]);
  const isNewBatch = newBatchId && tx.batchId === newBatchId;
  const bg = uncategorized ? "#fff9ef" : (tx.flagged ? "#fdf3f3" : (isNewBatch ? "#fafcff" : undefined));
  const sugIds = uncategorized ? rankSuggestions(tx, rules, categories, history, 3) : [];
  return (
    <div title={tx.importedAt ? `Geïmporteerd ${fmtDateTime(tx.importedAt)}` : undefined} style={{ borderTop: `1px solid ${T.line}`, borderLeft: `4px solid ${tx.batchId ? batchColor(tx.batchId) : "transparent"}`, background: bg }}>
      {/* Telefoon: datum/naam/bedrag/knoppen op één regel, de postkiezer eronder over de volle breedte.
          Desktop: de vertrouwde zes kolommen. */}
      <div style={isMobile
        ? { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto auto auto", gap: 6, rowGap: 8, alignItems: "center", padding: "10px 12px" }
        : { display: "grid", gridTemplateColumns: TX_COLS, gap: 10, alignItems: "center", padding: "8px 14px" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, color: T.sub, fontFamily: T.mono }}>{tx.date.slice(8, 10)}-{tx.date.slice(5, 7)}</span>
          {tx.periodDate && <div style={{ fontSize: 9, color: T.accent, fontWeight: 700 }} title="telt mee voor een andere periode">↪ {String(effMonth(tx)).padStart(2, "0")}-{effYear(tx)}</div>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.name}</div>
          {tx.note && tx.note.trim()
            ? <div style={{ fontSize: 11, color: T.warn, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.note}</div>
            : (tx.omschrijving && tx.omschrijving !== tx.name && <div style={{ fontSize: 11, color: T.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.omschrijving}</div>)}
        </div>
        <span style={{ textAlign: "right", fontFamily: T.mono, fontVariantNumeric: "tabular-nums", fontSize: 13, fontWeight: 600, color: sign < 0 ? T.neg : T.pos }}>{formatEUR(tx.amountCents)}</span>
        <div style={isMobile ? { gridColumn: "1 / -1", minWidth: 0 } : undefined}>
          {isSplit
            ? <button onClick={() => { setOpen(true); setSplitting(true); }} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, textAlign: "left", cursor: "pointer", background: "#eef0ff", color: "#4338ca", border: "1px solid #d7dcff", borderRadius: 7 }}>Verdeeld over {allocs.length} posten ✎</button>
            : <CatSelect categories={categories} groups={groups} value={singleCat} sign={sign} onChange={pickSingle} placeholder={uncategorized ? "— toe te kennen —" : "— kies post —"} />}
          {uncategorized && sugIds.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              {sugIds.map((cid) => { const c = categories.find((x) => x.id === cid); if (!c) return null;
                return <Chip key={cid} active size="sm" title="snel toekennen" onClick={() => pickSingle(cid)}>{c.naam}</Chip>; })}
            </div>
          )}
          {!isSplit && singleCat && singleSubs.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: T.sub, marginBottom: 3 }}>Kies subpost:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {singleSubs.map((s) => { const on = (allocs[0] && allocs[0].sub) === s; return (
                  <Chip key={s} active={on} tone="solid" size="sm" onClick={() => setSingleSub(on ? "" : s)}>{s}</Chip>
                ); })}
              </div>
            </div>
          )}
        </div>
        <button onClick={() => onToggleFlag(tx.id)} title={tx.flagged ? "markering weghalen" : "markeer: nog uitzoeken / voorgeschoten"} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 17, lineHeight: 1, color: tx.flagged ? T.warn : "#c7d0ce" }}>{tx.flagged ? "★" : "☆"}</button>
        <button onClick={() => setOpen((o) => !o)} title="meer" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.sub, display: "flex", justifyContent: "center" }}><Icon d={open ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />} size={16} /></button>
      </div>
      {open && (
        <div style={{ padding: isMobile ? "0 12px 14px 12px" : "0 14px 14px 90px", display: "flex", flexDirection: "column", gap: 10 }}>
          {sign > 0 && <div style={{ fontSize: 12, color: T.sub }}>Geld terug dat je had voorgeschoten? Kies hierboven de <b>uitgavepost</b> waarop je het had geboekt; de teruggave verlaagt dan die post.</div>}
          {tx.description && tx.description !== tx.omschrijving && <div style={{ fontSize: 12, color: T.sub, background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "6px 10px" }}><span style={{ fontWeight: 600 }}>Mededelingen: </span>{tx.description}</div>}
          <VermogenHint tx={tx} categories={categories} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn size="sm" variant={showAttach ? "secondary" : "ghost"} onClick={() => setShowAttach((v) => !v)}>📎 Bijlagen{attachCounts && attachCounts[tx.id] ? ` (${attachCounts[tx.id]})` : ""}</Btn>
            <TaakKnop tx={tx} />
          </div>
          {showAttach && <Bijlagen tx={tx} />}
          {isSplit && !splitting && (
            <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 7, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.sub, marginBottom: 4 }}>Verdeling</div>
              {allocs.map((a, i) => { const c = categories.find((x) => x.id === a.categoryId); return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "2px 0" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c ? c.naam : "(post?)"}{a.sub ? ` › ${a.sub}` : ""}{a.note ? ` · ${a.note}` : ""}</span>
                  <span style={{ fontFamily: T.mono, flexShrink: 0 }}>{formatEUR(a.amountCents)}</span>
                </div>); })}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Notitie</span>
            <input value={tx.note || ""} onChange={(e) => onSetNote(tx.id, e.target.value)} placeholder="bijv. voorgeschoten voor Maud" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
          </div>
          {onSaveOne && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: T.sub, width: 64 }}>Bundel</span>
              <input value={tx.bundle || ""} list="bundel-labels" onChange={(e) => onSaveOne(tx.id, { bundle: e.target.value })} placeholder="bijv. Verjaardag Maud — telt los op bij Uitgaven › Bundels" style={{ ...inputStyle, fontSize: 13, padding: "6px 10px" }} />
            </div>
          )}
          {onSaveOne && settlementsOf(tx).length === 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ fontSize: 12, color: T.sub, width: 64, paddingTop: 4 }}>Tikkie</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                  <Toggle on={!!tx.advance} onClick={() => onSaveOne(tx.id, tx.advance ? { advance: false } : { advance: true, expectedBackCents: Math.abs(tx.amountCents) })} />
                  <span>Ik ga hier een tikkie voor sturen — verwacht (deels) terug</span>
                </label>
                {tx.advance && <ExpectedBackEditor amountCents={tx.amountCents} value={tx.expectedBackCents} onChange={(v) => onSaveOne(tx.id, { expectedBackCents: v })} />}
              </div>
            </div>
          )}
          {settlementsOf(tx).length > 0 && <div style={{ fontSize: 12.5, color: T.pos, fontWeight: 600, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><span>✓ Gekoppeld aan {settlementsOf(tx).length === 1 ? "een tikkie" : `${settlementsOf(tx).length} tikkies`}{unassignedOf(tx) > 0 ? ` · nog ${formatEUR(unassignedOf(tx))} vrij` : ""} · beheren onder Tikkies</span>{onSaveOne && <button onClick={() => onSaveOne(tx.id, { settledWith: undefined, settlements: [], allocations: [] })} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>ontkoppel</button>}</div>}
          {onSaveOne && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 12, color: T.sub, width: 64 }}>Periode</span><PeriodControl tx={tx} years={years} onChange={(pd) => onSaveOne(tx.id, { periodDate: pd })} /></div>}
          {!splitting && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Btn variant="secondary" size="sm" onClick={() => setSplitting(true)}>Verdeel over meerdere posten</Btn>
              {singleCat && <RuleLearn tx={tx} categoryId={singleCat} onAddRule={onAddRule} />}
            </div>
          )}
          {splitting && <SplitEditor tx={tx} categories={categories} groups={groups} onSave={(a) => { onSetAllocations(tx.id, a); setSplitting(false); }} onCancel={() => setSplitting(false)} />}
        </div>
      )}
    </div>
  );
}
// Alleen opnieuw renderen als de transactie zelf of relevante lijsten wijzigen — scheelt veel werk
// bij lange transactielijsten.
const TxRow = React.memo(TxRowBase, (a, b) =>
  a.tx === b.tx && a.categories === b.categories && a.rules === b.rules && a.years === b.years && a.newBatchId === b.newBatchId && a.groups === b.groups && a.history === b.history
);

export { ExpectedBackEditor, VermogenHint, PostPicker, SplitEditor, fileToUploadPayload, Bijlagen, TaakKnop, TxRowBase, TxRow, TX_COLS, RuleLearn };
