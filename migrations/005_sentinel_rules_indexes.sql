CREATE TABLE IF NOT EXISTS sentinel_rules (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  kind text NOT NULL CHECK (kind IN ('degree_threshold','event_frequency','amount_threshold','temporal_burst','shared_attribute')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sentinel_entities_user_id_idx ON sentinel_entities(user_id,id);
CREATE INDEX IF NOT EXISTS sentinel_edges_user_source_idx ON sentinel_edges(user_id,source_id);
CREATE INDEX IF NOT EXISTS sentinel_edges_user_target_idx ON sentinel_edges(user_id,target_id);
CREATE INDEX IF NOT EXISTS sentinel_edges_user_pair_idx ON sentinel_edges(user_id,source_id,target_id);
CREATE INDEX IF NOT EXISTS sentinel_events_user_entity_time_idx ON sentinel_events(user_id,entity_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_alerts_user_status_time_idx ON sentinel_alerts(user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_case_entities_case_entity_idx ON sentinel_case_entities(case_id,entity_id);
CREATE INDEX IF NOT EXISTS sentinel_audit_user_time_idx ON sentinel_audit_log(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_analysis_runs_user_case_time_idx ON sentinel_analysis_runs(user_id,case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_rules_user_enabled_idx ON sentinel_rules(user_id,enabled,created_at DESC);
