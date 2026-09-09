# إصدار 0.4.79 — مزامنة Hisaby ثنائية الاتجاه (منشور)

**تاريخ:** 2026-09-09  
**BHD-R:** `1478983` · **Hisaby:** `6c410e4`  
**دليل Hisaby:** https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md

## ما يعمل بعد الربط مرة واحدة

- دفع فوري: فاتورة/تحصيل/إقامة → `POST https://hisaby.bhd-om.com/api/integrations/bhd-r/events`
- حسابي يعيد توجيه هذا المسار من النطاق العام ويستقبل أجسام الـ Worker كما هي
- سحب تلقائي كل 15 دقيقة (`GET /v1/integrations/hisaby/export` ثم المسارات المفصّلة)
- عقارات+عناوين+وحدات، جهات، فواتير، وارد/صادر، تواريخ، معاملات، مركز تكلفة لكل عقار

## قبل الاستخدام على الإنتاج

1. Hisaby: `prisma migrate deploy`
2. BHD-R: `pnpm --filter @bhd-r/db migrate` (يشمل `0024_hisaby_links`)
3. ربط الرمز الوارد + مفتاح القراءة حسب `/ar/owner/api-keys` و`/bhd-r`
