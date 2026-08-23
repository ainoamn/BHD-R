# مطابقة BHD R — SSO / أدمن / مشغّل (23 أغسطس 2026)

مرجع التنفيذ الحرفي: [`BHD-PRODUCT-SSO-ADMIN.md`](./BHD-PRODUCT-SSO-ADMIN.md) و[`BHD-UNIFIED-LOGIN-AND-APPS.md`](./BHD-UNIFIED-LOGIN-AND-APPS.md).  
مراجع حية للمنتجات: نَسَب · وازن · حسابي · المكتب · المتجر — نفس مسارات `/api/auth/bhd/*` و`admin-entry`.

## قائمة §3.1–3.4

| بند | الحالة | أين |
|---|---|---|
| `GET /api/auth/bhd/start` → authorize على الهوية | منفَّذ حي | 302 إلى `id.bhd-om.com` |
| `GET /api/auth/bhd/callback` + upsert `bhd_sub` | منفَّذ | Next callback + `identity-session.ts` (`users.identity_subject`) |
| `GET /api/auth/bhd/logout` → end-session | منفَّذ | ثم `{issuer}/oauth/end-session` |
| `GET /api/auth/admin-entry` | منفَّذ | → `start?returnTo=/platform` |
| غلاف `/login` → start إلا `?local=1` | منفَّذ | طوارئ مستأجر محلي فقط |
| `local=1` + إدارة → admin-entry | منفَّذ | |
| بلا Google محلي | منفَّذ | جوجل على الهوية فقط |
| فوتر «برامجنا» + دخول الإدارة | منفَّذ | مطابقة www.bhd-om.com |
| ربط أدمن قديم بالبريد (§3.3) | منفَّذ | بريد موثّق + `identity_subject` فارغ |
| مشغّل بكتالوج مجمد + خروج موحّد | منفَّذ | |
| تسجيل عميل `bhd-r` في ONE-BHD | منفَّذ | في اكتشاف OIDC الحي |
| قلب `mode=sso` في كتالوج ONE-BHD | منفَّذ | |
| قاعدة البيانات على Vercel | منفَّذ | Neon `nameless-shadow-43571265` → `DATABASE_URL` |
| تحقق ID Token مثل نَسَب/وازن | منفَّذ | HS256 بـ `BHD_IDENTITY_TOKEN_SECRET` + احتياطي `/oauth/userinfo` |

## سجل تثبيت (§12) — BHD R

| البند | التوثيق |
|---|---|
| المستودع | [ainoamn/BHD-R](https://github.com/ainoamn/BHD-R) |
| تاريخ التثبيت الحي | 23 أغسطس 2026 |
| `client_id` | `bhd-r` |
| الأصل الحي | https://bhd-r-api-phi.vercel.app (هدف: `https://r.bhd-om.com`) |
| `redirect_uri` | `{origin}/api/auth/bhd/callback` (+ legacy oidc + localhost) |
| عمود `bhd_sub` | `users.identity_subject` |
| ملفات المسار | `apps/web/src/app/api/auth/bhd/{start,callback,logout}` · `admin-entry` · `lib/bhd/identity-session.ts` |
| الدخول | غلاف login → start → `id.bhd-om.com/oauth/authorize` → callback يبدّل الكود ويتحقق من التوكن وينشئ جلسة Host-only |
| التحقق من التوكن | مثل نَسَب/وازن: حسب `alg`؛ HS256 بسر الهوية؛ وإلا Bearer على `/oauth/userinfo` |
| الجلسة | كوكي `bhd_r_session` + `bhd_r_csrf`؛ إنشاء المستخدم/العضوية محلياً عبر `DATABASE_URL` على Vercel |
| الأدمن | صلاحيات محلية؛ `/api/auth/admin-entry` → `/platform` |
| المشغّل | بعد الجلسة؛ الحساب → `https://id.bhd-om.com/account`؛ خروج → `/api/auth/bhd/logout` |
| الفوتر | صف برامجنا بأيقونات + روابط www.bhd-om.com + دخول الإدارة |
| Neon | https://console.neon.tech/app/projects/nameless-shadow-43571265?database=neondb |
| أسرار (أسماء فقط) | `BHD_IDENTITY_ISSUER`, `BHD_OAUTH_CLIENT_ID`, `BHD_OAUTH_CLIENT_SECRET`, `BHD_OAUTH_REDIRECT_URI`, `BHD_IDENTITY_TOKEN_SECRET` / `IDENTITY_TOKEN_SECRET`, `BHD_R_SESSION_SECRET`, `CSRF_SECRET`, `DATABASE_URL` |
| التقنيات | Next.js 16 · React 19 · NestJS 11 (اختياري لاحقاً) · Drizzle · Neon PostgreSQL · Vercel `bhd-r-api` |
| ما لم يُوحَّد | بيانات التشغيل العقارية؛ نشر Nest API الكامل للوحات التشغيل |

## أكواد خطأ الدخول (`?bhd=`)

| الرمز | المعنى |
|---|---|
| `state` | كوكي/حالة OIDC مفقودة أو غير متطابقة |
| `token` | فشل تبديل الكود على `/oauth/token` |
| `verify` | فشل تحقق ID Token / سر التوقيع |
| `db` | فشل الاتصال بقاعدة المنتج |
| `upsert` | فشل ربط/إنشاء المستخدم المحلي |
| `api` | لا `DATABASE_URL` على Vercel |
| `session` | فشل عام بعد التوكن |

## قبول سريع (§4)

1. مستخدم هوية جديد → صف `identity_subject` + مؤسسة starter بملكية محلية فقط.
2. أدمن/مالك قديم بنفس البريد الموثّق → يبقى دوره بعد الربط.
3. منتج آخر بلا تعيين → مستخدم عادي هناك.
4. جلسة `bhd_id` على الهوية → فتح BHD R عبر `mode=sso` بلا نموذج كلمة مرور على المنتج.
5. خروج موحّد عبر end-session.

## نشر

- GitHub `main`: https://github.com/ainoamn/BHD-R  
- Vercel مشروع `bhd-r-api` · Root Directory `apps/web`  
- بعد دفع `main` يُعاد البناء تلقائياً؛ أسرار الجلسة والقاعدة مضبوطة في لوحة Vercel.
