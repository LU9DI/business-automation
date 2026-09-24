import { randomUUID } from "node:crypto";
import { initDb } from "./db.js";

export type Entitlement = { allowed: boolean; limit: number | null; plan: string };

export async function getEntitlement(userId: string, feature: string): Promise<Entitlement> {
  const r = await initDb().query(
    `SELECT u.plan, e.enabled, e.limit_value
     FROM app_users u
     LEFT JOIN plan_entitlements e ON e.plan=u.plan AND e.feature=$2
     WHERE u.id=$1`,
    [userId, feature],
  );
  if (!r.rowCount) return { allowed: false, limit: 0, plan: "unknown" };
  const row = r.rows[0];
  return { allowed: row.enabled !== false, limit: row.limit_value == null ? null : Number(row.limit_value), plan: row.plan };
}

export async function audit(
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
  requestId?: string,
) {
  await initDb().query(
    `INSERT INTO audit_log(id,user_id,action,entity_type,entity_id,request_id,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), userId, action, entityType ?? null, entityId ?? null, requestId ?? null, JSON.stringify(metadata)],
  );
}

export async function reserveIdempotency(
  userId: string,
  scope: string,
  key: string,
  ttlSeconds = 86400,
): Promise<{ replay: boolean; response?: unknown; statusCode?: number }> {
  const clean = key.trim().slice(0, 200);
  if (!clean) return { replay: false };
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000);
  const id = randomUUID();
  const r = await initDb().query(
    `INSERT INTO idempotency_keys(id,user_id,key,scope,expires_at)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(user_id,scope,key)
     DO UPDATE SET key=idempotency_keys.key
     RETURNING status_code,response,created_at,expires_at,id`,
    [id, userId, clean, scope, expires],
  );
  const row = r.rows[0];
  const replay = row.id !== id && new Date(row.expires_at).getTime() > now.getTime();
  return replay
    ? { replay: true, response: row.response, statusCode: Number(row.status_code) }
    : { replay: false };
}

export async function completeIdempotency(
  userId: string,
  scope: string,
  key: string,
  statusCode: number,
  response: unknown,
) {
  await initDb().query(
    `UPDATE idempotency_keys
     SET status_code=$1,response=$2
     WHERE user_id=$3 AND scope=$4 AND key=$5`,
    [statusCode, JSON.stringify(response), userId, scope, key.trim().slice(0, 200)],
  );
}

export async function cleanupIdempotency() {
  await initDb().query("DELETE FROM idempotency_keys WHERE expires_at < now()");
}
