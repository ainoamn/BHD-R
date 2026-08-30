# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.83  
**Active focus:** Nest-first viewing pilot + Next write policy + abuse limits  
**Release 0.2.83:** [`RELEASE-0.2.83-AR.md`](./RELEASE-0.2.83-AR.md)  
**Release 0.2.82:** [`RELEASE-0.2.82-AR.md`](./RELEASE-0.2.82-AR.md)  
**Release 0.2.81:** [`RELEASE-0.2.81-AR.md`](./RELEASE-0.2.81-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Handoff:** [`HANDOFF-NEST-RENDER-2026-08-26-AR.md`](./HANDOFF-NEST-RENDER-2026-08-26-AR.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Production financial launch **blocked** until remaining P0/P1 closed |
| P0-01 booking sandbox | **mitigated 0.2.79** | |
| P0-02 Next direct writes | **partial 0.2.83** | Policy test + viewing Nest-first; other writes still Neon+guard |
| P0-03 media upload | **partial 0.2.82+0.2.83** | Soft-promote + Sharp tests; ClamAV residual |
| P0-04 secret fallbacks | **mitigated 0.2.79** | |
| P1-01 TOTP re-enroll | **mitigated 0.2.81** | |
| P1-02 hold expiry | **mitigated 0.2.80+0.2.82** | |
| P1-03 OIDC JWKS / leaks | **mitigated 0.2.81** | |
| P1-04 tenant isolation | **partial 0.2.83** | Public media `app.public`; Neon non-BYPASS still open |
| P1-05 CI/E2E honesty | **partial 0.2.81** | |
| P1-06 encryption rotation | **mitigated 0.2.82** | |
| P1-07 deploy env drift | **partial 0.2.82** | + CRON helper script |
| P2-06 Host spoof | **mitigated 0.2.83** | Vercel requires HTTPS `API_INTERNAL_ORIGIN` |

## Next (human / infra)

1. Run `node scripts/ensure-vercel-cron-secret.mjs` then redeploy web.  
2. Confirm Nest Live so viewing prefers Nest (`via: nest`).  
3. Continue: Nest-only remaining writes, ClamAV, Nest+DB E2E, non-BYPASSRLS Neon.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.83-AR.md`
- `docs/implementation/ENV-MANIFEST.md`
