# الإصدار 0.4.26 — Property 360 للإقامات + تقويم الإشغال

**التاريخ:** 2026-09-02

## الملخص

- **صفحة الإقامة:** نفس تخطيط Property 360 المستخدم في `/units/…` (معرض، وصف، مرافق، خريطة) مع معالج الحجز في الشريط الجانبي.
- **نتائج `/stays`:** hero مدمج، شبكة بطاقات متوازنة، وهوية بصرية BHD بدل إطار Booking الأصفر.
- **تقويم الإشغال:** شهران تفاعليان يوضحان الشاغر والمحجوز والمغلق — في صفحة الحجز وللوحة المالك.
- **API:** `GET /v1/public/stays/:slug/calendar` و `GET /v1/stays/units/:unitId/inventory-days`.

## التدفق العام (ضيف)

1. `/ar/stays` → بحث بالتواريخ
2. `/ar/stays/{slug}` → Property 360 + تقويم + حجز 4 خطوات
3. اختيار التواريخ من التقويم (أخضر = شاغر) أو حقول التاريخ
4. تأكيد → دفع → `/stays/booking/confirmed?ref=…`

## التقويم — دليل الألوان

| اللون | الحالة |
| --- | --- |
| أخضر | شاغر — قابل للحجز |
| أحمر | محجوز |
| برتقالي | hold (محجوز مؤقتاً) |
| رمادي | مغلق / صيانة / غير متاح |

## لوحة المالك

- `/ar/owner/stays/calendar` — تقويم لكل وحدة + قائمة الحجوزات والإغلاقات + تصدير iCal.
- `/ar/developer/stays/calendar` — نفس الواجهة.

## إصلاحات بيانات

- تفضيل وحدة سكنية (`bedrooms > 0`) عند عرض تفاصيل الإقامة (بدل معرض/محل).
- وصف الإقامة من ملخص النشر عند توفره.

## ملفات محورية

| الملف | الدور |
| --- | --- |
| `apps/web/src/app/[locale]/stays/[slug]/page.tsx` | Property 360 + `stayBooking` |
| `apps/web/src/components/property-detail-manager.tsx` | دعم `stayBooking` في الشريط الجانبي |
| `apps/web/src/components/stays/stay-availability-calendar.tsx` | التقويم التفاعلي |
| `apps/web/src/components/stays/stay-ops-calendar-panel.tsx` | تقويم المالك |
| `apps/api/src/stays/stays-inventory.service.ts` | قراءة `stay_inventory_days` + locks |
| `packages/contracts/src/stays/schemas.ts` | عقود التقويم |

## تحقق بعد النشر

- [ ] `/ar/stays?checkInOn=…&checkOutOn=…` — بطاقات في شبكة متوازنة
- [ ] `/ar/stays/al-noor-building-a-01` — Property 360 + تقويم + حجز
- [ ] `/ar/owner/stays/calendar` — تقويم الوحدات والحجوزات
- [ ] `GET /v1/public/stays/al-noor-building-a-01/calendar?fromOn=2026-09-01&toOn=2026-11-01` — JSON أيام

## متغيرات الإنتاج

| الطبقة | مطلوب |
| --- | --- |
| Vercel | `DATABASE_URL`, `STAYS_PLATFORM_ENABLED=true` |
| Render (API) | `STAYS_PLATFORM_ENABLED=true`, `DATABASE_URL` |
