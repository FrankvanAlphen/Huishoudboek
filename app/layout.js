import "./globals.css";

export const metadata = {
  title: "KPS 3.0 — Financiële beheersingsmodule",
  description: "Projectbeheersing: PER-lijst, kostendragerbewaking, arbeid, materieel en afrekenblad · J.P. van Eesteren (TBI)",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body style={{ margin: 0, padding: 0, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
