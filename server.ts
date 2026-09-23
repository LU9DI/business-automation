import acquisitionAutomationRoutes from "./src/routes/acquisitionAutomationRoutes.js";
import authRoutes from "./src/routes/authRoutes.js";
import workflowRoutes from "./src/routes/workflowRoutes.js";
import webhookRoutes from "./src/routes/webhookRoutes.js";
import express from "express";
import acquisitionRoutes from "./src/routes/acquisitionRoutes.js";
import cors from "cors";
import { initDb } from "./src/core/db.js";
import { metricsMiddleware, metricsSnapshot } from "./src/core/metrics.js";
import { requestId } from "./src/middleware/requestId.js";
import { rateLimit } from "./src/middleware/rateLimit.js";
import { errorHandler } from "./src/middleware/errorHandler.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const origins = process.env.CORS_ORIGIN?.split(",").map((v) => v.trim()).filter(Boolean);
const PUBLIC_PAGES: Array<[string,string,string]> = [["/produto","Business Automation — automação empresarial","Automatize processos com workflows, webhooks e execução controlada."],["/recursos","Recursos do Business Automation","Workflows, conectores, webhooks, limites de execução e rastreabilidade."],["/solucoes","Soluções de automação empresarial","Automação de processos e integrações para operações digitais."],["/guias","Guias de automação empresarial","Guias práticos para estruturar workflows e integrações."],["/faq","FAQ — Business Automation","Perguntas frequentes sobre workflows, webhooks e automação."]];
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch] || ch));
const publicBase = (req: express.Request) => (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
const renderSeoPage = (req: express.Request, path: string, title: string, description: string) => {
  const base = publicBase(req);
  const canonical = base + (path === "/" ? "" : path);
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="website"></head><body><main><h1>${safeTitle}</h1><p>${safeDescription}</p><p><a href="/produto">Conheça o produto</a></p></main></body></html>`;
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestId);
app.use(rateLimit);
app.use(cors(origins?.length ? { origin: origins, credentials: true } : { origin: false }));
app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});
app.use(metricsMiddleware);

app.use("/api/auth", authRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/webhooks", webhookRoutes);


app.get("/robots.txt", (req, res) => {
  const base = publicBase(req);
  res.type("text/plain").send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /login
Disallow: /app
Disallow: /dashboard
Disallow: /admin
Sitemap: ${base}/sitemap.xml
`);
});
app.get("/sitemap.xml", (req, res) => {
  const base = publicBase(req);
  const urls = ["/", ...PUBLIC_PAGES.map(([path]) => path)];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>${escapeHtml(base + (path === "/" ? "" : path))}</loc></url>`).join("")}</urlset>`);
});
app.get(["/login","/app","/dashboard","/admin"], (_req, res) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.status(404).type("html").send("<!doctype html><html><head><meta name=\"robots\" content=\"noindex,nofollow,noarchive\"></head><body>Not found</body></html>");
});
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.type("html").send(renderSeoPage(req, "/", "Business Automation", "Automação empresarial com workflows, conectores, webhooks e execução controlada."));
});
for (const [path, title, description] of PUBLIC_PAGES) {
  app.get(path, (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(renderSeoPage(req, path, title, description));
  });
}

app.use("/api/acquisition/automation", acquisitionAutomationRoutes);
app.use("/api/acquisition", acquisitionRoutes);

app.get("/api/health", async (_req, res) => {
  try { await initDb().query("SELECT 1"); res.json({ ok: true, service: "business-automation", database: "ok" }); }
  catch { res.status(503).json({ ok: false, database: "error" }); }
});
app.get("/api/metrics", (req, res) => {
  if (process.env.NODE_ENV === "production" && req.header("x-metrics-token") !== process.env.METRICS_TOKEN) return res.status(401).json({ error: "unauthorized" });
  res.json(metricsSnapshot());
});

app.use(errorHandler);
const server = app.listen(port, () => console.log("business-automation API listening on " + port));
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);