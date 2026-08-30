# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.82  
**Active focus:** Gallery soft-promote + encryption fail-closed + env/cron harden  
**Release 0.2.82:** [`RELEASE-0.2.82-AR.md`](./RELEASE-0.2.82-AR.md)  
**Release 0.2.81:** [`RELEASE-0.2.81-AR.md`](./RELEASE-0.2.81-AR.md)  
**Release 0.2.80:** [`RELEASE-0.2.80-AR.md`](./RELEASE-0.2.80-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Handoff:** [`HANDOFF-NEST-RENDER-2026-08-26-AR.md`](./HANDOFF-NEST-RENDER-2026-08-26-AR.md)  
**Property identity/QR:** [`PROPERTY-IDENTITY-QR-AR.md`](./PROPERTY-IDENTITY-QR-AR.md)  
**Adaptive properties UI:** [`PORTAL-ADAPTIVE-PROPERTIES-AR.md`](./PORTAL-ADAPTIVE-PROPERTIES-AR.md)  
**Brand assets:** [`../ASSETS.md`](../ASSETS.md)  
**Cycle reference:** [`TRANSACTION-FLOW-MAP.md`](./TRANSACTION-FLOW-MAP.md) **v1.3** · [`CYCLE-APPROVAL.md`](./CYCLE-APPROVAL.md)  
**Portal UI:** [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md)  
**Property wizard:** [`PROPERTY-WIZARD-AR.md`](./PROPERTY-WIZARD-AR.md)  
**Property ops hub / booking:** [`RELEASE-0.2.69-AR.md`](./RELEASE-0.2.69-AR.md)  
**Portal soft-nav + chrome:** [`RELEASE-0.2.70-71-AR.md`](./RELEASE-0.2.70-71-AR.md)  
**Catalogue empty fix:** [`RELEASE-0.2.77-AR.md`](./RELEASE-0.2.77-AR.md)  
**Gallery delete persist:** [`RELEASE-0.2.78-AR.md`](./RELEASE-0.2.78-AR.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| 0–4 | complete | Verified |
| OM ops 1–19 | coded | Nest على `https://bhd-r.onrender.com` |
| Security review 2026-08-30 | **documented** | Production financial launch **blocked** until remaining P0/P1 closed |
| P0-01 booking sandbox | **mitigated 0.2.79** | Complete endpoint + sandbox page fail-closed in production |
| P0-02 Next direct writes | **partial 0.2.80** | Live session + CSRF; Nest-only still open |
| P0-03 direct media upload | **partial 0.2.82** | Magic-bytes + best-effort promote + outbox; ClamAV residual |
| P0-04 secret fallbacks | **mitigated 0.2.79** | `requireSessionSecret` / OIDC state secret |
| P1-01 TOTP re-enroll | **mitigated 0.2.81** | Step-up + throttle + revoke other sessions |
| P1-02 hold expiry | **mitigated 0.2.80+0.2.82** | Booking path + catalogue + cron `/api/cron/expire-locks` |
| P1-03 OIDC JWKS / leaks | **mitigated 0.2.81** | JWKS + exact host + no `?x=` detail |
| P1-04 tenant isolation (Next) | **partial 0.2.81** | Deposit GUCs; org-scoped public writes; Neon non-BYPASS still open |
| P1-05 CI/E2E honesty | **partial 0.2.81** | Express API e2e; chromium fixture labeled; real Nest journeys open |
| P1-06 encryption rotation | **mitigated 0.2.82** | Fail-closed + failure inventory (hash only) |
| P1-07 deploy env drift | **partial 0.2.82** | render.yaml + ENV-MANIFEST; readiness dual-doc |
| P2-03 S3 orphan delete | **mitigated 0.2.80** | DeleteObject on gallery remove |
| Soft nav portal | **improved 0.2.70 + 0.2.79** | Ops cache + Link prefetch on manage hub / public |
| Catalogue empty `/properties` | **shipped 0.2.77** | Raw-SQL heal+list + `/api/public/catalogue` |
| Gallery image delete persist | **shipped 0.2.78** | DELETE `/api/owner/media/:id` from wizard |
| Nest Render reachability | **fixed 0.2.45** | Express + edge `/healthz` + CORS callback |

## Next (human / infra)

1. Confirm Vercel Ready for **0.2.82**; ensure `CRON_SECRET` set (warmup + expire-locks).  
2. Optional: set `MEDIA_PUBLIC_PROMOTE_MODE=await_worker` only when ClamAV worker is reliable.  
3. Continue: Nest-only writes, real ClamAV, Nest+DB E2E, non-BYPASSRLS Neon role.  
4. Sync Render dashboard env keys from ENV-MANIFEST (Blueprint `sync: false`).  
5. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.82-AR.md`
- `docs/implementation/ENV-MANIFEST.md`
- `docs/security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`
