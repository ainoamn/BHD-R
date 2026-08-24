# Phase 1 plan — identity, isolation, horizontal security residuals

## Residuals from GAP register

| ID  | Work                                                                                      |
| --- | ----------------------------------------------------------------------------------------- |
| F18 | TOTP recovery codes (hashed, single-use, issued once on confirm)                          |
| F04 | `can(actor, action, resource, tenantContext)` in `@bhd-r/authz`                           |
| F20 | Encryption backfill — deferred to worker job design in phase-1-followup if gate timeboxed |

## Implementation

1. Migration `0008_totp_recovery`: `users.totp_recovery_digests jsonb`.
2. `packages/security` recovery helpers + unit tests.
3. Auth confirm returns plaintext codes once; login accepts recovery OR TOTP; consume is atomic.
4. `can()` tenant-aware wrapper over `hasPermission`.

## Acceptance

- Unit tests for recovery consume/replay.
- `pnpm lint|typecheck|test|build` green for changed packages.
- GAP F18/F04 → complete; F20 remains partial until resumable backfill job lands.
