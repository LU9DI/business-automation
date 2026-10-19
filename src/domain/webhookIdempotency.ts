export type WebhookIdempotencyKeyResult =
  | { valid: true; key?: string }
  | { valid: false };

export function validateWebhookIdempotencyKey(raw: string | undefined): WebhookIdempotencyKeyResult {
  const key = (raw ?? "").trim();
  if (key.length > 200) return { valid: false };
  return key ? { valid: true, key } : { valid: true };
}
