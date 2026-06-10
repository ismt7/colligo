import express from "express";
import swaggerUi from "swagger-ui-express";
import feedsRouter from "./routes/feeds";
import articlesRouter from "./routes/articles";
import openApiSpec from "./openapi";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── API docs (OpenAPI/Swagger) ─────────────────────────────────────────────
app.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/feeds", feedsRouter);
app.use("/articles", articlesRouter);

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

export default app;
