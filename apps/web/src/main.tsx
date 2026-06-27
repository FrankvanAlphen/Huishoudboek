import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { tokens } from "./tokens";

document.body.style.margin = "0";
document.body.style.background = tokens.bg;
document.body.style.color = tokens.text;
document.body.style.fontFamily =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const container = document.getElementById("root");
if (!container) throw new Error("root-element niet gevonden");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
