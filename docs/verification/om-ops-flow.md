# Verification — OM ops flow (BHD-OM → BHD-R)

**Date:** 2026-08-25  
**Web:** Vercel project `bhd-r-api` / aliases `https://r.bhd-om.com`  
**API:** Nest must be reachable via `API_INTERNAL_ORIGIN` for live `/v1/*` mutations

## Steps

| # | Rule | Code / UI proof | Status |
|---|------|-----------------|--------|
| 1 | Address book | Ops `contacts` + party roles; booking rejects incomplete tenant | Wired |
| 2 | Property + units + owner | Owner/developer property wizard; owner party provisioning for SSO | Wired |
| 3 | Vacant listing | `GET /v1/operations/context` → `vacantUnits` | Wired |
| 4 | Vacant → pending → accountant → confirmed → lease | Reservation `pending` → accountant `confirmed` → convert | Wired |
| 5 | Lease in progress | Grace, cheques, multi-approval, e-sign, activate | Wired |
| 6 | Active lease on portals | Leasing default `active`; overview quick links; accounting cheques/invoices | Wired |
| 7 | Vacant again → ops deep-links | Vacant strip `?create=1&unitId=` | Wired |
| 8 | Deposit confirm → ledger | `postReservationDepositJournal` Dr 1000 / Cr 2100 | Wired |
| 9 | Lease end → vacancy task | `work_tasks` `related_type=lease_vacancy` | Wired |
| 10 | Party-scoped portal metrics | `PortalsService` owner/tenant scope by `partyId` | Wired |
| 11 | Nest API public host | `render.yaml` + `NEST-API-HOSTING.md` scaffold; go-live needs secrets | Scaffolded |
| 12 | Lease lifecycle ops UI | Activate / End / Terminate buttons on leasing console | Wired |
| 13 | Vacancy → maintenance + legal | Auto `vacancy_handover` ticket + `vacancy_deposit_review` legal case | Wired |
| 14 | Vacancy → accounts expense | Auto expense `vacancy_settlement` (`EXP-VAC-…`) | Wired |
| 15 | Ops Nest-missing banner | Banner when `API_*` unset or context fails | Wired |
| 16 | Deposit confirm in bookings UI | Pending row: Confirm deposit; confirmed: convert + ledger links | Wired |
| 17 | Vacancy follow-up pipeline | `vacancyFollowUps` in ops context + pipeline strip | Wired |
| 18 | Prefill lease from reservation | `leasing?create=1&reservationId&unitId&tenantId` + form defaults | Wired |
| 19 | Pending deposit queue | Bookings strip lists pending deposits with confirm action | Wired |

## Step 10 acceptance

1. Tenant with `partyId` sees only their leases/invoices/tickets/payments on overview and list endpoints.
2. Owner with `partyId` (no org-wide staff role) sees only properties where `ownerPartyId` matches.
3. Staff roles (`property_manager`, `organization_admin`, …) keep org-wide metrics.
4. Overview payload may include `scopedToPartyId` when scoped.

## Step 11 acceptance (go-live)

1. Nest container reachable at public HTTPS URL (`/health/ready` OK).
2. Vercel Production has `API_INTERNAL_ORIGIN` = that URL (never localhost).
3. Web `/v1/*` mutations succeed against Neon.

## Step 12 acceptance

1. Draft lease row shows **Activate**.
2. Active lease row shows **Renew**, **End**, and **Terminate**.
3. End/Terminate calls `PATCH /v1/leasing/leases/:id` with `action` and seeds vacancy task (step 9).

## Step 13 acceptance

1. End/terminate creates (if missing) an open maintenance ticket `category=vacancy_handover` for the unit.
2. End/terminate creates (if missing) a legal case `caseType=vacancy_deposit_review` linked to the lease.
3. Together with step 9 task, covers tasks / maintenance / legal for vacant-again flow.

## Step 14 acceptance

1. End/terminate creates expense `reference=EXP-VAC-…`, `category=vacancy_settlement` once.
2. Amount uses deposit when > 0, else 1 minor unit placeholder with notes to adjust.

## Step 15 acceptance

1. Ops pages show a banner if `API_INTERNAL_ORIGIN`/`API_ORIGIN` unset on the web runtime.
2. Banner also appears when Nest context fetch fails.

## Production blockers

- Nest API not yet live on a public host (scaffold only until secrets/DNS applied).
- Neon password previously exposed in chat → rotate.

## Deploy cadence

After each OM step: commit → `git push origin main` → Vercel Production deploy → update docs.

| Step | Commit | Vercel |
|------|--------|--------|
| 8 Deposit journal | `f27f2de` | Ready |
| 9 Vacancy task | `0a4c297` | Ready |
| 10 Party-scoped portals | `8edaf35` | Ready |
| 11 Nest hosting scaffold | `6b4dc32` | Ready |
| 12 Lease lifecycle UI | `ad27d7d` | Ready |
| 13 Vacancy maint+legal | `d5403cf` | Ready |
| 14–15 Accounts + API banner | `777bc4b` | Ready |
| 16–17 Deposit UI + vacancy pipeline | `09cd3d2` | Ready |
| 18–19 Prefill lease + deposit queue | `bff75a7` | Ready |

## Cycle rules v1.1 (coded — apply migration 0011)

Source of truth: `docs/implementation/TRANSACTION-FLOW-MAP.md` (+ HTML) **v1.2**.

| ID | Rule | Code status |
|----|------|-------------|
| R1 | Cancel request → admin date → accountant clearance → tenant sees cancelled | Coded (`cancel_requested` / `clearance_pending` / `cancelled`) |
| R2 | Deposit settlement tied on every exit path | Partial (vacancy follow-ups on clear) |
| R3 | Renewal: signed addendum → cheques + invoices → accountant (manager exception) | Coded (pending terms + confirm/waive) |
| R4 | `closed_won` → in-system ownership transfer + prior owner history | Coded |
| R5 | Sale of leased unit allowed; lease rights follow new owner | Coded |
