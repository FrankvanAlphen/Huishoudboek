import { Router } from "express";
import { upsertBudgetLineSchema } from "@finance/shared";
import { getHouseholdId } from "../household.js";
import { getBudget, upsertBudgetLine, ValidationError } from "../services/budgetService.js";

export const budgetRouter = Router();

budgetRouter.get("/", async (req, res) => {
  const yearId = req.query.year;
  if (typeof yearId !== "string") {
    res.status(400).json({ error: "Parameter 'year' ontbreekt" });
    return;
  }
  const householdId = await getHouseholdId();
  try {
    res.json(await getBudget(householdId, yearId));
  } catch {
    res.status(404).json({ error: "Jaar niet gevonden" });
  }
});

budgetRouter.put("/line", async (req, res) => {
  const parsed = upsertBudgetLineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  try {
    const result = await upsertBudgetLine(householdId, parsed.data);
    res.json(result);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
});
