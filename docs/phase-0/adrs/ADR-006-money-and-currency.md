# ADR-006: تمثيل المال والعملات

- **الحالة:** Accepted conceptually
- **التاريخ:** 23 أغسطس 2026

## القرار

- المبالغ `BIGINT amount_minor`.
- OMR/BHD/KWD = ثلاث منازل؛ AED/SAR/QAR/USD = منزلتان.
- FX والنسب `NUMERIC/Decimal` ولا تستخدم JS Number.
- Currency وCountry Pack catalogs بإصدارات.
- العقد والفاتورة يحتفظان بالعملة الأصلية؛ التحويل للتقرير فقط.
- أرقام الفواتير Counter/sequence ذرية حسب الكيان القانوني والسنة والنوع.

## النتائج

- الحسابات تحتاج مكتبة Money type مشتركة واختبارات Golden/Property-based.
- JSON API يرسل BigInt كمقادير string أو Money DTO محدد، لا Number غير آمن.

