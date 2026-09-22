ALTER TABLE acquisition_content DROP CONSTRAINT IF EXISTS acquisition_content_content_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS acquisition_content_owner_hash_idx
  ON acquisition_content(owner_id, content_hash)
  WHERE owner_id IS NOT NULL;