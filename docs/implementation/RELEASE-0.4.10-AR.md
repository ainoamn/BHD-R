# الإصدار 0.4.10 — إلغاء الحجوزات وعدم الحضور (ops)

**التاريخ:** 2026-08-31  
**العلم:** مغلق افتراضياً — مسارات `/v1/stays/bookings/:id/*` تردّ 404/401/403 حتى التفعيل والسماح للمؤسسة.

## ماذا أُضيف؟

- `POST /v1/stays/bookings/:id/cancel` — إلغاء من `request_pending` | `payment_pending` | `confirmed` | `pre_arrival`؛ تحرير قفل المخزون وإلغاء نوايا الدفع المعلّقة.
- `POST /v1/stays/bookings/:id/no-show` — من `confirmed` أو `pre_arrival`؛ نفس تحرير القفل.
- واجهة جدول الحجوزات: أزرار إلغاء / عدم حضور / مغادرة (حسب الحالة).
- آلة الحالة: `confirmed → no_show` مسموح (Expand).

## تحقق

| فحص | نتيجة |
| --- | --- |
| بلا جلسة → cancel/no-show | 401 أو 404 |
| انتقال غير قانوني | 409 |
| API/Web typecheck | قبل الدمج |

## تفعيل

نفس علم المنصة + allowlist؛ صلاحية `stay.booking.manage`.
