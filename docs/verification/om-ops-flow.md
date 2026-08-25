# Verification — OM ops flow (BHD-OM → BHD-R)

**Date:** 2026-08-25  
**Web:** Vercel project `bhd-r-api` / aliases `https://r.bhd-om.com`  
**API:** Nest must be reachable via `API_INTERNAL_ORIGIN` for live `/v1/*` mutations

## Steps

| # | Rule | Code / UI proof | Status |
|---|------|-----------------|--------|
| 1 | Address book | Ops `contacts` + party roles; booking rejects incomplete tenant (email/phone/address/id) | Wired |
| 2 | Property + units + owner | Owner/developer property wizard; owner party provisioning for SSO | Wired |
| 3 | Vacant listing | `GET /v1/operations/context` → `vacantUnits` | Wired |
| 4 | Vacant → pending → accountant → confirmed → lease | Reservation creates `pending`; accountant PATCH → `confirmed`; convert requires confirmed + requirements | Wired |
| 5 | Lease in progress: grace, cheques, multi-approval, e-sign, activate | `createLeaseSchema` + approval chain + cheque gate on send/activate | Wired |
| 6 | Active lease on portals | Tenant-scoped leases/contracts; leasing filter default `active`; overview quick links; accounting secondary cheques/invoices | Wired |
| 7 | Vacant again → tasks/maintenance/legal/accounts | Vacant strip deep-links `?create=1&unitId=` | Wired |
| 8 | Deposit confirm → ledger | `FinanceService.postReservationDepositJournal` Dr 1000 / Cr 2100, `source_type=reservation_deposit`, idempotent | Wired |
| 9 | Lease end → vacancy task | `updateLease` end/terminate inserts `work_tasks` (`related_type=lease_vacancy`) with checklist; idempotent | Wired |

## Step 8 acceptance

1. Confirm pending reservation with `termsSnapshot.depositMinor > 0` → one posted journal (`source_type=reservation_deposit`, `source_id=reservationId`).
2. Retry / re-entry is idempotent (unique org+source lookup).
3. Zero/null deposit → confirm succeeds, no journal.
4. `termsSnapshot.depositJournalEntryId` set when journal created.
5. Journal appears under accounting journals list when Nest is live.

## Step 9 acceptance

1. `PATCH` lease `action=end` (from `active`) or `terminate` creates one vacancy task for that lease/unit.
2. Re-running end/terminate path does not duplicate the task (`related_type` + `related_id`).
3. Checklist covers inspection, maintenance, legal/deposit, accounts.
4. Unit reappears in `vacantUnits` (ended/terminated leases are not blockers).
5. Task visible under ops Tasks when Nest is live.

## Production blockers

- Nest API not hosted on the Vercel web project; set `API_INTERNAL_ORIGIN` to a public HTTPS Nest URL.
- Neon password previously exposed in chat → rotate.

## Deploy cadence

After each OM step: commit → `git push origin main` → Vercel Production deploy → update this file + `OPS-FLOW-FROM-BHD-OM.md` + `STATUS.md`.

| Step | Commit | Vercel |
|------|--------|--------|
| 8 Deposit journal | `f27f2de` | Ready |
| 9 Vacancy task | `0a4c297` | Ready |
