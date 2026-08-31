# الإصدار 0.4.8 — توجيه دفع الإقامة عبر بوابة المزوّد (sandbox)

**التاريخ:** 2026-08-31  
**العلم:** مغلق افتراضياً — `POST /v1/public/stays/payment-sessions` يردّ 404 حتى التفعيل.

## ماذا أُضيف؟

- `POST /v1/public/stays/payment-sessions` — جلسة دفع لـ `stay_payment_intents` (sandbox) مع `Idempotency-Key` و`returnPath`.
- مرجع الجلسة يُخزَّن في `provider_intent_id` دون تغيير جدول فواتير `payment_sessions`.
- `sandbox-complete` يدعم فواتير **و** إقامات (`kind: stay_booking` عبر نفس مسار التأكيد).
- زر **ادفع الآن** في `StayCheckout` يحوّل لصفحة `/payments/sandbox/...`.

## تدفق

1. Quote → Hold → Booking + payment intent (0.4.4/0.4.5)  
2. Payment session → redirect مزوّد  
3. Sandbox confirm → booking `confirmed`  

## تحقق

| فحص | نتيجة |
| --- | --- |
| العلم off → payment-sessions | 404 |
| API/Web typecheck | قبل الدمج |

## تفعيل

`STAYS_PLATFORM_ENABLED` + allowlist + `PAYMENT_SANDBOX_ENABLED=true` (غير production) أو بوابة sandbox للمنظمة.
