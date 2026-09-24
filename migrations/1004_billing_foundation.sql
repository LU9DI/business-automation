CREATE TABLE IF NOT EXISTS subscriptions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 plan text NOT NULL DEFAULT 'free',
 status text NOT NULL DEFAULT 'trialing',
 trial_ends_at timestamptz,
 current_period_start timestamptz NOT NULL DEFAULT now(),
 current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 provider text,
 provider_subscription_id text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id)
);
CREATE TABLE IF NOT EXISTS billing_events (
 id uuid PRIMARY KEY,
 user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
 event_type text NOT NULL,
 from_plan text,
 to_plan text,
 provider text,
 provider_event_id text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user_created ON billing_events(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS plan_change_audits (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
 from_plan text,
 to_plan text NOT NULL,
 reason text NOT NULL,
 effective_at timestamptz NOT NULL DEFAULT now(),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_plan_change_audits_user ON plan_change_audits(user_id,effective_at DESC);
