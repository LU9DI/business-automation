CREATE TABLE IF NOT EXISTS sentinel_entities (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('person','company','account','contract','asset','address','vehicle','case','organization')),
  name text NOT NULL,
  external_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_entities_user_idx ON sentinel_entities(user_id, entity_type);
CREATE TABLE IF NOT EXISTS sentinel_edges (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  source_id text NOT NULL REFERENCES sentinel_entities(id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES sentinel_entities(id) ON DELETE CASCADE,
  relation text NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, source_id, target_id, relation)
);
CREATE INDEX IF NOT EXISTS sentinel_edges_user_idx ON sentinel_edges(user_id);
CREATE INDEX IF NOT EXISTS sentinel_edges_source_idx ON sentinel_edges(user_id, source_id);
CREATE INDEX IF NOT EXISTS sentinel_edges_target_idx ON sentinel_edges(user_id, target_id);
CREATE TABLE IF NOT EXISTS sentinel_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  entity_id text REFERENCES sentinel_entities(id) ON DELETE SET NULL,
  amount numeric,
  currency text,
  source text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_events_user_time_idx ON sentinel_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_events_entity_idx ON sentinel_events(user_id, entity_id);
CREATE TABLE IF NOT EXISTS sentinel_alerts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','dismissed','confirmed')),
  title text NOT NULL,
  summary text NOT NULL,
  rationale jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_alerts_user_status_idx ON sentinel_alerts(user_id, status, created_at DESC);
