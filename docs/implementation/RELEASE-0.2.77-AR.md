# إصدار 0.2.77 — إصلاح كتالوج `/properties`

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com (Vercel من فرع `main`)

## المشكلة

العقار يظهر منشوراً في بوابة المالك وصفحة العرض العامة (`/properties/:id`) تعمل، لكن [`/ar/properties`](https://r.bhd-om.com/ar/properties) يبقى فارغاً («لا توجد نتائج»).

## السبب المرجّح

مسار الكتالوج كان يعتمد على صفوف `listings` + مسارات Nest/RLS (`app.public` / `public_unit_available`) التي تخفي الوحدات المحجوزة أو غير المتزامنة، بينما صفحة التفاصيل تقرأ بامتياز `platform_admin`.

## الحل

1. إعادة كتابة `searchPublicListingsFromNeon` بـ **SQL خام** في معاملة واحدة:
   - `app.platform_admin=true`
   - شفاء `properties` / `units` / `listings` من `publish_when_available`
   - إدراج listing ناقص إن لزم
   - انتهاء holds المنتهية
   - اختيار من `units` (وليس فقط listings.enabled)
2. مسار تشخيص: `GET /api/public/catalogue?debug=1` → `{ count, data, error?, detail? }`
3. بطاقة القائمة تفتح `/properties/:propertyId` عند توفره

## تحقق بعد النشر

1. Vercel Deployment لأحدث `main` = Ready.  
2. افتح https://r.bhd-om.com/api/public/catalogue?debug=1 — يجب `count >= 1` بدون `error`.  
3. افتح https://r.bhd-om.com/ar/properties — تظهر الوحدة المنشورة (مثلاً عبد الحميد / U-01).  
4. من البطاقة: الانتقال لصفحة العرض + مشاركة/QR كما في 0.2.73–0.2.76.

## وثائق مرتبطة

- [`CHANGELOG.md`](../../CHANGELOG.md)  
- [`STATUS.md`](./STATUS.md)
