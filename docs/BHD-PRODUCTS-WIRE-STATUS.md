# حالة ربط منتجات BHD بالهوية الحيّة

> **التاريخ:** 29 أكتوبر 2026  
> **الهوية:** https://id.bhd-om.com  
> **الأيقونات:** https://id.bhd-om.com/admin#apps  
> **الربط:** https://id.bhd-om.com/admin#connect  
> **مرجع التطبيق:** [BHD-HR](https://github.com/ainoamn/BHD-HR) (`docs/BHD-ACCOUNT-ISOLATION.md`)  
> **أمر الوكيل:** [`BHD-CURSOR-PRODUCT-WIRE.md`](BHD-CURSOR-PRODUCT-WIRE.md)

---

## ماذا أُنجز على الهوية (ONE-BHD) اليوم

| البند | التفاصيل |
|---|---|
| API حي | `/api/bhd/runtime` (مدة الجلسة 40 يوماً)، `/api/bhd/catalog`، `/api/bhd/icons/{id}` |
| سكربت النافذة | `https://id.bhd-om.com/bhd-identity.js` — عزل Bearer؛ `isolate` يفضّل `POST /api/auth/bhd/rebind` |
| عزل الخصوصية | [`BHD-ACCOUNT-ISOLATION.md`](BHD-ACCOUNT-ISOLATION.md) — ممنوع `start` بعد تبديل Bearer بلا handoff |
| لوحة الإدارة | `/admin#apps` للأيقونات، `/admin#connect` لتفاصيل الربط |
| نفس الأيقونات | رأس / فوتر / رئيسية من الكتالوج الحي |

---

## المستودعات المستهدفة

| المستودع | النطاق | حالة السلك (هدف 29 أكتوبر) |
|---|---|---|
| [ONE-BHD](https://github.com/ainoamn/ONE-BHD) | الهوية + البوابة | مصدر الحقيقة + نشر Vercel |
| [BHD-HR](https://github.com/ainoamn/BHD-HR) | موارد بشرية | مرجع كامل 7/7 + §93 rebind |
| [WAZEN](https://github.com/ainoamn/WAZEN) | وازن | يُحدَّث: سكربت، rebind، كتالوج، توثيق |
| [hisaby](https://github.com/ainoamn/hisaby) | حسابي | يُحدَّث |
| [BHD-STOR](https://github.com/ainoamn/BHD-STOR) | المتجر | يُحدَّث |
| [BHD-R](https://github.com/ainoamn/BHD-R) | المكتب / R | يُحدَّث |
| [Nasab](https://github.com/ainoamn/Nasab) | نَسَب | يُحدَّث |
| [bhd-om](https://github.com/ainoamn/bhd-om) | www تسويق | يُحدَّث |
| [ainoamn-ain-oman-web](https://github.com/ainoamn/ainoamn-ain-oman-web) | عين عُمان | يُحدَّث / يُزرع السلك |
| [nextjs-boilerplate](https://github.com/ainoamn/nextjs-boilerplate) | قالب | يُزرع قالب سلك جاهز |

---

## قائمة التحقق لكل منتج (إلزامي)

1. تحميل `bhd-identity.js` + CSP لـ `id.bhd-om.com`
2. مدة كوكي المنتج من `/api/bhd/runtime` (لا 400 يوماً محلياً)
3. تبديل الحساب → `switch` + Bearer ثم **`POST /api/auth/bhd/rebind`** (انظر عزل الخصوصية)
4. كتالوج حي في الرأس والفوتر والرئيسية من `/api/bhd/catalog`
5. `start` / `callback` / `logout` / `rebind` على الخادم
6. ملف `docs/BHD-PRODUCT-WIRE.md` (أو نسخ CURSOR + ISOLATION) داخل المستودع

---

## كيف يُختبر

1. غيّر بلاطة في `/admin#apps` → تظهر في الرأس/الفوتر خلال ثوانٍ.
2. حسابان مختلفان → بدّل → الصفحة تُعاد ببيانات الحساب الجديد فقط.
3. نافذة ثانية لا تتأثر.
