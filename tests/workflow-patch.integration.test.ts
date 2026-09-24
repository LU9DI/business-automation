import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initDb } from "../src/core/db.js";
import { signAccessToken } from "../src/middleware/auth.js";
import { app } from "../server.js";

const enabled =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.RUN_HTTP_INTEGRATION === "1" &&
  !!process.env.DATABASE_URL &&
  !!process.env.JWT_SECRET;

test("PATCH workflow completes end-to-end when createWorkflowVersion reacquires the same advisory lock", { skip: !enabled }, async () => {
  const db = initDb();
  const userId = randomUUID();
  const workflowId = randomUUID();
  const email = `patch-lock-${userId}@test.invalid`;
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind integration server");
  const base = `http://127.0.0.1:${address.port}`;
  const token = signAccessToken({ sub: userId });

  try {
    await db.query(
      "INSERT INTO app_users (id,email,password_hash) VALUES ($1,$2,$3)",
      [userId, email, "integration-test-placeholder"],
    );
    await db.query(
      "INSERT INTO workflows (id,user_id,name,enabled,steps) VALUES ($1,$2,$3,true,$4)",
      [workflowId, userId, "before-patch", JSON.stringify([])],
    );
    await db.query(
      "INSERT INTO workflow_versions(id,workflow_id,version,definition,created_by) VALUES($1,$2,1,$3,$4)",
      [
        randomUUID(),
        workflowId,
        JSON.stringify({ id: workflowId, name: "before-patch", enabled: true, steps: [] }),
        userId,
      ],
    );

    const response = await Promise.race([
      fetch(`${base}/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "after-patch",
          enabled: true,
          steps: [],
        }),
      }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error("PATCH workflow timed out while reacquiring advisory lock")), 3000),
      ),
    ]);

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.workflow.name, "after-patch");
    assert.equal(body.workflowVersion, 2);

    const versions = await db.query(
      "SELECT version,definition FROM workflow_versions WHERE workflow_id=$1 ORDER BY version",
      [workflowId],
    );
    assert.equal(versions.rowCount, 2);
    assert.equal(versions.rows[1].version, 2);
    assert.equal(versions.rows[1].definition.name, "after-patch");
  } finally {
    server.close();
    await db.query("DELETE FROM app_users WHERE id=$1", [userId]);
  }
});
