# تسليم مسائي — استكمال العمل غداً من جهاز آخر

**تاريخ التوثيق:** 2026-08-31  
**وقت التوثيق (مسقط / Asia/Muscat / UTC+4):** 22:43  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main` (مدموج مباشرة — لا PR معلّق)  
**آخر commit عند التوثيق:** `f6a67e8` — *Fix property save and unit pages when owner-name column is missing.*  
**معرّف محادثة Cursor:** [307d3b18-d433-4130-9cd4-fbf9f887f158](307d3b18-d433-4130-9cd4-fbf9f887f158)

---

## أين توقّفنا الآن

### ما اكتمل اليوم
1. **بطاقات الكتالوج** (`/ar/properties`): ترتيب  
   وحدة (مثل شقة A-02) → المبنى → الموقع → السيريال → المواصفات → السعر  
   + تصغير المسافات + عنوان/سعر أوضح + زر مبنى داخل إطار.
2. **صفحة العقار/الوحدة**: نفس التسلسل الهرمي للعناوين.
3. **اسم المالك**: مخفي عاماً إلا إذا فعّل المالك «السماح بإظهار اسم المالك في الإعلان العام».
4. **إصلاح عاجل (`f6a67e8`)**: فشل حفظ العقار + 404 على صفحة الوحدة بسبب عمود `show_owner_name_on_listing` غير الموجود في Neon — أصبح التحميل/الحفظ آمناً مع محاولة إنشاء العمود أو تجاوزه.

### تحقق فوري بعد نشر Vercel (أول شيء غداً)
- [ ] حفظ [تعديل مبنى النور](https://r.bhd-om.com/ar/owner/properties/d0840631-207d-477a-853a-043572d49240/edit) ينجح بلا «تعذر تحديث العقار…»
- [ ] فتح [وحدة A-02](https://r.bhd-om.com/ar/units/90cd9d0b-3526-4419-8066-4c24f6534b90) يظهر التفاصيل لا 404
- [ ] الكتالوج ما زال صحيحاً: [العقارات المتاحة](https://r.bhd-om.com/ar/properties?countryCode=OM&currency=OMR)

### هجرة Neon (مهم)
- ملف: `packages/db/migrations/generated/0017_show_owner_name_on_listing.sql`
- التطبيق الرسمي على الإنتاج ما زال مستحسناً حتى لو الكود أصبح متسامحاً.

---

## المحادثة كاملة (نسخة حرفية)

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript-FULL.jsonl`](./conversation-transcript-FULL.jsonl) | JSONL خام كامل (508 أسطر) — SHA256 `d2f32b02780d83f49a4869c6db40ccdd203040a514420496d9b24cd8f6e4c53c` |
| [`conversation-readable-FULL.md`](./conversation-readable-FULL.md) | نسخة مقروءة (502 رسالة مستخرجة) |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`TOMORROW-PLAN-AR.md`](./TOMORROW-PLAN-AR.md) | **خطة عمل مقترحة ليوم غد بالأولويات** |

تسليم سابق (22:31): [`../2026-08-31-multi-unit-listing-cards/`](../2026-08-31-multi-unit-listing-cards/)

---

## كيف تبدأ من الجهاز الثاني

```bash
git pull origin main
```

ثم افتح بالترتيب:
1. هذا الملف (`README.md`)
2. `TOMORROW-PLAN-AR.md`
3. عند الحاجة: `conversation-readable-FULL.md` أو الـ JSONL الكامل

---

## commits ذات الصلة (الأحدث أولاً)

| Commit | الملخص |
| --- | --- |
| `f6a67e8` | إصلاح حفظ العقار + صفحة الوحدة عند غياب عمود اسم المالك |
| `590b8a6` | أرشفة محادثة مسائية أولى + ملاحظات استكمال |
| `efbf064` | Tightening مسافات البطاقة + عنوان/سعر |
| `b6e0125` | ترتيب البطاقة + زر المبنى + gate اسم المالك + هجرة 0017 |
| `9e92778` … `9b4ad78` | وحدات متعددة، صور، مسودة، سيريالات |

## ملفات محورية

- `apps/web/src/lib/listing-card-copy.ts`
- `apps/web/src/lib/load-property-profile.ts`
- `apps/web/src/lib/ensure-property-profile-columns.ts`
- `apps/web/src/components/listing-catalogue-card.tsx` / `listing-result-row.tsx`
- `apps/web/src/components/property-detail-manager.tsx` / `property-wizard.tsx`
- `apps/web/src/app/globals.css`
- `packages/db/migrations/generated/0017_show_owner_name_on_listing.sql`
