# مزامنة مجلد العمل الأب — 24 أغسطس 2026

المجلد الأب:

`C:\Users\ahami\Documents\Codex\2026-08-11\https-github-com-ainoamn-bhd-om`

## مرجع الحزمة التشغيلية

للاطلاع على وصف الوحدات والـAPI والنشر الوظيفي راجع الوثيقة المعتمدة:

[`OPERATIONS_SUITE_AR.md`](./OPERATIONS_SUITE_AR.md)

**جرد مساحة Codex 2026-08-11 بالكامل:** [`CODEX_WORKSPACE_2026-08-11_AR.md`](./CODEX_WORKSPACE_2026-08-11_AR.md)

## خريطة المحتويات → المكان الصحيح

| المصدر في المجلد الأب | الوجهة في المستودع / القرار |
| --- | --- |
| `BHD-R/` | المستودع التشغيلي النشط (`ainoamn/BHD-R`) — **0.2.0 / V1** |
| `BHD-R-complete-0.2.0/` | تصدير مصدري محدّث من المستودع الحي (يستبدل 0.1.6 محلياً) |
| `BHD-R-complete-0.1.6/` + `.zip` | أرشيف أقدم — **لا يُطبَّق** فوق 0.2.0 |
| `BHD-R-complete-0.1.4.zip` | أرشيف أقدم — **لا يُطبَّق** فوق 0.2.0 |
| `BHD-R-0.1.0-source/` + `.zip` | أرشيف تاريخي — **لا يُطبَّق** فوق الإصدار الحالي |
| `BHD-R-Omani-UI-2026-08-23/` + `.zip` | حزمة واجهة أقدم — مدمجة سابقًا؛ **لا تُستبدل** 0.2.0 |
| `BHD-R-System-Screenshots(-2026-08-23)/` | → `docs/screenshots/2026-08-23/*.png` |
| `generated-assets/bhd-r-open-graph.png` | مصدر OG → `docs/assets/source/`؛ الإنتاج `apps/web/public/og.png` |
| `outputs/BHD-R-phase-0/` | → `docs/phase-0/` |
| `outputs/BHD-OM-*.{md,csv,json}` | المراجعات في `docs/legacy-reviews/` |
| `outputs/BHD-R-BUILD-PLAN-AR.md` | النسخة المعتمدة: `docs/product/BHD-R-BUILD-PLAN-AR.md` |
| `work/` (أدوات + BHD-OM قديمة) | محلي فقط — **لا تُرفع** (قد تحتوي `.env` / `dev.db`) |
| `Untitled` | سجل بناء Vercel خام — أرشيف محلي فقط |

## تحقق الاستبدال (0.2.0 فوق 0.1.6)

- لا ملفات أحدث في حزمة 0.1.6 من المستودع الحي.
- المستودع يحتوي عشرات الملفات الأحدث (نواة V1 / 0.2.0).
- التصدير المحلي الصحيح: `BHD-R-complete-0.2.0`.

## ما لم يُرفع عمدًا

- أسرار `.env*` و`.vercel`
- `node_modules` / `.next` / مخرجات البناء
- محتويات `work/bhd-om`
- الحزم الأقدم من 0.2.0 كاستبدال للكود
- مجلدات `new-chat` الخاصة بـ BHD-Pro (منتج منفصل)

## النشر

- الفرع: `main`
- الإنتاج: https://bhd-r-api-phi.vercel.app · https://r.bhd-om.com
