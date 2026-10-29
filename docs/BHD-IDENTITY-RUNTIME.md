# تشغيل الهوية المركزي — API + سكربت واحد

> **الحالة:** معتمد. البرمجة على `https://id.bhd-om.com` والمواقع تقرأها حيّاً.  
> **التاريخ:** 29 أكتوبر 2026  
> **لوحة الإدارة:** [https://id.bhd-om.com/admin#connect](https://id.bhd-om.com/admin#connect) — تفاصيل الربط والعناوين والنسخ الجاهز.

كل منتج كان ينسخ الجلسة والكتالوج «على مزاجه». المصدر الحي الآن على الهوية. المنتج **لا يعيد برمجة** مدة الدخول ولا عزل النوافذ ولا قائمة التطبيقات.

---

## ماذا يعيش على الموقع الأم؟

| العنوان | الوظيفة |
|---|---|
| `GET https://id.bhd-om.com/api/bhd/runtime` | مدة الجلسة (40 يوماً)، أسماء الكوكيز، ترويسات النافذة، الكتالوج مع `homeUrl` و`workspaceUrl` |
| `GET https://id.bhd-om.com/api/bhd/catalog` | شاشة الأيقونات الحية: الاسم، الرابط، الشعار |
| `GET https://id.bhd-om.com/api/bhd/icons/{id}` | ملف الشعار المرفوع من الإدارة |
| [https://id.bhd-om.com/admin#apps](https://id.bhd-om.com/admin#apps) | لوحة التحكم بالشعار والمسمّى والرابط |
| نفس الكتالوج | رأس المستخدم + فوتر «برامجنا» + شبكة الرئيسية/الشركة |
| `https://id.bhd-om.com/bhd-identity.js` | جلسة النافذة، `/me`، تبديل الحساب، الخروج |
| `GET/POST /api/auth/me` `switch` `logout` | الجلسة الحقيقية (كوكي Host-only + Bearer للنافذة) |
| OIDC `/oauth/authorize` | تعرّف المنتج بعد الدخول دون كلمة مرور ثانية |

تغيير 40 يوماً أو كتالوج أو سلوك النافذة على ONE-BHD يظهر للمواقع عند الطلب التالي للـ API (حوالي دقيقة كاش).

---

## ماذا يبقى داخل كل منتج؟

مسار OIDC المحلي فقط، لأن سر العميل لا يُعرض في المتصفح:

- `GET /api/auth/bhd/start`
- `GET /api/auth/bhd/callback` — عند ضبط كوكي المنتج استخدم `maxAge` من `runtime.session.maxAgeSec`
- `GET /api/auth/bhd/logout`
- أدمن المنتج وصلاحياته في قاعدة المنتج

---

## ربط الموقع الآخر (نسخ جاهز)

في `<head>` أو قبل الرأس:

```html
<script src="https://id.bhd-om.com/bhd-identity.js" defer></script>
```

اسمح في CSP المنتج: `script-src https://id.bhd-om.com` و`connect-src https://id.bhd-om.com`.

```js
const runtime = await BhdIdentity.runtime();
// runtime.session.maxAgeSec === 40 * 24 * 3600
const { body } = await BhdIdentity.me();
// body.user / body.accounts — نفس النافذة لا تسرق نافذة أخرى
// بعد التبديل: أعد ربط جلسة المنتج بـ POST /api/auth/bhd/rebind (Bearer) —
// ممنوع productStart وحده بعد switch (انظر BHD-ACCOUNT-ISOLATION.md)
await BhdIdentity.switchAccount(sub); // يستدعي isolate → يفضّل rebind
```

عند إنشاء كوكي جلسة المنتج في `callback`:

```js
const runtime = await fetch("https://id.bhd-om.com/api/bhd/runtime").then((r) => r.json());
cookie.maxAge = runtime.session.maxAgeSec;
```

لا تنسخ `window-session.ts` ولا تثبت 400 يوماً محلياً. اقرأ الرقم من الهوية.

---

## كيف يتعرّف الموقع الآخر على الدخول؟

1. المستخدم يدخل على `id.bhd-om.com` → كوكي `bhd_id` + رمز النافذة.
2. المنتج يستدعي `start` إن لم تكن له جلسة محلية → الهوية ترى `bhd_id` وتصدر كود OIDC دون شاشة إن كانت الجلسة قائمة.
3. `callback` يربط `bhd_sub` ويفتح جلسة المنتج بنفس مدة `runtime.session.maxAgeSec`.
4. الرأس يقرأ `BhdIdentity.me()` فيتعرّف على الحساب والنوافذ فوراً دون نسخ كود الهوية.

إن انتهت الـ 40 يوماً على الهوية، `me` يعيد `user: null` و`start` يعرض شاشة الدخول. المنتج يمسح كوكيه المحلية ويتبع الهوية.
