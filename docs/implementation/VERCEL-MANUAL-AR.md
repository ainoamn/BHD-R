# ما تقوم به يدوياً على Vercel — حرفياً

**المشروع:** `bhd-r-api`  
**اللوحة:** [vercel.com → bhd-r-api](https://vercel.com/bhdom89-8158s-projects/bhd-r-api)  
**النطاق:** `https://r.bhd-om.com`

> Nest API **ليس** داخل مشروع Vercel هذا (Root = `apps/web` فقط).  
> رابط Nest يأتي من Render/Fly/VM أولاً، ثم تلصقه هنا.

---

## أ) الآن — تحقق فقط (لا تغيّر شيئاً إن كانت القيم صحيحة)

1. افتح المشروع **bhd-r-api**.
2. من الشريط الجانبي: **Settings** → **Environment Variables**.
3. تأكد أن هذه موجودة لـ **Production** و **Preview** (موجودة حالياً حسب الفحص):
   - `DATABASE_URL`
   - `NEXT_PUBLIC_SITE_URL` = `https://r.bhd-om.com`
   - `COOKIE_SECURE` = `true`
   - `BHD_IDENTITY_ISSUER` = `https://id.bhd-om.com`
   - `BHD_OAUTH_CLIENT_ID` = `bhd-r`
   - `BHD_OAUTH_CLIENT_SECRET`
   - `BHD_OAUTH_REDIRECT_URI` = `https://r.bhd-om.com/api/auth/bhd/callback`
   - `BHD_IDENTITY_REDIRECT_URI` = `https://r.bhd-om.com/api/auth/bhd/callback`
   - `BHD_IDENTITY_CLIENT_SECRET`
   - `BHD_IDENTITY_TOKEN_SECRET` / `IDENTITY_TOKEN_SECRET`
   - `BHD_R_SESSION_SECRET`
   - `CSRF_SECRET`

4. **لا تضف** الآن:
   - `API_INTERNAL_ORIGIN=http://localhost:4000` ← ممنوع على Vercel (يعلّق الطلبات).

---

## ب) بعد أن يصبح Nest على HTTPS عام (Render وغيره)

احصل على الرابط أولاً، مثال: `https://bhd-r-api.onrender.com` أو `https://api.r.bhd-om.com`.

ثم في Vercel → **Settings** → **Environment Variables**:

### 1) أضف `API_INTERNAL_ORIGIN`
1. اضغط **Add New**.
2. **Key:** `API_INTERNAL_ORIGIN`
3. **Value:** الصق رابط Nest بالكامل **بدون** شرطة في النهاية  
   مثال: `https://bhd-r-api.onrender.com`
4. فعّل البيئات: **Production** و **Preview** (و Development إن ظهر).
5. احفظ **Save**.

### 2) أضف `API_ORIGIN`
1. **Add New** مرة أخرى.
2. **Key:** `API_ORIGIN`
3. **Value:** **نفس** قيمة `API_INTERNAL_ORIGIN` حرفياً.
4. البيئات: **Production** + **Preview**.
5. **Save**.

### 3) (موصى به) تأكيد عناوين الموقع
إن لم تكن موجودة، أضف لـ Production + Preview:

| Key | Value |
|-----|--------|
| `PUBLIC_WEB_ORIGIN` | `https://r.bhd-om.com` |
| `NEXT_PUBLIC_API_ORIGIN` | `https://r.bhd-om.com` |
| `PUBLIC_API_ORIGIN` | `https://r.bhd-om.com` |

(`NEXT_PUBLIC_SITE_URL` موجود مسبقاً — لا حاجة لتكراره إن كان `https://r.bhd-om.com`).

### 4) أعد النشر
1. الشريط الجانبي: **Deployments**.
2. افتح أحدث نشر **Ready** على الفرع `main`.
3. القائمة `⋯` → **Redeploy**.
4. ألغِ خيار استخدام Build Cache إن ظهر خيار واضح لذلك (أو اتركه إن لم يظهر).
5. انتظر حتى يصبح الحالة **Ready**.

### 5) تحقق سريع
1. افتح `https://r.bhd-om.com` وسجّل الدخول.
2. جرّب صفحة مالك/مستأجر أو حجوزات — يجب أن تُحمَّل بيانات `/v1` بدل فراغ دائم.
3. من المتصفح أو curl: `https://YOUR-NEST-HOST/health/ready` يجب أن يرجع نجاحاً.

---

## ج) تدوير كلمة مرور Neon (مهم أمنياً)

إذا كانت كلمة مرور قاعدة البيانات ظهرت سابقاً في محادثة:

1. Neon Console → المشروع → **Reset role password** / rotate.
2. انسخ connection string الجديدة.
3. Vercel → **Environment Variables** → `DATABASE_URL`:
   - عدّل **Production**
   - عدّل **Preview**
4. الصق السلسلة **بدون** `channel_binding=...` إن سبّب مشاكل سابقاً (اتبع ما نجح معك).
5. **Deployments** → **Redeploy**.
6. إن كان Nest على Render: حدّث `DATABASE_URL` هناك أيضاً بنفس القيمة المناسبة لدور الـ API.

---

## د) ما لا تفعله على Vercel

- لا تغيّر **Root Directory** عن `apps/web`.
- لا تحاول نشر Nest داخل نفس مشروع الويب كبديل عن `API_INTERNAL_ORIGIN`.
- لا تضع أسرار DB في متغيرات `NEXT_PUBLIC_*`.

---

## ترتيب العمل الصحيح

```
1) انشر Nest على Render (من render.yaml) واحصل على HTTPS
2) نفّذ القسم (ب) أعلاه على Vercel
3) Redeploy الويب
4) اختبر SSO + حجز/محاسبة
```

## هـ) رسالة «تعذّر الوصول إلى Nest API» على الشاشة

هذه الرسالة تعني أن **واجهة Next على Vercel تعمل**، لكن طلبات `/v1/*` لا تصل إلى خادم Nest.

| السبب الشائع | ماذا تفعل |
|--------------|-----------|
| Nest لم يُنشَر بعد | أنشئ خدمة Docker من `Dockerfile.api` / `render.yaml` على Render |
| `API_INTERNAL_ORIGIN=http://localhost:4000` | احذفها أو استبدلها برابط Nest **HTTPS** العام |
| Nest نائم/معطل على Render | افتح الخدمة → Logs → تأكد أن `/health/ready` يرجع 200 |
| نسيت Redeploy بعد تغيير المتغيرات | Deployments → Redeploy Production |

**تحقق سريع:** في المتصفح افتح  
`https://YOUR-NEST-HOST/health/ready`  
إن لم يفتح أو فشل → المشكلة في Nest وليس في صفحة العقارات.

دليل Nest التفصيلي: [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)
