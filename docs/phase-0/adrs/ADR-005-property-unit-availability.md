# ADR-005: Property + Unit + Listing والتوافر المشتق

- **الحالة:** Accepted conceptually
- **التاريخ:** 23 أغسطس 2026

## القرار

- العقار الفردي ينشئ Unit واحدة تلقائياً.
- العقار المتعدد يملك Unit rows مستقلة.
- الإعلان `Listing` منفصل عن الأصل والوحدة.
- `marketing_enabled` رغبة نشر، وليس إثبات توافر.
- effective visibility تتطلب Unit `AVAILABLE` وعدم وجود block متداخل.
- PostgreSQL exclusion constraints تمنع تداخل Hold/Reservation/Lease.

## النتائج

- المحجوز والمؤجر يختفيان آلياً.
- انتهاء الحجز يعيد الوحدة إن بقي زر العرض مفعلاً.
- لا JSON units ولا مفاتيح نصية Legacy.
- يحتاج Cache/Sitemap invalidation عند كل availability event.
