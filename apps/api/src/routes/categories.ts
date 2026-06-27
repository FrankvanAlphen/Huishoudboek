import { Router } from "express";
import { createCategorySchema, updateCategorySchema, createGroupSchema } from "@finance/shared";
import { getHouseholdId } from "../household.js";
import {
  listGroupsWithCategories,
  createCategory,
  updateCategory,
  archiveCategory,
  createGroup,
} from "../services/categoryService.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", async (_req, res) => {
  const householdId = await getHouseholdId();
  res.json(await listGroupsWithCategories(householdId));
});

categoriesRouter.post("/", async (req, res) => {
  const parsed = createCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  const id = await createCategory(householdId, parsed.data);
  res.status(201).json({ id });
});

categoriesRouter.patch("/:id", async (req, res) => {
  const parsed = updateCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  await updateCategory(householdId, req.params.id, parsed.data);
  res.json({ ok: true });
});

categoriesRouter.post("/:id/archive", async (req, res) => {
  const householdId = await getHouseholdId();
  await archiveCategory(householdId, req.params.id);
  res.json({ ok: true });
});

categoriesRouter.post("/groups", async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ongeldige invoer" });
    return;
  }
  const householdId = await getHouseholdId();
  const id = await createGroup(householdId, parsed.data);
  res.status(201).json({ id });
});
