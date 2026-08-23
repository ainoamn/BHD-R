# ربط BHD R بهوية BHD الموحّدة — قيم التشغيل

المصادر المعتمدة (منسوخة داخل المستودع):

- [`BHD-PRODUCT-SSO-ADMIN.md`](./BHD-PRODUCT-SSO-ADMIN.md)
- [`BHD-UNIFIED-LOGIN-AND-APPS.md`](./BHD-UNIFIED-LOGIN-AND-APPS.md)
- [`BHD-APP-SWITCHER.md`](./BHD-APP-SWITCHER.md)

اكتشاف OIDC الحي: https://id.bhd-om.com/.well-known/openid-configuration  
واجهة الدخول الحالية: https://bhd-r-api-phi.vercel.app/ar/login → `/api/auth/bhd/start`

## حالة التسجيل الحية (23 أغسطس 2026)

- `bhd-r` مُدرَج في اكتشاف الهوية:  
  https://id.bhd-om.com/.well-known/openid-configuration → `clients` يتضمن `bhd-r`
- `redirect_uri` المسموح:  
  `https://bhd-r-api-phi.vercel.app/api/auth/bhd/callback`  
  (+ legacy `/v1/auth/oidc/callback` و`https://r.bhd-om.com/api/auth/bhd/callback` وlocalhost)
- سر العميل على Vercel: `BHD_OAUTH_CLIENT_SECRET` يطابق اشتقاق الهوية من `AUTH_SECRET` (`HMAC-SHA256` على `bhd-oauth:bhd-r`) ما لم يُضبط `BHD_OAUTH_CLIENT_SECRET_R` على ONE-BHD.
- كتالوج المشغّل في ONE-BHD: عنصر `bhd-r` بـ `mode: "sso"`.

## مسار المنتج الإلزامي (§3.1)

| المسار | السلوك |
| --- | --- |
| `GET /api/auth/bhd/start` | 302 إلى `https://id.bhd-om.com/oauth/authorize` + كوكي `bhd_oauth_state` |
| `GET /api/auth/bhd/callback` | تبديل الكود على الخادم → إنشاء جلسة محلياً عبر `DATABASE_URL` (أو `POST {API}/v1/auth/identity/session`) → كوكي `bhd_r_session` / `bhd_r_csrf` |
| `GET /api/auth/bhd/logout` | مسح جلسة المنتج ثم `…/oauth/end-session` |
| `GET /api/auth/admin-entry` | → `start?returnTo=/platform` (أو `next` الآمن) |

المسارات القديمة `/v1/auth/oidc/start|callback` تحوّل إلى المسارات أعلاه.

## جلسة الويب على Vercel (بدون Nest منفصل)

للنشر الحالي على `bhd-r-api` يكفي:

```env
DATABASE_URL=postgresql://…@…neon.tech/neondb?sslmode=require
BHD_IDENTITY_TOKEN_SECRET=<نفس IDENTITY_TOKEN_SECRET من الهوية>
BHD_R_SESSION_SECRET=<≥32>
CSRF_SECRET=<≥32>
```

قاعدة الإنتاج الحالية: مشروع Neon `nameless-shadow-43571265` (eu-west-2) —  
https://console.neon.tech/app/projects/nameless-shadow-43571265?database=neondb

`callback` ينشئ المستخدم/الجلسة مباشرة عبر `@bhd-r/db` عند وجود `DATABASE_URL`.  
`API_INTERNAL_ORIGIN` يبقى اختيارياً عندما يُنشر Nest API لاحقاً.

## ربط المستخدم (§3.3 / §0.7)

بعد التحقق من `id_token` في Nest `loginWithIdentity`:

1. `users.identity_subject = sub` موجود → حدّث الاسم وافتح الجلسة (الأدوار كما هي).
2. وإلا بريد موثّق + `identity_subject` فارغ → اربط `sub` واحتفظ بالعضويات/الأدوار.
3. وإلا أنشئ مستخدماً + مؤسسة فردية `starter` بدور `organization_owner` فقط (ليس `platform_admin`).
4. امسح جلسات المنتج السابقة وارفع `session_version` قبل إصدار الكوكي.

## 1) سجّل عميل `bhd-r` في الهوية (`one-bhd`)

```json
{
  "client_id": "bhd-r",
  "client_secret_hash": "<bcrypt للسر>",
  "redirect_uris": [
    "https://bhd-r-api-phi.vercel.app/api/auth/bhd/callback",
    "https://r.bhd-om.com/api/auth/bhd/callback",
    "http://localhost:3000/api/auth/bhd/callback"
  ],
  "post_logout_redirect_uris": [
    "https://bhd-r-api-phi.vercel.app/",
    "https://r.bhd-om.com/",
    "http://localhost:3000/"
  ],
  "scopes": ["openid", "profile", "email"],
  "first_party": true,
  "token_endpoint_auth_method": "client_secret_post"
}
```

بعد نجاح `GET {origin}/api/auth/bhd/start` بـ 302 إلى `id.bhd-om.com`، اطلب من ONE-BHD قلب عنصر المنتج في `apps.ts` إلى `mode: "sso"`.

## 2) متغيرات الويب على Vercel (`Root Directory = apps/web`)

```env
NEXT_PUBLIC_SITE_URL=https://bhd-r-api-phi.vercel.app
PUBLIC_SITE_URL=https://bhd-r-api-phi.vercel.app
WEB_ORIGIN=https://bhd-r-api-phi.vercel.app
BHD_IDENTITY_ISSUER=https://id.bhd-om.com
BHD_OAUTH_CLIENT_ID=bhd-r
BHD_OAUTH_CLIENT_SECRET=<سر العميل>
BHD_OAUTH_REDIRECT_URI=https://bhd-r-api-phi.vercel.app/api/auth/bhd/callback
BHD_OAUTH_POST_LOGOUT_REDIRECT_URI=https://bhd-r-api-phi.vercel.app/
BHD_R_SESSION_SECRET=<≥32 حرفاً>
API_INTERNAL_ORIGIN=https://YOUR-PUBLIC-HTTPS-API
COOKIE_SECURE=true
```

Aliases `BHD_IDENTITY_*` مدعومة أيضاً.

## 3) API (إلزامي لإتمام الجلسة)

الواجهة وحدها لا تكفي بعد عودة `code`. انشر Nest + Neon + Redis، ثم نفس أسرار الهوية + `DATABASE_URL` + `BHD_R_SESSION_SECRET` + `CSRF_SECRET` + `BHD_IDENTITY_TOKEN_SECRET` إن لزم HS256.

**ممنوع على Vercel:** `API_INTERNAL_ORIGIN=http://localhost:4000`.

## 4) غلاف الدخول (§3.2)

- `/ar/login` و`/en/login` → `/api/auth/bhd/start` إلا طوارئ `?local=1` (حساب مستأجر محلي).
- `local=1` مع مسار إدارة → `/api/auth/admin-entry`.
- لا زر Google على واجهة المنتج.

## 5) ما لا يُفعل

- لا تشارك `DATABASE_URL` مع منتجات أخرى أو الهوية.
- لا كوكي `Domain=.bhd-om.com`.
- لا تمنح أدوار مدير عبر الهوية.
- لا تستخدم `?local=1` لدخول الأدمن.
