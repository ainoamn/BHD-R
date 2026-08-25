# Operational flow: BHD-OM → BHD-R

**Source of truth (behavior):** `C:\dev\bhd-om` legacy ops (vacant → reserve → deposit → lease → approvals → active).  
**Implementation:** BHD-R Nest API + web ops console (`apps/api`, `apps/web`).

## Hard rules (replicate exactly)

1. Address book first: owners / tenants / users as `parties` + `party_roles`.
2. Property + units linked to owner party from address book.
3. Vacant units only appear for new reservations.
4. Reservation path: vacant unit → tenant from address book → **pending** → accountant confirms deposit → **confirmed** → compliance → lease draft (**in progress**).
5. Lease in progress: rent, grace, other amounts, cheques, e-sign, accountant re-check, multi-party approval → active.
6. Active lease: leave vacant lists; show on owner / property / tenant / accounting.
7. When vacant again: tasks, maintenance, legal, accounts deep-links.

## Status mapping

| OM concept | BHD-R today |
|------------|-------------|
| مسودة/مؤكد حجز | `reservations.status`: `pending` → `confirmed` (accountant deposit) → `converted` |
| ضمان بانتظار المحاسب | `pending` + requirement `deposit_receipt` + `termsSnapshot.depositMinor` |
| عقد قيد الإجراء | `leases.status=draft` + `contracts.status=draft\|sent\|…` |
| ساري | `leases.status=active` + signed contract |
| شاغر | derived: no active hold/reservation/lease/blocking maintenance |

## Phase checklist

| Step | Status |
|------|--------|
| 1 Address book | In progress (contacts roles already; completeness gates added with booking) |
| 2 Property + units + owner | Exists (wizard); polish ongoing |
| 3 Vacant listing | Ops context `vacantUnits` + bookings filter |
| 4 Booking → accountant → lease | **Gate wired in leasing service** |
| 5 Contract amounts / cheques / e-sign / approvals | Partial (e-sign/approval exist; grace/cheque schedule next) |
| 6 Portal reflection | Partial portals; deepen after gate |
| 7 Vacant → tasks/maintenance/legal/accounts | Manual ops today; automation later |

## Deploy note

Web on Vercel needs Nest at `API_INTERNAL_ORIGIN` / `API_ORIGIN` for `/v1/*` ops mutations.
