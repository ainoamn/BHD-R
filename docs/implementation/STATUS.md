# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.89  
**Active focus:** Nest Render deploy tooling + public read least-privilege  
**Release 0.2.89:** [`RELEASE-0.2.89-AR.md`](./RELEASE-0.2.89-AR.md)  
**Release 0.2.88:** [`RELEASE-0.2.88-AR.md`](./RELEASE-0.2.88-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch blocked until payment webhook confirm |
| P0-02 Next direct writes | **mitigated 0.2.88** | Nest-first with Neon fallback until Render Live on current `main` |
| P1-04 public elevation | **hardened 0.2.89** | Showcase public-first; viewer contact least-privilege |
| Nest deploy ops | **tooled 0.2.89** | Hook scripts + Blueprint autoDeploy; Live already serves `booking-checkouts` |
| P0-01 payment proof | **partial** | Sandbox fail-closed; real webhook confirm still required |

## Next (human / infra)

1. `RENDER_DEPLOY_HOOK_URL=… node scripts/trigger-render-deploy.mjs` **أو** Manual Deploy على Render من `main`.  
2. `node scripts/verify-nest-health.mjs` ثم تأكيد `via: nest` للحجز/التحديث.  
3. Webhook دفع → تأكيد حجز؛ ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.89-AR.md`
