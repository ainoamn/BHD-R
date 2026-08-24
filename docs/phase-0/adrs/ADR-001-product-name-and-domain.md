# ADR-001: اسم المنتج والنطاق

- **الحالة:** الاسم Accepted؛ النطاق Proposed
- **التاريخ:** 23 أغسطس 2026

## السياق

استبدل مالك المنتج الاسم السابق بـ**BHD R**، ويرمز R إلى إدارة العقارات. إعداد ONE-BHD الحالي يحتوي `bhd-baitak` و`bhd-office` على نطاق متعارض.

## القرار

- الاسم الرسمي: `BHD R`.
- الوصف العربي: `إدارة العقارات`.
- الوصف الإنجليزي: `Real Estate Management`.
- Sub-brand: `BHD R — A BHD Product`.
- النطاق المقترح: `https://r.bhd-om.com`.
- OIDC client المقترح: `bhd-r`.
- لا يعاد استخدام `bhd-baitak` أو `baitak.bhd-om.com` للمنتج الجديد.

## النتائج

- هوية قصيرة ومتوافقة مع مشغل BHD.
- ينتهي تعارض Office/Baitak عن BHD R، مع بقاء تنظيف السجل القديم عملاً مستقلاً.
- يلزم تسجيل DNS وOIDC callbacks وapp catalog بعد الاعتماد.
