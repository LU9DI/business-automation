import { Router } from "express";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { initDb, withTransaction } from "../core/db.js";
import { requireAuth } from "../middleware/auth.js";
import { prepareWorkflow, executeWorkflow } from "../services/workflowService.js";
import { redactedJson } from "../services/redaction.js";

const router = Router();
const MAX_RUNS_PER_DAY = 500;
const MAX_CONCURRENT_RUNS = 3;

router.post("/setup/:workflowId", requireAuth, async (req, res) => {
  try {
    const db = initDb();
    const userId = (req as any).userId;
    const w = await db.query("SELECT id FROM workflows WHERE id=$1 AND user_id=$2", [req.params.workflowId, userId]);
    if (!w.rowCount) return res.status(404).json({ error: "workflow not found" });
    const secret = crypto.randomBytes(32).toString("base64url");
    await db.query(
      "INSERT INTO workflow_webhooks (id,workflow_id,user_id,secret) VALUES ($1,$2,$3,$4) ON CONFLICT(workflow_id) DO UPDATE SET secret=EXCLUDED.secret,active=true",
      [randomUUID(), req.params.workflowId, userId, secret],
    );
    res.status(201).json({ workflowId: req.params.workflowId, active: true, secret });
  } catch {
    res.status(500).json({ error: "failed to setup webhook" });
  }
});

router.get("/:workflowId", requireAuth, async (req, res) => {
  try {
    const r = await initDb().query(
      "SELECT workflow_id,active,created_at FROM workflow_webhooks WHERE workflow_id=$1 AND user_id=$2",
      [req.params.workflowId, (req as any).userId],
    );
    if (!r.rowCount) return res.status(404).json({ error: "webhook not configured" });
    res.json({ webhook: r.rows[0] });
  } catch {
    res.status(500).json({ error: "failed to load webhook" });
  }
});

router.patch("/:workflowId", requireAuth, async (req, res) => {
  try {
    const active = Boolean(req.body?.active);
    const r = await initDb().query(
      "UPDATE workflow_webhooks SET active=$1 WHERE workflow_id=$2 AND user_id=$3 RETURNING workflow_id,active",
      [active, req.params.workflowId, (req as any).userId],
    );
    if (!r.rowCount) return res.status(404).json({ error: "webhook not configured" });
    res.json({ webhook: r.rows[0] });
  } catch {
    res.status(400).json({ error: "failed to update webhook" });
  }
});

router.post("/:workflowId", async (req, res) => {
  let runId: string | undefined;

  try {
    const db = initDb();
    const hook = await db.query(
      "SELECT w.id,w.user_id,w.name,w.enabled,w.steps,h.secret,h.active FROM workflow_webhooks h JOIN workflows w ON w.id=h.workflow_id WHERE h.workflow_id=$1",
      [req.params.workflowId],
    );
    if (!hook.rowCount || !hook.rows[0].active) return res.status(404).json({ error: "webhook not configured" });

    const signature = req.header("x-workflow-signature") || "";
    const rawBody = Buffer.isBuffer((req as any).rawBody)
      ? (req as any).rawBody
      : Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac("sha256", hook.rows[0].secret).update(rawBody).digest("hex");
    const provided = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    if (!signature || provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
      return res.status(401).json({ error: "invalid webhook signature" });
    }

    const w = prepareWorkflow(hook.rows[0]);
    if (!w.enabled) return res.status(409).json({ error: "workflow is disabled" });

    const idempotencyKey = (req.header("idempotency-key") || "").trim().slice(0, 200) || undefined;
    const admission = await withTransaction(async (client) => {
      // Serialize admission per user so concurrent requests cannot all pass the same limits.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(hook.rows[0].user_id)]);

      if (idempotencyKey) {
        const existing = await client.query(
          "SELECT id,status,output,error FROM workflow_runs WHERE workflow_id=$1 AND idempotency_key=$2 LIMIT 1",
          [hook.rows[0].id, idempotencyKey],
        );
        if (existing.rowCount) return { kind: "duplicate" as const, row: existing.rows[0] };
      }

      const concurrent = await client.query(
        "SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1 AND status IN ('running','queued')",
        [hook.rows[0].user_id],
      );
      if (Number(concurrent.rows[0].count) >= MAX_CONCURRENT_RUNS) {
        return { kind: "concurrency" as const };
      }

      const daily = await client.query(
        "SELECT COUNT(*)::int count FROM workflow_runs WHERE user_id=$1 AND created_at >= now()-interval '24 hours'",
        [hook.rows[0].user_id],
      );
      if (Number(daily.rows[0].count) >= MAX_RUNS_PER_DAY) {
        return { kind: "daily" as const };
      }

      const id = randomUUID();
      await client.query(
        "INSERT INTO workflow_runs (id,workflow_id,user_id,status,input,started_at,idempotency_key) VALUES ($1,$2,$3,'running',$4,now(),$5)",
        [id, hook.rows[0].id, hook.rows[0].user_id, redactedJson(req.body || {}), idempotencyKey || null],
      );
      return { kind: "admitted" as const, id };
    });

    if (admission.kind === "duplicate") {
      return res.status(200).json({
        runId: admission.row.id,
        status: admission.row.status,
        output: admission.row.output || undefined,
        error: admission.row.error || undefined,
        duplicate: true,
      });
    }
    if (admission.kind === "concurrency") {
      return res.status(429).json({ error: "concurrency limit reached", limit: MAX_CONCURRENT_RUNS });
    }
    if (admission.kind === "daily") {
      return res.status(429).json({ error: "daily workflow run limit reached", limit: MAX_RUNS_PER_DAY });
    }

    runId = admission.id;
    const result = await executeWorkflow(w, req.body || {});
    await db.query(
      "UPDATE workflow_runs SET status='succeeded',output=$1,finished_at=now() WHERE id=$2",
      [redactedJson(result.output), runId],
    );
    res.json({ runId, status: "succeeded", output: redactedJson(result.output) });
  } catch (e) {
    if (runId) {
      await initDb().query(
        "UPDATE workflow_runs SET status='failed',error=$1,finished_at=now() WHERE id=$2",
        [e instanceof Error ? e.message : "execution failed", runId],
      ).catch(() => {});
    }
    res.status(400).json({ error: "webhook execution failed", runId });
  }
});

export default router;
