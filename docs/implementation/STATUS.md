# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.0  
**Active focus:** Client soft-nav + background warm-all  
**Release 0.3.0:** [`RELEASE-0.3.0-AR.md`](./RELEASE-0.3.0-AR.md)  
**Release 0.2.99:** [`RELEASE-0.2.99-AR.md`](./RELEASE-0.2.99-AR.md)  
**Release 0.2.98:** [`RELEASE-0.2.98-AR.md`](./RELEASE-0.2.98-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Client soft-nav pages | **shipped 0.3.0** | No RSC wait per ops click; cache-first paint |
| Background warm-all | **shipped 0.2.99** | Prefetch all nav + batch ops warm |
| Soft-nav ops | **shipped 0.2.98** | Neon-first sections; no infinite spinner |
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
