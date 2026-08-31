# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.10  
**Active focus:** BHD R Stays Phase 0 (flags/docs only; no public surface)  
**Stays Phase 0:** [`RELEASE-STAYS-PHASE-0-AR.md`](./RELEASE-STAYS-PHASE-0-AR.md) · [`../verification/stays-phase-0.md`](../verification/stays-phase-0.md)  
**Stays pack:** [`../product/daily-stays/README.md`](../product/daily-stays/README.md)  
**Release 0.3.10:** [`RELEASE-0.3.10-AR.md`](./RELEASE-0.3.10-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Stays Phase 0 — ADR/flags/baseline | **in progress** | Branch `feat/stays-phase-0`; flags off; no `/stays` |
| Marketing session via Next cookie | **shipped 0.3.10** | `/api/auth/me` |
| Browse list/grid/table toggle | **shipped 0.3.9** | Toolbar view switcher |
| Map + discovery + reviews | **shipped 0.3.8** | Pins + reviews + party profiles |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.  
5. اختياري: أرشفة مشروع Vercel `web` الخاطئ لتجنب التباس Error في اللوحة.  
6. اختياري لاحقاً: تنفيذ حزمة الإقامات اليومية وفق `docs/product/daily-stays/` (Feature Flag مغلق).

## Verification

See the latest `RELEASE-*-AR.md` for the checklist of the current release.
