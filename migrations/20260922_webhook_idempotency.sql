ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_webhook_idempotency_idx
  ON workflow_runs(workflow_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;