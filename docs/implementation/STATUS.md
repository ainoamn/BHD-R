# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.6  
**Active focus:** Vacant units in new booking form  
**Release 0.3.6:** [`RELEASE-0.3.6-AR.md`](./RELEASE-0.3.6-AR.md)  
**Release 0.3.5:** [`RELEASE-0.3.5-AR.md`](./RELEASE-0.3.5-AR.md)  
**Release 0.3.4:** [`RELEASE-0.3.4-AR.md`](./RELEASE-0.3.4-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Vacant units in bookings | **shipped 0.3.6** | Neon context for create booking dropdown |
| SPA keep-alive panels | **shipped 0.3.5** | Last 8 ops panels mounted; E2E soft-nav guard |
| Home hero + property filters | **shipped 0.3.4** | Compact hero; rent/sale + location + price |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
