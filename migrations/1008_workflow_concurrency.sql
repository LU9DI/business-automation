CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_active_run
  ON workflow_runs(workflow_id)
  WHERE status IN ('running','queued');
