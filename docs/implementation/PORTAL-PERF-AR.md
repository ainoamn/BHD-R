# أداء التنقل والحفظ في البوابة (0.2.26 → 0.2.28)

## المشكلة

التنقل بين أقسام المالك/المطور والحفظ كان يستغرق عشرات الثواني (حتى ~80ث) ويومض بين هياكل تحميل بسبب:

1. **Nest على Render نائم أو متوقف** — إن `GET /health/ready` لا يرد خلال ثوانٍ، كل `/v1/*` يعلّق الصفحة
2. **فحص `/health/ready` إضافي** مع كل قسم تشغيل (أُزيل في 0.2.26)
3. روابط `<a href>` كاملة تعيد تحميل المستند بدل soft navigation
4. **وميض الـ layout** — `PortalShell` كان ينتظر DB كاملة في كل تنقل فيظهر `loading` فوق الشريط الجانبي
5. **CSRF جديد** قبل كل `browserMutation` + رفع صور بالتسلسل
6. Next 15+ `staleTimes.dynamic = 0` → إعادة جلب الصفحة في كل نقرة
7. **عاصفة prefetch** من كل روابط الشريط الجانبي دفعة واحدة بينما Nest بارد

## ما تم

| إصدار | إجراء | أثر |
| --- | --- | --- |
| 0.2.26 | `NestKeepAlive` + `/api/warm` | إبقاء Nest دافئاً أثناء جلسة البوابة |
| 0.2.26 | إزالة `probeNestReady` من كل قسم | نصف زمن التنقل عند البرد |
| 0.2.26 | `Link` + prefetch في ops console | تنقل بدون reload كامل |
| 0.2.26 | CSRF مؤقت + رفع متوازٍ + `staleTimes` | حفظ وتنقل أسرع |
| 0.2.27 | مهلات BFF + أخطاء عربية عند Nest down | لا تعليق ~160ث عند الحفظ |
| 0.2.28 | `requirePortalShell` (JWT ≤900ms DB) | الشريط العلوي/الجانبي يثبت؛ يقل الوميض |
| 0.2.28 | شريط تحميل نحيف فقط | بدون هيكل صفحة وهمية |
| 0.2.28 | `prefetch={false}` في الشريط الجانبي | لا عاصفة RSC عند Nest down |
| 0.2.28 | Cron `/api/cron/warmup-nest` كل 5 دقائق | إبقاء Nest دافئاً بين الزيارات |
| 0.2.70 | كاش عميل لأقسام التشغيل + `/api/portal/ops` | تنقّل فوري بعد التسخين الخلفي |
| 0.2.79 | `Link` prefetch في إدارة العقار + بطاقات القائمة + كاش صور أطول؛ تعطيل sandbox الحجز في الإنتاج | تنقّل أنعم + إغلاق P0-01 جزئياً |

## ملفات

- `apps/web/src/lib/viewer.ts` (`getShellViewer` / `requirePortalShell`)
- `apps/web/src/lib/api.ts` / `server-api.ts`
- `apps/web/src/components/nest-keep-alive.tsx`
- `apps/web/src/app/api/warm/route.ts`
- `apps/web/src/app/api/cron/warmup-nest/route.ts`
- `apps/web/vercel.json` (crons)
- `apps/web/src/components/portal-shell.tsx` / `portal-nav.tsx` / `portal-loading.tsx`
- `apps/web/src/components/operations-workspace.tsx` / `operations-console.tsx`
- `apps/web/next.config.ts`

## ما يجب عمله يدوياً إن بقي البطء

1. افتح [Render](https://dashboard.render.com) → خدمة Nest (`bhd-r.onrender.com`).
2. راجع **Logs** ونفّذ **Manual Deploy** حتى يرجع `/health/ready` → 200 خلال ثوانٍ.
3. على Vercel أضف `CRON_SECRET` (عشوائي ≥24) لـ Production/Preview.
4. أعد تجربة [معاينة المالك](https://bhd-r-api-phi.vercel.app/ar/owner).

## تحقق سريع

1. افتح `/ar/owner` — يجب ظهور الشريط دون وميض صفحات كاملة.
2. تنقّل بين الفواتير / العقود — شريط تقدّم نحيف فقط داخل المحتوى.
3. إن ظهرت بانر «Nest غير متصل»: اضغط إعادة الاتصال أو أصلح Render أولاً.

**ملاحظة:** KeepAlive أثناء الجلسة + Cron كل 5 دقائق يخفّفان النوم؛ للإنتاج الثقيل يُفضّل Always-on على Render.
