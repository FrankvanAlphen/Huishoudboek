import { useEffect, useState } from "react";
import { api } from "./api";
import { tokens } from "./tokens";
import { Login } from "./pages/Login";

type AuthState = "checking" | "out" | "in";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    api
      .me()
      .then((r) => setAuth(r.authenticated ? "in" : "out"))
      .catch(() => setAuth("out"));
  }, []);

  if (auth === "checking") {
    return <div style={{ padding: 24, color: tokens.muted }}>Laden…</div>;
  }
  if (auth === "out") {
    return <Login onSuccess={() => setAuth("in")} />;
  }

  return <AuthenticatedShell onLogout={() => setAuth("out")} />;
}

function AuthenticatedShell({ onLogout }: { onLogout: () => void }) {
  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Financieel Overzicht</h1>
        <button
          onClick={() => void logout()}
          style={{
            padding: "8px 14px",
            fontSize: 14,
            color: tokens.text,
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Uitloggen
        </button>
      </header>

      <section
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          boxShadow: tokens.shadow,
          padding: 24,
        }}
      >
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Fase 1 — fundament staat</h2>
        <p style={{ color: tokens.muted, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          De basis is gelegd: beveiligde toegang, database met het kern-schema en de geteste
          rekenkern (saldo, begroting, potjes, deduplicatie en de regel-engine). In fase 2 komen
          de begroting en de overname-wizard erbij, zodat je je Excel-cijfers kunt invoeren.
        </p>
      </section>
    </div>
  );
}
