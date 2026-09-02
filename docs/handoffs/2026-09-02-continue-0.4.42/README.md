# تسليم حيّ — محادثة 307d3b18 (أرشيف محدَّث ليلاً)

**تاريخ التحديث:** 2026-09-02  
**وقت التوثيق (مسقط / UTC+4):** 23:39  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**آخر commit عند الأرشفة:** `f059bc6` — *fix(stays): show property on bookings and mark calendar booked*  
**محادثة Cursor:** [307d3b18-d433-4130-9cd4-fbf9f887f158](307d3b18-d433-4130-9cd4-fbf9f887f158)

> هذا المجلد هو أرشيف المحادثة الكامل لهذه الجلسة الطويلة. حُدّث الليلة بعد مسار التأكيد / الإيصال / بوابة المالك / الترجمة.

---

## أين توقّفنا الآن (للجهاز الآخر)

```bash
git pull origin main
git log -1 --oneline   # يفترض f059bc6 أو أحدث
```

### ما شُحن في هذه الجولة (بعد 0.4.46)

| Commit | الملخص |
| --- | --- |
| `a966d82` → `0acde99` | ترحيب شخصي + تخطيط صفحة التأكيد + مستندات PDF بأسلوب وازن |
| `560afb2` | شعار واحد فقط على الإيصال؛ إخفاء كروم الموقع في صفحات الإيصال |
| `a0d3536` | حجوزات الضيف العامة تظهر في بوابة المالك (Neon) + تعريب النشاط |
| `276a36e` | توحيد تسميات الحالة/النشاط عربي/إنجليزي في `ui-labels.ts` |
| `f059bc6` | اسم العقار + رابط في الحجوزات؛ أيام التقويم «محجوز» بعد الدفع |

### تحقق سريع على الإنتاج

- [ ] `/ar/stays/booking/confirmed?...` — ترحيب + شعار + اسم/مرجع + روابط PDF
- [ ] `/ar/owner/stays` — لوحات مترجمة + حجوزات حديثة بعقار
- [ ] `/ar/owner/stays/bookings` — أعمدة العقار/الوحدة
- [ ] `/ar/owner/stays/calendar` — أيام محجوزة بعد الدفع (افتح التقويم مرة لمزامنة الحجوزات القديمة)
- [ ] مرجع تجريبي مثل `ST-0A58F0FE` يظهر مع اسم العقار

---

## المحادثة كاملة

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript.jsonl`](./conversation-transcript.jsonl) | JSONL خام كامل (**974** سطر) — SHA256 في [`MANIFEST.md`](./MANIFEST.md) |
| [`conversation-readable.md`](./conversation-readable.md) | نسخة مقروءة (**291** رسالة) |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) | **خطة الاستكمال بالأولويات** |

> **تنبيه أمني:** أُزيلت قيم حساسة محتملة (`DATABASE_URL`، مفاتيح، JWT، إلخ) بـ `[REDACTED-…]` قبل الرفع.

---

## ملاحظات معمارية لا تكسرها

```
حجز ضيف عام ──Neon──► stay_bookings
                         ├── Neon ► صفحات المالك (ثُبّت)
                         └── Nest /v1/stays/* غالباً فارغ/صامت (fallback فقط)

تأكيد الدفع ──► قفل kind=booking + inventory_days booked + outbox للعامل
فواتير الإيجار / المحاسبة ≠ إيصالات الإقامة (فجوة متعمّدة حالياً)
```

**ملفات محورية:**  
`owner-stays-ops-neon.ts` · `public-stays-payment-neon.ts` · `ui-labels.ts` · `stay-booking-document.tsx` · `stay-ops-bookings-table.tsx`

---

## روابط ذات صلة

- [`../2026-09-02-stay-checkout-0.4.46/`](../2026-09-02-stay-checkout-0.4.46/) — نقطة 0.4.46  
- [`../2026-09-02-continue-0.4.43/`](../2026-09-02-continue-0.4.43/)  
- [`../2026-09-02-evening-home-handoff/`](../2026-09-02-evening-home-handoff/) — محادثة أخرى (لا تخلط الأرشيف)
