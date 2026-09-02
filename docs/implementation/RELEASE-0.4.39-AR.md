# الإصدار 0.4.39 — إصلاح كatalog الإقامات (0 نتائج)

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commits:** `2bcf82e` (0.4.38) → `f00ff0a` (0.4.39)

## الملخص

1. **إصلاح SQL:** استعلام `/api/public/stays/catalogue` كان يفشل (`stays_catalogue_failed`) بسبب subquery خاطئ لسعر الليلة — أُصلح ومحاذاة JOIN مع بحث الإقامات العام.
2. **Fallback:** إذا فشل الكatalog أو كان فارغاً، الصفحة تستخدم `/v1/public/stays/search` كاحتياط.
3. **دمج على main:** 0.4.38 + 0.4.39 منشوران على `main` وVercel.

## ما يُعرض حالياً

- **3 وحدات منشورة** من مبنى النور: A-01، A-02، R-01 (الوحدات الأخرى تحتاج نشراً في معالج الإعداد).

## تحقق (مُختبر على الإنتاج)

- [x] `GET /api/public/stays/catalogue?countryCode=OM` — يعيد 3 وحدات
- [x] `/ar/stays?countryCode=OM&currency=OMR` — يظهر الكatalog والتصفية
- [x] قائمة / شبكة / جدول
- [ ] نشر بقية وحدات المبنى (R-02, R-03, S-01, S-02) من `/ar/owner/stays/setup`

## روابط

- [صفحة الإقامات](https://r.bhd-om.com/ar/stays?countryCode=OM&currency=OMR)
- [العقارات (مرجع)](https://r.bhd-om.com/ar/properties?countryCode=OM&currency=OMR)
