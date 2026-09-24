ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS workflow_version_id uuid;
ALTER TABLE execution_attempts ADD COLUMN IF NOT EXISTS workflow_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workflow_runs_workflow_version_id_fkey') THEN
    ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_workflow_version_id_fkey
      FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='execution_attempts_workflow_version_id_fkey') THEN
    ALTER TABLE execution_attempts ADD CONSTRAINT execution_attempts_workflow_version_id_fkey
      FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_version ON workflow_runs(workflow_version_id);
CREATE INDEX IF NOT EXISTS idx_execution_attempts_version ON execution_attempts(workflow_version_id);
