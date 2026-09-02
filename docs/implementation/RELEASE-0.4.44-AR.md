# الإصدار 0.4.44 — إصلاح نشر Vercel + unitId على Nest

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** _(يُحدَّث بعد الرفع)_

## الملخص

1. **إصلاح فشل البناء على Vercel:** تمرير `unitId` الاختياري كان يخالف `exactOptionalPropertyTypes` في صفحة الحجز وتقويم الإقامة — البناء لا يكتمل فبقي الإنتاج على بناء أقدم من 0.4.43.
2. **Nest:** `resolveListingContext` يحترم `unitId` لمسارات quote / availability / calendar (احتياطي Render).
3. يتبع 0.4.43: sandbox-complete + ربط الحجز بالوحدة + معالج غير المنشور.

## تحقق بعد النشر

- [ ] `POST .../quotes` مع `"unitId":"fd6e559d-…"` → 200 (ليس `invalid_body`)
- [ ] الحجز الناتج على R-01 وليس A-02
- [ ] `sandbox-complete` → ليس `sandbox_disabled` → حالة `confirmed`
