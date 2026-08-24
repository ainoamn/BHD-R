# Phase 0 plan — baseline audit

## Goal

Establish an honest, evidence-based baseline before any further enterprise build work. Do not treat `V1-COMPLETION-REPORT-AR.md` as proof without matching routes, schema, and tests.

## Inputs

1. `docs/legacy-reviews/BHD-OM-operational-workflows-deep-review-ar.md`
2. `docs/product/CURSOR-BHD-R-enterprise-build-command-ar.md`
3. Live code: `apps/api`, `apps/web`, `apps/worker`, `packages/*`
4. Migrations `0000`–`0007` + `custom/0001_rls.sql`

## Deliverables

| Artifact                              | Purpose                          |
| ------------------------------------- | -------------------------------- |
| `docs/implementation/GAP-REGISTER.md` | Required vs actual with statuses |
| `docs/implementation/STATUS.md`       | Current phase board              |
| `docs/implementation/phase-0-plan.md` | This plan                        |
| `docs/verification/phase-0.md`        | Command results + counts         |
| `docs/verification/_baseline-logs/*`  | Raw command logs                 |

## Work items

1. Inventory controllers → permission classification (route-policy test must remain fail-closed).
2. Inventory schema `organization_id` + RLS coverage.
3. Map OM §19 journeys to BHD R evidence.
4. Run verification gate; fix only Phase-0 blockers (format/lint/type/test/build/e2e) before Phase 1 feature work.
5. Record residual `partial`/`missing` owners by phase number.

## Acceptance

- GAP register lists every major capability with status ≠ unknown.
- Baseline gate results recorded (pass or fail with fix commits).
- Phase 1 not started for new features until format/verify/lint/typecheck/test/build are green; e2e/DB noted if environment-limited.
