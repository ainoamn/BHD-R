# CONTINUE — 2026-09-09 (مزامنة Hisaby حيّة)

**BHD-R HEAD:** `4be1056` · **0.4.79** · https://r.bhd-om.com  
**Hisaby:** `6cab208` · https://hisaby.bhd-om.com  
**دليل Hisaby:** https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md  
**دليل العقارات:** [`docs/implementation/HISABY-INTEGRATION-AR.md`](./docs/implementation/HISABY-INTEGRATION-AR.md)

## قبل أول ربط على الإنتاج
1. Hisaby: `prisma migrate deploy`
2. BHD-R: `pnpm --filter @bhd-r/db migrate` (تطبيق `0024_hisaby_links`)
3. ربط المفاتيح مرة واحدة حسب [`HISABY-API-KEYS-AR.md`](./docs/implementation/HISABY-API-KEYS-AR.md)

## اقرأ
- [`docs/implementation/RELEASE-0.4.79-AR.md`](./docs/implementation/RELEASE-0.4.79-AR.md)
- [`docs/handoffs/2026-09-09-hisaby-sync-0.4.79/`](./docs/handoffs/2026-09-09-hisaby-sync-0.4.79/)
- [`docs/implementation/STATUS.md`](./docs/implementation/STATUS.md)
