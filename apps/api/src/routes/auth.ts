import { Router } from "express";
import { loginSchema } from "@finance/shared";
import { config } from "../config.js";
import {
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  loginRateLimit,
} from "../auth.js";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  if (!verifyPassword(parsed.data.password, config.AUTH_PASSWORD_HASH)) {
    res.status(401).json({ error: "Onjuist wachtwoord" });
    return;
  }
  setSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  res.json({ authenticated: isAuthenticated(req) });
});
