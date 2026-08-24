# مزامنة مجلد العمل الأب — 24 أغسطس 2026

المجلد الأب:

`C:\Users\ahami\Documents\Codex\2026-08-11\https-github-com-ainoamn-bhd-om`

## مرجع الحزمة التشغيلية

للاطلاع على وصف الوحدات والـAPI والنشر الوظيفي راجع الوثيقة المعتمدة:

[`OPERATIONS_SUITE_AR.md`](./OPERATIONS_SUITE_AR.md)

## خريطة المحتويات → المكان الصحيح

| المصدر في المجلد الأب                    | الوجهة في المستودع / القرار                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `BHD-R/`                                 | المستودع التشغيلي النشط (`ainoamn/BHD-R`)                                   |
| `BHD-R-complete-0.1.6/` + `.zip`         | مصدر الإصدار **0.1.6** — يُزامَن إلى `BHD-R/` (محتوى الكود متطابق)          |
| `BHD-R-complete-0.1.4.zip`               | أرشيف أقدم — **لا يُطبَّق** فوق 0.1.6                                       |
| `BHD-R-0.1.0-source/` + `.zip`           | أرشيف تاريخي — **لا يُطبَّق** فوق الإصدار الحالي                            |
| `BHD-R-Omani-UI-2026-08-23/` + `.zip`    | حزمة واجهة أقدم — مدمجة سابقًا؛ **لا تُستبدل** 0.1.6                        |
| `BHD-R-System-Screenshots(-2026-08-23)/` | → `docs/screenshots/2026-08-23/*.png`                                       |
| `generated-assets/bhd-r-open-graph.png`  | مصدر OG → `docs/assets/source/`؛ الإنتاج `apps/web/public/og.png`           |
| `outputs/BHD-R-phase-0/`                 | → `docs/phase-0/`                                                           |
| `outputs/BHD-OM-*.{md,csv,json}`         | المراجعات موجودة في `docs/legacy-reviews/`؛ أُضيفت الفهارس CSV/JSON الناقصة |
| `outputs/BHD-R-BUILD-PLAN-AR.md`         | النسخة المعتمدة: `docs/product/BHD-R-BUILD-PLAN-AR.md`                      |
| `work/` (أدوات + نسخة BHD-OM قديمة)      | مساحة عمل محلية — **لا تُرفع** (قد تحتوي `.env` / `dev.db`)                 |
| `Untitled`                               | سجل بناء Vercel خام — أرشيف محلي فقط                                        |

## تحقق حزمة 0.1.6

- مقارنة SHA-256: لا ملفات جديدة في الحزمة غير موجودة في المستودع.
- فروق التوثيق فقط: `README.md` / `CHANGELOG.md` / `docs/RELEASE_SYNC_0.1.6.md` (أحدث في المستودع).
- الملفات الحرجة (`package.json`, `portal-nav`, `globals.css`, `authz`) متطابقة مع الحزمة.

## ما لم يُرفع عمدًا

- أسرار `.env*` و`.vercel`
- `node_modules` / `.next` / مخرجات البناء
- محتويات `work/bhd-om` (منتج قديم + قاعدة محلية)
- الحزم الأقدم من 0.1.6 كاستبدال للكود

## النشر

- الفرع: `main`
- الإنتاج: https://bhd-r-api-phi.vercel.app · https://r.bhd-om.com
