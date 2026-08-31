# ADR-010: Bounded Context للإقامات اليومية (BHD R Stays)

- **الحالة:** Accepted (Phase 0 gate)
- **التاريخ:** 31 أغسطس 2026
- **المرجع:** [`docs/product/daily-stays/BHD-R-DAILY-STAYS-MASTER-PLAN-AR.md`](../../product/daily-stays/BHD-R-DAILY-STAYS-MASTER-PLAN-AR.md)

## القرار

نضيف `stays` كـ **bounded context مستقل** داخل الـ Modular Monolith الحالي، مترابط مع العقار/الوحدة عبر معرفات مشتركة، **منفصل** عن مسار الإيجار الطويل (holds → reservations → leases → invoices).

قنوات العرض على الوحدة/العقار ستكون منطقية:

- البيع (`saleEnabled`)
- الإيجار الطويل (`longTermRentEnabled` عبر `listingPurpose` الحالي)
- الإقامة اليومية (`shortStayEnabled` عبر جداول `stay_*` وFeature Flags)

**لا** نضيف قيمة `daily` إلى `units.listing_purpose`.

## الأسباب

- الحجز الحالي مصمَّم للوصول إلى عقد إيجار طويل؛ التأجير اليومي يحتاج تقويماً ولياليًا وتسعيرًا متغيرًا وضيوفًا وFolio مستقلاً.
- فاتورة الإيجار الحالية مرتبطة بـ `leaseId`؛ عقد إيجار وهمي للضيف اليومي يكسر المحاسبة والصلاحيات والتقارير.
- فصل الحالات يمنع خلط «محجوز عربون إيجار» مع «محجوز ليالٍ».

## البدائل المرفوضة

| البديل | السبب |
| ------ | ----- |
| إضافة `daily` إلى `listingPurpose` | يخلط قنوات العرض ويوسّع كل فلاتر البيع/الإيجار |
| إعادة استخدام `holds` / `reservations` / `leases` | دلالات مختلفة؛ قيود وتقارير وبوابة مستأجر غير مناسبة |
| إنشاء Lease وهمي لكل إقامة | كسر الفواتير والدفاتر وحقوق المستأجر طويل المدة |
| منتج/قاعدة منفصلة بالكامل | تكلفة تشغيل وSSO وبيانات مزدوجة بلا مبرر في V1 |

## الحدود

**يعاد استخدامه:** organizations، properties، units، addresses، media، parties، outbox، work tasks، ledger، Country Packs، BHD Identity.

**جديد ومستقل:** `stay_*` tables، quote/hold/booking يومي، folio إقامة، بوابة ضيف، تقويم/تسعير يومي.

**كتابات stays:** Nest API فقط وfail-closed. لا Neon write fallback جديد في Next.

## Feature Flags

مغلق افتراضياً على مستويات: منصة → مؤسسة → عقار/وحدة. إغلاق العلم يعيد السلوك الحالي حرفياً.

## التوافق

- Expand–Migrate–Contract؛ هجرات Additive فقط.
- `stay_inventory_locks` مصدر حقيقة للفترات؛ `stay_inventory_days` إسقاط قابل لإعادة البناء.
- PostgreSQL `daterange [)` + GiST exclusion على `unit_id` للفترات النشطة.
