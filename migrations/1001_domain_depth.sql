CREATE TABLE IF NOT EXISTS workflow_versions (
 id uuid PRIMARY KEY, workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
 version integer NOT NULL, definition jsonb NOT NULL, created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workflow_id,version)
);
CREATE TABLE IF NOT EXISTS execution_attempts (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
 attempt integer NOT NULL, status text NOT NULL, error text, started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_execution_attempts_run ON execution_attempts(run_id,attempt);