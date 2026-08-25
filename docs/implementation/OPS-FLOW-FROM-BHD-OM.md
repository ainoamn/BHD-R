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
10. Portal metrics and lists are party-scoped (owner portfolio / tenant leases) unless the actor has org-wide staff roles.
11. Nest API is hosted publicly; Vercel `API_INTERNAL_ORIGIN` points at it.
12. Ops leasing UI exposes activate / end / terminate (end/terminate seeds vacancy task).
13. Lease end/terminate also auto-opens maintenance (`vacancy_handover`) and legal assessment (`vacancy_deposit_review`).
14. Lease end/terminate seeds accounts expense `vacancy_settlement` (idempotent reference).
15. Ops console warns when Nest is missing/unreachable on Vercel.

## Status mapping

| OM concept | BHD-R today |
|------------|-------------|
| مسودة/مؤكد حجز | `reservations.status`: `pending` → `confirmed` (accountant deposit) → `converted` |
| ضمان بانتظار المحاسب | `pending` + requirement `deposit_receipt` + `termsSnapshot.depositMinor` |
| قيد عربون تلقائي | `journal_entries` `source_type=reservation_deposit` Dr `1000` / Cr `2100` (idempotent) |
| عقد قيد الإجراء | `leases.status=draft` + `contracts.status=draft\|sent\|…` |
| ساري | `leases.status=active` + signed contract |
| شاغر | derived: no active hold/reservation/lease/blocking maintenance |
| مهمة شغور تلقائية | `work_tasks` `related_type=lease_vacancy` |
| صيانة/محاماة/حسابات شغور | maintenance `vacancy_handover` + legal `vacancy_deposit_review` + expense `vacancy_settlement` |
| بوابة حسب الطرف | `PortalsService` scopes by `ownerPartyId` / `tenantPartyId` |

## Phase checklist

| Step | Status |
|------|--------|
| 1–7 | **Wired** (see earlier commits) |
| 8 Deposit confirm → auto journal | **Wired** |
| 9 Lease end → vacancy task | **Wired** |
| 10 Party-scoped portal metrics | **Wired** |
| 11 Nest API public host | **Scaffolded** — `NEST-API-HOSTING.md` + `VERCEL-MANUAL-AR.md` |
| 12 Lease lifecycle ops actions | **Wired** |
| 13 Vacancy → maintenance + legal | **Wired** |
| 14 Vacancy → accounts expense | **Wired** |
| 15 Ops Nest-missing banner | **Wired** |

## Deploy note

Web on Vercel needs Nest at `API_INTERNAL_ORIGIN` / `API_ORIGIN`. Manual steps: `docs/implementation/VERCEL-MANUAL-AR.md`.
