# الإصدار 0.4.47 — إصلاح 404 لصفحة دفع sandbox للإقامات

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** _(يُحدَّث بعد الدفع)_

## المشكلة

بعد تأكيد الحجز كان التحويل إلى:

`/ar/payments/sandbox/{session}?kind=stay&return=…`

يعرض **404** رغم أن جلسة الدفع أُنشئت بنجاح (`ST-0A58F0FE`).

## السبب

- إنشاء جلسة الدفع يستخدم `isPaymentSandboxPilotEnabled()` (يفتح مع `STAYS_PLATFORM_ENABLED` / `PAYMENT_SANDBOX_ENABLED`).
- صفحة `/payments/sandbox/[sessionReference]` كانت تستخدم `isBookingSandboxAllowed()` الذي **مغلق في الإنتاج** إلا مع `ALLOW_BOOKING_SANDBOX=1`.

## الإصلاح

توحيد بوابة الصفحة مع نفس دالة الـ pilot المستخدمة لإنشاء الجلسة وإكمال الدفع.

## تحقق

- [ ] تأكيد حجز → صفحة «محاكاة دفع الإقامة» تظهر (ليست 404)
- [ ] إكمال الدفع → `/stays/booking/confirmed?ref=ST-…`
- [ ] رابط الإيصال يعمل
