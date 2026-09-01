# خطة الاستكمال — 0.4.24 (من أي جهاز)

**تاريخ:** 2026-09-01 · **مسقط UTC+4**  
**آخر commit:** `80aa5dd` · **الإصدار:** `0.4.24`  
**الفرع:** `main` (مدمج — لا PR معلّق)

---

## P0 — تحقق الإنتاج (10 دقائق)

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
git log -1 --oneline   # 80aa5dd
```

1. Vercel → Production أحدث من `80aa5dd`
2. [المحفظة](https://r.bhd-om.com/ar/owner/properties) — **كل** العقارات (ليس 1 فقط)
3. [بحث الإقامات](https://r.bhd-om.com/ar/stays) — صورة + سعر
4. [صفحة الحجز](https://r.bhd-om.com/ar/stays/al-noor-building-a-01) — معرض + وصف
5. [معالج الإقامة](https://r.bhd-om.com/ar/owner/stays/setup?propertyId=d0840631-707d-477a-853a-043572d49240) — ترجمة + نشر → redirect

---

## P1 — إن بقي listing قديم بدون سعر

أعد **نشر** الإقامة مرة من المعالج (أو عدّل السعر واحفظ) لملء `stay_inventory_days` على Neon.

Render Manual Deploy لـ Nest إن أردت cache/search من API مباشرة (Vercel يقرأ Neon أولاً).

---

## P2 — تحسينات لاحقة (اختياري)

- شارات قنوات (بيع / إيجار / إقامة) في المحفظة
- warm Nest قبل النشر
- اختبار حجز ضيف كامل (quote → hold → pay)

---

## P3 — لا تكسر

- `DATABASE_URL` + `STAYS_PLATFORM_ENABLED=true` على Vercel
- CSRF: حفظ الإقامة عبر `browserNextMutation` → `/api/owner/stays/setup`
- `scripts/set-database-url.mjs` — **محلي فقط**، لا يُرفع

---

## عند فتح Cursor على جهاز آخر

```
اقرأ:
- docs/handoffs/2026-09-01-stays-public-and-portfolio/README.md
- docs/handoffs/2026-09-01-stays-public-and-portfolio/CONTINUE-PLAN-AR.md
- docs/implementation/RELEASE-0.4.24-AR.md

git pull origin main. تحقق P0 ثم استكمل P2 حسب الحاجة.
```

**محادثة Cursor:** `d0d5551b-99f7-449e-92d1-5d812bcf527d`
