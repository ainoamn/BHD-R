# عزل بيانات الحساب بعد التبديل (خصوصية — نموذج جوجل)

> **الحالة:** إلزامي لكل منتج مرتبط بـ `https://id.bhd-om.com`.  
> **تاريخ:** 29 أكتوبر 2026 — محاذاة مع BHD-HR-live.  
> **لوحة الربط:** https://id.bhd-om.com/admin#connect

---

## القاعدة (نموذج جوجل)

- ربط التبويب: `?au=<sub>` + خريطة `bhd_account_tokens` في `sessionStorage`.
- جلسة المنتج لكل حساب: `bhd_product_session_tokens` + `bhd_product_csrf_tokens` — طلبات `/api/*` ترسل `x-bhd-product-session` و`x-bhd-active-au` و`x-bhd-identity-bearer` ولا تعتمد على الكوكي المشتركة وحدها.
- `requireLiveSession` يفضّل JWT المنتج المربوط بالتبويب ويرفض `account_mismatch` عند تعارض `?au=`.
- انحراف خلفي: `POST /api/auth/bhd/rebind` مع `Accept: application/json` (silent) ويعيد `sessionToken`/`csrf` للتبويب.
- تبديل صريح: غطاء فارغ + `X-BHD-Persist-Cookie: 1` + form rebind.
- `BhdSilentSso`: فحص عند التركيز — `silent: true` فقط؛ الغطاء يبقى حتى `currentSub === ?au=` بعد `router.refresh()`.
- Bootstrap في `layout`: إن وُجد `?au=` يُفعَّل `data-bhd-switching` فوراً قبل رسم SSR الخاطئ (كوكي تبويب آخر).
- `localStorage bhd_product_cookie_sub` يتزامن مع مالك الكوكي عبر التبويبات.

---

## ملفات هذا التطبيق (BHD R web)

- `src/lib/identity/window-session.ts`
- `src/lib/identity/client.ts`
- `src/components/bhd-silent-sso.tsx`
- `src/components/bhd-privacy-gate.tsx`
- `src/components/bhd-app-switcher.tsx`
- `src/app/api/auth/bhd/rebind/route.ts`
- `src/app/[locale]/layout.tsx`
