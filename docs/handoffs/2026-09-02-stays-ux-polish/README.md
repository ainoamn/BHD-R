# تسليم — 0.4.27 تحسينات UX للإقامات والتقييمات

**تاريخ:** 2026-09-02  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الفرع:** `main`  
**آخر commit:** `9643021` — *Polish stays UX with full-width calendar, slim search bar, and Booking-style reviews as 0.4.27.*  
**الإصدار:** 0.4.27  
**سابق:** [0.4.26 Property 360 + تقويم](../2026-09-02-stays-property360-calendar/README.md)

---

## ما أُنجز

| الطلب | الحل |
| --- | --- |
| التقويم صغير/غير ملائم | تقويم `large` في العمود الرئيسي |
| تشتت الوحدات | accordion مطوي + إخفاء في صفحة الإقامة |
| شريط بحث سميك | booking-bar نحيف، max-width 56rem |
| زر بحث أزرق | `--oman-teal` |
| تقييمات Booking | PropertyReviewScore + ReviewsPanel محدّث |

---

## كيف تبدأ من جهاز آخر

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
```

> اقرأ `docs/implementation/RELEASE-0.4.27-AR.md` ثم استكمل من HEAD على `main`.

---

## تحقق

- [ ] Vercel نشر commit 0.4.27
- [ ] تقويم الإقامة بعرض كامل
- [ ] شريط بحث نحيف + زر أخضر
- [ ] وحدات المبنى مطوية
- [ ] تقييمات على صفحة العقار

**ملاحظة:** `scripts/set-database-url.mjs` محلي فقط — لا يُرفع.
