# Phase 1 verification — 2026-08-24 (complete)

## Landed

- TOTP hashed recovery codes (`0008`) + login consume
- `can()` policy helper
- **Encryption backfill (F20):**
  - `tryRotateEncryptedField` + metrics in `@bhd-r/security`
  - Worker processor `apps/worker/src/encryption/backfill.ts` (resumable batches, `FOR UPDATE SKIP LOCKED`)
  - Topic `encryption.backfill` auto-continues via domain queue
  - Platform API `POST /v1/platform/encryption/backfill` (`platform.settings.write`)
- Domain state machines in `@bhd-r/domain` (reservation/contract/journal/maintenance)

## Commands

| Command                                 | Result    |
| --------------------------------------- | --------- |
| `pnpm --filter @bhd-r/security test`    | 9 passed  |
| `pnpm --filter @bhd-r/domain test`      | 5 passed  |
| `pnpm --filter @bhd-r/api typecheck`    | 0         |
| `pnpm --filter @bhd-r/worker typecheck` | 0         |
| `pnpm --filter @bhd-r/api test`         | 13 passed |

## Ops note

After deploying worker+API, rotate `FIELD_ENCRYPTION_ACTIVE_VERSION` only after new key env vars exist, then enqueue backfill per target. Dual-read remains via existing decrypt of older `v` envelopes.
