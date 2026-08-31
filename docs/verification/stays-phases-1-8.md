# Stays Phases 1–8 — verification (build train)

**Branch:** `feat/stays-build` → merge to `main`  
**Date:** 2026-08-31  
**Flags:** `STAYS_PLATFORM_ENABLED` default **off** — public and portal stays surfaces stay dark until explicitly enabled.

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
| 8 | Channel sync blocked stub (SSRF gate) | not enabled |

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

- Guest interactive checkout UI (Nest quote/hold/pay intent shipped in **0.4.4**; flag-off 404).
- Reports Occupancy/ADR/RevPAR UI for stays.
- iCal/OTA after SSRF controls.
- Full-repo `pnpm check` still has unrelated ESLint debt in api/web.

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
