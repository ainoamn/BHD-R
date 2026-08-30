# إصدار 0.2.88 — حجز عام Nest-first

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02** | `POST /v1/public/units/:id/booking-checkouts` — hold + reservation pending + prospect party |
| **Abuse** | Throttle 8/دقيقة؛ honeypot `website`؛ انتهاء holds/reservations قبل الفحص |
| **Idempotency** | `submissionId` → `sessionReference` ثابت؛ إعادة الطلب تعيد نفس الحجز |
| **BFF** | `createPublicBookingNestOrNeon` مع Neon fallback |

بهذا تُغلق مسارات الكتابة المباشرة الحرجة عبر Nest-first (عقارات المالك + وسائط + معاينة + حجز). يبقى تأكيد الدفع sandbox fail-closed في الإنتاج.

## المتبقي

- **Redeploy Nest على Render** (إلزامي لـ `via: nest` على الحجز وتحديث العقار 0.2.87+)
- ClamAV حقيقي · Nest+DB E2E · دور Neon بلا BYPASSRLS
- ربط تأكيد العربون بـ webhook دفع موقّع (ليس sandbox)

## تحقق

1. بعد نشر Nest: بدء حجز يعيد `via: nest`.  
2. قبل نشر Nest: `via: neon` (fallback).  
3. إعادة نفس `idempotency-key` (UUID) تعيد نفس `sessionReference`.  
4. وحدة بلا عربون → `deposit_not_set`.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.87-AR.md`](./RELEASE-0.2.87-AR.md)
