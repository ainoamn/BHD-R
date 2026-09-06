# تسليم حيّ — بوابة المالك: عرض كامل + لوحة تحكّم (0.4.69 → 0.4.70)

**تاريخ التوثيق:** 2026-09-06  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**آخر commit:** `e219cd9` — *feat(portal): compact owner control dashboard layout (0.4.70)*  
**محادثة Cursor:** [601b86ab-8e1d-4cd0-8a97-097ad967e9ee](601b86ab-8e1d-4cd0-8a97-097ad967e9ee)

> الكود مرفوع على `main`. النشر عبر Vercel تلقائي لمشروع `bhd-r-api` (Root: `apps/web`).

---

## ابدأ هنا على جهاز آخر

```bash
git pull origin main
git log -1 --oneline   # يفترض e219cd9 أو أحدث
```

ثم اقرأ:

1. [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md)
2. [`../implementation/RELEASE-0.4.70-AR.md`](../implementation/RELEASE-0.4.70-AR.md)
3. [`../implementation/RELEASE-0.4.69-AR.md`](../implementation/RELEASE-0.4.69-AR.md)

---

## ما شُحن

| إصدار | Commit | الملخص |
| --- | --- | --- |
| 0.4.69 | `19786ed` | عرض كامل للبوابة + تقويم أوضح بدون تداخل المراجع |
| 0.4.70 | `e219cd9` | لوحة `/owner` مدمجة: إحصائيات صغيرة، تنبيهات مرتّبة، ترتيب أوضح |

---

## روابط تحقق بعد النشر

- https://r.bhd-om.com/ar/owner
- https://r.bhd-om.com/ar/owner/stays/calendar
- https://r.bhd-om.com/ar/owner/stays/bookings

---

## ملاحظات تشغيل

- `STAY_ESIGN_REQUIRED=1` و `NEXT_PUBLIC_STAY_ESIGN_REQUIRED=1` تبقى على Vercel.
- محلياً إن Node < 22: استخدم `pnpm --config.engine-strict=false`.
