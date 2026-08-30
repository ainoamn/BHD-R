# إصدار 0.2.80 — حارس Next الحي + تصلّب الوسائط + انتهاء الحجوزات

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02 (جزئي)** | `requireLiveSession`: JWT + `sessionVersion` + جلسة غير ملغاة + CSRF double-submit على كتابات Next |
| **P0-03 (جزئي)** | تحقق magic-bytes؛ تخزين خاص فقط؛ منع Base64 في الإنتاج؛ ملاحظة `scanNote` لانتظار worker |
| **P1-02** | انتهاء holds/reservations المنتهية زمنياً قبل التحقق من توفر الوحدة |
| **P2-03** | `DeleteObject` لـ S3 عند حذف أصل المعرض |

## المتبقي

- تحويل كامل لكتابات الأعمال عبر Nest فقط
- ClamAV + Sharp watermark عبر worker
- بوابة CI/E2E خضراء

## تحقق

1. حفظ/رفع عقار يتطلب CSRF صالحاً (وإلا 403).  
2. جلسة ملغاة/`sessionVersion` قديم → 401 على `/api/owner/*`.  
3. رفع ملف بامتداد مزيف → 400 `invalid_file`.  
4. حجز جديد بعد انتهاء hold سابق لا يفشل بتفرد.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.79-AR.md`](./RELEASE-0.2.79-AR.md)
