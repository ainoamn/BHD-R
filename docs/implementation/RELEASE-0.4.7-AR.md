# الإصدار 0.4.7 — تقارير Occupancy / ADR / RevPAR للإقامات

**التاريخ:** 2026-08-31  
**العلم:** مغلق افتراضياً — مسار التقارير ops يردّ 404/401 حتى التفعيل والسماح للمؤسسة.

## ماذا أُضيف؟

- Domain: `computeStayPerformanceMetrics` ( Occupancy، ADR، RevPAR بمال minor صحيح).
- `GET /v1/stays/reports/performance?fromOn=&toOn=&propertyId?` — من `stay_inventory_days` + حجوزات مؤكدة.
- لوحة المالك/المطور: أداء آخر 30 يوماً على `/owner/stays` و`/developer/stays`.

## صيغ

- Occupancy = ليالي مشغولة / ليالي قابلة للبيع  
- ADR = إيراد الغرف / ليالي مشغولة  
- RevPAR = إيراد الغرف / ليالي قابلة للبيع  

## تحقق

| فحص | نتيجة |
| --- | --- |
| Domain tests (performance) | قبل الدمج |
| العلم off → reports/performance | 401 أو 404 |

## تفعيل

Projector (0.4.2) يملأ الأيام + حجوزات مؤكدة + `STAYS_PLATFORM_ENABLED` + allowlist.
