# Phase 2 verification — 2026-08-24 (complete)

**Product version:** 0.2.3

## Landed

- Plan entitlements catalog (`starter` / `growth` / `enterprise`) in `@bhd-r/domain`
- Server enforcement on property/unit/party-representative creates
- Team seat limits aligned to the same catalog (memberships + pending invites)
- Migration `0009_organization_invitations` + RLS table list entry
- Invite APIs: create (token once), list, revoke, accept (hashed digest, email match)
- `POST /v1/parties/:id/representatives/:authorityId/revoke` ends authority immediately
- Prior build checklist: `docs/verification/BUILD-VERIFY-0.2.2.md`

## Commands

| Command | Result |
| --- | --- |
| `pnpm format:check` | pass |
| `pnpm verify:source` | pass |
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | pass (domain entitlements 6 tests; api 13) |
| `pnpm build` | pass |
| `pnpm test:e2e` | pass — web Playwright 22; api e2e 3 |

## Ops note

1. Backup production DB.
2. Migrate through **`0009`**.
3. Re-apply RLS/runtime roles (`0001_rls.sql` includes `organization_invitations`).
4. Invite plaintext tokens are returned **once** at create; only SHA-256 digests are stored.
