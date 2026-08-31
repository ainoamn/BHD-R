# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.2.97  
**Active focus:** Navigation performance (stop Nest prefetch storms)  
**Release 0.2.97:** [`RELEASE-0.2.97-AR.md`](./RELEASE-0.2.97-AR.md)  
**Release 0.2.96:** [`RELEASE-0.2.96-AR.md`](./RELEASE-0.2.96-AR.md)  
**Release 0.2.95:** [`RELEASE-0.2.95-AR.md`](./RELEASE-0.2.95-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Nav performance | **shipped 0.2.97** | No sidebar prefetch storm; short Nest timeouts |
| Portal header | **shipped 0.2.96** | Compact EN + switcher only |
| Property edit save | **shipped 0.2.95** | Next-minted CSRF for Neon owner PATCH |
| Listing UI polish | **shipped 0.2.94** | One rent badge; baked logo |
| Nest Always-on | **recommended** | Render Free sleep remains root cause for ops Nest paths |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
