import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initDb } from "../src/core/db.js";
import { createWorkflowVersion, ensureWorkflowVersion } from "../src/services/executionPolicy.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1" && !!process.env.DATABASE_URL;

test("workflow version capture allows concurrent executions with shared locks", { skip: !enabled }, async () => {
  const db = initDb();
  const userId = randomUUID();
  const workflowId = randomUUID();
  const email = `concurrency-${userId}@test.invalid`;
  const c1 = await db.connect();
  const c2 = await db.connect();

  try {
    await db.query("INSERT INTO app_users (id,email,password_hash) VALUES ($1,$2,$3)", [
      userId,
      email,
      "integration-test-placeholder",
    ]);
    await db.query(
      "INSERT INTO workflows (id,user_id,name,enabled,steps) VALUES ($1,$2,$3,true,$4)",
      [workflowId, userId, "concurrency-test", JSON.stringify([])],
    );
    await db.query(
      "INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",
      [randomUUID(), workflowId, JSON.stringify({ id: workflowId, name: "concurrency-test", enabled: true, steps: [] }), userId],
    );

    await c1.query("BEGIN");
    await c2.query("BEGIN");

    const first = ensureWorkflowVersion(workflowId, userId, c1);
    const second = ensureWorkflowVersion(workflowId, userId, c2);

    let timedOut = false;
    try {
      await Promise.race([
        Promise.all([first, second]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("shared-lock acquisition timed out")), 500)),
      ]);
    } catch {
      timedOut = true;
    }

    assert.equal(timedOut, false, "concurrent executions must both acquire FOR SHARE without waiting for each other");

    const [v1, v2] = await Promise.all([first, second]);
    assert.equal(v1?.id, v2?.id);
    assert.equal(v1?.version, 1);

    await c1.query("COMMIT");
    await c2.query("COMMIT");
  } finally {
    await c1.query("ROLLBACK").catch(() => {});
    await c2.query("ROLLBACK").catch(() => {});
    c1.release();
    c2.release();
    await db.query("DELETE FROM app_users WHERE id=$1", [userId]);
  }
});

test("workflow execution waits for an edit and captures the committed version", { skip: !enabled }, async () => {
  const db = initDb();
  const userId = randomUUID();
  const workflowId = randomUUID();
  const email = `edit-race-${userId}@test.invalid`;
  const editor = await db.connect();
  const runner = await db.connect();

  try {
    await db.query("INSERT INTO app_users (id,email,password_hash) VALUES ($1,$2,$3)", [
      userId,
      email,
      "integration-test-placeholder",
    ]);
    await db.query(
      "INSERT INTO workflows (id,user_id,name,enabled,steps) VALUES ($1,$2,$3,true,$4)",
      [workflowId, userId, "before-edit", JSON.stringify([])],
    );
    await db.query(
      "INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",
      [randomUUID(), workflowId, userId ? JSON.stringify({ id: workflowId, name: "before-edit", enabled: true, steps: [] }) : "{}", userId],
    );

    await editor.query("BEGIN");
    await editor.query(
      "SELECT id FROM workflows WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [workflowId, userId],
    );
    await editor.query(
      "UPDATE workflows SET name=$1,updated_at=now() WHERE id=$2 AND user_id=$3",
      ["after-edit", workflowId, userId],
    );
    const version = await createWorkflowVersion(workflowId, userId, editor);
    assert.equal(version, 2);

    await runner.query("BEGIN");
    const capture = ensureWorkflowVersion(workflowId, userId, runner);

    await editor.query("SELECT pg_sleep(0.2)");
    await editor.query("COMMIT");

    const captured = await capture;
    assert.equal(captured?.version, 2);
    assert.equal(captured?.definition?.name, "after-edit");

    await runner.query("COMMIT");
  } finally {
    await editor.query("ROLLBACK").catch(() => {});
    await runner.query("ROLLBACK").catch(() => {});
    editor.release();
    runner.release();
    await db.query("DELETE FROM app_users WHERE id=$1", [userId]);
  }
});
