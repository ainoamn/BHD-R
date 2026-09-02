# خطة الاستكمال — من المنزل (0.4.40)

**تاريخ:** 2026-09-02 · **مسقط UTC+4**  
**آخر commit:** `0079e42` · **الإصدار:** `0.4.40`  
**الفرع:** `main`

---

## P0 — سحب المستودع (دقيقة)

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
git log -3 --oneline
```

تأكد أن HEAD ≥ `0079e42`.

---

## P1 — تحقق الإنتاج (5 دقائق)

1. [الإقامات](https://r.bhd-om.com/ar/stays?countryCode=OM&currency=OMR) — 3 بطاقات (ليس 0)
2. [R-01 + ?unit=](https://r.bhd-om.com/ar/stays/al-noor-building-a-01?unit=fd6e559d-3f92-4b5d-be64-4ba0245ec662) — تقويم + أقسام فاتح/غامق
3. [شقة A-02](https://r.bhd-om.com/ar/units/90cd9d0b-3526-4419-8066-4c24f6534b90) — نفس تنسيق الأقسام
4. فلاتر الإقامات: خريطة، ميزانية، نوع، غرف/حمامات، موقع

---

## P2 — نشر بقية الوحدات (اختياري)

من [معالج الإعداد](https://r.bhd-om.com/ar/owner/stays/setup?propertyId=d0840631-207d-477a-853a-043572d49240):

- R-02, R-03, S-01, S-02 → `publish_status = published`
- بعد النشر تظهر في `/ar/stays` تلقائياً

---

## P3 — مهام مقترحة لاحقاً

- تحسين portal-adaptive.css على الهاتف (h2 صغير 0.95rem في ops — قد يؤثر على العام)
- اختبار حجز ضيف كامل (quote → hold → pay)
- شارات قنوات (بيع / إيجار / إقامة) في المحفظة

---

## P4 — لا تكسر

- `DATABASE_URL` + `STAYS_PLATFORM_ENABLED=true` على Vercel
- لا ترفع: `scripts/set-database-url.mjs`, `packages/db/tmp-migrate-*.mjs`
- CSRF: حفظ الإقامة عبر `/api/owner/stays/setup` على Vercel

---

## عند فتح Cursor على جهاز آخر

```
اقرأ:
- docs/handoffs/2026-09-02-evening-home-handoff/README.md
- docs/handoffs/2026-09-02-evening-home-handoff/CONTINUE-PLAN-AR.md
- docs/implementation/RELEASE-0.4.40-AR.md

git pull origin main. تحقق P1 ثم استكمل P2/P3 حسب الحاجة.
```

**محادثة Cursor:** `d0d5551b-99f7-449e-92d1-5d812bcf527d`  
**أرشيف كامل:** `docs/handoffs/2026-09-02-evening-home-handoff/conversation-readable-FULL.md`
