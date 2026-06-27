import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is verplicht"),
  AUTH_PASSWORD_HASH: z.string().min(1, "AUTH_PASSWORD_HASH is verplicht (zie npm run hash-password)"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET moet minstens 16 tekens zijn"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Faal hard en duidelijk bij ontbrekende configuratie i.p.v. halverwege te crashen.
  console.error("Ongeldige omgevingsconfiguratie:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
