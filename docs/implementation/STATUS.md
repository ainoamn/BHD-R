# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.80  
**Active focus:** Next live-session/CSRF + media hardening (review follow-through)  
**Release 0.2.80:** [`RELEASE-0.2.80-AR.md`](./RELEASE-0.2.80-AR.md)  
**Release 0.2.79:** [`RELEASE-0.2.79-AR.md`](./RELEASE-0.2.79-AR.md)  
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
| P0-02 Next direct writes | **partial 0.2.80** | Live session + CSRF on Next writes; Nest-only still open |
| P0-03 direct media upload | **partial 0.2.80** | Magic-bytes + private S3; no prod Base64; worker scan residual |
| P0-04 secret fallbacks | **mitigated 0.2.79** | `requireSessionSecret` / OIDC state secret |
| P1-02 hold expiry | **mitigated 0.2.80** | Expire timed-out holds/reservations before bookability check |
| P2-03 S3 orphan delete | **mitigated 0.2.80** | DeleteObject on gallery remove |
| Soft nav portal | **improved 0.2.70 + 0.2.79** | Ops cache + Link prefetch on manage hub / public |
| Catalogue empty `/properties` | **shipped 0.2.77** | Raw-SQL heal+list + `/api/public/catalogue` |
| Gallery image delete persist | **shipped 0.2.78** | DELETE `/api/owner/media/:id` from wizard |
| Nest Render reachability | **fixed 0.2.45** | Express + edge `/healthz` + CORS callback |

## Next (human / infra)

1. Confirm Vercel Ready for **0.2.80**; ensure `CRON_SECRET` + `CSRF_SECRET` + `BHD_R_SESSION_SECRET` set.  
2. Smoke: property save/upload with CSRF; revoked session → 401; booking after expired hold.  
3. Continue: Nest-only writes, ClamAV worker, CI/E2E gate.  
4. (Optional) Always-on Nest on Render for cold-start.  
5. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.80-AR.md`
- `docs/security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`
- `docs/implementation/RELEASE-0.2.79-AR.md`
