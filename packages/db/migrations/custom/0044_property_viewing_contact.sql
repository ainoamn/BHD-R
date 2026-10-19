-- Who meets viewing guests at this building (guard / on-site responsible).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS viewing_contact_user_id uuid REFERENCES users(id);

CREATE INDEX IF NOT EXISTS properties_viewing_contact_user_idx
  ON properties (viewing_contact_user_id)
  WHERE viewing_contact_user_id IS NOT NULL;
