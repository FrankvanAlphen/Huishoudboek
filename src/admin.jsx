// ---- Admin: huishoudens en accounts beheren ----
// Alleen zichtbaar voor een admin-gebruiker. Je maakt een huishouden aan (de container voor één
// gedeelde boekhouding) en koppelt er losse accounts aan; elk account krijgt een tijdelijk wachtwoord
// dat de gebruiker bij de eerste login moet wijzigen. Accounts kun je ook weer verwijderen.
import React, { useState, useEffect } from "react";
import { T, Btn, inputStyle } from "./ui.jsx";
import { listHouseholds, createHousehold, createAccount, deleteAccount } from "./api.js";

function HuishoudBeheer({ onClose }) {
  const [lijst, setLijst] = useState(null);
  const [fout, setFout] = useState("");
  const [nieuwHuis, setNieuwHuis] = useState({ key: "", name: "" });
  const [nieuwAcc, setNieuwAcc] = useState({}); // per household-key: { username, displayName }
  const [tijdelijk, setTijdelijk] = useState(null); // laatst aangemaakt account { username, tempPassword }
  const [bezig, setBezig] = useState(false);
  const [bevestig, setBevestig] = useState(""); // username die om verwijderbevestiging vraagt

  const laden = async () => {
    try { const r = await listHouseholds(); setLijst(r.households || []); }
    catch { setFout("Kon de lijst niet laden."); }
  };
  useEffect(() => { laden(); }, []);

  const huisAanmaken = async () => {
    setFout(""); setTijdelijk(null);
    if (nieuwHuis.key.trim().length < 2) { setFout("Kies een huishoud-naam van minstens 2 tekens."); return; }
    setBezig(true);
    try { await createHousehold(nieuwHuis.key, nieuwHuis.name); setNieuwHuis({ key: "", name: "" }); await laden(); }
    catch (e) { setFout(String(e.message).includes("bestaat-al") ? "Dat huishouden bestaat al." : "Aanmaken mislukt."); }
    finally { setBezig(false); }
  };

  const accountKoppelen = async (hkey) => {
    setFout(""); setTijdelijk(null);
    const a = nieuwAcc[hkey] || {};
    if ((a.username || "").trim().length < 2) { setFout("Kies een inlognaam van minstens 2 tekens."); return; }
    setBezig(true);
    try {
      const r = await createAccount(hkey, a.username, a.displayName);
      setTijdelijk({ username: r.username, tempPassword: r.tempPassword, household: hkey });
      setNieuwAcc((s) => ({ ...s, [hkey]: { username: "", displayName: "" } }));
      await laden();
    } catch (e) {
      const m = String(e.message);
      setFout(m.includes("gebruiker-bestaat-al") ? "Die inlognaam bestaat al." : m.includes("huishouden-onbekend") ? "Huishouden niet gevonden." : "Koppelen mislukt.");
    } finally { setBezig(false); }
  };

  const accountVerwijderen = async (username) => {
    setFout("");
    try { await deleteAccount(username); setBevestig(""); await laden(); }
    catch (e) { setFout(String(e.message).includes("niet-jezelf") ? "Je kunt je eigen account niet verwijderen." : "Verwijderen mislukt."); }
  };

  const setAcc = (hkey, veld, val) => setNieuwAcc((s) => ({ ...s, [hkey]: { ...(s[hkey] || {}), [veld]: val } }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,22,0.55)", display: "grid", placeItems: "center", zIndex: 60, padding: 16 }}>
      <div style={{ background: T.panel, borderRadius: 14, padding: 24, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", width: "min(600px, 95vw)", maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Huishoudens &amp; accounts</div>
          <Btn size="sm" variant="ghost" onClick={onClose}>Sluiten</Btn>
        </div>
        <div style={{ fontSize: 12.5, color: T.sub, marginBottom: 16 }}>Een huishouden is één gedeelde boekhouding. Koppel er een of meer accounts aan — die zien allemaal dezelfde gegevens. Elk account krijgt een tijdelijk wachtwoord om door te geven.</div>

        {tijdelijk && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: "#f2f9f4", border: `1px solid ${T.pos}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Account aangemaakt: {tijdelijk.username}</div>
            <div style={{ fontSize: 12.5, color: T.sub }}>Tijdelijk wachtwoord: <b style={{ fontFamily: T.mono, fontSize: 14 }}>{tijdelijk.tempPassword}</b></div>
            <div style={{ fontSize: 11.5, color: T.sub, marginTop: 6 }}>Geef dit door. Het is nu eenmalig te zien; daarna niet meer op te vragen.</div>
          </div>
        )}
        {fout && <div style={{ fontSize: 12.5, color: T.neg, marginBottom: 12 }}>{fout}</div>}

        {/* nieuw huishouden */}
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Nieuw huishouden</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 12, color: T.sub, flex: "1 1 150px" }}>Naam (bijv. Gezin Jansen)
              <input value={nieuwHuis.name} onChange={(e) => setNieuwHuis((s) => ({ ...s, name: e.target.value }))} placeholder="Gezin Jansen" style={{ ...inputStyle, width: "100%", marginTop: 3 }} />
            </label>
            <label style={{ fontSize: 12, color: T.sub, flex: "1 1 150px" }}>Sleutel (kort, geen spaties)
              <input value={nieuwHuis.key} onChange={(e) => setNieuwHuis((s) => ({ ...s, key: e.target.value }))} placeholder="gezin-jansen" style={{ ...inputStyle, width: "100%", marginTop: 3 }} />
            </label>
            <Btn onClick={huisAanmaken} disabled={bezig}>Aanmaken</Btn>
          </div>
        </div>

        {/* bestaande huishoudens met hun accounts */}
        {lijst == null ? <div style={{ fontSize: 12.5, color: T.sub }}>Laden…</div>
          : lijst.length === 0 ? <div style={{ fontSize: 12.5, color: T.sub }}>Nog geen huishoudens.</div>
          : lijst.map((h) => (
            <div key={h.key} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{h.name}</div>
                <div style={{ fontSize: 11.5, color: T.sub, fontFamily: T.mono }}>{h.key}</div>
              </div>
              {h.accounts.length === 0
                ? <div style={{ fontSize: 12, color: T.sub, marginBottom: 8 }}>Nog geen accounts gekoppeld.</div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                    {h.accounts.map((a) => (
                      <div key={a.username} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5 }}>
                        <span style={{ fontWeight: 600 }}>{a.displayName}</span>
                        <span style={{ color: T.sub, fontFamily: T.mono }}>{a.username}</span>
                        {a.isAdmin && <span style={{ fontSize: 10.5, color: T.accent, fontWeight: 700 }}>ADMIN</span>}
                        {a.mustChange && <span style={{ fontSize: 10.5, color: T.warn }}>nog niet ingelogd</span>}
                        <span style={{ flex: 1 }} />
                        {bevestig === a.username
                          ? <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <span style={{ fontSize: 11.5, color: T.neg }}>Zeker?</span>
                              <Btn size="sm" variant="danger" onClick={() => accountVerwijderen(a.username)}>Verwijder</Btn>
                              <Btn size="sm" variant="ghost" onClick={() => setBevestig("")}>Nee</Btn>
                            </span>
                          : a.isAdmin
                            ? null
                            : <Btn size="sm" variant="ghost" onClick={() => setBevestig(a.username)}>Verwijderen</Btn>}
                      </div>
                    ))}
                  </div>}
              {/* account koppelen */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
                <label style={{ fontSize: 11.5, color: T.sub, flex: "1 1 120px" }}>Naam
                  <input value={(nieuwAcc[h.key] || {}).displayName || ""} onChange={(e) => setAcc(h.key, "displayName", e.target.value)} placeholder="Piet Jansen" style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
                </label>
                <label style={{ fontSize: 11.5, color: T.sub, flex: "1 1 120px" }}>Inlognaam
                  <input value={(nieuwAcc[h.key] || {}).username || ""} onChange={(e) => setAcc(h.key, "username", e.target.value)} placeholder="piet" style={{ ...inputStyle, width: "100%", marginTop: 2 }} />
                </label>
                <Btn size="sm" onClick={() => accountKoppelen(h.key)} disabled={bezig}>+ Account</Btn>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export { HuishoudBeheer };
