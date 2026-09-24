CREATE TABLE IF NOT EXISTS sentinel_imports (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  source_name text NOT NULL,
  format text NOT NULL CHECK (format IN ('json','csv')),
  synthetic boolean NOT NULL DEFAULT true,
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','rejected','partial')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_imports_user_idx ON sentinel_imports(user_id,created_at DESC);
