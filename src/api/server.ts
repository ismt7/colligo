import express from "express";
import feedsRouter from "./routes/feeds";
import articlesRouter from "./routes/articles";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/feeds", feedsRouter);
app.use("/articles", articlesRouter);

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

export default app;
