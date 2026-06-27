import { Router } from "express";
import { wizardImportSchema } from "@finance/shared";
import { getHouseholdId } from "../household.js";
import { importBudget } from "../services/wizardService.js";

export const wizardRouter = Router();

wizardRouter.post("/import", async (req, res) => {
  const parsed = wizardImportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  const result = await importBudget(householdId, parsed.data);
  res.json(result);
});
