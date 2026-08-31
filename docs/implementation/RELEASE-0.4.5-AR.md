# الإصدار 0.4.5 — واجهة حجز الضيف التفاعلية (quote → hold → pay)

**التاريخ:** 2026-08-31  
**العلم:** واجهة `/stays` تبقى خلف `STAYS_PUBLIC_SURFACE` / المنصة؛ استدعاءات Nest تردّ 404 والعلم مغلق.

## ماذا أُضيف؟

- مكوّن `StayCheckout` على `/[locale]/stays/[slug]`:
  1. `GET …/availability`
  2. `POST …/quotes`
  3. `POST …/holds` + `Idempotency-Key`
  4. `POST …/bookings` + `Idempotency-Key`
- يعرض المرجع والحالة والمبلغ و`paymentIntentId`؛ التأكيد يبقى عبر webhook `stay_booking`.
- تمرير تواريخ البحث من قائمة النتائج إلى صفحة التفاصيل.
- `browserPublicGet` + `idempotencyKey` اختياري لـ `browserPublicMutation`.

## تحقق

| فحص | نتيجة |
| --- | --- |
| العلم off → `/ar/stays` | notFound / سطح معتم |
| Web typecheck | قبل الدمج |

## تفعيل

يتطلّب Nest منشور بـ 0.4.4+، إعلان منشور، و`STAYS_PLATFORM_ENABLED` + allowlist.
