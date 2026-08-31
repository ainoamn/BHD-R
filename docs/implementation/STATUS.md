# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.5  
**Active focus:** Publish keep-alive SPA portal navigation  
**Release 0.3.5:** [`RELEASE-0.3.5-AR.md`](./RELEASE-0.3.5-AR.md)  
**Release 0.3.4:** [`RELEASE-0.3.4-AR.md`](./RELEASE-0.3.4-AR.md)  
**Release 0.3.3:** [`RELEASE-0.3.3-AR.md`](./RELEASE-0.3.3-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| SPA keep-alive panels | **shipped 0.3.5** | Last 8 ops panels mounted; E2E soft-nav guard |
| Home hero + property filters | **shipped 0.3.4** | Compact hero; rent/sale + location + price |
| Public soft-nav warm | **shipped 0.3.3** | Marketing shells + light catalogue prefetch |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
