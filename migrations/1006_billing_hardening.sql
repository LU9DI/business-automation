-- Billing hardening: enforce domain values and provider event idempotency.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_plan_chk') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_chk CHECK (plan IN ('free','pro','business'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscriptions_status_chk') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_chk CHECK (status IN ('trialing','active','past_due','canceled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_events_provider_event
  ON billing_events(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_period
  ON subscriptions(status,current_period_end);

CREATE INDEX IF NOT EXISTS idx_billing_events_provider
  ON billing_events(provider,event_type,created_at DESC);
