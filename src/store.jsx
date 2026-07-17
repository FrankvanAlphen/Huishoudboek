import React, { createContext, useContext } from "react";

// ---- Gedeelde app-context ----
// Wie je bent, wie "de ander" is, de bijlage-tellingen en de bijbehorende acties.
// Schermen halen dit zelf op met useHuishoudboekje(), zodat deze gegevens niet meer
// via props door de hele boom hoeven te worden doorgegeven (geen prop-drilling).
const HuishoudCtx = createContext(null);

function HuishoudProvider({ value, children }) {
  return <HuishoudCtx.Provider value={value}>{children}</HuishoudCtx.Provider>;
}

function useHuishoudboekje() {
  const v = useContext(HuishoudCtx);
  if (!v) throw new Error("useHuishoudboekje() gebruikt buiten <HuishoudProvider>");
  return v;
}

export { HuishoudProvider, useHuishoudboekje };
