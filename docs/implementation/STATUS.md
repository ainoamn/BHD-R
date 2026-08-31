# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.2.99  
**Active focus:** Background warm of all portal routes/ops  
**Release 0.2.99:** [`RELEASE-0.2.99-AR.md`](./RELEASE-0.2.99-AR.md)  
**Release 0.2.98:** [`RELEASE-0.2.98-AR.md`](./RELEASE-0.2.98-AR.md)  
**Release 0.2.97:** [`RELEASE-0.2.97-AR.md`](./RELEASE-0.2.97-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Background warm-all | **shipped 0.2.99** | Prefetch all nav shells + batch ops warm |
| Soft-nav ops | **shipped 0.2.98** | Neon approvals/invoices/expenses/maintenance |
| Nav performance | **shipped 0.2.97** | No sidebar prefetch storm |
| Nest Always-on | **recommended** | Helps Nest-only sections during warm |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
