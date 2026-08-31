# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.2.98  
**Active focus:** Owner portal soft-nav (Neon ops, no infinite boot)  
**Release 0.2.98:** [`RELEASE-0.2.98-AR.md`](./RELEASE-0.2.98-AR.md)  
**Release 0.2.97:** [`RELEASE-0.2.97-AR.md`](./RELEASE-0.2.97-AR.md)  
**Release 0.2.96:** [`RELEASE-0.2.96-AR.md`](./RELEASE-0.2.96-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Soft-nav ops | **shipped 0.2.98** | Neon approvals/invoices/expenses/maintenance; no infinite spinner |
| Nav performance | **shipped 0.2.97** | No sidebar prefetch storm; short Nest timeouts |
| Portal header | **shipped 0.2.96** | Compact EN + switcher only |
| Nest Always-on | **recommended** | Remaining Nest-only sections still benefit from Always-On |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
