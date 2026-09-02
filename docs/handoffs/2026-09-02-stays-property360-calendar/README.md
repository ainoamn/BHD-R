# تسليم — 0.4.26 Property 360 للإقامات + تقويم الإشغال

**تاريخ:** 2026-09-02  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الفرع:** `main`  
**آخر commit:** `05b8f73` — *Ship Property 360 stay pages, occupancy calendar, and refined stays search UX as 0.4.26.*  
**الإصدار:** 0.4.26  
**معرّف محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

---

## ما أُنجز (0.4.25 → 0.4.26)

| المجال | التفاصيل |
| --- | --- |
| **تفاصيل الإقامة** | `PropertyDetailManager` + `stayBooking` بدل `StayPublicShowcase` المنفصل |
| **بحث `/stays`** | hero، شبكة `auto-fill`، بطاقات محسّنة، شريط بحث بهوية BHD |
| **تقويم الضيف** | `StayAvailabilityCalendar` في خطوة الحجز الأولى |
| **تقويم المالك** | `/owner/stays/calendar` — تبويبات وحدات + locks + iCal |
| **API** | `calendar` عام + `inventory-days` للعمليات |
| **بيانات** | اختيار وحدة بغرف نوم في SQL التفاصيل |

---

## كيف تبدأ من جهاز آخر

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
```

في Cursor:

> اقرأ `docs/handoffs/2026-09-02-stays-property360-calendar/README.md` و `docs/implementation/RELEASE-0.4.26-AR.md` ثم استكمل من HEAD على `main`.

---

## روابط التحقق (إنتاج)

- [نتائج البحث](https://r.bhd-om.com/ar/stays?checkInOn=2026-09-03&checkOutOn=2026-09-05&adults=2&children=0)
- [تفاصيل مبنى النور](https://r.bhd-om.com/ar/stays/al-noor-building-a-01?checkInOn=2026-09-03&checkOutOn=2026-09-05&adults=2&children=0)
- [مرجع Property 360 — وحدة](https://r.bhd-om.com/ar/units/90cd9d0b-3526-4419-8066-4c24f6534b90)

---

## تحقق بعد النشر

- [ ] Vercel + Render نشرا commit 0.4.26
- [ ] صفحة الإقامة = Property 360
- [ ] التقويم يظهر في الحجز
- [ ] تقويم المالك يعرض الحجوزات
- [ ] API التقويم يرجع أياماً من `stay_inventory_days`

---

## تسليم سابق

| الوثيقة | المحتوى |
| --- | --- |
| [`../2026-09-01-stays-public-and-portfolio/`](../2026-09-01-stays-public-and-portfolio/) | 0.4.24 معالج + محفظة |
| [`RELEASE-0.4.25-AR.md`](../../implementation/RELEASE-0.4.25-AR.md) | بحث Booking + حجز 4 خطوات |

**ملاحظة:** `scripts/set-database-url.mjs` محلي فقط — لا يُرفع.
