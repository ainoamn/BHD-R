# توافق بيانات المحاسبة: BHD-R ↔ Hisaby

**تاريخ:** 2026-10-18 · **إصدار المنتج:** 0.8.75  
**مواقع:** [عقارات](https://r.bhd-om.com) · [حسابي](https://hisaby.bhd-om.com)  
**مستودع حسابي:** [ainoamn/hisaby](https://github.com/ainoamn/hisaby)  
**دليل الربط التشغيلي:** [`HISABY-INTEGRATION-AR.md`](./HISABY-INTEGRATION-AR.md) · [توثيق Hisaby](https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md)

---

## مبدأ عدم التعارض

| النظام     | الدور                                                            | ماذا يرحّل رسمياً؟                                      |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| **BHD-R**  | محاسبة تشغيلية للعقار (قيود مزدوجة، إيصالات، ميزان مراجعة داخلي) | حركات الإيجار/الإقامة/التأمين/المصروف داخل بوابة المالك |
| **Hisaby** | GL مفصّل + ضريبة + تقارير محاسبية عميقة                          | فواتير/سندات/مراكز تكلفة من أحداث المال                 |

**لا يُنسخ كود Hisaby داخل العقارات.** الربط عبر API + SSO فقط (قرار D-207).

لتفادي **القيد المزدوج**:

1. أحداث المال (`stay.payment.succeeded` · `lease.invoice.issued` · `lease.payment.received` · `expense.*` · `deposit.*`) هي **مصدر الحقيقة** لمستندات Hisaby.
2. حدث `accounting.journal.posted` من BHD-R **إعلامي** (مرجع قيد + مبالغ) — Hisaby يتجاهله عند الترحيل التلقائي حتى لا يكرّر القيد.
3. سحب اللقطة `GET /v1/integrations/hisaby/export` يوفّر الحسابات والقيود للمطابقة وليس لإعادة الترحيل الأعمى.

---

## معرّفات ثابتة (externalId)

كل كيان في التصدير يحمل `externalId` بالبادئة `bhd-r:`:

| كيان   | الشكل                   |
| ------ | ----------------------- |
| جهة    | `bhd-r:party:{uuid}`    |
| عقار   | `bhd-r:property:{uuid}` |
| وحدة   | `bhd-r:unit:{uuid}`     |
| حساب   | `bhd-r:account:{uuid}`  |
| قيد    | `bhd-r:journal:{uuid}`  |
| فاتورة | `bhd-r:invoice:{uuid}`  |
| دفعة   | `bhd-r:payment:{uuid}`  |
| إيصال  | `bhd-r:receipt:{uuid}`  |
| مصروف  | `bhd-r:expense:{uuid}`  |

المبالغ دائماً **نص أعداد صحيحة** بوحدة صغرى (`amountMinor`)؛ للريال العماني **3 خانات** (`150000` = 150.000 ر.ع).

مفاتيح عدم التكرار للأحداث: `idempotencyKey` بطول 8–180، عادة `bhd-r:…` أو UUID الحدث في outbox.

---

## حقول حدث الدفع (توافق جسم Hisaby)

| حقل                                                                                        | استخدام BHD-R                   |
| ------------------------------------------------------------------------------------------ | ------------------------------- |
| `organizationExternalId`                                                                   | `organizations.id`              |
| `propertyId` / `unitId` + كائنات الاسم/العنوان                                             | أبعاد العقار                    |
| `counterparty.externalId`                                                                  | `bhd-r:party:…` أو `parties.id` |
| `sourceRefs.bookingId` / `invoiceId` / `paymentId` / `journalId` / `leaseId` / `expenseId` | ربط المستندات                   |
| `amountMinor` + `currency`                                                                 | نفس وحدات GL التشغيلي           |
| `direction`                                                                                | `inbound` / `outbound`          |
| `accountLabel`                                                                             | تسمية تشغيلية للعرض في حسابي    |

Worker: `apps/worker/src/hisaby-push.ts` · تصدير: `apps/api/.../hisaby.service.ts` · لقطة: `compatibility` في JSON التصدير.

---

## الطباعة والإرسال (0.8.75)

في `/ar/owner/accounting`:

- **طباعة** القيد / المستند / التقرير (نافذة طباعة HTML جاهزة لـ PDF).
- **بريد إلكتروني:** طابور `notification.delivery.requested` (نفس مسار Resend للمنصة) عبر `POST /api/owner/accounting/send`.
- **واتساب:** رابط `wa.me` برسالة جاهزة (نفس نمط العقود والمطالبات). إرسال Cloud API من السيرفر يبقى في Hisaby (`pos_receipt`) حتى يُربط توكن Meta للمنصة العقارية لاحقاً.
- عند **ترحيل قيد يدوي** يُرسل بريد للطرف المرتبط مرة واحدة (dedupe على معرّف القيد).

---

## ماذا يفعل المالك مرة واحدة؟

اتبع [`HISABY-INTEGRATION-AR.md`](./HISABY-INTEGRATION-AR.md): رمز وارد من حسابي + مفتاح قراءة بصلاحيات حسابي الكاملة من العقارات.
