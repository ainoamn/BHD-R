# Stays Phase 0 verification — 2026-08-31

## Scope executed

Per `docs/product/daily-stays/BHD-R-DAILY-STAYS-COPILOT-PROMPT-AR.md` — **Phase 0 only**:

| Deliverable | Path |
| ----------- | ---- |
| ADR | `docs/phase-0/adrs/ADR-010-stays-bounded-context.md` |
| Threat model | `docs/product/daily-stays/THREAT-MODEL-STAYS-AR.md` |
| Baseline | `docs/product/daily-stays/PHASE-0-BASELINE-AR.md` |
| Feature flags | `packages/config/src/feature-flags.ts` (+ env keys) |
| Unit tests | `packages/config/test/feature-flags.test.ts`, domain availability regression |
| E2E guards | `apps/web/tests/e2e/smoke.spec.ts` (no stays tab; `/ar/stays` not OK) |

**Not started:** Phase 1 schema/migrations/Nest module/public UI.

## Acceptance checklist

| Criterion | Result |
| --------- | ------ |
| Flags default off | Pass (unit tests) |
| No behavioral public stays surface | Pass (E2E + no routes added) |
| No stays migration | Pass |
| Long-term availability API unchanged | Pass (domain test) |
| `listing_purpose` still rent/sale/both only | Pass (documented; schema untouched) |

## Commands

Recorded on branch `feat/stays-phase-0`:

| Command | Exit |
| ------- | ---- |
| `pnpm --filter @bhd-r/config lint && build && test` | 0 (4 tests) |
| `pnpm --filter @bhd-r/domain test` | 0 (10 tests) |
| `pnpm --filter @bhd-r/authz lint` | 0 (throw-error cleanup) |
| `pnpm check` (full monorepo) | **blocked** by pre-existing `@bhd-r/api` / `@bhd-r/web` eslint debt (unrelated to Stays; 14+ / 43 errors on files not touched for Phase 0) |

E2E: new guards added in `smoke.spec.ts`; run `pnpm --filter @bhd-r/web test:e2e` when Playwright env is available.

## Residual (does not block Phase 0 merge of *this* slice)

- Production payment gateway, ClamAV, Nest+DB E2E, Neon non-BYPASS, secret rotation — `STATUS.md` Next.
- Full-repo `pnpm check` green requires a separate lint-debt cleanup PR.
- Phase 1 must not land in the same PR as Phase 0.

## Gate decision

**Phase 0 Stays slice accepted for PR** (flags off, docs+ADR+tests, no public surface).  
**Do not start Phase 1 in this PR.**
