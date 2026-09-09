# إصدار 0.4.79 — مزامنة Hisaby ثنائية الاتجاه

**تاريخ:** 2026-09-09  
**BHD-R:** `a8caf1b` + docs لاحقة · **Hisaby:** `6cab208`  
**دليل Hisaby:** https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md

## ما يعمل بعد الربط مرة واحدة

- دفع فوري: فاتورة/تحصيل/إقامة → `POST …/api/integrations/bhd-r/events`
- سحب تلقائي كل 15 دقيقة من حسابي (+ فوري عند حفظ المفتاح)
- عقارات+عناوين+وحدات، جهات، فواتير، وارد/صادر، تواريخ، معاملات، مركز تكلفة لكل عقار

## قبل الاستخدام على الإنتاج

1. Hisaby: `prisma migrate deploy`
2. BHD-R: `pnpm --filter @bhd-r/db migrate` (يشمل `0024_hisaby_links`)
3. ربط الرمز الوارد + مفتاح القراءة حسب `/ar/owner/api-keys` و`/bhd-r`

توليد Prisma محلياً بمسار خاطئ/Prisma 7 لا يوقف النشر — المهم ترحيل الإنتاج.
