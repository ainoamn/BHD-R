# خطة الاستكمال — من الكمبيوتر الثاني

**تاريخ:** 2026-09-01 · **مسقط UTC+4**  
**آخر commit:** `38b4f26` · **الإصدار:** `0.4.22`

---

## P0 — تحقق الإنتاج (15 دقيقة)

1. `git pull origin main`
2. Vercel Dashboard → Production deployment أحدث من `38b4f26`
3. معالج الإقامة: حفظ ومتابعة على **مبنى النور** (propertyId `d0840631-707d-477a-853a-043572d49240`)
4. إن فشل الحفظ: تحقق `DATABASE_URL` على Vercel (ليس فقط Nest)

---

## P1 — إكمال pilot الإقامات (إن نجح P0)

| # | المهمة | ملاحظات |
| --- | --- | --- |
| 1 | إكمال المعالج حتى **النشر** لوحدتي A-01 و A-02 | سعر + slug + محتوى |
| 2 | تحقق `/ar/stays` — ظهور الإعلان | قد يتأخر حتى inventory rebuild |
| 3 | Render Manual Deploy لـ Nest إن `/v1/stays/inventory/health` بطيء | ليس blocker للحفظ بعد 0.4.22 |
| 4 | اختبار حجز ضيف (quote → hold → pay) على listing منشور | مسار 0.4.4–0.4.8 |

---

## P2 — تحسينات UI (اختياري)

- شارات قنوات (بيع / إيجار / إقامة) في المحفظة العقارية
- تحسين تسميات حالة الوحدة في جدول المعالج (عربي)
- warm-up Nest قبل النشر إن أردت inventory فوري بدون انتظار worker

---

## P3 — لا تكسر

- **البيع والإيجار السنوي** — الإقامة اليومية channel منفصل على وحدات موجودة
- `STAYS_PLATFORM_ENABLED` على Vercel **و** Render
- CSRF: الحفظ عبر `browserNextMutation` فقط لـ `/api/owner/*`

---

## أوامر مفيدة

```bash
# حالة المستودع
git log -5 --oneline
git status

# نشر Vercel يدوياً (من جذر BHD-R)
vercel deploy --prod --yes

# فحص Nest
curl -s https://bhd-r.onrender.com/v1/stays/inventory/health
```

---

## عند فتح Cursor على الجهاز الثاني

انسخ هذا للمحادثة الجديدة:

```
اقرأ:
- docs/handoffs/2026-09-01-stays-setup-neon-write/README.md
- docs/handoffs/2026-09-01-stays-setup-neon-write/CONTINUE-PLAN-AR.md
- docs/implementation/RELEASE-0.4.22-AR.md

git pull origin main. استكمل pilot الإقامات من P0 ثم P1.
```
