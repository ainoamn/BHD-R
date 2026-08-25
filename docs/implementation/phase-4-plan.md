# Phase 4 plan — CRM, viewing, booking concurrency, cheques

## Requirements (build command §9)

Close gaps on Lead / RentalApplication / Cheque entities, reservation price snapshot, one-active booking uniqueness, and concurrency proof.

## Implementation

1. Migration `0010_crm_cheques_concurrency`: `leads`, `rental_applications`, `cheques`; reservation `rent_minor`/`currency`/`terms_snapshot`; unique partial indexes for one active hold/reservation per unit.
2. Domain machines: `viewingMachine`, `leadMachine`, `chequeMachine`.
3. Finance APIs: list/create/review cheques with `cheque.*` + `finance.booking_payment.confirm` permissions.
4. Reservation create snapshots unit rent/currency/terms.
5. Concurrency model unit test (50 contenders → 1 winner) + advisory lock already in leasing.
6. Responsive shell: tablet/phone portal drawer at 960px, ops panel padding, metrics articles, overflow e2e.

## Acceptance

- Schema + RLS list include new tables.
- Cheque review rejects illegal status jumps.
- Verification gate green; `docs/verification/phase-4.md` recorded.
