import test from "node:test";
import assert from "node:assert/strict";
import { validateWebhookIdempotencyKey } from "../src/domain/webhookIdempotency.js";

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
