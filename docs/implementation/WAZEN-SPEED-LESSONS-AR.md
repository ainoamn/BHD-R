# سرعة الصفحات: دروس وازن (WAZEN) مقابل BHD-R

مرجع وازن: [ainoamn/WAZEN](https://github.com/ainoamn/WAZEN) — خصوصاً `docs/HANDOFF-2026-08-13.md` («تسريع التنقل»).

## لماذا وازن سريع؟

| عامل | وازن | BHD-R (قبل 0.2.31) |
| --- | --- | --- |
| مصدر بيانات اللوحة | Next على Vercel يقرأ **Neon مباشرة** (`DATABASE_URL`) عبر `/api/dashboard` | اللوحة كانت تستدعي **Nest على Render** عبر `/v1/.../overview` |
| اعتماد API طويل الأمد | لا يوجد Nest منفصل للوحة | كل صفحة تنتظر Render (نوم/تعطل = 30–100ث) |
| تنقّل | شريط تقدّم رفيع فقط بعد ~120ms — بلا شاشة شعار كاملة | هيكل تحميل أوسع + انتظار Nest |
| كاش تنقّل | تنقّل داخلي مع كاش عميل | `staleTimes` موجود؛ رُفع في 0.2.31 |

مقتطف وازن (README): اللوحة `/dashboard` — «تنقّل داخلي مع كاش، بلا شاشة شعار».

## ما طُبّق في BHD-R (0.2.31)

1. **`loadPortalOverview`** — إن وُجد `DATABASE_URL` على Vercel تُقرأ إحصائيات المالك/المطور/المستأجر من Neon مباشرة (نفس أسلوب وازن)، بدون انتظار Nest.
2. **`NavigationProgress`** — شريط علوي خفيف مثل وازن.
3. **`staleTimes`** — dynamic 60ث / static 300ث لتقليل إعادة الجلب عند التنقّل.
4. إن لم تتوفر القاعدة: مهلة Nest قصيرة (~4ث) ثم لوحة فارغة بدل التعليق.

## ما يبقى بطيئاً حتى يُصلح Render

أقسام التشغيل (فواتير، عقود، …) ما زالت تمر عبر Nest (`OperationsWorkspace`).  
طالما [`https://bhd-r.onrender.com/health/ready`](https://bhd-r.onrender.com/health/ready) لا يرد، تلك الصفحات تظهر بانر Nest أو تفرّغ خلال مهلة قصيرة.

**لوحة التحكم `/ar/owner` يجب أن تفتح بسرعة** بعد نشر 0.2.31 إذا كان `DATABASE_URL` مضبوطاً على Vercel (كما في وازن).

## تحقق

1. Vercel → `DATABASE_URL` موجود على Preview + Production.
2. افتح `/ar/owner` مسجّلاً — يجب أن تظهر المقاييس خلال ثوانٍ حتى لو Nest نائم.
3. افتح `/ar/owner/invoices` — إن Nest down ستظهر بانر؛ أصلح Render للحفظ والعمليات.
