-- Enforce tenant ownership across parent/child workflow relations at the database layer.
-- Existing application-level user_id filters remain defense in depth.

CREATE UNIQUE INDEX IF NOT EXISTS workflows_id_user_id_uidx
  ON workflows(id, user_id);

ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_workflow_user_fk;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_workflow_user_fk
  FOREIGN KEY (workflow_id, user_id)
  REFERENCES workflows(id, user_id)
  ON DELETE CASCADE;

ALTER TABLE workflow_webhooks
  DROP CONSTRAINT IF EXISTS workflow_webhooks_workflow_user_fk;

ALTER TABLE workflow_webhooks
  ADD CONSTRAINT workflow_webhooks_workflow_user_fk
  FOREIGN KEY (workflow_id, user_id)
  REFERENCES workflows(id, user_id)
  ON DELETE CASCADE;
