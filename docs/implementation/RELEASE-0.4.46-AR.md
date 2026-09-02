# الإصدار 0.4.46 — ألوان الحجز + تعبئة الضيف + إيصال PDF والبريد

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** `9404d91`

## الملخص

تحسين مسار الحجز العام (`/stays/{slug}/book`) ليتوافق مع طلب المنتج:

1. **ألوان مميزة** لحقول الوصول / المغادرة / نوع الإقامة / البالغين / الأطفال في خطوة الإقامة، ونفس الألوان في **المراجعة** والتأكيد والإيصال.
2. **تعبئة بيانات الضيف** تلقائياً من المستخدم المسجّل (الاسم والبريد) مع إمكانية التعديل.
3. بعد **تأكيد الحجز** يتم التحويل مباشرة إلى **بوابة الدفع** (sandbox).
4. بعد الدفع: صفحة **إيصال** قابلة للطباعة/الحفظ كـ PDF، ورابط من صفحة التأكيد.
5. عند وجود بريد ضيف: طابور `notification.delivery.requested` لإرسال إيميل التأكيد + رابط الإيصال عبر الـ worker (SMTP).

## الملفات الرئيسية

| مسار | دور |
| --- | --- |
| `apps/web/src/components/stays/stay-checkout.tsx` | ألوان، prefill، تحويل دفع تلقائي |
| `apps/web/src/app/globals.css` | CSS tones/chips |
| `apps/web/src/app/[locale]/stays/[slug]/book/page.tsx` | تمرير بيانات المشاهد |
| `apps/web/src/app/[locale]/stays/booking/confirmed/page.tsx` | ألوان + رابط الإيصال |
| `apps/web/src/app/[locale]/stays/booking/receipt/` | صفحة الإيصال + زر طباعة PDF |
| `apps/web/src/lib/public-stays-booking-neon.ts` | حفظ `guestContact` + stayType في snapshot |
| `apps/web/src/lib/public-stays-payment-neon.ts` | طابور إيميل بعد تأكيد الدفع |
| `apps/web/src/lib/public-stays-guest-neon.ts` | إسقاط بيانات الإيصال من الحجز |
| `packages/contracts/src/stays/schemas.ts` | `guestEmail` / `guestPhone` اختياريان |
| `apps/api/src/stays/stays-booking.service.ts` | نفس حقول الضيف على Nest |

## تحقق يدوي

- [ ] خطوة الإقامة: كل حقل بلون مختلف؛ النوع يتغيّر لونه عند التبديل
- [ ] خطوة البيانات: الاسم/البريد ممتلئان للمستخدم المسجّل وقابلان للتعديل
- [ ] المراجعة: نفس ألوان الوصول/المغادرة/النوع/البالغين/الأطفال
- [ ] تأكيد الحجز → تحويل لـ `/payments/sandbox/...`
- [ ] بعد sandbox-complete → `/stays/booking/confirmed?ref=ST-…` مع رابط الإيصال
- [ ] `/stays/booking/receipt?ref=ST-…` → «حفظ / طباعة PDF»
- [ ] إن وُجد SMTP على الـ worker: وصول إيميل التأكيد لبريد الضيف

## ملاحظات تشغيل

- الإيميل يعتمد على `SMTP_*` / `EMAIL_FROM` في worker وطابور `notification.delivery.requested`.
- الإيصال الحالي HTML قابل للطباعة كـ PDF من المتصفح (بدون ملف PDF مخزّن خاص).
