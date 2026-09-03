# الإصدار 0.4.51 — فتح نشاط الحجز كعقد من لوحة المالك

**التاريخ:** 2026-09-03  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** _(after push)_

## الملخص

من صفحة المالك `/ar/owner` أصبح الضغط على عناصر **آخر نشاط** (طلب حجز / تأكيد دفع) يفتح مستند حجز بأسلوب العقد يعرض:

1. بيانات الحجز والتواريخ والمبلغ  
2. اسم الضيف والبريد ورقم التواصل  
3. العقار والوحدة مع روابط  
4. حالة الدفع وطريقة الدفع ومرجع المزود  
5. روابط إيصال الضيف وتأكيد الحجز + طباعة PDF  

## الملفات

| الملف | الدور |
| --- | --- |
| `apps/web/src/components/portal-overview.tsx` | روابط النشاط → صفحة العقد |
| `apps/web/src/lib/portal-overview-data.ts` | `resourceType` / `resourceId` من workflow |
| `apps/web/src/components/stays/stay-booking-contract.tsx` | مستند العقد |
| `apps/web/src/lib/owner-stays-ops-neon.ts` | تحميل تفاصيل الحجز + الدفع + الضيف |
| `apps/web/src/app/[locale]/owner/stays/bookings/[bookingId]/` | صفحة العقد للمالك |
| `apps/web/src/app/[locale]/developer/stays/bookings/[bookingId]/` | نفس الصفحة للمطوّر |
| `apps/web/src/components/stays/stay-ops-bookings-table.tsx` | رابط المرجع + زر العقد |

## تحقق

- [ ] https://r.bhd-om.com/ar/owner — الضغط على «تأكيد دفع» أو «طلب حجز» يفتح العقد  
- [ ] يظهر العقار والتواصل وطريقة الدفع والإيصال  
- [ ] من `/ar/owner/stays/bookings` الضغط على المرجع يفتح نفس الصفحة  

## روابط

- [لوحة المالك](https://r.bhd-om.com/ar/owner)
- [حجوزات الإقامات](https://r.bhd-om.com/ar/owner/stays/bookings)
