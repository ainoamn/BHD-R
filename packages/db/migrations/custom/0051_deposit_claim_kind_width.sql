-- property_complaint is 18 chars; kind was varchar(16) and blocked track complaints.

ALTER TABLE stay_deposit_claims
  ALTER COLUMN kind TYPE varchar(32);

ALTER TABLE stay_deposit_claims DROP CONSTRAINT IF EXISTS stay_deposit_claims_kind_check;
ALTER TABLE stay_deposit_claims
  ADD CONSTRAINT stay_deposit_claims_kind_check
  CHECK (
    kind IN (
      'not_received',
      'deduction',
      'other',
      'property_complaint',
      'appeal',
      'site_complaint'
    )
  );
