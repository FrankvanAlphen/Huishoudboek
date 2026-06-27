import { Router } from "express";
import { healthcheckDb } from "../db.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    const dbOk = await healthcheckDb();
    res.json({ status: "ok", db: dbOk });
  } catch {
    res.status(503).json({ status: "degraded", db: false });
  }
});
