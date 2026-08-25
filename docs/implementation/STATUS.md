# Implementation status

**Updated:** 2026-08-25  
**Active phase:** Property wizard UX shipped; apply Neon migrations `0011` + `0012`  
**Product version:** 0.2.19  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.3** · [`CYCLE-APPROVAL.md`](./CYCLE-APPROVAL.md)  
**Portal UI:** [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md)  
**Property wizard:** [`PROPERTY-WIZARD-AR.md`](./PROPERTY-WIZARD-AR.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0–4 | complete | Verified |
| OM ops 1–19 | coded | Nest `API_INTERNAL_ORIGIN` still manual |
| Cycle R1–R5 | **approved + coded** | Queues, finance_manager gates, ownership history UI |
| Portal chrome | **shipped** | Header user + AR/EN + responsive drawer for all portals |
| Property wizard | **shipped** | Gated steps, Oman cascade, cover, AI copy, serials |

## Next (human / infra — cannot automate without secrets)

1. `pnpm db:migrate` with production `DATABASE_URL` (migrations `0011` + `0012_property_serials`).  
2. Confirm Vercel Production/Preview deploy for latest `main`.  
3. Nest HTTPS + Vercel `API_INTERNAL_ORIGIN` / `API_ORIGIN` — [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md).  
4. Smoke `/ar/owner/properties/new` on phone + desktop after redeploy.

## Verification

- `docs/verification/om-ops-flow.md`
- `docs/implementation/TRANSACTION-FLOW-MAP.html`
- `docs/implementation/PORTAL-CHROME-AR.md`
- `docs/implementation/PROPERTY-WIZARD-AR.md`
- `pnpm --filter @bhd-r/api test` (cycle clearance permission tests)
