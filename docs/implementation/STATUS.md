# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.84  
**Active focus:** Error redaction + CSRF leftovers + deposit Nest-first  
**Release 0.2.84:** [`RELEASE-0.2.84-AR.md`](./RELEASE-0.2.84-AR.md)  
**Release 0.2.83:** [`RELEASE-0.2.83-AR.md`](./RELEASE-0.2.83-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch still blocked until remaining P0/P1 closed |
| P0-02 Next direct writes | **partial 0.2.84** | Viewing + deposit Nest-first; property/media/booking still Neon |
| P2-04 error redaction | **mitigated 0.2.84** | `clientSafeErrorCode` |
| CSRF leftovers | **mitigated 0.2.84** | Origin required; complete CSRF; policy asserts CSRF |
| Idempotency (public) | **mitigated 0.2.84** | Viewing/booking idempotency-key |
| P1-07 / cron | **partial** | Run `ensure-vercel-cron-secret.mjs` if still `cron_unconfigured` |

## Next (human / infra)

1. `node scripts/ensure-vercel-cron-secret.mjs` ثم إعادة نشر الويب.  
2. Redeploy Nest (Render) لالتقاط `PATCH .../deposit`.  
3. Continue: Nest-only property/media/booking، ClamAV، Nest+DB E2E، Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.84-AR.md`
