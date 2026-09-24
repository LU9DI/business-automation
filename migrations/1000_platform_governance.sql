CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_created ON audit_log(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  key text NOT NULL,
  scope text NOT NULL,
  status_code integer NOT NULL DEFAULT 200,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_user_scope_key ON idempotency_keys(user_id, scope, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan text NOT NULL,
  feature text NOT NULL,
  limit_value integer,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(plan, feature)
);
INSERT INTO plan_entitlements(plan,feature,limit_value,enabled) VALUES
('free','core',NULL,true),
('free','advanced_analytics',1,true),
('free','automations',5,true),
('pro','core',NULL,true),
('pro','advanced_analytics',NULL,true),
('pro','automations',100,true),
('business','core',NULL,true),
('business','advanced_analytics',NULL,true),
('business','automations',1000,true)
ON CONFLICT(plan,feature) DO NOTHING;