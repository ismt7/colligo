/**
 * Shared logger built on Winston.
 *
 * Reads LOG_LEVEL from the environment (defaulting to "info") so it works
 * whether called before or after config.ts is imported.
 *
 * Usage:
 *   import { logger } from '../lib/logger';
 *   logger.info('message', { meta: 'value' });
 */
import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const base = `${String(timestamp)} [${String(level)}]: ${String(stack ?? message)}`;
  const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return base + extra;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: combine(errors({ stack: true }), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    }),
  ],
});
