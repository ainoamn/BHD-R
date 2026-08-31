# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.2.95  
**Active focus:** Property edit save CSRF on Next  
**Release 0.2.95:** [`RELEASE-0.2.95-AR.md`](./RELEASE-0.2.95-AR.md)  
**Release 0.2.94:** [`RELEASE-0.2.94-AR.md`](./RELEASE-0.2.94-AR.md)  
**Release 0.2.93:** [`RELEASE-0.2.93-AR.md`](./RELEASE-0.2.93-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Property edit save | **shipped 0.2.95** | Next-minted CSRF for Neon owner PATCH |
| Listing UI polish | **shipped 0.2.94** | One rent badge; baked logo; portal header |
| Property save reliability | **shipped 0.2.93** | Neon-first create/update |
| AI description room fields | **shipped 0.2.92** | majlis/halls/kitchens/pool in generated copy |
| Unit room fields | **shipped 0.2.91** | Wizard + DB room fields |
| Security review 2026-08-30 | **documented** | Financial launch needs live gateway adapter |
| P0-02 / P0-01 | **mitigated** | Nest-first writes + reservation_deposit webhook |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
