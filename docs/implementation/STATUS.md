# Implementation status

**Updated:** 2026-08-30  
**Product version:** 0.2.90  
**Active focus:** Signed payment webhook → public booking deposit confirm (P0-01)  
**Release 0.2.90:** [`RELEASE-0.2.90-AR.md`](./RELEASE-0.2.90-AR.md)  
**Release 0.2.89:** [`RELEASE-0.2.89-AR.md`](./RELEASE-0.2.89-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Security review 2026-08-30 | **documented** | Financial launch needs live gateway adapter + Nest redeploy |
| P0-02 Next direct writes | **mitigated 0.2.88** | Nest-first owner + public booking/viewing |
| P0-01 payment proof | **mitigated 0.2.90** | Signed `reservation_deposit` webhook confirms + journals; sandbox still fail-closed |
| Nest deploy ops | **tooled 0.2.89** | Redeploy Nest so webhook branch is Live |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook.  
2. ربط بوابة الدفع لتوقيع وإرسال الحمولة أعلاه بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.

## Verification

- `docs/implementation/RELEASE-0.2.90-AR.md`
- `scripts/simulate-reservation-deposit-webhook.mjs`
