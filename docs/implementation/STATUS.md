# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.85  
**Active focus:** Nest-first media delete + deposit idempotency + catalogue RLS/rate-limit  
**Release 0.2.85:** [`RELEASE-0.2.85-AR.md`](./RELEASE-0.2.85-AR.md)  
**Release 0.2.84:** [`RELEASE-0.2.84-AR.md`](./RELEASE-0.2.84-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch still blocked until remaining P0/P1 closed |
| P0-02 Next direct writes | **partial 0.2.85** | Viewing + deposit + media delete Nest-first; property create/update + media upload + booking still Neon |
| P2-04 error redaction | **mitigated 0.2.85** | Owner routes + CI policy gate |
| Idempotency (deposit) | **mitigated 0.2.85** | Nest `@Idempotent` + Neon keys |
| Catalogue public read | **hardened 0.2.85** | Rate-limit + SELECT under `app.public` |
| P1-07 / cron | **partial** | Run `ensure-vercel-cron-secret.mjs` if still `cron_unconfigured` |

## Next (human / infra)

1. `node scripts/ensure-vercel-cron-secret.mjs` ثم إعادة نشر الويب.  
2. Redeploy Nest (Render) لالتقاط `DELETE /v1/media` وIdempotency على deposit.  
3. Continue: Nest-only property create/update، media upload، public booking؛ ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.85-AR.md`
