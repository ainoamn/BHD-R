# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.2.93  
**Active focus:** Reliable Neon-first property save  
**Release 0.2.93:** [`RELEASE-0.2.93-AR.md`](./RELEASE-0.2.93-AR.md)  
**Release 0.2.92:** [`RELEASE-0.2.92-AR.md`](./RELEASE-0.2.92-AR.md)  
**Release 0.2.91:** [`RELEASE-0.2.91-AR.md`](./RELEASE-0.2.91-AR.md)  
**Release 0.2.90:** [`RELEASE-0.2.90-AR.md`](./RELEASE-0.2.90-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Property save reliability | **shipped 0.2.93** | Neon-first create/update + cookie CSRF |
| AI description room fields | **shipped 0.2.92** | majlis/halls/kitchens/pool in generated copy |
| Unit room fields | **shipped 0.2.91** | Wizard + DB `majlis`/`halls`/`kitchens`/`has_pool` |
| Security review 2026-08-30 | **documented** | Financial launch needs live gateway adapter + Nest redeploy |
| P0-02 Next direct writes | **mitigated 0.2.88** | Nest-first owner + public booking/viewing |
| P0-01 payment proof | **mitigated 0.2.90** | Signed `reservation_deposit` webhook confirms + journals; sandbox still fail-closed |
| Nest deploy ops | **tooled 0.2.89** | Redeploy Nest so webhook branch is Live |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.91-AR.md`
- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
