# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.87  
**Active focus:** Nest-first full property UPDATE (wizard bundle)  
**Release 0.2.87:** [`RELEASE-0.2.87-AR.md`](./RELEASE-0.2.87-AR.md)  
**Release 0.2.86:** [`RELEASE-0.2.86-AR.md`](./RELEASE-0.2.86-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch still blocked until remaining P0/P1 closed |
| P0-02 Next direct writes | **partial 0.2.87** | Owner property create/update/deposit + media upload/delete Nest-first; **public booking** still Neon |
| Owner write abuse limits | **mitigated 0.2.86** | Rate limits on create/update/media |
| P1-07 / cron | **mitigated 0.2.86** | `CRON_SECRET` set; cron returns 401 without bearer |

## Next (human / infra)

1. **Redeploy Nest (Render)** — required for full property PATCH + prior media DELETE / deposit Idempotent.  
2. Continue: Nest public booking checkout، ClamAV، Nest+DB E2E، Neon non-BYPASS.  
3. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.87-AR.md`
