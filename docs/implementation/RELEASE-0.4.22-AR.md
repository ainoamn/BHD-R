# الإصدار 0.4.22 — إعداد الإقامة: حفظ عبر Vercel/Neon

**التاريخ:** 2026-09-01

## المشكلة

- رسالة: «تم التحميل من قاعدة البيانات (Nest: 503…). الحفظ يتطلب Nest»
- **حفظ ومتابعة** يفشل مع `Failed to fetch` (BFF → Render Nest timeout)
- زر «إعداد الإقامة اليومية» كان رابطاً نصياً غير بارز
- المعالج لا يعرض ملخص العقار كما في المحفظة

## الإصلاح

- **تحميل وحفظ** إعداد الإقامة عبر Next على Vercel مباشرة إلى Neon:
  - `GET /api/owner/stays/setup/context`
  - `POST /api/owner/stays/setup` (unit-types, profiles, rate-plan, listing, publish)
- بطاقة ملخص العقار + جدول وحدات منظم في المعالج
- زر «إعداد الإقامة اليومية» ضمن أزرار إجراءات العقار

## مطلوب منك

1. **Vercel Production redeploy** (يتم تلقائياً عند دفع `main` أو `vercel deploy --prod`)
2. تأكد `DATABASE_URL` مضبوط على Vercel (مطلوب للحفظ)
3. Nest على Render **اختياري** لخطوات الإعداد — مطلوب لاحقاً لمزامنة المخزون عبر outbox

## تحقق

1. `/ar/owner/properties/:id` → زر «إعداد الإقامة اليومية» بارز
2. `/ar/owner/stays/setup?propertyId=…` → بدون رسالة Nest 503
3. اختر وحدات → **حفظ ومتابعة** → ينتقل للخطوة 2
