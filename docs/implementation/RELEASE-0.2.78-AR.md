# إصدار 0.2.78 — حذف صور المعرض فعلياً

**التاريخ:** 2026-08-30  
**Commit على `main`:** `886a1e6`  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com (Vercel من فرع `main`)

## المشكلة

في معالج تعديل العقار، زر «إزالة الصورة» كان يحدّث واجهة المتصفح فقط. بعد إعادة فتح التعديل أو التحديث تعود الصور من Neon.

## الحل

1. `DELETE /api/owner/media/:assetId` — يحذف ربط `unit_media` وصف `media_assets` (إن لم يكن مستخدماً في مستندات الحجز).
2. المعالج يستدعي الحذف فوراً للصور الموجودة (`existing`) قبل إزالتها من الحالة المحلية، مع حالة «جارٍ الحذف…».

## تحقق بعد النشر

1. Vercel Deployment لـ `886a1e6` / 0.2.78 = Ready.  
2. افتح تعديل عقار → خطوة الصور → «إزالة الصورة» → انتظر «جارٍ الحذف…».  
3. أعد فتح `/edit` — الصورة المحذوفة لا تعود.  
4. الكتالوج ما زال يعمل: https://r.bhd-om.com/ar/properties و `/api/public/catalogue?debug=1`.

## وثائق مرتبطة

- [`CHANGELOG.md`](../../CHANGELOG.md)  
- [`STATUS.md`](./STATUS.md)  
- [`RELEASE-0.2.77-AR.md`](./RELEASE-0.2.77-AR.md) (كتالوج `/properties`)
