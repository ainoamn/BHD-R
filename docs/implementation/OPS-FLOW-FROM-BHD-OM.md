# Operational flow: BHD-OM → BHD-R

**Source of truth (behavior):** `C:\dev\bhd-om` legacy ops (vacant → reserve → deposit → lease → approvals → active).  
**Implementation:** BHD-R Nest API + web ops console (`apps/api`, `apps/web`).  
**Updated:** 2026-08-25

## Hard rules (replicate exactly)

1. Address book first: owners / tenants / users as `parties` + `party_roles`.
2. Property + units linked to owner party from address book.
3. Vacant units only appear for new reservations.
4. Reservation path: vacant unit → tenant from address book → **pending** → accountant confirms deposit → **confirmed** → compliance → lease draft (**in progress**).
5. Lease in progress: rent, grace, other amounts, cheques, e-sign, accountant re-check, multi-party approval → active.
6. Active lease: leave vacant lists; show on owner / property / tenant / accounting.
7. When vacant again: tasks, maintenance, legal, accounts deep-links.
8. Accountant deposit confirm posts ledger journal (cash/bank ↔ tenant deposits liability).
9. Lease end/terminate auto-seeds a vacancy follow-up task (checklist for inspection / maintenance / legal / accounts).

## Status mapping

| OM concept | BHD-R today |
|------------|-------------|
| مسودة/مؤكد حجز | `reservations.status`: `pending` → `confirmed` (accountant deposit) → `converted` |
| ضمان بانتظار المحاسب | `pending` + requirement `deposit_receipt` + `termsSnapshot.depositMinor` |
| قيد عربون تلقائي | `journal_entries` `source_type=reservation_deposit` Dr `1000` / Cr `2100` (idempotent) |
| عقد قيد الإجراء | `leases.status=draft` + `contracts.status=draft\|sent\|…` |
| ساري | `leases.status=active` + signed contract |
| شاغر | derived: no active hold/reservation/lease/blocking maintenance |
| مهمة شغور تلقائية | `work_tasks` `related_type=lease_vacancy` + `related_id=leaseId` on end/terminate |

## Phase checklist

| Step | Status |
|------|--------|
| 1 Address book | In progress (contacts roles already; completeness gates added with booking) |
| 2 Property + units + owner | Exists (wizard); polish ongoing |
| 3 Vacant listing | Ops context `vacantUnits` + bookings filter |
| 4 Booking → accountant → lease | **Gate wired in leasing service** |
| 5 Contract amounts / cheques / e-sign / approvals | **Wired** — grace, cheque schedule, multi-stage approval chain, cheque gate before send/activate |
| 6 Portal reflection | **Wired** — tenant-scoped leases/contracts; leasing defaults to `active`; owner/tenant overview quick links; accounting shows lease invoices + cheques |
| 7 Vacant → tasks/maintenance/legal/accounts | **Wired** — vacant strip deep-links `?create=1&unitId=` into bookings/tasks/maintenance/legal/accounting forms |
| 8 Deposit confirm → auto journal | **Wired** — `FinanceService.postReservationDepositJournal` on reservation confirm; skip if depositMinor is 0/null |
| 9 Lease end → vacancy task | **Wired** — idempotent `work_tasks` with vacancy checklist on `end` / `terminate` |

## Next (step 10+)

1. Host Nest API publicly and set `API_INTERNAL_ORIGIN` on Vercel (infra).
2. Party-scoped portal overview metrics.
3. Optional: auto-open maintenance ticket / legal case from vacancy checklist.

## Deploy note

Web on Vercel needs Nest at `API_INTERNAL_ORIGIN` / `API_ORIGIN` for `/v1/*` ops mutations. Steps 8–9 live in Nest; they take effect when the API process runs against Neon.
