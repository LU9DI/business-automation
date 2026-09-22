import authRoutes from "./src/routes/authRoutes.js";
import workflowRoutes from "./src/routes/workflowRoutes.js";
import express from "express";
import cors from "cors";
import { initDb } from "./src/core/db.js";
import { metricsMiddleware, metricsSnapshot } from "./src/core/metrics.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const origin = process.env.CORS_ORIGIN?.trim();

app.disable("x-powered-by");
app.use(cors(origin ? { origin: origin.split(",").map(v => v.trim()), credentials: true } : undefined));
app.use(express.json({ limit: "1mb" }));
app.use(metricsMiddleware);

app.use("/api/workflows", workflowRoutes);

app.use("/api/auth", authRoutes);

app.get("/api/health", async (_req, res) => {
  try {
    const db = await initDb();
    await db.query("SELECT 1");
    res.json({ ok: true, service: "business-automation", database: "ok" });
  } catch {
    res.status(503).json({ ok: false, database: "error" });
  }
});

app.get("/api/metrics", (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.METRICS_TOKEN && req.header("x-metrics-token") !== process.env.METRICS_TOKEN) return res.status(401).json({ error: "unauthorized" });
  res.json(metricsSnapshot());
});

const server = app.listen(port, () => console.log(`Business Automation API listening on ${port}`));
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
