CREATE UNIQUE INDEX IF NOT EXISTS acquisition_leads_owner_email_idx
  ON acquisition_leads(owner_id,email)
  WHERE owner_id IS NOT NULL AND email IS NOT NULL;