-- Deposit claim workflow: owner triage -> accountant; request numbers; staff-only notes.

ALTER TABLE stay_deposit_claims ADD COLUMN IF NOT EXISTS reference_code varchar(40);
ALTER TABLE stay_deposit_claims ADD COLUMN IF NOT EXISTS owner_internal_note text;
ALTER TABLE stay_deposit_claims ADD COLUMN IF NOT EXISTS accountant_internal_note text;
ALTER TABLE stay_deposit_claims ADD COLUMN IF NOT EXISTS referred_at timestamptz;
ALTER TABLE stay_deposit_claims ADD COLUMN IF NOT EXISTS referred_by_name varchar(160);

UPDATE stay_deposit_claims c
SET reference_code = 'DC-' || upper(left(b.reference_code, 24)) || '-' ||
  lpad((
    select count(*)::text
    from stay_deposit_claims x
    where x.booking_id = c.booking_id
      and x.created_at <= c.created_at
  ), 2, '0')
FROM stay_bookings b
WHERE b.id = c.booking_id
  AND (c.reference_code IS NULL OR c.reference_code = '');

ALTER TABLE stay_deposit_claims DROP CONSTRAINT IF EXISTS stay_deposit_claims_status_check;
ALTER TABLE stay_deposit_claims
  ADD CONSTRAINT stay_deposit_claims_status_check
  CHECK (status IN ('open', 'with_accountant', 'accepted', 'rejected', 'escalated', 'resolved'));

ALTER TABLE stay_deposit_claims DROP CONSTRAINT IF EXISTS stay_deposit_claims_response_check;
ALTER TABLE stay_deposit_claims
  ADD CONSTRAINT stay_deposit_claims_response_check
  CHECK (
    response IS NULL
    OR response IN ('accepted', 'rejected', 'referred')
  );

CREATE UNIQUE INDEX IF NOT EXISTS stay_deposit_claims_reference_uidx
  ON stay_deposit_claims (organization_id, reference_code)
  WHERE reference_code IS NOT NULL;
