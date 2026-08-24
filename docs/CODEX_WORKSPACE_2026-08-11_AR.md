# جرد مساحة عمل Codex — 2026-08-11

**تاريخ الجرد:** 24 أغسطس 2026  
**المسار الأب:** `C:\Users\ahami\Documents\Codex\2026-08-11`

هذه الوثيقة تثبت مراجعة المجلد حرفياً (كل فرع فرعي ذي صلة بمنظومة BHD)، وتحدد
مصدر الحقيقة في Git، وما يُستبدل، وما يبقى محلياً فقط.

## الحكم التنفيذي

| المنتج | مصدر الحقيقة في Git | حالة الجرد |
| --- | --- | --- |
| **BHD R** | [`ainoamn/BHD-R`](https://github.com/ainoamn/BHD-R) `main` @ **0.2.0** | مرفوع؛ أحدث من كل حزم `complete-0.1.x` |
| ONE-BHD | `ainoamn/ONE-BHD` | محلي مُحدَّث بـ fast-forward من `origin` |
| BHD-STOR | `ainoamn/BHD-STOR` | محلي مُحدَّث؛ تقرير الأمن موجود كـ `docs/ENGINEERING-SECURITY-AUDIT-2026-08-11.md` |
| hisaby | `ainoamn/hisaby` | محلي مُحدَّث؛ تدقيق 2026-08-11 موجود في `docs/` |
| WAZEN | `ainoamn/WAZEN` | محلي مُحدَّث من `origin` |
| bhd-om (قديم) | `ainoamn/bhd-om` | مرجع تاريخي فقط؛ لا يُستبدل به BHD-R |

**قاعدة الاستبدال:** الجديد يستبدل القديم دائماً. حزم `BHD-R-complete-0.1.4` و`0.1.6`
و`0.1.0-source` و`Omani-UI` **لا تُنسَخ فوق** مجلد `BHD-R` الحي (الإصدار 0.2.0 / V1).

## شجرة المجلد الأب

```text
2026-08-11/
├── https-github-com-ainoamn-bhd-om/     ← مساحة BHD-R النشطة
│   ├── BHD-R/                           ← المستودع التشغيلي (Git)
│   ├── BHD-R-complete-0.2.0/            ← تصدير مصدري من 0.2.0 (محلّي)
│   ├── BHD-R-complete-0.1.6/ + .zip     ← أرشيف أقدم (مرجعي)
│   ├── BHD-R-complete-0.1.4.zip
│   ├── BHD-R-0.1.0-source/ + .zip
│   ├── BHD-R-Omani-UI-2026-08-23/ + .zip
│   ├── BHD-R-System-Screenshots*/ + .zip → docs/screenshots/2026-08-23/
│   ├── generated-assets/                → docs/assets/source/
│   ├── outputs/                         → docs/legacy-reviews/ + docs/phase-0/ + docs/product/
│   ├── work/bhd-om                      ← clone قديم (أسرار محتملة — لا تُرفع من هنا)
│   └── work/reference-repos/*           ← clones مرجعية متزامنة مع origin
├── https-github-com-ainoamn-bhd-om-2/   ← مخرجات مراجعة BHD-STOR + clone
└── new-chat/                            ← حزمة hardening لـ BHD-Pro (منتج آخر) + تدقيق HISABY
```

## BHD-R — ما رُفع وما يُستبدل

- الإصدار المرفوع: **0.2.0** (اكتمال نواة V1، هجرات `0003`–`0007`).
- مقارنة `BHD-R-complete-0.1.6` مقابل المستودع: **0** ملف أحدث في الحزمة؛ ~74 ملفاً
  أحدث في المستودع؛ الملف الوحيد «الزائد» في الحزمة كان `tsconfig.tsbuildinfo` (مستبعد).
- التصدير المحلي الجديد: `BHD-R-complete-0.2.0/BHD-R` يعكس محتوى المستودع بدون
  `node_modules` / `.git` / أسرار.

### وثائق المنتج المعتمدة داخل المستودع

| الوثيقة | الدور |
| --- | --- |
| [`V1-COMPLETION-REPORT-AR.md`](./V1-COMPLETION-REPORT-AR.md) | إثبات اكتمال V1 |
| [`OPERATIONS_SUITE_AR.md`](./OPERATIONS_SUITE_AR.md) | الحزمة التشغيلية |
| [`PROJECT_DOCUMENTATION_AR.md`](./PROJECT_DOCUMENTATION_AR.md) | توثيق النظام |
| [`product/BHD-R-BUILD-PLAN-AR.md`](./product/BHD-R-BUILD-PLAN-AR.md) | خطة البناء |
| [`PARENT_FOLDER_SYNC_AR.md`](./PARENT_FOLDER_SYNC_AR.md) | خريطة المجلد المجاور |
| [`RELEASE_SYNC_0.1.6.md`](./RELEASE_SYNC_0.1.6.md) | سجل مزامنة 0.1.6 (تاريخي) |

## ما لا يُرفع إلى GitHub من هذه المساحة

- `.env*` و`.env.neon` و`dev.db` وأي مفاتيح تحت `work/`
- `node_modules` / `.next` / مخرجات البناء
- أرشيفات zip الضخمة (تبقى نسخاً محلية؛ المصدر في Git)
- منتج **BHD-Pro** تحت `new-chat/outputs/` (مستودع مختلف؛ لا يُدمج في BHD-R)
- مجلد `Untitled` (سجل بناء Vercel خام)

## إجراءات النسخ المحلية المنفَّذة في هذا الجرد

1. التحقق أن `BHD-R` نظيف ومتزامن مع `origin/main` عند 0.2.0.
2. fast-forward لكل من ONE-BHD، BHD-STOR، hisaby، WAZEN، bhd-om إلى أحدث `origin`.
3. إنشاء/تحديث `BHD-R-complete-0.2.0` من المستودع الحي.
4. عدم تطبيق أي حزمة 0.1.x فوق الكود الحي.

## النشر

- GitHub: https://github.com/ainoamn/BHD-R  
- إنتاج الويب: https://bhd-r-api-phi.vercel.app · https://r.bhd-om.com  
- قبل اعتماد DB: نسخة احتياطية → هجرات `0003`–`0007` → RLS/أدوار → Canary.
