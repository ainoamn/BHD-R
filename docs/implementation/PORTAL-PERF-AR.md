# أداء التنقل والحفظ في البوابة (0.2.26)

## المشكلة

التنقل بين أقسام المالك/المطور والحفظ كان يستغرق عشرات الثواني (حتى ~80ث) بسبب:

1. **Render cold start** لكل طلب تقريباً
2. **فحص `/health/ready` إضافي** مع كل قسم تشغيل
3. روابط `<a href>` كاملة تعيد تحميل المستند بدل soft navigation
4. **CSRF جديد** قبل كل `browserMutation` (نية رفع + إكمال × عدد الملفات)
5. رفع الصور **بالتسلسل**
6. Next 15+ `staleTimes.dynamic = 0` → إعادة جلب الصفحة في كل نقرة

## ما تم

| إجراء | أثر |
| --- | --- |
| `NestKeepAlive` + `/api/warm` | إبقاء Nest دافئاً أثناء جلسة البوابة |
| إزالة `probeNestReady` من كل قسم | نصف زمن التنقل عند البرد |
| `Link` + `prefetch` بدل `<a>` في ops/portal | تنقل بدون reload كامل |
| تخزين CSRF مؤقت + إعادة محاولة عند 403 | أقل رحلات شبكة عند الحفظ |
| رفع وسائط بتوازي (3) | حفظ أسرع بكثير مع عدة صور |
| `experimental.staleTimes` | إبقاء مقاطع البوابة في كاش العميل 30–180ث |

## ملفات

- `apps/web/src/lib/api.ts`
- `apps/web/src/components/nest-keep-alive.tsx`
- `apps/web/src/app/api/warm/route.ts`
- `apps/web/src/components/portal-shell.tsx`
- `apps/web/src/components/operations-workspace.tsx`
- `apps/web/src/components/operations-console.tsx`
- `apps/web/src/components/portal-section.tsx`
- `apps/web/src/components/property-wizard.tsx`
- `apps/web/next.config.ts`

## تحقق

1. افتح `/ar/owner` وانتظر ~3ث (warm)
2. تنقّل بين الفواتير / العقود / لوحة التحكم — يجب أن يبدو سلساً بعد الزيارة الأولى
3. احفظ عقاراً بصورتين — أسرع من التسلسل السابق؛ لا يظهر Failed to fetch إن كان Nest Live ≥ 0.2.25

**ملاحظة:** الخدمة المجانية على Render قد تنام بعد خمول طويل؛ KeepAlive يخفّف ذلك أثناء فتح البوابة فقط. للإنتاج الثقيل يُفضّل Always-on.
