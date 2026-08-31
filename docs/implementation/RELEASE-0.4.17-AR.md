# الإصدار 0.4.17 — إصلاح رفع صور العقار (Failed to fetch)

**التاريخ:** 2026-08-31  
**السطح:** معالج إضافة/تعديل عقار، `/api/owner/media`

## لماذا ما زالت الرسالة القديمة تظهر؟

النص `تم تحديث العقار، لكن رفع الصور فشل: Failed to fetch` مع بانرين (أخضر+أحمر) يأتي من **بناء Vercel قديم**. حتى تُنشر 0.4.15+، المتصفح يشغّل الكود القديم الذي يحاول رفع Nest مباشرة فيفشل CORS/`Failed to fetch`.

## الإصلاح في 0.4.17

1. الرفع من المتصفح → `POST /api/owner/media` كـ **JSON base64** (بعد ضغط الصورة).
2. الخادم: Neon/R2 أولاً؛ إن التخزين غير مضبوط → رفع عبر Nest **من السيرفر** (بدون CORS في المتصفح).
3. رسائل عربية واضحة؛ لا يُعرض `Failed to fetch` الخام.

## مطلوب منك على Vercel (مهم)

1. [Deployments](https://vercel.com) → مشروع `bhd-r-api` → أحدث commit على `main`.
2. `⋯` → **Redeploy** و**عطّل** Use existing Build Cache إن وُجد.
3. انتظر **Ready**.
4. في Environment Variables لـ Production تأكد من وجود:
   - `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET_PRIVATE`  
   **أو** على الأقل Nest Live + `API_INTERNAL_ORIGIN=https://bhd-r.onrender.com`
5. حدّث صفحة التعديل بقوة (Ctrl+Shift+R) ثم أعد حفظ صورة واحدة صغيرة.

## تحقق

- بعد Ready: رسالة الخطأ إن ظهرت يجب ألا تحتوي `Failed to fetch` حرفياً.
- بانر واحد فقط (خطأ أو نجاح)، لا الاثنين معاً بنفس النص.
