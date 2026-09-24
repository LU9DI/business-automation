CREATE TABLE IF NOT EXISTS sentinel_cases (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','closed')),
  purpose text NOT NULL,
  classification text NOT NULL DEFAULT 'restricted',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_cases_user_idx ON sentinel_cases(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sentinel_case_entities (
  case_id text NOT NULL REFERENCES sentinel_cases(id) ON DELETE CASCADE,
  entity_id text NOT NULL REFERENCES sentinel_entities(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'subject_of_analysis',
  PRIMARY KEY(case_id, entity_id)
);

CREATE TABLE IF NOT EXISTS sentinel_audit_log (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  purpose text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_audit_user_time_idx ON sentinel_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_audit_resource_idx ON sentinel_audit_log(user_id, resource_type, resource_id);

CREATE TABLE IF NOT EXISTS sentinel_data_sources (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('public','synthetic','authorized_internal','connector')),
  legal_basis text,
  owner text,
  retention_days integer CHECK (retention_days IS NULL OR retention_days > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_sources_user_idx ON sentinel_data_sources(user_id,status);

CREATE TABLE IF NOT EXISTS sentinel_analysis_runs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  case_id text REFERENCES sentinel_cases(id) ON DELETE SET NULL,
  analysis_type text NOT NULL,
  algorithm_version text NOT NULL,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_review_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_analysis_runs_user_idx ON sentinel_analysis_runs(user_id, created_at DESC);
