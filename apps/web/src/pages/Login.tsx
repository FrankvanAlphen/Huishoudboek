import { useState } from "react";
import { api } from "./api";
import { tokens } from "./tokens";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inloggen mislukt");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          boxShadow: tokens.shadow,
          padding: 28,
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 20 }}>Financieel Overzicht</h1>
        <p style={{ margin: "0 0 20px", color: tokens.muted, fontSize: 14 }}>
          Log in met het gedeelde wachtwoord.
        </p>

        <label style={{ display: "block", fontSize: 13, marginBottom: 6, color: tokens.muted }}>
          Wachtwoord
        </label>
        <input
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: 15,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            outline: "none",
          }}
        />

        {error && (
          <p style={{ color: tokens.negatief, fontSize: 13, margin: "12px 0 0" }}>{error}</p>
        )}

        <button
          onClick={() => void submit()}
          disabled={busy || !password}
          style={{
            width: "100%",
            marginTop: 20,
            padding: "10px 12px",
            fontSize: 15,
            fontWeight: 600,
            color: tokens.accentText,
            background: busy || !password ? "#9ec5c0" : tokens.accent,
            border: "none",
            borderRadius: 8,
            cursor: busy || !password ? "default" : "pointer",
          }}
        >
          {busy ? "Bezig…" : "Inloggen"}
        </button>
      </div>
    </div>
  );
}
