# الإصدار 0.4.42 — شارات قنوات المحفظة + إصلاح عناوين الهاتف

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** `c56e3b8`

## الملخص

1. **شارات القنوات في محفظة العقارات:** عمود «القنوات» يعرض إيجار / بيع / إقامة من `listingPurpose` للوحدات + وجود `stay_profiles` (الإقامة ليست غرض إدراج).
2. **نفس الحقل على Nest** في `PortalsService.listProperties` لمسار API الاحتياطي.
3. **إصلاح الهاتف:** تصغير `h2/h3` داخل `.property-360__section` أصبح محصوراً تحت `.portal-layout` حتى لا يطغى على عناوين صفحات الإقامة/الوحدة العامة (0.4.40).

## الملفات الرئيسية

| الملف | التغيير |
|-------|---------|
| `apps/web/src/lib/portal-ops-data.ts` | تجميع `channels: ('rent'\|'sale'\|'stay')[]` لكل عقار |
| `apps/web/src/components/operations-console.tsx` | عمود + تنسيق `channels` + شارات على الجوال |
| `apps/web/src/app/globals.css` | أنماط `.ops-channel-badges` |
| `apps/web/src/app/portal-adaptive.css` | نطاق shrink تحت `.portal-layout` فقط |
| `apps/api/src/portals/portals.service.ts` | مرآة `channels` في Nest |

## تحقق بعد النشر

- [ ] محفظة المالك `/ar/owner/properties` — شارات إيجار/بيع/إقامة على مبنى النور
- [ ] [صفحة إقامة عامة](https://r.bhd-om.com/ar/stays/al-noor-building-a-01?unit=fd6e559d-3f92-4b5d-be64-4ba0245ec662) — عناوين أقسام بحجم 0.4.40 على الهاتف
- [ ] كتالوج الإقامات لا يزال 3 وحدات: `GET /api/public/stays/catalogue?countryCode=OM`

## ما تبقّى (يدوي / اختياري)

- نشر R-02 / R-03 / S-01 / S-02 من معالج الإعداد (يتطلب جلسة مالك)
- اختبار حجز ضيف كامل: quote → hold → pay (sandbox)

## تسليم

[`../handoffs/2026-09-02-continue-0.4.42/`](../handoffs/2026-09-02-continue-0.4.42/)
