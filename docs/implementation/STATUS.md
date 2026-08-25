# Implementation status

**Updated:** 2026-08-25  
**Active phase:** Portal chrome redesign shipped; Nest wiring + migration `0011` still infra  
**Product version:** 0.2.18  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.3** · [`CYCLE-APPROVAL.md`](./CYCLE-APPROVAL.md)  
**Portal UI:** [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0–4 | complete | Verified |
| OM ops 1–19 | coded | Nest `API_INTERNAL_ORIGIN` still manual |
| Cycle R1–R5 | **approved + coded** | Queues, finance_manager gates, ownership history UI |
| Portal chrome | **shipped** | Header user + AR/EN + responsive drawer for all portals |

## Next (human / infra — cannot automate without secrets)

1. `pnpm db:migrate` with production `DATABASE_URL` (migration `0011_lease_cycle_v11`).  
2. Confirm Vercel Production/Preview deploy for latest `main` → `https://r.bhd-om.com` / Preview.  
3. Nest HTTPS + Vercel `API_INTERNAL_ORIGIN` / `API_ORIGIN` — [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md).  
4. Smoke portal chrome on phone + desktop (AR/EN) after Vercel redeploy.

## Verification

- `docs/verification/om-ops-flow.md`
- `docs/implementation/TRANSACTION-FLOW-MAP.html`
- `docs/implementation/PORTAL-CHROME-AR.md`
- `pnpm --filter @bhd-r/api test` (cycle clearance permission tests)
