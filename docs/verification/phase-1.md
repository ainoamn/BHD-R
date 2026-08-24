# Phase 1 verification (partial) — 2026-08-24

## Landed

- Migration `0008_totp_recovery`
- `packages/security` recovery helpers + unit test
- Auth confirm returns one-time plaintext recovery codes; login consumes hashed digest atomically
- `can()` in `@bhd-r/authz`

## Commands

| Command                              | Result    |
| ------------------------------------ | --------- |
| `pnpm --filter @bhd-r/security test` | 8 passed  |
| `pnpm --filter @bhd-r/api typecheck` | 0         |
| `pnpm --filter @bhd-r/api test`      | 13 passed |
| `pnpm format:check`                  | 0         |

## Remaining Phase 1

- F20 encryption resumable backfill job + metrics
- Full monorepo `pnpm test` / `pnpm test:e2e` after this commit
