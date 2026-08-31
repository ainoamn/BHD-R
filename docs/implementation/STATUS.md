# Implementation status

**Updated:** 2026-08-31  
**Product version:** 0.3.9  
**Active focus:** Properties browse view modes  
**Release 0.3.9:** [`RELEASE-0.3.9-AR.md`](./RELEASE-0.3.9-AR.md)  
**Release 0.3.8:** [`RELEASE-0.3.8-AR.md`](./RELEASE-0.3.8-AR.md)  
**Release 0.3.7:** [`RELEASE-0.3.7-AR.md`](./RELEASE-0.3.7-AR.md)  
**Env manifest:** [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)  
**Nest hosting:** [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)  
**Next product pack (not started):** [`../product/daily-stays/README.md`](../product/daily-stays/README.md)

| Phase | Status | Notes |
| ----- | ------ | ----- |
| Browse list/grid/table toggle | **shipped 0.3.9** | Toolbar view switcher + localStorage |
| Map + discovery + reviews | **shipped 0.3.8** | Live `r.bhd-om.com`; pins + reviews + party profiles |
| Properties browse filters | **shipped 0.3.7** | Sticky search + sidebar/drawer + client facets |
| Vacant units in bookings | **shipped 0.3.6** | Neon context for create booking dropdown |

## Next (human / infra)

1. Redeploy Nest (Render) لالتقاط `reservation_deposit` webhook + أعمدة الوحدة الجديدة.  
2. ربط بوابة الدفع لتوقيع وإرسال حمولة العربون بعد الدفع.  
3. ClamAV؛ Nest+DB E2E؛ Neon non-BYPASS.  
4. تدوير أسرار ظهرت في محادثات سابقة.  
5. اختياري: أرشفة مشروع Vercel `web` الخاطئ لتجنب التباس Error في اللوحة.  
6. اختياري لاحقاً: تنفيذ حزمة الإقامات اليومية وفق `docs/product/daily-stays/` (Feature Flag مغلق).

## Verification

See the latest `RELEASE-*-AR.md` for the checklist of the current release.
