# تسليم — 0.4.30 تقويم أخضر + تسعير يومي + ملاحظات

**تاريخ:** 2026-09-02  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**آخر commit:** `b26678f` — *Ship stay calendar green availability and per-day rates/notes as 0.4.30.*  
**الإصدار:** 0.4.30  
**معرّف محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

---

## ما أُنجز

| الطلب | الحل |
| --- | --- |
| كل الأيام الشاغرة خضراء | `fillInventoryCalendarDays` يفترض `available` + السعر الأساسي |
| تسعير يوم معيّن (رفع/تخفيض) | `manual_rate` + واجهة مالك |
| ملاحظة/تهنئة للجمهور | `public_note` يظهر في التقويم العام |
| السعر في التقويم | مبلغ تحت رقم اليوم |

## ترحيل Neon (إلزامي)

```sql
ALTER TABLE "stay_inventory_days"
  ADD COLUMN IF NOT EXISTS "public_note" text,
  ADD COLUMN IF NOT EXISTS "manual_rate" boolean NOT NULL DEFAULT false;
```

أو: `pnpm --filter @bhd-r/db exec tsx src/migrate.ts` مع `DATABASE_URL`.

## تحقق بعد النشر

1. https://r.bhd-om.com/ar/stays/al-noor-building-a-01 — أيام خضراء + أسعار
2. `/ar/owner/stays/calendar` — اضغط يوماً → احفظ سعراً وملاحظة
3. أعد تحميل الصفحة العامة — يظهر السعر والملاحظة
