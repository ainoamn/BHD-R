# خطة الاستكمال — بعد 0.4.42

**تاريخ:** 2026-09-02 · **مسقط UTC+4**  
**الإصدار الحالي:** `0.4.42`  
**الفرع:** `main`

---

## تم في هذه الجلسة

- [x] P0 سحب `main` (≥ 0.4.41)
- [x] P1 تحقق كتالوج الإقامات = 3
- [x] P3 شارات القنوات في المحفظة + إصلاح shrink عناوين الهاتف العامة
- [x] توثيق + أرشفة محادثة قبل الرفع

---

## P1 — تحقق بعد نشر 0.4.42 (5 دقائق)

1. [محفظة المالك](https://r.bhd-om.com/ar/owner/properties) — شارات إيجار/بيع/إقامة على مبنى النور
2. [إقامة R-01 على الهاتف](https://r.bhd-om.com/ar/stays/al-noor-building-a-01?unit=fd6e559d-3f92-4b5d-be64-4ba0245ec662) — عناوين أقسام ليست مضغوطة إلى 0.95rem
3. كتالوج: `GET /api/public/stays/catalogue?countryCode=OM` → count = 3

---

## P2 — نشر بقية الوحدات (يدوي — مالك)

من [معالج الإعداد](https://r.bhd-om.com/ar/owner/stays/setup?propertyId=d0840631-207d-477a-853a-043572d49240):

- R-02, R-03, S-01, S-02 → `publish_status = published`
- بعدها تظهر في `/ar/stays`

---

## P3 — مقترح لاحقاً

- اختبار حجز ضيف كامل: quote → hold → pay (sandbox 0.4.41)
- تحسينات كتالوج/فلاتر عند إضافة وحدات منشورة جديدة

---

## P4 — لا تكسر

- لا ترفع: `scripts/set-database-url.mjs`, `packages/db/tmp-migrate-*.mjs`, أسرار `.env`
- `DATABASE_URL` + `STAYS_PLATFORM_ENABLED=true` على Vercel

---

## عند فتح Cursor على جهاز آخر

```
اقرأ:
- docs/handoffs/2026-09-02-continue-0.4.42/README.md
- docs/handoffs/2026-09-02-continue-0.4.42/CONTINUE-PLAN-AR.md
- docs/implementation/RELEASE-0.4.42-AR.md

git pull origin main
تحقق P1 ثم أنجز P2 يدوياً عند توفر جلسة المالك.
```

**محادثة:** `307d3b18-d433-4130-9cd4-fbf9f887f158`
