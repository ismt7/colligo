/**
 * Worker entry-point.
 *
 * Immediately runs one fetch cycle on startup, then repeats on a configurable
 * interval (default: 1 hour).
 *
 * Environment variables
 * ─────────────────────
 * FETCH_INTERVAL_MS   How often to poll feeds (default: 3600000 = 1 h)
 * WORKER_CONCURRENCY  Max feeds fetched in parallel per cycle (default: 5)
 * DATABASE_URL        PostgreSQL connection string (required)
 */
import "dotenv/config";
import prisma from "../lib/prisma";
import { fetchAllFeeds } from "./fetchFeeds";

const FETCH_INTERVAL_MS = parseInt(process.env.FETCH_INTERVAL_MS ?? String(60 * 60 * 1000), 10);

async function runLoop(): Promise<void> {
  console.log(`[worker] Starting — fetch interval: ${FETCH_INTERVAL_MS} ms`);

  // Run an immediate cycle so the worker is useful right after container start.
  await fetchAllFeeds();

  // Schedule subsequent cycles.
  const timer = setInterval(async () => {
    try {
      await fetchAllFeeds();
    } catch (err) {
      // setInterval callbacks must not throw — log and keep the timer alive.
      console.error("[worker] Unhandled error in fetch cycle:", err);
    }
  }, FETCH_INTERVAL_MS);

  // Ensure the Node process doesn't prevent container shutdown.
  timer.unref();

  // Graceful shutdown --------------------------------------------------------
  async function shutdown(signal: string): Promise<void> {
    console.log(`[worker] ${signal} received — shutting down`);
    clearInterval(timer);
    await prisma.$disconnect();
    console.log("[worker] Goodbye.");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Keep the process alive so the timer fires.
  // (The interval itself keeps the event loop running; unref() allows a clean
  //  exit on signal without waiting for the next tick.)
  await new Promise<never>(() => {
    /* intentionally never resolves */
  });
}

runLoop().catch((err) => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
