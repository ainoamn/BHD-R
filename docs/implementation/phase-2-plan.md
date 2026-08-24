# Phase 2 plan — parties, representatives, invitations, entitlements

## Requirements (build command §7)

- Party / company / identity documents already present; close entitlement + invite gaps.
- One-time hashed invite tokens with expiry, accept, revoke.
- Server-side plan limits on properties, units, representatives (transactional).
- Tenant isolation for invitations via RLS.
- Revoking representation authority withdraws access immediately (`status=inactive`).

## Implementation

1. Domain catalog `packages/domain/src/entitlements.ts` (`starter` / `growth` / `enterprise`).
2. API helper `apps/api/src/common/entitlements.ts` enforced on property/unit/party-representative creates.
3. Migration `0009_organization_invitations` + RLS list entry.
4. Org APIs: create/list/revoke invitations; accept by token (authenticated, email match).
5. Align team-seat limits with `entitlementsForPlan().representatives`.
6. `POST /v1/parties/:id/representatives/:authorityId/revoke`.

## Acceptance

- Unit: entitlement overflow rejects.
- Typecheck/lint/test/build green.
- Ops: migrate through `0009` then re-apply RLS before relying on invites in production.
