# نشر العزل الصامت (نموذج جوجل) — كل مواقع BHD

> **التاريخ:** 29 أكتوبر 2026  
> **الهوية الأم:** https://id.bhd-om.com (`ONE-BHD`)  
> **المرجع التنفيذي:** `BHD-HR` → `src/lib/identity/*` + `BhdPrivacyGate` + `BhdSilentSso` + `POST /api/auth/bhd/rebind`

## الأسلوب الموحّد

| آلية | الوظيفة |
|---|---|
| `?au=<bhdSub>` | ربط التبويب بحساب معيّن (مثل Google `authuser`) |
| `bhd_account_tokens` | رمز Bearer لكل حساب في `sessionStorage` |
| `silentRebind` | `Accept: application/json` على `/api/auth/bhd/rebind` — بلا شاشة وبلا نص |
| `paintPrivacyVeil` | غطاء فارغ **فقط** عند تبديل صريح — ممنوع «جاري عزل…» |
| `scrubCacheBustFromUrl` | إزالة `_bhd` بعد استقرار الصفحة |
| `X-BHD-Persist-Cookie: 1` | عند التبديل تتبع البرامج المرتبطة نفس الحساب |

## من أين يُربط كل موقع؟

كل منتج يتصل بالهوية عبر:

1. سكربت حي: `https://id.bhd-om.com/bhd-identity.js`
2. كتالوج/أيقونات: `https://id.bhd-om.com/api/bhd/catalog` و `/api/bhd/icons/*`
3. تبديل الحساب: `POST https://id.bhd-om.com/api/auth/switch`
4. عزل المنتج: `POST /api/auth/bhd/rebind` **محلياً على المنتج** بـ Bearer النافذة (لا يعتمد على كوكي `bhd_id` وحده)

## المستودعات

| المستودع | مسار السلك الرئيسي | ملاحظات |
|---|---|---|
| ONE-BHD | `app/lib/identity/*`, `SessionMenu`, `rebind` | مصدر الهوية |
| BHD-HR | `src/lib/identity/*`, `BhdPrivacyGate`, `rebind` | المرجع الكامل §97–§98 |
| WAZEN | `lib/identity/*`, `components/bhd/*` | نفس الأسلوب |
| bhd-om | `lib/identity/*`, `components/bhd/*` | نفس الأسلوب |
| hisaby | `frontend/src/lib/identity/*` (+ proxy للـ API إن لزم) | نفس الأسلوب |
| BHD-STOR | `frontend/src/lib/identity/*` | نفس الأسلوب |
| BHD-R | `apps/web/src/lib/identity/*` | نفس الأسلوب |
| Nasab | `app/src/lib/identity/*` + `server/bhd/auth.ts` | Express rebind |
| ainoamn-ain-oman-web | ملفات الهوية تحت `src/` | حد أدنى إن وُجد السلك |
| nextjs-boilerplate | `lib/identity/*` | قالب للمنتجات الجديدة |

## تعارضات أُزيلت

- رسائل عزل ظاهرة على F5
- `applyAccountIsolation` القديم يعيد تحميلاً كاملاً في الخلفية كل ثوانٍ
- الاعتماد على `bhd_id` المشترك بعد تبديل Bearer دون rebind
- نصوص عربية على حجاب الخصوصية

## تحقق

1. F5 على أي منتج مربوط → لا ملاحظة عزل.
2. تبديل حساب → غطاء فارغ لحظة ثم بيانات الحساب الجديد فقط + `?au=`.
3. تبويبان بحسابين → كل تبويب يبقى على `au` الخاص به بعد الإصلاح الصامت.

