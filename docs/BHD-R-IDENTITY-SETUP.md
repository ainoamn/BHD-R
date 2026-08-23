# ربط BHD R بهوية BHD الموحّدة — قيم التشغيل

المصدر المعتمد: [docs/BHD-IDENTITY-SSO.md في ONE-BHD](https://github.com/ainoamn/ONE-BHD/blob/main/docs/BHD-IDENTITY-SSO.md)  
اكتشاف OIDC الحي: https://one-bhd.vercel.app/.well-known/openid-configuration  
واجهة الدخول الحالية: https://bhd-r-api-phi.vercel.app/ar/login

## لماذا ظهر `DNS_HOSTNAME_RESOLVED_PRIVATE`؟

الويب يعيد كتابة `/v1/*` إلى `API_INTERNAL_ORIGIN`. إن بقي الافتراضي `http://localhost:4000` فإن شبكة Vercel ترفض العنوان الخاص. تم تعطيل إعادة الكتابة إلى عناوين خاصة على Vercel، مع مسار احتياطي لبدء OIDC من Next.

## 1) سجّل عميل `bhd-r` في مشروع الهوية (`one-bhd`)

أضف إلى `BHD_OAUTH_CLIENTS` / جدول العملاء (نفس شكل وازن/حسابي):

```json
{
  "client_id": "bhd-r",
  "client_secret_hash": "<bcrypt للسر>",
  "redirect_uris": [
    "https://bhd-r-api-phi.vercel.app/v1/auth/oidc/callback",
    "https://r.bhd-om.com/v1/auth/oidc/callback",
    "http://localhost:3000/v1/auth/oidc/callback"
  ],
  "scopes": ["openid", "profile", "email"],
  "first_party": true,
  "token_endpoint_auth_method": "client_secret_post"
}
```

ملاحظة: قائمة الاكتشاف الحالية تضم `bhd-baitak` وليس `bhd-r` بعد. حتى يُضاف `bhd-r` يمكن مؤقتاً استخدام `bhd-baitak` إذا كان redirect محدّثاً لنطاق BHD R — لكن القرار المعتمد للمنتج هو **`bhd-r`**.

## 2) متغيرات مشروع الويب على Vercel (`bhd-r-api` / الجذر `apps/web`)

```env
NEXT_PUBLIC_SITE_URL=https://bhd-r-api-phi.vercel.app
PUBLIC_SITE_URL=https://bhd-r-api-phi.vercel.app
WEB_ORIGIN=https://bhd-r-api-phi.vercel.app
BHD_IDENTITY_ISSUER=https://id.bhd-om.com
BHD_OAUTH_CLIENT_ID=bhd-r
BHD_OAUTH_CLIENT_SECRET=<سر العميل من الهوية>
BHD_OAUTH_REDIRECT_URI=https://bhd-r-api-phi.vercel.app/v1/auth/oidc/callback
BHD_IDENTITY_CLIENT_ID=bhd-r
BHD_IDENTITY_CLIENT_SECRET=<نفس السر>
BHD_IDENTITY_REDIRECT_URI=https://bhd-r-api-phi.vercel.app/v1/auth/oidc/callback
COOKIE_SECURE=true
```

Aliases `BHD_OAUTH_*` و`BHD_IDENTITY_*` مدعومة معاً حسب مواصفة ONE-BHD.

## 3) انشر API (إلزامي لإتمام الجلسة)

الواجهة وحدها لا تكفي بعد عودة `code` من الهوية. تحتاج:

| المكوّن | مثال |
| --- | --- |
| Nest API `apps/api` | `https://bhd-r-api.fly.dev` أو Render |
| PostgreSQL + PostGIS | Neon |
| Redis | Upstash |

ثم على الويب:

```env
API_INTERNAL_ORIGIN=https://YOUR-PUBLIC-API
```

وعلى الـ API نفس متغيرات الهوية + `DATABASE_URL` + `BHD_R_SESSION_SECRET` + `CSRF_SECRET` + مفاتيح التشفير من `.env.example`.

إن كان مزوّد الهوية ما زال يوقّع ID Token بـ HS256 مؤقتاً، ضع على الـ API أيضاً:

```env
BHD_IDENTITY_TOKEN_SECRET=<نفس IDENTITY_TOKEN_SECRET من one-bhd>
```

## 4) تدفق النجاح المتوقع

1. https://bhd-r-api-phi.vercel.app/ar/login  
2. «المتابعة عبر هوية BHD» → `id.bhd-om.com/oauth/authorize`  
3. بعد الدخول → callback على نفس نطاق الويب `/v1/auth/oidc/callback`  
4. الـ API يبدّل `code`، يتحقق من ID Token (JWKS RS256 أو HS256 احتياطي)، يربط `sub` → جلسة BHD R  

## 5) ما لا يُفعل

- لا تضبط `API_INTERNAL_ORIGIN=http://localhost:4000` على Vercel.  
- لا تشارك `DATABASE_URL` مع وازن/حسابي/الهوية.  
- لا تمنح أدوار مدير عبر الهوية؛ الأدوار محلية بعد `sub`.  
- لا تضع زر Google على واجهة BHD R؛ جوجل فقط على نطاق الهوية.
