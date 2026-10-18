# الإصدار 0.8.72 — إصلاح بناء Vercel بعد توسيع RefundBooking

**التاريخ:** 2026-10-18  
**الحالة:** جاهز للرفع

## المشكلة

فشل نشر `bhd-r-api` (Vercel) على 0.8.70 و0.8.71: TypeScript رفض `stay-deposit-claims-neon.ts` لأن نوع `RefundBooking` أُضيف إليه `unitId` و`guestPartyId` للترحيل المحاسبي دون تحديث أعمدة التحميل.

## الحل

تضمين `unitId` و`guestPartyId` (و`propertyId` حيث لزم) في `bookingColumns` واستعلام الشكاوى المسندة.

## التحقق

- `tsc --noEmit` للويب نظيف.
- eslint للملف المعدّل نظيف.
