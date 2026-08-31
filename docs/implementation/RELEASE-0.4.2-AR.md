# الإصدار 0.4.2 — projector المخزون + housekeeping عند المغادرة

**التاريخ:** 2026-08-31  
**العلم:** `STAYS_PLATFORM_ENABLED` مغلق افتراضياً — وظائف العامل تعمل فقط عند التفعيل.

## ماذا أُضيف؟

- إعادة بناء `stay_inventory_days` من الأقفال النشطة + أسعار الملف (projector).
- تحرير holds المنتهية كل 60 ثانية عند العلم on.
- جدول `stay_housekeeping_tasks` + إنشاء مهمة turnover تلقائياً عند `stay.checked_out`.
- `POST /v1/stays/bookings/:id/checkout` (ops، خلف العلم + allowlist).
- Domain: أولوية حالة اليوم `availabilityFromLockKinds`.

## Nest / Render

- `StaysModule` على الإنتاج يردّ 401 على `/v1/stays/inventory/health` (المسار موجود).
- بعد الدمج: Manual Deploy أو Deploy Hook لالتقاط 0.4.2 على Render + Worker.

## تحقق

| فحص | نتيجة |
| --- | --- |
| `pnpm --filter @bhd-r/domain test` | 18 passed |
| Neon migrate `0016_stay_housekeeping` | applied |
| `/ar/stays` والعلم off | بلا سطح إقامة |
| Worker بدون العلم | jobs idle / outbox stay → skipped |
