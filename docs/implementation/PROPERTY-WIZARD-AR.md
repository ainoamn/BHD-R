# معالج إضافة عقار — BHD R

**المسار:** `/{ar|en}/{owner|developer}/properties/new`  
**المكوّن:** `apps/web/src/components/property-wizard.tsx`  
**آخر تحديث:** `main` @ `6e5b607` / إصدار **0.2.25** (2026-08-25)

## مراحل المعالج (1–7)

| # | المحتوى |
|---|--------|
| 1 | بيانات العقار + موقع عُمان + رابط/منتقي خرائط جوجل |
| 2 | الوحدات (رمز تلقائي للقراءة فقط، طابق/غرف/حمامات قوائم فارغة إلزامية) |
| 3 | التشغيل والمرافق بأيقونات (بدون حقل عدد الطوابق) |
| 4 | الملكية + مرفقات خاصة اختيارية: سند / كروكي / بطاقة مالك |
| 5 | الصور (صورتان على الأقل + غلاف) |
| 6 | الوصف الاحترافي + ترجمة AR↔EN |
| 7 | معاينة ظهور عامة بأسلوب منصات الحجز ثم الحفظ |

- الرجوع لمرحلة سابقة مسموح؛ التقدم مشروط بإكمال الحالية.
- شريط المراحل: المتبقي **أحمر**، المكتمل **قوس قزح** بإطار أخضر، الحالية مميّزة.

## التحقق المرئي

- إلزامي فارغ: إطار أحمر (`.field--missing`)
- معبّأ: إطار أخضر (`.field--ok`)
- تنبيه نواقص عند «متابعة»

## خرائط جوجل

- حقل رابط إلزامي + زر **اختيار من الخريطة** (`MapLocationPicker` / Leaflet)
- نقر/سحب الدبوس أو بحث داخل عُمان → يُنشأ رابط جوجل + إحداثيات + معاينة مضمّنة
- المكوّنات: `parse-google-maps-url.ts`, `map-location-picker.tsx`
- CSP يسمح ببلاط OSM وNominatim وiframe خرائط جوجل

## الاسم والترقيم

- اسم واحد للعقار (عربي‖إنجليزي متوازيان)؛ الوحدات ترث الاسم (+ رمز الوحدة إن كان متعدد)
- رمز الوحدة `U-01…` تلقائي غير قابل للتعديل
- عند الحفظ: `BHD-{year}-PRP-{R|S|I}-{NNNN}` (هجرة `0012_property_serials.sql`)

## المرفقات الخاصة (المرحلة 4)

| النوع | `documentType` | ملاحظة |
|------|----------------|--------|
| ملكية | `title_deed` | اختياري — للمالك فقط |
| رسم مساحي | `floor_plan` | اختياري — للمالك فقط |
| بطاقة المالك | `other` | اختياري — للمالك فقط |

لا تظهر للجمهور. الرفع عبر منطقة اختيار ملف مخصّصة (بدون نص المتصفح الخام وحده).

## الترجمة والوصف

- توليد من البيانات: `property-listing-copy.ts`
- `POST /api/translate` (MyMemory من الخادم) + معجم عُماني احتياطي

## الحفظ وCSRF

المتصفح يستدعي `/api/backend/v1/*` (BFF على Vercel) الذي يوجّه إلى Nest مع `Origin` = `WEB_ORIGIN` لتفادي `Cross-site request rejected` على معاينات Vercel.

### رفع الصور (إصلاح Failed to fetch — 0.2.24)

سابقاً كان المتصفح يرفع مباشرة إلى رابط S3/MinIO موقّع، وCSP (`connect-src 'self'`) أو CORS كانا يمنعان الطلب فيظهر **Failed to fetch**.

الآن:

1. `POST /v1/media/upload-intents` يعيد `uploadPath` = `/v1/media/ingress/:token` و`uploadUrl` مطلق لـ Nest.
2. المتصفح يرفع `PUT` عبر نفس أصل الموقع (rewrite Next → Nest) ثم يكمل `complete`.
3. Nest يكتب إلى S3 داخلياً (لا حاجة لـ CORS على الـ bucket للرفع من المتصفح).
4. CSP يسمح أيضاً بـ `https://bhd-r.onrender.com` كاحتياط.

**على Render:** اضبط `PUBLIC_NEST_ORIGIN=https://bhd-r.onrender.com` (أو دع `RENDER_EXTERNAL_URL`).  
**على Vercel:** `API_INTERNAL_ORIGIN` يجب أن يشير إلى نفس Nest حتى يعمل rewrite `/v1/*`.

راجع: [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md)

## تجربة الواجهة

- انتقال شرائح بين المراحل (RTL + `prefers-reduced-motion`)
- ثنائية لغة `.bilingual-pair`؛ مرافق `.amenity-chip`
- تذييل لاصق بأزرار دائرية

## النشر

| سطح | مضيف | ملاحظة |
|-----|------|--------|
| ويب | Vercel `bhd-r-api` → `r.bhd-om.com` / preview | يُنشر تلقائياً من `main` |
| API | Render `bhd-r.onrender.com` | يجب Live ≥ `6e5b607` (إصلاح بناء CORS + media ingress) |

**متغيرات Vercel الضرورية:** `API_INTERNAL_ORIGIN`, `WEB_ORIGIN` أو `PUBLIC_WEB_ORIGIN`, نفس `BHD_R_SESSION_SECRET` / `CSRF_SECRET` مع Nest.

ملاحظات النشر الكاملة: [`RELEASE-0.2.25-AR.md`](./RELEASE-0.2.25-AR.md).

## إصلاح بناء سابق

`exactOptionalPropertyTypes`: تمرير `area` / `coverUrl` فقط عند وجود قيمة.

### فشل Render (0.2.25)

بناء Docker كان يكسر عند `corsOriginDelegate` (نمط callback). استُبدل بـ `resolveCorsOrigin`. بدون هذا الإصلاح يبقى API على نسخة قديمة ويستمر Failed to fetch عند الحفظ.
