# الإصدار 0.4.15 — إصلاح نشر Vercel + ترجمة + رفع صور

**التاريخ:** 2026-08-31  
**الأسطح:** معالج تعديل العقار، `/api/translate`، `/api/owner/media`، نشر Vercel

## لماذا بقيت المشاكل بعد 0.4.14؟

إنتاج Vercel كان يفشل التثبيت (`engines.node >=24` + `engine-strict=true` بينما بيئة Vercel غالباً Node 22) فيبقى الموقع على بناء قديم — لذلك ظلت الترجمة ورفع الصور كما هي على [صفحة التعديل](https://r.bhd-om.com/ar/owner/properties/8bf6abfc-3bf1-4e4d-a190-1d86fa50923e/edit).

## الإصلاحات

1. **نشر:** `engines` → `>=22`، `.nvmrc` = 22، `installCommand` مع `--config.engine-strict=false`.
2. **ترجمة:** Google Translate (gtx) أولاً، ثم MyMemory؛ رفض الترجمات التالفة القصيرة؛ بدون CSRF (جلسة + same-origin كافية).
3. **رفع صور:** إعادة بناء `FormData` في كل محاولة (الجسم يُستهلك مرة واحدة)، رفع متسلسل، ضغط أقوى.

## تحقق

- [ ] نشر Production لـ `main` يصبح Ready.
- [ ] زر ترجمة الاسم/الوصف يملأ الحقل المقابل.
- [ ] حفظ عقار مع صورة جديدة ينجح بلا `Failed to fetch`.
