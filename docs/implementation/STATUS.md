# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.1  
**Active focus:** Qootk-style soft nav (no white flash)  
**Release 0.3.1:** [`RELEASE-0.3.1-AR.md`](./RELEASE-0.3.1-AR.md)  
**Release 0.3.0:** [`RELEASE-0.3.0-AR.md`](./RELEASE-0.3.0-AR.md)  
**Release 0.2.99:** [`RELEASE-0.2.99-AR.md`](./RELEASE-0.2.99-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Soft SPA ops host | **shipped 0.3.1** | PortalMainSlot + optimistic nav; removed loading white flash |
| Client soft-nav pages | **shipped 0.3.0** | Cache-first ops paint |
| Background warm-all | **shipped 0.2.99** | Prefetch all nav + batch ops warm |
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
