# الإصدار 0.4.1 — stay_booking webhook + أقفال المخزون الحية

**التاريخ:** 2026-08-31  
**العلم:** `STAYS_PLATFORM_ENABLED` ما زال مغلقاً افتراضياً.

## ماذا أُضيف؟

- Webhook الدفع `kind: stay_booking` + `paymentIntentId` (Expand–Contract مع `invoice` و `reservation_deposit`).
- تأكيد الحجز: مطابقة المبلغ/العملة، حدث فريد، ترقية القفل hold→booking، قيد `stay_payment`، outbox/history.
- `StaysInventoryService` حي: advisory lock + تحرير holds المنتهية + إدراج GiST + outbox.
- اختبار تكامل GiST (يتطلب `STAYS_LOCK_DATABASE_URL` أو `TEST_DATABASE_URL`).
- محاكي: `scripts/simulate-stay-booking-webhook.mjs`.

## تحقق سريع

| فحص | نتيجة متوقعة |
| --- | --- |
| `POST` webhook بلا حقول stay_booking | 400 |
| تداخل قفل نشط على نفس الوحدة | رفض EXCLUDE |
| نطاقات متلامسة عند checkout | مسموح |
| `/ar/stays` والعلم off | 404 |

## ملاحظة نشر (Vercel / Render)

فشل نشر Production لـ `92b0b1c` في لوحة مشروع **`bhd-r-api`** (Next) لا يعني أن الكود غير قابل للبناء على tip الحالي — أُعيد التحقق في 0.4.14 (`turbo` api+web ناجح؛ Nest `/healthz` Live). تجاهل Preview على فروع `feat/*` و dependabot؛ انشر دائماً من `main` الأخير. التفاصيل: [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md).

## تفعيل طيار (بشري)

1. إعادة نشر Nest (Render) لاستلام Finance/Stays.
2. إبقاء العلم مغلقاً حتى org طيار + allowlist.
