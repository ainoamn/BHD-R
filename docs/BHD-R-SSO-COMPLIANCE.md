# مطابقة BHD R — SSO / أدمن / مشغّل (23 أغسطس 2026)

مرجع التنفيذ الحرفي: [`BHD-PRODUCT-SSO-ADMIN.md`](./BHD-PRODUCT-SSO-ADMIN.md) و[`BHD-UNIFIED-LOGIN-AND-APPS.md`](./BHD-UNIFIED-LOGIN-AND-APPS.md).

## قائمة §3.1–3.4

| بند | الحالة | أين |
|---|---|---|
| `GET /api/auth/bhd/start` → authorize على الهوية | منفَّذ | `apps/web/src/app/api/auth/bhd/start` |
| `GET /api/auth/bhd/callback` + upsert `bhd_sub` | منفَّذ | `…/callback` + Nest `loginWithIdentity` (`users.identity_subject`) |
| `GET /api/auth/bhd/logout` → end-session | منفَّذ | `…/logout` |
| `GET /api/auth/admin-entry` | منفَّذ | `apps/web/src/app/api/auth/admin-entry` |
| غلاف `/login` → start إلا `?local=1` | منفَّذ | `apps/web/src/app/[locale]/login/page.tsx` |
| `local=1` + إدارة → admin-entry | منفَّذ | نفس الصفحة |
| بلا Google محلي | منفَّذ | لا يوجد زر |
| فوتر «برامجنا» + دخول الإدارة | منفَّذ | `site-footer.tsx` |
| ربط أدمن قديم بالبريد (§3.3) | منفَّذ | `auth.service.ts` |
| مشغّل بكتالوج مجمد + خروج موحّد | منفَّذ | `lib/bhd/apps.ts` + `bhd-app-switcher.tsx` |
| تسجيل عميل `bhd-r` في ONE-BHD | منفَّذ 23 أغسطس 2026 | `clients` في الاكتشاف الحي |
| قلب `mode=sso` في كتالوج ONE-BHD | منفَّذ | `apps.ts` في ONE-BHD |
| `API_INTERNAL_ORIGIN` / `DATABASE_URL` على Vercel | `DATABASE_URL` مضبوط (جلسة من Next) | Nest API اختياري لاحقاً |

## سجل تثبيت (§12 قالب الموحّد) — BHD R

| البند | التوثيق |
|---|---|
| المستودع | `ainoamn/BHD-R` |
| تاريخ التثبيت | 23 أغسطس 2026 — مسارات `/api/auth/bhd/*` + §0.7 + مشغّل + فوتر |
| `client_id` | `bhd-r` (يُسجَّل في ONE-BHD) |
| الأصل | `https://bhd-r-api-phi.vercel.app` → لاحقاً `https://r.bhd-om.com` |
| `redirect_uri` | `{origin}/api/auth/bhd/callback` |
| عمود `bhd_sub` | `users.identity_subject` |
| ملفات المسار | `apps/web/src/app/api/auth/bhd/{start,callback,logout}` · `admin-entry` · Nest `POST /v1/auth/identity/session` |
| الدخول | غلاف login → start → id.bhd-om.com → callback → جلسة Host-only |
| الأدمن | صلاحيات محلية عبر memberships؛ دخول الإدارة عبر `admin-entry` → `/platform` |
| المشغّل | بعد الجلسة؛ الحساب → `https://id.bhd-om.com/account`؛ خروج → `/api/auth/bhd/logout` |
| التقنيات | Next.js 16 · NestJS 11 · Drizzle/PostgreSQL · Redis · pnpm/Turbo · Vercel web |
| ما لم يُوحَّد | العقارات، العقود، الإيجارات، الفواتير، الصيانة، أدوار المنتج |

## قبول سريع (§4)

1. مستخدم هوية جديد → صف `identity_subject` + مؤسسة starter.
2. أدمن/مالك قديم بنفس البريد الموثّق → يبقى دوره بعد الربط.
3. منتج آخر بلا تعيين → مستخدم عادي هناك.
4. بعد تسجيل عميل + API عام: جلسة `bhd_id` → فتح BHD R بلا نموذج إن `mode=sso`.
5. خروج موحّد عبر end-session.
