ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash text;
CREATE INDEX IF NOT EXISTS idx_idempotency_completed ON idempotency_keys(completed_at);