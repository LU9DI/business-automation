import test from "node:test";
import assert from "node:assert/strict";
import { validateWebhookIdempotencyKey, validateWebhookActiveUpdate } from "../src/domain/webhookIdempotency.js";

test("accepts and trims idempotency keys up to 200 characters", () => {
  assert.deepEqual(validateWebhookIdempotencyKey("  request-123  "), { valid: true, key: "request-123" });
  assert.equal(validateWebhookIdempotencyKey("x".repeat(200)).valid, true);
});

test("rejects oversized idempotency keys instead of truncating them", () => {
  assert.deepEqual(validateWebhookIdempotencyKey("x".repeat(201)), { valid: false });
});

test("treats missing or whitespace-only idempotency keys as absent", () => {
  assert.deepEqual(validateWebhookIdempotencyKey(undefined), { valid: true });
  assert.deepEqual(validateWebhookIdempotencyKey("   "), { valid: true });
});


test("webhook active updates accept booleans only", () => {
  assert.deepEqual(validateWebhookActiveUpdate(true), { valid: true, active: true });
  assert.deepEqual(validateWebhookActiveUpdate(false), { valid: true, active: false });
  for (const value of ["false", "true", 0, 1, null, undefined, {}, []]) {
    assert.deepEqual(validateWebhookActiveUpdate(value), { valid: false });
  }
});
