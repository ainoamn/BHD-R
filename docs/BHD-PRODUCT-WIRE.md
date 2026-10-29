# ربط BHD-R بهوية BHD الحية

> تاريخ التحديث: 29 أكتوبر 2026  
> المصدر: https://id.bhd-om.com — الأيقونات: /admin#apps — الربط: /admin#connect

## ما طُبِّق (2026-10-29)

| البند | التفاصيل |
|--------|-----------|
| سكربت + CSP | `bhd-identity.js` في `apps/web/src/app/[locale]/layout.tsx`؛ CSP في `apps/web/src/proxy.ts` (script/connect/img لـ `id.bhd-om.com`) |
| مدة الجلسة | `apps/web/src/lib/bhd/runtime.ts` ← `GET /api/bhd/runtime`؛ كوكي `bhd_r_session` / CSRF / roster |
| rebind | `POST /api/auth/bhd/rebind` — Bearer النافذة → `rebindProductSessionFromProfile`؛ يمسح `bhd_r_org` |
| عميل الهوية | `apps/web/src/lib/identity/client.ts` + `window-session.ts` — `switchWindowAccount` ثم `applyAccountIsolation` (rebind أولاً) |
| كتالوج حي | `catalog.ts` + `useBhdCatalog` — الرأس (`bhd-app-switcher`) والفوتر (`site-footer`) |
| Silent SSO | `bhd-silent-sso.tsx` — عدم تطابق → rebind بالـ Bearer (لا `/start` أعمى بعد تبديل النافذة) |

## تحقق

1. كتالوج الأيقونات من `/api/bhd/catalog` في الرأس والفوتر.
2. تبديل حساب → `POST /api/auth/bhd/rebind` → بيانات الحساب الجديد فقط.
3. مدة الجلسة من `/api/bhd/runtime`.

## مراجع

- `BHD-CURSOR-PRODUCT-WIRE.md` — أمر الربط الكامل
- `BHD-ACCOUNT-ISOLATION.md` — عزل التبديل (rebind بالـ Bearer)
- `BHD-IDENTITY-RUNTIME.md` — runtime + سكربت
