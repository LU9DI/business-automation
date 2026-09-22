CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acquisition_leads(
  id uuid PRIMARY KEY,email text,name text,company text,source text NOT NULL,
  country text,language text,score integer,status text NOT NULL DEFAULT 'researched',
  last_contact_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),owner_id text
);

CREATE TABLE IF NOT EXISTS acquisition_content(
  id uuid PRIMARY KEY,channel text NOT NULL,title text NOT NULL,body text NOT NULL,slug text,
  content_hash text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'researched',
  scheduled_at timestamptz,published_at timestamptz,utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id text
);

CREATE TABLE IF NOT EXISTS acquisition_events(
  id uuid PRIMARY KEY,lead_id uuid REFERENCES acquisition_leads(id) ON DELETE SET NULL,
  content_id uuid REFERENCES acquisition_content(id) ON DELETE SET NULL,type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now(),
  owner_id text,idempotency_key text
);

ALTER TABLE acquisition_leads ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE acquisition_content ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE acquisition_events ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE acquisition_events ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS acquisition_leads_owner_idx ON acquisition_leads(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_content_owner_idx ON acquisition_content(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_events_owner_idx ON acquisition_events(owner_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS acquisition_events_owner_idempotency_idx ON acquisition_events(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS acquisition_leads_status_idx ON acquisition_leads(owner_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_content_channel_idx ON acquisition_content(owner_id,channel,status,created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_events_created_idx ON acquisition_events(created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('20260922_acquisition_hardening')
ON CONFLICT (version) DO NOTHING;