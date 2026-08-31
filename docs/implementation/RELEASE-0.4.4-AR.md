# الإصدار 0.4.4 — عرض سعر → حجز مؤقت → نية دفع (ضيف عام)

**التاريخ:** 2026-08-31  
**العلم:** `STAYS_PLATFORM_ENABLED` مغلق افتراضياً — كل مسارات الضيف تردّ 404 حتى التفعيل.

## ماذا أُضيف؟

- `GET /v1/public/stays/:slug/availability` — توافر النطاق والضيوف.
- `POST /v1/public/stays/:slug/quotes` — تسعير ليلي + رسوم تنظيف عبر domain `quoteStay`.
- `POST /v1/public/stays/holds` — قفل GiST + صف `stay_holds` (يتطلّب `Idempotency-Key`).
- `POST /v1/public/stays/bookings` — حجز من الحجز المؤقّت + folio + `stay_payment_intents` (يتطلّب `Idempotency-Key`).
- تأكيد الدفع يبقى عبر webhook `kind: stay_booking` (0.4.1).
- Contracts: `createStayQuoteSchema` / hold / booking / availability.
- واجهة التفاصيل: إشارة أن مسار Nest جاهز؛ UI تفاعلي مع الطيار.

## تدفق

1. Quote (TTL ~30 د)  
2. Hold (TTL ~15 د، قفل مخزون)  
3. Booking + payment intent  
4. مزوّد الدفع → webhook → confirmed

## تحقق

| فحص | نتيجة |
| --- | --- |
| العلم off → quotes / holds / bookings / availability | 404 |
| Domain + API typecheck | يُشغَّل قبل الدمج |

## تفعيل

نفس 0.4.3: إعلان منشور + projector + `STAYS_PLATFORM_ENABLED` + allowlist، ثم مسار الدفع الحقيقي بشرياً.
