# حالة ربط منتجات BHD بالهوية الحيّة

> **آخر تحديث:** 29 أكتوبر 2026  
> **الهوية:** https://id.bhd-om.com  
> **الأيقونات:** https://id.bhd-om.com/admin#apps  
> **الربط:** https://id.bhd-om.com/admin#connect  
> **مرجع التطبيق الكامل:** [BHD-HR](https://github.com/ainoamn/BHD-HR)  
> **أمر الوكيل:** [`BHD-CURSOR-PRODUCT-WIRE.md`](BHD-CURSOR-PRODUCT-WIRE.md)  
> **عزل الخصوصية:** [`BHD-ACCOUNT-ISOLATION.md`](BHD-ACCOUNT-ISOLATION.md)

---

## ما أُنجز على الهوية (ONE-BHD)

| البند | التفاصيل |
|---|---|
| API حي | `/api/bhd/runtime`، `/api/bhd/catalog`، `/api/bhd/icons/{id}` |
| سكربت | `bhd-identity.js` — `isolate` يفضّل `POST /api/auth/bhd/rebind` |
| بوابة | `logout` + `rebind` تحت `/api/auth/bhd/` |
| توثيق | CURSOR-WIRE، ACCOUNT-ISOLATION، IDENTITY-RUNTIME، هذا الملف |

**التزام النشر المرجعي:** `c9bffb9` (جدول الحالة + سجل §94)

---

## المستودعات (دفع إلى GitHub — 29 أكتوبر 2026)

| المستودع | SHA | ماذا دُفع |
|---|---|---|
| [ONE-BHD](https://github.com/ainoamn/ONE-BHD) | `c9bffb9` | وثائق + logout/rebind + نشر Vercel |
| [BHD-HR](https://github.com/ainoamn/BHD-HR) | `f461645` | مرجع 7/7 + §93 rebind-first + خريطة الملفات |
| [WAZEN](https://github.com/ainoamn/WAZEN) | `95afcce` | سكربت، runtime، rebind، كتالوج حي، SilentSso |
| [hisaby](https://github.com/ainoamn/hisaby) | `374b860` | rebind + runtime + كتالوج + وثائق العزل |
| [BHD-STOR](https://github.com/ainoamn/BHD-STOR) | `0113d45` | سلك الواجهة: rebind، كتالوج، هوية |
| [BHD-R](https://github.com/ainoamn/BHD-R) | `1e65001b` | rebind، runtime، كتالوج، وثائق |
| [Nasab](https://github.com/ainoamn/Nasab) | `fb44d7f` | rebind على الخادم، سكربت، كتالوج، CSP |
| [bhd-om](https://github.com/ainoamn/bhd-om) | `3c0d5cf` | سلك البوابة/التسويق + rebind + كتالوج |
| [ainoamn-ain-oman-web](https://github.com/ainoamn/ainoamn-ain-oman-web) | `1ad56c2` | سكربت، CSP، start/callback/logout/rebind، شريط برامج |
| [nextjs-boilerplate](https://github.com/ainoamn/nextjs-boilerplate) | `5036420` | قالب Next جاهز بالسلك الكامل + وثائق |

### متابعات تشغيل (ليست حجب سلك الكود)

- **hisaby:** إعادة نشر Nest على Render حتى يعمل `rebind` عبر الـ proxy في الإنتاج.
- **bhd-om / hisaby:** فوتر التسويق قد يبقى بلا شبكة كتالوج حي (المبدّل مربوط).
- **ain-oman-web:** ربط `AuthContext` المحلي بـ `ain_bhd_sub` ما زال TODO.

---

## قائمة التحقق (كل منتج)

1. `bhd-identity.js` + CSP لـ `id.bhd-om.com`
2. مدة الجلسة من `/api/bhd/runtime` (لا 400 يوماً ثابتاً)
3. تبديل → Bearer `switch` ثم **`POST /api/auth/bhd/rebind`**
4. كتالوج حي في الرأس/الفوتر/(الرئيسية)
5. `start` / `callback` / `logout` / `rebind`
6. `docs/BHD-PRODUCT-WIRE.md` + نسخ ACCOUNT-ISOLATION و CURSOR-WIRE

---

## تحقق يدوي بعد النشر

1. غيّر بلاطة في `/admin#apps` → تظهر في الرأس/الفوتر.
2. حسابان → بدّل → بيانات الحساب الجديد فقط (لا تسرّب).
3. نافذة ثانية لا تتأثر.
