import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

type SentinelSignal = {
  tenantId: string;
  source: string;
  type: "incident" | "sensor" | "report" | "alert" | "transaction" | "movement" | "observation";
  severity: "low" | "medium" | "high" | "critical";
  entityIds?: string[];
  payload: Record<string, unknown>;
};

const timeoutMs = 5_000;

function config() {
  const url = String(process.env.SENTINEL_URL || "").replace(/\/$/, "");
  const secret = String(process.env.SENTINEL_INTEGRATION_SECRET || "");
  const tenantId = String(process.env.SENTINEL_TENANT_ID || "");
  return url && secret && tenantId ? { url, secret, tenantId } : null;
}

export async function emitSentinelSignal(signal: Omit<SentinelSignal, "tenantId"> & { tenantId?: string }) {
  const cfg = config();
  if (!cfg) return { sent: false, skipped: true };

  const body: SentinelSignal = { ...signal, tenantId: signal.tenantId || cfg.tenantId };
  const serialized = JSON.stringify(body);
  const idempotencyKey = crypto.randomUUID();

  for (let attempt = 0; attempt < 3; attempt++) {
    const timestamp = String(Date.now());
    const signature = crypto.createHmac("sha256", cfg.secret).update(timestamp).update(".").update(serialized).digest("hex");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(cfg.url + "/api/integrations/signals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sentinel-timestamp": timestamp,
          "x-sentinel-signature": signature,
          "idempotency-key": idempotencyKey,
        },
        body: serialized,
        signal: controller.signal,
      });
      if (response.ok || response.status === 200 || response.status === 201) return { sent: true, status: response.status };
      if (response.status < 500 && response.status !== 429) return { sent: false, status: response.status };
    } catch {}
    finally { clearTimeout(timer); }
    await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return { sent: false, failed: true };
}

function classify(path: string, status: number) {
  if ("business-automation" === "business-automation") {
    if (!(path.startsWith("/api/workflows") || path.startsWith("/api/webhooks"))) return null;
  } else if ("business-automation" === "ai-agent-marketplace") {
    if (!(path.startsWith("/api/agents") || path.startsWith("/api/install") || path.startsWith("/api/reviews"))) return null;
  } else {
    if (!(path.startsWith("/api/tax") || path.startsWith("/api/companies") || path.startsWith("/api/revenue") || path.startsWith("/api/payments"))) return null;
  }
  const severity = status >= 500 ? "critical" : status >= 400 ? "high" : "low";
  const type = path.includes("/payments") || path.includes("/install") ? "transaction" : status >= 400 ? "alert" : "observation";
  return { severity, type };
}

export function sentinelIntegrationMiddleware(req: Request, res: Response, next: NextFunction) {
  res.on("finish", () => {
    const classification = classify(req.path, res.statusCode);
    if (!classification || req.method === "GET" || req.path.includes("/validate")) return;
    const segments = req.path.split("/").filter(Boolean);
    const entityIds = segments.filter(v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)).slice(0, 5);
    void emitSentinelSignal({
      source: "business-automation",
      type: classification.type as SentinelSignal["type"],
      severity: classification.severity as SentinelSignal["severity"],
      entityIds,
      payload: {
        event: req.method + " " + req.path,
        status: res.statusCode,
        requestId: req.header("x-request-id") || null,
        occurredAt: new Date().toISOString(),
      },
    });
  });
  next();
}
