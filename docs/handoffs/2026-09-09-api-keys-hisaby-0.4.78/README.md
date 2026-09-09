# تسليم — مفاتيح API وHisaby 0.4.78

**تاريخ:** 2026-09-09  
**الإصدار:** 0.4.78  
**Commit:** `692c213`  
**الفرع:** `main`  
**الإنتاج:** https://r.bhd-om.com  
**Vercel:** `bhd-r-api` — Production **Success**

## الحالة
منشور وحي.

## ما دخل
- إعادة بناء [`/ar/owner/api-keys`](https://r.bhd-om.com/ar/owner/api-keys) بالعربية (صلاحيات، نسخ السر، إلغاء، دليل Hisaby).
- توثيق من ينشئ المفتاح: [`HISABY-API-KEYS-AR.md`](../../implementation/HISABY-API-KEYS-AR.md)
- معمارية التكامل: [`HISABY-INTEGRATION-AR.md`](../../implementation/HISABY-INTEGRATION-AR.md)

## على الجهاز الآخر
```sh
git pull origin main
# HEAD يجب أن يشمل 692c213 أو أحدث docs بعده
```

## تحقق يدوي
1. افتح `/ar/owner/api-keys` — دليل Hisaby ظاهر بالعربية.
2. إنشاء مفتاح → نسخ السر → إغلاق.
3. إلغاء مفتاح عبر النافذة المعرّبة (ليس prompt المتصفح).
