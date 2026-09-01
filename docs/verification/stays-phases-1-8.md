# Stays Phases 1–8 — verification (build train)

**Branch:** `feat/stays-build` → merge to `main`  
**Date:** 2026-08-31  
**Flags:** `STAYS_PLATFORM_ENABLED` default **off** — public and portal stays surfaces stay dark until explicitly enabled.

## 0.4.19 setup + publish

- `GET /v1/stays/setup/context?propertyId=` — property units + existing profiles/listings.
- `POST /v1/stays/setup/profiles` + rate-plan + listing + `POST .../publish` — full onboarding path.
- Wizard at `/owner|developer/stays/setup?propertyId=` writes via Nest (no Neon fallback).
- Publish triggers inline `stay_inventory_days` rebuild + outbox `stay.inventory.changed`.

## What shipped in this train

| Phase | Delivered | Live with flag off? |
| ----- | --------- | ------------------- |
| 0 | ADR, threat model, flags, baseline | n/a (docs) |
| 1 | `0015_stays_*` SQL + Drizzle + domain + contracts + authz | schema additive only |
| 2 | Nest `StaysModule` (public + ops) fail-closed | 404 when flag off |
| 3 | Owner/developer stays nav + shells + setup wizard | nav hidden when flag off |
| 4 | `/[locale]/stays` + slug + homepage tab | `notFound` / no tab when flag off |
| 5 | Booking service + guest `/guest/stays` shell | gated |
| 6–7 | Folio tables in 0015; worker job stubs | no auto jobs until wired |
| 8 | Channel sync blocked stub (SSRF gate); **export ICS 0.4.11** | import not enabled |

## Commands (scoped)

| Command | Result |
| ------- | ------ |
| `pnpm --filter @bhd-r/domain test` | 17 passed |
| `pnpm --filter @bhd-r/config test` | 5 passed |
| `pnpm --filter @bhd-r/db typecheck` | 0 |
| `pnpm --filter @bhd-r/api typecheck` | 0 |
| `pnpm --filter @bhd-r/web typecheck` | 0 |

## Production enablement (human)

1. Run Neon migrate (`0015_stays_core` + `0015_stays_rls`).
2. Redeploy Nest (Render) to pick up `StaysModule`.
3. Keep `STAYS_PLATFORM_ENABLED=false` until a pilot org is allow-listed.
4. Payment kind `stay_booking` is wired in Nest Finance webhook (0.4.1); provider pilot still human/infra.
5. Inventory projector + housekeeping on checkout shipped in **0.4.2** (worker gated by flag).

## Honest gaps (continue Expand–Contract)

- iCal/OTA **import** after SSRF controls (read-only export shipped 0.4.11).
- Non-sandbox live PSP adapter for stay intents.
- Ops booking detail actions beyond checkout (cancel/no-show UI).
- Full-repo `pnpm check` still has unrelated ESLint debt in api/web.

## 0.4.9 ops bookings list

- `GET /v1/stays/bookings` returns org-scoped rows (not an empty stub).
- Unauthenticated → 401/404 while flag off.

## 0.4.8 stay payment redirect

- Flag off → `POST /v1/public/stays/payment-sessions` **404**.
- Flag on + sandbox → redirect to `/payments/sandbox/:ref`; complete confirms stay booking.

## 0.4.7 Occupancy / ADR / RevPAR

- Domain `computeStayPerformanceMetrics`; ops `GET /v1/stays/reports/performance`.
- Flag off → 401/404; flag on → KPIs from sellable inventory days + confirmed bookings.

## 0.4.6 guest trips

- Flag off → public lookup **404**; guest list without session **401** (or 404 if gated first).
- Flag on → lookup by `referenceCode`; claim links `user_id`; list/detail scoped to claimant.

## 0.4.5 guest checkout UI

- Detail page runs availability → quote → hold → booking through `/api/backend`.
- Flag/surface off → public `/stays` stays dark; Nest POSTs still 404.

## 0.4.4 quote → hold → pay

- Flag off → `POST .../quotes`, `POST .../holds`, `POST .../bookings`, `GET .../availability` return **404**.
- Flag on → quote prices via `quoteStay`; hold takes GiST lock; booking creates folio + `stay_payment_intents`; confirm via webhook `stay_booking`.

## 0.4.3 public search

- Flag off → `GET /v1/public/stays/search` returns **404**.
- Flag on → results from published listings whose units are fully `available` on `stay_inventory_days` for the requested half-open range; Redis cache TTL 45s when `REDIS_URL` is set.

## 0.4.1 lock verify

```bash
STAYS_LOCK_DATABASE_URL="$DATABASE_URL" pnpm --filter @bhd-r/db exec vitest run test/stay-inventory-locks.integration.test.ts
```

## Nest probe (0.4.2)

```bash
node scripts/verify-nest-health.mjs
# StaysModule live if:
curl -s https://bhd-r.onrender.com/v1/stays/inventory/health
# → 401 Authentication required (not 404)
```
