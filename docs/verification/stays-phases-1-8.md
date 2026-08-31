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
4. Payment kind `stay_booking` still needs provider wiring before real money.

## Honest gaps (continue Expand–Contract)

- Full quote/hold/pay E2E and concurrent DB lock test against real Postgres.
- Inventory-day projector cron registration in worker main.
- Housekeeping task auto-create on checkout.
- Reports Occupancy/ADR/RevPAR UI.
- iCal/OTA after SSRF controls.
- Full-repo `pnpm check` still has unrelated ESLint debt in api/web.
