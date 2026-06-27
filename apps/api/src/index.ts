import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

import { config, isProd } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { yearsRouter } from "./routes/years.js";
import { budgetRouter } from "./routes/budget.js";
import { wizardRouter } from "./routes/wizard.js";
import { requireAuth } from "./auth.js";

const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Publieke endpoints
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);

// Beveiligde resources (fase 2).
app.use("/api/categories", requireAuth, categoriesRouter);
app.use("/api/years", requireAuth, yearsRouter);
app.use("/api/budget", requireAuth, budgetRouter);
app.use("/api/wizard", requireAuth, wizardRouter);

// In productie serveert de API de gebouwde frontend (apps/web/dist).
if (isProd) {
  const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }
}

app.listen(config.PORT, () => {
  console.log(`API luistert op poort ${config.PORT} (${config.NODE_ENV})`);
});
