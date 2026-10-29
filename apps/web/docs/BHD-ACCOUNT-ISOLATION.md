# عزل بيانات الحساب بعد التبديل (خصوصية — نموذج جوجل)

> **الحالة:** إلزامي لكل منتج مرتبط بـ `https://id.bhd-om.com`.  
> **تاريخ:** 29 أكتوبر 2026 — محاذاة مع BHD-HR-live.  
> **لوحة الربط:** https://id.bhd-om.com/admin#connect

---

## القاعدة (نموذج جوجل)

- ربط التبويب: `?au=<sub>` + خريطة `bhd_account_tokens` في `sessionStorage`.
- انحراف خلفي: `POST /api/auth/bhd/rebind` مع `Accept: application/json` (silent).
- تبديل صريح: غطاء فارغ + `X-BHD-Persist-Cookie: 1` + form rebind.
- `BhdSilentSso`: فحص كل ~20ث — `silent: true` فقط.

---

## ملفات هذا التطبيق (BHD R web)

- `src/lib/identity/window-session.ts`
- `src/lib/identity/client.ts`
- `src/components/bhd-silent-sso.tsx`
- `src/components/bhd-privacy-gate.tsx`
- `src/components/bhd-app-switcher.tsx`
- `src/app/api/auth/bhd/rebind/route.ts`
- `src/app/[locale]/layout.tsx`
