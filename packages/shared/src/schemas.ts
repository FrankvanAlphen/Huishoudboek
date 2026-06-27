import { z } from "zod";

/** Login met het gedeelde huishoud-wachtwoord. */
export const loginSchema = z.object({
  password: z.string().min(1, "Wachtwoord is verplicht"),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Allocatie-invoer (gebruikt vanaf fase 3 bij koppelen/splitsen).
 * De server controleert aanvullend dat de som van de allocaties gelijk is aan
 * het transactiebedrag voordat een transactie de status 'verwerkt' krijgt.
 */
export const allocationInputSchema = z.object({
  categoryId: z.string().uuid(),
  amountCents: z.number().int(),
});

export const allocateTransactionSchema = z.object({
  allocations: z.array(allocationInputSchema).min(1),
  note: z.string().max(2000).optional(),
});
export type AllocateTransactionInput = z.infer<typeof allocateTransactionSchema>;

// --- Fase 2: posten, jaren, begroting, wizard ----------------------------

export const categoryTypeSchema = z.enum(["income", "expense", "savings"]);

export const createGroupSchema = z.object({
  naam: z.string().min(1).max(120),
  volgorde: z.number().int().optional(),
});

export const createCategorySchema = z.object({
  groupId: z.string().uuid(),
  naam: z.string().min(1).max(160),
  type: categoryTypeSchema,
  noteSuggested: z.boolean().optional(),
  volgorde: z.number().int().optional(),
});

export const updateCategorySchema = z.object({
  naam: z.string().min(1).max(160).optional(),
  type: categoryTypeSchema.optional(),
  noteSuggested: z.boolean().optional(),
  groupId: z.string().uuid().optional(),
  volgorde: z.number().int().optional(),
});

export const createYearSchema = z.object({
  jaartal: z.number().int().min(2000).max(2100),
  carryInCents: z.number().int().optional(),
});

export const copyYearSchema = z.object({
  sourceYearId: z.string().uuid(),
  jaartal: z.number().int().min(2000).max(2100),
  carryInCents: z.number().int().optional(),
});

const twelveCents = z.array(z.number().int()).length(12);

export const upsertBudgetLineSchema = z.object({
  yearId: z.string().uuid(),
  categoryId: z.string().uuid(),
  monthlyAverageCents: z.number().int(),
  monthsCents: twelveCents.optional(),
});

export const wizardImportSchema = z.object({
  jaartal: z.number().int().min(2000).max(2100),
  carryInCents: z.number().int(),
  rows: z
    .array(z.object({ name: z.string().min(1), monthsCents: twelveCents }))
    .max(500),
  pots: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        openingBalanceCents: z.number().int(),
        openingDate: z.string().optional().nullable(),
      }),
    )
    .max(200),
});
