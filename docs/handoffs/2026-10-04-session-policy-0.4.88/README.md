# تسليم — تطبيق سياسة جلسة BHD (0.4.88)

**التاريخ:** 2026-10-04 (مسقط UTC+4)  
**المستودع:** https://github.com/ainoamn/BHD-R — الفرع `main`  
**الإنتاج:** https://r.bhd-om.com  
**الطلب:** «طبّق حرفياً ما جاء في [`BHD-SESSION-POLICY.md`](https://github.com/ainoamn/ONE-BHD/blob/main/docs/BHD-SESSION-POLICY.md)»

## على الجهاز الآخر

```bash
git pull origin main
pnpm install --frozen-lockfile
pnpm --filter @bhd-r/authz --filter @bhd-r/db run build
```

## ماذا تم

1. **نسخ السياسة حرفياً** إلى [`docs/BHD-SESSION-POLICY.md`](../../BHD-SESSION-POLICY.md).
2. **مدة الجلسة 400 يوم** بدل 8 ساعات — ثابت واحد `PRODUCT_SESSION_MAX_AGE_SECONDS` في `@bhd-r/authz` يُستخدم للـ JWT وصف `sessions` والكوكيات، في الويب (Vercel) و Nest.
3. **لا إبطال للأجهزة الأخرى عند الدخول** (كان الدخول من جهاز جديد يُخرج كل الأجهزة).
4. **إزالة مستمعي عودة التبويب:** `NestKeepAlive` (`visibilitychange` + `focus`) و`PortalRoutePrefetch` (`visibilitychange`).
5. **تحويل صامت مباشر** عند انتهاء جلسة المنتج إلى `/api/auth/bhd/start` بدل المرور بصفحة `/login`.
6. **الخروج:** زر «تسجيل الخروج» أصبح نموذج `POST`؛ المسار يبطل صف الجلسة في Neon ثم يمسح الكوكيات ثم `end-session`. الطلبات من مواقع أخرى لا تُخرج المستخدم.
7. **CSP:** `form-action` يسمح بـ `https://id.bhd-om.com` حتى يعمل تحويل الخروج.
8. توثيق: `RELEASE-0.4.88-AR.md`، `STATUS.md`، `BHD-R-IDENTITY-SETUP.md`، `CHANGELOG.md`.

## ما كان متوافقاً أصلاً
- `GET /api/auth/me` لا يكتب كوكي.
- لا `router.refresh()` تلقائي عند عودة التبويب.
- لا Google One Tap في المنتج.
- الكوكي Host-only + HttpOnly + Secure + SameSite=Lax.

## دمج مع الجهاز الآخر
سُحبت commits حتى 0.4.87 قبل الرفع. حُلّ تعارضان (`bhd-app-switcher.tsx`، `proxy.ts`) مع الإبقاء على تعديلات الجهاز الآخر (باراميتر `locale` في الخروج، أصول صور R2 في CSP).

## الفحوص
- `tsc` للويب و API: ناجح.
- `eslint` على الملفات المعدّلة: ناجح.
- `vitest`: فشل اختباران في `next-write-route-policy.test.ts` **موجودان قبل هذا التغيير** (مسارات الإقامات العامة وCSRF)، لا علاقة لهما بالجلسة.

## النشر
- رمز Vercel على هذا الجهاز كان منتهياً؛ النشر يتم بعد `vercel login`.
- Nest على Render يُنشر من Git (إن كان مفعّلاً تلقائياً).

## اختبار القبول
- [ ] ادخل ← أغلق التبويب ساعة ← افتح: ما زلت داخلاً بلا وميض ولا جوجل.
- [ ] أغلق المتصفح وافتحه: داخل.
- [ ] «خروج»: المرة التالية تُطلب الهوية.
- [ ] من منتج آخر: تنقّل صامت.
- [ ] الجلسات القديمة (8 ساعات) تمر بتحويل صامت واحد ثم تحصل على 400 يوم.

## مهام مفتوحة
- إصلاح اختبارَي `next-write-route-policy` (سابقان لهذا العمل).
