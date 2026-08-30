# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.86  
**Active focus:** Nest-first property create + media upload + owner write limits  
**Release 0.2.86:** [`RELEASE-0.2.86-AR.md`](./RELEASE-0.2.86-AR.md)  
**Release 0.2.85:** [`RELEASE-0.2.85-AR.md`](./RELEASE-0.2.85-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch still blocked until remaining P0/P1 closed |
| P0-02 Next direct writes | **partial 0.2.86** | Viewing + deposit + media delete/upload + property create Nest-first; property **update** + public booking still Neon |
| Owner write abuse limits | **mitigated 0.2.86** | Rate limits on create/update/media |
| PATCH property idempotency | **mitigated 0.2.86** | Neon keys honor wizard `idempotency-key` |
| P1-07 / cron | **ops** | `ensure-vercel-cron-secret.mjs` + redeploy |

## Next (human / infra)

1. Confirm cron endpoints after redeploy (no `cron_unconfigured`).  
2. Redeploy Nest (Render) if behind media DELETE / deposit Idempotent.  
3. Continue: Nest full property update bundle، public booking Nest، ClamAV، Nest+DB E2E، Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.86-AR.md`
