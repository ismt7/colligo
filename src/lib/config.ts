/**
 * Centralised environment-variable validation.
 *
 * Import this module early in any entry-point (before other app code) to
 * surface configuration errors at startup rather than at runtime.
 *
 *   import { config } from "../lib/config";   // API / worker entry-points
 *
 * All variables are validated with Zod.  Missing required variables cause a
 * descriptive error message and a non-zero exit.
 */
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // ── Runtime ────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // ── API server ─────────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().positive().default(3000),

  // ── Worker ─────────────────────────────────────────────────────────────────
  /** Polling interval in milliseconds (default: 1 hour). */
  FETCH_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /** Max feeds fetched in parallel per cycle. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  /** Restrict worker execution to a daytime window. */
  WORKER_ACTIVE_HOURS_ENABLED: z.coerce.boolean().default(true),
  /** Start hour (inclusive), 0-23. */
  WORKER_ACTIVE_HOURS_START: z.coerce.number().int().min(0).max(23).default(9),
  /** End hour (exclusive), 0-23. */
  WORKER_ACTIVE_HOURS_END: z.coerce.number().int().min(0).max(23).default(18),
  /** IANA timezone used for active-hours checks. */
  WORKER_ACTIVE_HOURS_TZ: z.string().min(1).default("Asia/Tokyo"),

  // ── Logging ────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug", "silly"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("❌  Invalid environment configuration:");
  result.error.errors.forEach((e) => {
    console.error(`   ${e.path.join(".")}: ${e.message}`);
  });
  process.exit(1);
}

/** Validated, typed application configuration derived from process.env. */
export const config: Config = result.data;
