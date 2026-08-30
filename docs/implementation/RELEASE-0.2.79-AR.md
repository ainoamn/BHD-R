# إصدار 0.2.79 — أمن الحجز + أسرار الإنتاج + تنقّل أنعم

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com

## المصدر

تقرير المراجعة الكامل محفوظ في:

[`docs/security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ في هذا الإصدار (شريحة 0–72 ساعة جزئية + سرعة تنقّل)

| بند التقرير | الإجراء |
| --- | --- |
| **P0-01** تأكيد عربون بلا دفع | تعطيل `POST /api/public/bookings/complete` وصفحة sandbox في الإنتاج (fail-closed) إلا مع `ALLOW_BOOKING_SANDBOX=1` |
| **P0-04** أسرار تطوير ثابتة | `requireSessionSecret()` يرفض الإنتاج بدون `BHD_R_SESSION_SECRET` ≥32 |
| **P2-01** Cron مفتوح | `/api/cron/warmup-nest` يرفض عند غياب `CRON_SECRET`؛ لا يعيد body/origin |
| **§14 سرعة** | استبدال `<a href>` الداخلية في لوحة العقار/الأقسام بـ `Link` + prefetch؛ كاش صور أقوى؛ روابط الموقع العامة بـ prefetch |

## ما تبقّى (لا يُغلق بهذا الإصدار)

- P0-02 توحيد كل كتابات الأعمال عبر Nest (مسار كبير)
- P0-03 مسار رفع مباشر → quarantine/worker
- P1-* وبوابة CI/E2E كاملة وفق التقرير

## تحقق

1. Production: `POST /api/public/bookings/complete` → 403 `sandbox_disabled`.  
2. `/ar/payments/sandbox/...` → 404 في الإنتاج.  
3. تنقّل لوحة المالك بين الفواتير/العقود بدون Document reload كامل (Network: soft RSC).  
4. من إدارة العقار: أزرار العقود/التأجير عبر soft Link.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md)  
- [`STATUS.md`](./STATUS.md)  
- [`PORTAL-PERF-AR.md`](./PORTAL-PERF-AR.md)
