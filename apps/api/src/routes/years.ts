import { Router } from "express";
import { createYearSchema, copyYearSchema } from "@finance/shared";
import { getHouseholdId } from "../household.js";
import { listYears, createYear, copyYear } from "../services/yearService.js";

export const yearsRouter = Router();

yearsRouter.get("/", async (_req, res) => {
  const householdId = await getHouseholdId();
  res.json(await listYears(householdId));
});

yearsRouter.post("/", async (req, res) => {
  const parsed = createYearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  try {
    const id = await createYear(householdId, parsed.data);
    res.status(201).json({ id });
  } catch {
    res.status(409).json({ error: "Dit jaar bestaat al" });
  }
});

yearsRouter.post("/:id/copy", async (req, res) => {
  const parsed = copyYearSchema.safeParse({ ...req.body, sourceYearId: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  try {
    const id = await copyYear(householdId, parsed.data);
    res.status(201).json({ id });
  } catch {
    res.status(409).json({ error: "Doeljaar bestaat mogelijk al" });
  }
});
