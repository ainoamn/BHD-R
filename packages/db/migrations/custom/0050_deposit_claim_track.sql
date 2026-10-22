-- Property complaint → appeal → site complaint track kinds.

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
