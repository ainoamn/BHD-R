# الإصدار 0.4.24 — الإقامات اليومية (عرض عام + معالج) + إصلاح المحفظة

**التاريخ:** 2026-09-01  
**الإنتاج:** https://r.bhd-om.com

## الملخص

- **معالج الإقامة:** ترجمة فورية AR↔EN، توليد ملخص AI، معاينة قبل النشر، نشر دفعة واحدة، توجيه تلقائي إلى `/stays/{slug}`.
- **بعد النشر على Neon:** إعادة بناء `stay_inventory_days` فوراً (365 يوم) حتى يظهر السعر في البحث.
- **البحث والتفاصيل:** صور الغلاف، fallback للسعر من `stay_rate_plans`، قراءة Neon مباشرة، صفحة حجز غنية (معرض + حقائق + وصف).
- **المحفظة العقارية:** إصلاح ظهور عقار واحد فقط رغم إحصاء 3 — تعطيل فلتر `?propertyId=` على قائمة العقارات + `organization_owner` يرى كل عقارات المؤسسة + `leftJoin` في Nest.

## تحقق

1. [المحفظة](https://r.bhd-om.com/ar/owner/properties) — تظهر كل العقارات النشطة.
2. [بحث الإقامات](https://r.bhd-om.com/ar/stays) — صورة + سعر ليلي.
3. [صفحة الحجز](https://r.bhd-om.com/ar/stays/al-noor-building-a-01) — معرض ووصف.
4. [معالج الإعداد](https://r.bhd-om.com/ar/owner/stays/setup?propertyId=d0840631-707d-477a-853a-043572d49240) — ترجمة + معاينة + redirect بعد النشر.

## ملفات رئيسية

- `apps/web/src/components/stays/stay-setup-wizard.tsx`
- `apps/web/src/lib/stay-setup-neon.ts` — inventory rebuild + `publish_profiles`
- `apps/web/src/lib/load-public-stays-neon.ts`
- `apps/web/src/components/stays/stay-public-showcase.tsx`
- `apps/api/src/stays/stays-search.service.ts`
- `apps/web/src/components/operations-console.tsx` — فلتر المحفظة
- `apps/web/src/lib/portal-ops-data.ts` — `organization_owner` org-wide
