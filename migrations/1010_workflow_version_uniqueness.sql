-- Defense-in-depth: version uniqueness must be enforced by PostgreSQL as well as the workflow-row lock.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'workflow_versions'::regclass
      AND contype = 'u'
      AND conname = 'workflow_versions_workflow_id_version_key'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS workflow_versions_workflow_id_version_idx
      ON workflow_versions(workflow_id, version);
    ALTER TABLE workflow_versions
      ADD CONSTRAINT workflow_versions_workflow_id_version_key
      UNIQUE USING INDEX workflow_versions_workflow_id_version_idx;
  END IF;
END $$;
