# الإصدار 0.4.6 — رحلات الضيف: بحث بالمرجع + قائمة الحساب + claim

**التاريخ:** 2026-08-31  
**العلم:** `STAYS_PLATFORM_ENABLED` مغلق افتراضياً — المسارات العامة وبوابة الضيف معتمة حتى التفعيل.

## ماذا أُضيف؟

- `GET /v1/public/stays/bookings/lookup?referenceCode=` — إسقاط عام آمن للحجز.
- `GET /v1/guest/stays/bookings` — حجوزات مرتبطة بـ `user_id` (جلسة مطلوبة).
- `GET /v1/guest/stays/bookings/:id` — تفاصيل حجز مملوك للمستخدم.
- `POST /v1/guest/stays/bookings/claim` — ربط حجز بلا مستخدم بالحساب الحالي.
- واجهة `/guest/stays` + `/guest/stays/[bookingId]`؛ رابط من checkout بعد الحجز.

## تحقق

| فحص | نتيجة |
| --- | --- |
| العلم off → lookup | 404 |
| العلم off → guest list بلا جلسة | 401 أو 404 |
| API/Web typecheck | قبل الدمج |

## تفعيل

Nest من `main` (0.4.4+) + علم المنصة؛ بعد الحجز العام استخدم المرجع ثم claim.
