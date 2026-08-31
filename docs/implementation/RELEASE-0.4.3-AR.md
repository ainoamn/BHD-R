# الإصدار 0.4.3 — بحث الإقامات العام من projection + Redis TTL

**التاريخ:** 2026-08-31  
**العلم:** `STAYS_PLATFORM_ENABLED` مغلق افتراضياً — البحث يردّ 404 حتى التفعيل.

## ماذا أُضيف؟

- `GET /v1/public/stays/search` يقرأ `stay_public_listings` + `stay_inventory_days` (توافر النطاق `[checkIn, checkOut)`).
- `GET /v1/public/stays/:slug` لتفاصيل الإعلان المنشور.
- كاش Redis اختياري (TTL 45 ثانية) عبر `REDIS_URL`؛ عند الفشل يمرّ للاستعلام مباشرة.
- Domain: `stayRangeFullyAvailable`.
- واجهة `/stays` كانت موصولة مسبقاً؛ بحث بتواريخ يصبح `noindex,follow`.

## تحقق

| فحص | نتيجة |
| --- | --- |
| العلم off → `/v1/public/stays/search` | 404 |
| Domain tests | 19 passed |
| API typecheck | ok |

## تفعيل

يتطلّب إعلانات منشورة + projector (0.4.2) يملأ الأيام، ثم `STAYS_PLATFORM_ENABLED=true`.
