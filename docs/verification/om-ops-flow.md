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

## Step 10 acceptance

1. Tenant with `partyId` sees only their leases/invoices/tickets/payments on overview and list endpoints.
2. Owner with `partyId` (no org-wide staff role) sees only properties where `ownerPartyId` matches.
3. Staff roles (`property_manager`, `organization_admin`, …) keep org-wide metrics.
4. Overview payload may include `scopedToPartyId` when scoped.

## Step 11 acceptance (go-live)

1. Nest container reachable at public HTTPS URL (`/health/ready` OK).
2. Vercel Production has `API_INTERNAL_ORIGIN` = that URL (never localhost).
3. Web `/v1/*` mutations succeed against Neon.

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
| 11 Nest hosting scaffold | (this release) | after push |
