# إصدار 0.2.87 — تحديث عقار Nest-first (حزمة المعالج الكاملة)

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02** | توسيع `PATCH /v1/portfolio/properties/:id` لحزمة المعالج الكاملة (عنوان/مالك/ملف/مرافق/مستندات/عدادات/وحدات/إدراجات) |
| **Idempotency** | `@Idempotent` على تحديث العقار في Nest |
| **BFF** | `updatePropertyBundleNestOrNeon` — Nest-first مع Neon fallback |
| **صلاحيات** | يتطلب `property.update` + `unit.update` |

بهذا تُغلق كتابة عقارات المالك عبر Nest-first (إنشاء + تحديث + عربون + وسائط). يبقى الحجز العام على Neon فقط.

## المتبقي

- Nest public booking checkout
- ClamAV حقيقي · Nest+DB E2E · دور Neon بلا BYPASSRLS
- **Redeploy Nest على Render** إلزامي لالتقاط حزمة التحديث الجديدة

## تحقق

1. تعديل عقار من المعالج يعيد `via: nest` بعد نشر Nest.  
2. قبل نشر Nest، يبقى `via: neon` (fallback).  
3. إعادة نفس `idempotency-key` لا تكرر التحديث بحمولة مختلفة (409).

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.86-AR.md`](./RELEASE-0.2.86-AR.md)
