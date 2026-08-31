# تسليم العمل — بطاقات الوحدات المتعددة + اسم المالك + صفحة العقارات

**تاريخ التوثيق:** 2026-08-31  
**وقت التوثيق (مسقط / Asia/Muscat / UTC+4):** 22:31  
**حالة الرفع عند التوثيق:** كل التغييرات على `main` ومرتفعة إلى `origin/main`  
**آخر commit وظيفي قبل ملف التسليم:** `efbf064` — *Tighten listing card spacing and emphasize title and price.*  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**معرّف محادثة Cursor:** [307d3b18-d433-4130-9cd4-fbf9f887f158](307d3b18-d433-4130-9cd4-fbf9f887f158)

---

## أين توقّفنا (لاستكمال العمل غداً من الجهاز الثاني)

1. بطاقات كتالوج [العقارات المتاحة](https://r.bhd-om.com/ar/properties?countryCode=OM&currency=OMR) تعرض ترتيب الوحدة → المبنى → الموقع → السيريال → المواصفات → السعر، مع زر مبنى داخل إطار.
2. تم تصغير المسافات بين الأسطر وتكبير عنوان الوحدة والسعر (commit `efbf064`) — يُفضّل التحقق بعد اكتمال نشر Vercel بـ Ctrl+F5.
3. اسم المالك مخفي في الصفحة العامة ما لم يفعّل المالك الخيار في تعديل العقار: **«السماح بإظهار اسم المالك في الإعلان العام»**.
4. هجرة قاعدة البيانات المطلوبة: `packages/db/migrations/generated/0017_show_owner_name_on_listing.sql`  
   (`show_owner_name_on_listing` على `property_profiles`، افتراضي `false`).  
   **تحقق غداً:** هل طُبّقت الهجرة على Neon الإنتاج؟

### ملاحظات UI ما زالت مرشّحة للمتابعة

- التأكد أن المسافات/الخطوط بعد النشر تبدو احترافية على الجوال والشبكة والجدول.
- إن بقي تكرار في سطر الموقع (مثل مطرح الكبرى مرتين) راجع بيانات العنوان في Neon أو `formatListingLocation`.
- زر «عرض المبنى وكل وحداته» داخل `.listing-card__building-cta` — ضبط إضافي إن لزم ليتماشى أكثر مع الثيم.

---

## المحادثة كاملة (بدون حذف حرف من المصدر)

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript-FULL.jsonl`](./conversation-transcript-FULL.jsonl) | **نسخة حرفية كاملة** من ملف transcript جلسة Cursor (JSONL خام، كل الأحداث كما هي). SHA256: `13F870F596247F3E77F951281A612BD88A3584A5D4FC126BCB895396B12D2582` |
| [`conversation-readable-FULL.md`](./conversation-readable-FULL.md) | نسخة مقروءة مستخرجة من نفس المصدر (نصوص المستخدم/المساعد كاملة دون Truncation متعمّد) |

المصدر الأصلي على الجهاز الأول:

`C:\Users\ameed\.cursor\projects\c-dev-BHD-R\agent-transcripts\307d3b18-d433-4130-9cd4-fbf9f887f158\307d3b18-d433-4130-9cd4-fbf9f887f158.jsonl`

---

## commits ذات الصلة بهذه الجولة (الأحدث أولاً)

| Commit | الملخص |
| --- | --- |
| `efbf064` | Tightening مسافات البطاقة + عنوان/سعر أوضح |
| `b6e0125` | ترتيب بطاقة الوحدة + زر المبنى المؤطّر + إخفاء اسم المالك إلا بموافقة + هجرة 0017 |
| `9e92778` | غلاف المحفظة من صور نطاق المبنى |
| `dccf2ae` | عزل صور الوحدة/المبنى + وصف مركّب للوحدة |
| `f643306` | وحدات مع رابط المبنى + إشغال + إيجار أو بيع |
| `afa3ae9` | أوصاف المبنى المتعدد + سيريالات الوحدات + بطاقات الكتالوج |
| `9b4ad78` | حفظ كمسودة في معالج العقار |

---

## الملفات المحورية التي لمسناها

- `apps/web/src/lib/listing-card-copy.ts` — عنوان الوحدة، المبنى، الموقع
- `apps/web/src/components/listing-catalogue-card.tsx`
- `apps/web/src/components/listing-result-row.tsx`
- `apps/web/src/components/listing-card.tsx`
- `apps/web/src/components/listings-table.tsx`
- `apps/web/src/components/property-detail-manager.tsx`
- `apps/web/src/components/property-wizard.tsx` — خيار إظهار اسم المالك
- `apps/web/src/lib/search-public-listings-neon.ts` — area/street في الكتالوج
- `apps/web/src/lib/load-public-property-neon.ts` / `load-property-neon.ts`
- `apps/web/src/app/globals.css` — تنسيق البطاقة والزر
- `packages/db/src/schema.ts` + `0017_show_owner_name_on_listing.sql`
- `packages/contracts/src/schemas.ts` — `showOwnerNameOnListing`

---

## قائمة تحقق سريعة للجهاز الثاني غداً

1. `git pull origin main` على نفس المستودع.
2. افتح هذا الملف + `conversation-readable-FULL.md` أو الـ JSONL الكامل.
3. تأكد نشر Vercel لـ `main` صار Ready على https://r.bhd-om.com
4. طبّق/تحقق هجرة `0017` على Neon إن لم تُطبَّق.
5. أكمل من قسم «أين توقّفنا» أعلاه.

---

## حالة الدمج والنشر عند التوثيق

- الفرع: `main`
- التتبع: `origin/main` متزامن (لا commits معلّقة محلياً قبل إضافة هذا التسليم)
- لا يوجد فرع منفصل بانتظار PR — العمل مدموج مباشرة في `main`
- النسخ الاحتياطي للمحادثة مرفوع داخل هذا المجلد عبر commit التسليم التالي
