# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.79  
**Active focus:** Soft nav + P0 sandbox/secrets hardening from security review  
**Security review (0.2.78 baseline):** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)  
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
| P0-04 secret fallbacks | **mitigated 0.2.79** | `requireSessionSecret` / OIDC state secret |
| P0-02 Next direct writes | **open** | Prefer Nest-only writes (large track) |
| P0-03 direct media upload | **open** | Needs quarantine/worker path |
| Soft nav portal | **improved 0.2.70 + 0.2.79** | Ops cache + Link prefetch on manage hub / public |
| Catalogue empty `/properties` | **shipped 0.2.77** | Raw-SQL heal+list + `/api/public/catalogue` |
| Gallery image delete persist | **shipped 0.2.78** | DELETE `/api/owner/media/:id` from wizard |
| Nest Render reachability | **fixed 0.2.45** | Express + edge `/healthz` + CORS callback |

## Next (human / infra)

1. Confirm Vercel Ready for **0.2.79**; set `CRON_SECRET` if missing.  
2. Smoke: soft nav owner sidebar + property hub; `POST /api/public/bookings/complete` → 403.  
3. Continue review plan: Nest-only writes, media quarantine, live session revoke, CI/E2E gate.  
4. (Optional) Always-on Nest on Render for cold-start.  
5. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`
- `docs/implementation/RELEASE-0.2.79-AR.md`
- `docs/implementation/RELEASE-0.2.78-AR.md`
- `docs/implementation/RELEASE-0.2.77-AR.md`
- `docs/implementation/PORTAL-PERF-AR.md`
- `docs/implementation/NEST-API-HOSTING.md`
