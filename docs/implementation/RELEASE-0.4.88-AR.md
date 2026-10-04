# BHD R 0.4.88 — تطبيق سياسة جلسة BHD

**المرجع:** [`docs/BHD-SESSION-POLICY.md`](../BHD-SESSION-POLICY.md) (منسوخ حرفياً من [ainoamn/ONE-BHD](https://github.com/ainoamn/ONE-BHD/blob/main/docs/BHD-SESSION-POLICY.md)).

## القاعدة
المستخدم يبقى مسجّل الدخول طالما لم يضغط «خروج».

## ما تغيّر مقابل كل بند في السياسة

| بند السياسة | قبل | بعد |
| --- | --- | --- |
| لا مهلة خمول | JWT + صف `sessions` + كوكي = 8 ساعات | 400 يوم (`PRODUCT_SESSION_MAX_AGE_SECONDS` في `@bhd-r/authz`) في الويب و Nest |
| JWT `exp` يطابق `maxAge` | — | نفس الثابت للـ JWT والكوكي و`expiresAt` |
| لا `SessionKeepAlive` / مستمعي `visibilitychange`/`focus` | `NestKeepAlive` يرسل نبضات عند عودة التبويب؛ `PortalRoutePrefetch` يرسل prefetch عند `visibilitychange` | أُزيلت المستمعات؛ يبقى مؤقّت دوري فقط لا يلمس الجلسة (`/api/warm` بلا كوكيات) |
| `GET /api/auth/me` بلا `Set-Cookie` | كان متوافقاً | بلا تغيير |
| لا `router.refresh()` تلقائي | لا يوجد | بلا تغيير |
| لا Google One Tap | لا يوجد في المنتج | بلا تغيير |
| انتهاء جلسة المنتج → تحويل صامت واحد | تحويل إلى `/login` ثم `/api/auth/bhd/start` | تحويل مباشر إلى `/api/auth/bhd/start?returnTo=/{locale}/{portal}` |
| الخروج = زر «خروج» → `POST` ثم `end-session` | `GET` عبر `location.assign` ومسح الكوكي فقط | نموذج `POST` يبطل صف الجلسة في Neon ثم يمسح الكوكي ويحوّل إلى `end-session` |
| لا خروج صامت | أي رابط `GET` من موقع آخر يُخرج المستخدم | `GET`/`POST` من `cross-site`/`same-site` لا يُخرج |
| البقاء مع تعدد الأجهزة | الدخول من جهاز جديد يبطل كل الجلسات ويرفع `sessionVersion` | لا يُبطل الجلسات الأخرى |
| Host-only / HttpOnly / Secure / Lax | متوافق | بلا تغيير |

## ملفات
- `packages/authz/src/index.ts` — `PRODUCT_SESSION_MAX_AGE_SECONDS`
- `apps/web/src/lib/bhd/identity-session.ts` — مدة 400 يوم؛ لا إبطال عند الدخول
- `apps/web/src/app/api/auth/bhd/callback/route.ts`، `csrf/route.ts` — `maxAge` 400 يوم
- `apps/web/src/app/api/auth/bhd/logout/route.ts` — إبطال الجلسة + حماية من الخروج الصامت
- `apps/web/src/components/bhd-app-switcher.tsx` — خروج عبر `POST`
- `apps/web/src/proxy.ts` — `form-action` يسمح بتحويل الهوية بعد الخروج
- `apps/web/src/components/nest-keep-alive.tsx`، `portal-route-prefetch.tsx` — إزالة مستمعي الرجوع للتبويب
- `apps/web/src/lib/viewer.ts` — تحويل صامت مباشر إلى الهوية
- `apps/api/src/auth/auth.service.ts`، `auth.controller.ts` — نفس المدة ونفس قاعدة عدم الإبطال

## ملاحظة على الجلسات الحالية
الجلسات المُصدرة قبل هذا الإصدار تنتهي بعد 8 ساعات من إصدارها. عند انتهائها يحدث تحويل صامت واحد إلى الهوية (بلا شاشة دخول إن كانت `bhd_id` قائمة) فتُصدر جلسة جديدة بمدة 400 يوم.

## اختبار القبول (من السياسة)
- [ ] ادخل → أغلق التبويب ساعة أو أكثر → افتح الموقع: ما زلت داخلاً، بلا وميض تحديث، بلا شاشة جوجل.
- [ ] أغلق المتصفح بالكامل ثم افتحه على نفس الموقع: داخل، بلا طلب دخول.
- [ ] اضغط «خروج»: تُطلب شاشة الدخول في المرة التالية.
- [ ] من منتج آخر بينما الجلسة قائمة: تنقّل صامت بلا كلمة مرور وبلا جوجل.
