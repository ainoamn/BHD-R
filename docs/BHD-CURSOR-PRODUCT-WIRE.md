# أوامر كورسر لربط أي موقع BHD بالهوية الحيّة

> **المصدر المعتمد:** `https://id.bhd-om.com`  
> **لوحة الأيقونات:** `https://id.bhd-om.com/admin#apps`  
> **لوحة الربط:** `https://id.bhd-om.com/admin#connect`  
> **التاريخ:** 29 أكتوبر 2026

انسخ الفقرة «أمر الوكيل» كاملة إلى كورسر في مستودع المنتج (وازن / حسابي / نَسَب / المتجر / المكتب / الموارد البشرية / www).

---

## أمر الوكيل (الصقه في Cursor Agent)

```text
اربط هذا الموقع بهوية BHD الحية على https://id.bhd-om.com دون نسخ منطق الجلسة محلياً.

المطلوب حرفياً:

1) السكربت والـ CSP
- أضف في layout أو الرأس:
  <script src="https://id.bhd-om.com/bhd-identity.js" defer></script>
- اسمح في CSP:
  script-src https://id.bhd-om.com
  connect-src https://id.bhd-om.com
  img-src https://id.bhd-om.com data:

2) مدة الجلسة من الهوية لا من ثابت محلي
- عند ضبط كوكي جلسة المنتج في /api/auth/bhd/callback:
  const runtime = await fetch("https://id.bhd-om.com/api/bhd/runtime").then(r => r.json());
  cookie.maxAge = runtime.session.maxAgeSec; // 40 يوماً حالياً
- ممنوع رقم 400 يوماً أو أي maxAge محلي ثابت.

3) عزل الحسابات والنوافذ (خصوصية إلزامية) — اقرأ BHD-ACCOUNT-ISOLATION.md
- كل نافذة تستخدم رمزها عبر BhdIdentity (Bearer في sessionStorage).
- عند تبديل الحساب في المنتج (الطريقة الصحيحة):
  1) POST https://id.bhd-om.com/api/auth/switch مع Bearer النافذة → احفظ token
  2) POST /api/auth/bhd/rebind بالـ token (يعيد كتابة كوكي جلسة المنتج ويمسح نطاق المنشأة)
  3) returnTo مع ?_bhd=timestamp وأخفِ الواجهة فوراً
- ممنوع بعد تبديل Bearer: استدعاء /api/auth/bhd/start مباشرة بلا تذكرة window-handoff
  (الكوكي المشتركة bhd_id تبقى على الحساب القديم → البيانات لا تُعزل).
- BhdIdentity.switchAccount/isolate يفضّل الآن rebind بالـ Bearer؛ لا تعتمد على سقوط isolate إلى start.
- ممنوع إبقاء بيانات المستخدم السابق؛ ممنوع BroadcastChannel لمزامنة الحساب بين النوافذ.
- إن اختلف /api/auth/me المحلي عن BhdIdentity.me() → rebind بالـ Bearer فوراً (لا start أعمى).

4) جلب البيانات والأيقونات من كتالوج واحد
- المصدر الحي: GET https://id.bhd-om.com/api/bhd/catalog
- أو: const catalog = await BhdIdentity.catalog(); // يطلق حدث bhd-catalog
- كل بلاطة تحتوي: id, nameAr, nameEn, origin, homePath, workspacePath, homeUrl, workspaceUrl, logoUrl, mark, accent, soft, enabled
- الشعار إن وُجد: logoUrl مثل https://id.bhd-om.com/api/bhd/icons/{id}

5) نفس الأيقونات في ثلاثة أماكن
- رأس المستخدم (مشغّل التسع نقاط بجانب صورة الحساب): من الكتالوج الحي
- الفوتر «برامجنا»: نفس الكتالوج ونفس logoUrl/name/href
- الصفحة الرئيسية للبوابة أو شبكة البرامج: نفس الكتالوج
- ممنوع قائمة products.ts أو apps.ts ثابتة لهذه الشاشات الثلاث.

6) OIDC المحلي يبقى على الخادم فقط
- GET /api/auth/bhd/start
- GET /api/auth/bhd/callback (يربط bhd_sub)
- GET /api/auth/bhd/logout → end-session على الهوية
- أبقِ BHD_CLIENT_ID و BHD_CLIENT_SECRET في بيئة الخادم فقط.

7) وثّق في docs/ داخل المنتج أن المصدر هو /admin#apps و /api/bhd/catalog
- لا ترفع أسراراً.
- بعد التنفيذ لخّص الملفات المتغيرة وكيف يُختبر التبديل دون تسرّب بيانات حساب سابق.
```

---

## كيف يعمل الربط

| الخطوة | ماذا يحدث |
|---|---|
| دخول | المستخدم يدخل على `id.bhd-om.com` → كوكي `bhd_id` + رمز النافذة |
| فتح منتج | `/api/auth/bhd/start` → `/oauth/authorize` يرى الجلسة → كود → `callback` يفتح جلسة المنتج |
| تبديل حساب | `POST /api/auth/switch` + Bearer → **`POST /api/auth/bhd/rebind`** بالرمز (مسار الخصوصية). احتياط: handoff→start فقط إن لم يوجد token |
| بيانات الصفحة | تُمسَح فوراً ثم تُجلب من جلسة المنتج الجديدة فقط — انظر `BHD-ACCOUNT-ISOLATION.md` |

## كيف يُعزل المستخدمون

- كوكي `bhd_id` مشتركة بين نوافذ نفس المتصفح؛ العزل بـ `bhd_window_token` في `sessionStorage`.
- التبديل مع Bearer لا يغيّر كوكي النوافذ الأخرى.
- بعد التبديل يُعاد ربط المنتج بالحساب الظاهر في هذه النافذة فقط؛ ممنوع عرض بيانات الحساب السابق.

## كيف تُجلب الأيقونات

```js
const { apps } = await BhdIdentity.catalog();
// أو
window.addEventListener("bhd-catalog", (e) => render(e.detail));
```

التحكم من: `https://id.bhd-om.com/admin#apps` (المسمّى، الرابط، الشعار، الترتيب، الإظهار).

## تحقق سريع

1. غيّر اسماً أو شعاراً في `/admin#apps` → يظهر في الرأس والفوتر والرئيسية خلال ثوانٍ على المواقع المرتبطة.
2. سجّل حسابين → بدّل من الرأس → الصفحة تفرغ ثم تعرض بيانات الحساب الجديد فقط.
3. نافذة ثانية بحساب آخر لا تتأثر بتبديل الأولى.
