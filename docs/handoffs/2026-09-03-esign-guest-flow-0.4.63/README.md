# تسليم حيّ — مسار الإقامات + التوقيع الإلكتروني (0.4.54 → 0.4.63)

**تاريخ التوثيق:** 2026-09-03  
**وقت التوثيق (مسقط / UTC+4):** 16:32 تقريباً  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**آخر commit عند الأرشفة:** `76456d7` — *feat(stays): show e-sign CTA on confirmation when contract unsigned (0.4.63)*  
**محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

> هذا المجلد أرشيف المحادثة + خطة الاستكمال للجهاز الثاني. الكود منشور على `main` والإنتاج محدّث إلى **0.4.63**.

---

## على الجهاز الآخر — ابدأ هنا

```bash
git clone https://github.com/ainoamn/BHD-R.git
# أو إن كان المستودع موجوداً:
cd BHD-R
git pull origin main
git log -1 --oneline   # يفترض 76456d7 أو أحدث
```

ثم اقرأ بالترتيب:

1. [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) — ماذا بقي وما الحالة الحالية  
2. [`conversation-readable.md`](./conversation-readable.md) — ملخص المحادثة مقروءاً  
3. عند الحاجة للتفاصيل الخام: [`conversation-transcript.jsonl`](./conversation-transcript.jsonl)

---

## ما شُحن في هذه الجولة

| إصدار | Commit | الملخص |
| --- | --- | --- |
| 0.4.54–0.4.56 | (سلسلة سابقة في نفس المحادثة) | صفحة الحجز المنقسمة + شعار/نص تحفيزي |
| 0.4.57–0.4.58 | | دفع sandbox: CTA إعادة حجز عند `dates_taken` + إصلاح TS |
| 0.4.59 | `ba1095f` | مزامنة التقويم مع الأقفال؛ إسقاط حجوزات `payment_pending` المنتهية |
| 0.4.60 | `31806ee` | عدم احتساب قفل الضيف نفسه كـ `dates_taken` |
| 0.4.61 | `3e9a636` | رحلات الضيف: دفع / إلغاء / تعديل / احجز مجدداً |
| 0.4.62 | `2e06aee` | تفعيل مسار التوقيع بعد الدفع + شاشة اعتماد بن حمود |
| **0.4.63** | **`76456d7`** | زر **توقيع عقد الإقامة** في صفحة التأكيد للحجوزات غير الموقّعة |

### سبب مشكلة التوقيع (مهم)
على Vercel كان:
- `STAY_ESIGN_REQUIRED=0`
- `NEXT_PUBLIC_STAY_ESIGN_REQUIRED=0`

تم ضبطهما إلى `1` في production + preview. **لا تعِدهما إلى `0`** إلا لتعطيل متعمّد.

---

## تحقق سريع على الإنتاج

- [ ] بعد دفع جديد → يفضّل التحويل إلى `/ar/stays/booking/sign?ref=ST-…`
- [ ] [تأكيد ST-0343C0F6](https://r.bhd-om.com/ar/stays/booking/confirmed?ref=ST-0343C0F6) يظهر زر **توقيع عقد الإقامة** إن لم يُوقَّع بعد
- [ ] بعد التوقيع → شارة «معتمد إلكترونياً من بن حمود» ثم تفاصيل الحجز؛ الزر يختفي من confirmed
- [ ] رحلات الضيف: إتمام الدفع / إلغاء / احجز مجدداً حسب الحالة

---

## ملفات المحادثة

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript.jsonl`](./conversation-transcript.jsonl) | JSONL خام كامل للمحادثة | (**أسرار منقّحة**)
| [`conversation-readable.md`](./conversation-readable.md) | نص المستخدم/المساعد فقط |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) | خطة الاستكمال |

---

## ما لا يُرفع إلى Git (محلياً فقط)

هذه الملفات كانت untracked عمداً (أدوات ترحيل/أسرار):

- `packages/db/tmp-migrate-0021.mjs`
- `packages/db/tmp-migrate-0022.mjs`
- `scripts/set-database-url.mjs`

لا تنسخ أسرار Vercel/Neon إلى المستودع.

