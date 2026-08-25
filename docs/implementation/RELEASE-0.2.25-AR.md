# إصدار 0.2.25 — رفع وتوثيق ونشر (2026-08-25)

**Commit:** `6e5b607` على [`ainoamn/BHD-R`](https://github.com/ainoamn/BHD-R) الفرع `main`  
**يشمل أيضاً:** `0.2.23` (جوال)، `0.2.24` (رفع وسائط / Failed to fetch)

## ماذا يُنشر وأين

| سطح | مضيف | مصدر | ملاحظة |
| --- | --- | --- | --- |
| واجهة | Vercel مشروع `bhd-r-api` → `https://r.bhd-om.com` | Auto من `main` | Root = `apps/web` |
| API | Render → `https://bhd-r.onrender.com` | Auto Docker `Dockerfile.api` | يجب أن يصبح **Live** على `6e5b607+` |

## سلسلة المشاكل التي يغطيها الإصدار

1. **لوحة التحكم على الجوال / القائمة لا تختفي** → `0.2.23`
2. **حفظ عقار → Failed to fetch** → رفع عبر Nest ingress بدل S3 من المتصفح (`0.2.24`) + CSP
3. **Render Deploy failed** منذ `5766f9a` → خطأ TypeScript في CORS (`corsOriginDelegate` بنمط Express غير متوافق مع Nest) أصلحه `0.2.25`

طالما Render عالق على نسخة أقدم من `6e5b607`، مسار `PUT /v1/media/ingress/:token` غير موجود وFailed to fetch يبقى.

## التحقق بعد Live

1. Render: Deploy لـ `6e5b607` (أو أحدث) = **Live** وليس Failed  
2. `GET https://bhd-r.onrender.com/health/ready` → `{"status":"ready",...}`  
3. Vercel: أحدث Deployment من `main` = Ready  
4. تسجيل دخول → `/ar/owner/properties/new` → إكمال المعالج مع صورتين → **حفظ العقار والوحدات** بدون Failed to fetch  
5. على هاتف ≤960px: القائمة مخفية حتى ☰  

## متغيرات ضرورية

**Vercel:** `API_INTERNAL_ORIGIN` / `API_ORIGIN` = `https://bhd-r.onrender.com`  
**Render:** `WEB_ORIGIN` / `PUBLIC_WEB_ORIGIN` = `https://r.bhd-om.com`؛ يُفضّل `PUBLIC_NEST_ORIGIN=https://bhd-r.onrender.com`  
نفس `BHD_R_SESSION_SECRET` و`CSRF_SECRET` بين السطحين.

## وثائق مرتبطة

- [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md) — استضافة Nest + CORS build fix + media ingress  
- [`PROPERTY-WIZARD-AR.md`](./PROPERTY-WIZARD-AR.md) — المعالج والحفظ  
- [`PORTAL-DASHBOARD-AR.md`](./PORTAL-DASHBOARD-AR.md) / [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md) — لوحة التحكم والجوال  
- [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md) — ضبط Vercel يدوياً  
- [`CHANGELOG.md`](../../CHANGELOG.md) — سجل الإصدارات  
