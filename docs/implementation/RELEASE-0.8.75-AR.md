# الإصدار 0.8.75 — توافق Hisaby + طباعة وإرسال المستندات المحاسبية

**التاريخ:** 2026-10-18  
**الحالة:** جاهز للرفع

## الهدف

دراسة [حسابي](https://hisaby.bhd-om.com) ومستودع [ainoamn/hisaby](https://github.com/ainoamn/hisaby) لضمان أن محاسبة العقارات التشغيلية لا تتعارض مع GL المفصّل عند الربط المستقبلي، مع إضافة طباعة وإرسال إلكتروني للفواتير والإيصالات والقيود والتقارير.

## ما تغيّر

1. **عقد توافق البيانات** في [`HISABY-ACCOUNTING-COMPAT-AR.md`](./HISABY-ACCOUNTING-COMPAT-AR.md): أدوار النظامين، `externalId` الثابتة، أحداث المال كمصدّر Hisaby، والقيود التشغيلية كمراجع إعلامية.
2. **تصدير Hisaby** يضيف `externalId` للحسابات/القيود/الفواتير/المدفوعات/الإيصالات/المصروفات/الجهات/العقارات/الوحدات + كتلة `compatibility`.
3. **حمولة outbox** لـ `accounting.journal-posted` أغنى (`amountMinor`، `sourceRefs.journalId`، مذكرة) وWorker يمرّر مراجع المصدر بشكل أنظف.
4. **طباعة** القيد والمستند وميزان المراجعة/الدخل/الميزانية/التدفقات/أعمار الذمم من محور المحاسبة.
5. **إرسال** عبر `POST /api/owner/accounting/send`: بريد معلّم في الطابور + رابط واتساب `wa.me`؛ بريد تلقائي عند ترحيل قيد يدوي للطرف المرتبط.

## الملفات

- `docs/implementation/HISABY-ACCOUNTING-COMPAT-AR.md`
- `apps/api/src/integrations/hisaby.service.ts`
- `apps/worker/src/hisaby-push.ts`
- `apps/web/src/lib/accounting-print.ts`
- `apps/web/src/lib/accounting-send-neon.ts`
- `apps/web/src/app/api/owner/accounting/send/route.ts`
- `apps/web/src/lib/accounting-gl-neon.ts`
- `apps/web/src/components/accounting/accounting-hub.tsx`
- `apps/web/src/components/accounting/accounting-entry-drawer.tsx`

## التحقق

- لا DDL إنتاج.
- واتساب عبر رابط عميق (Cloud API يبقى في Hisaby حتى يُربط لاحقاً).

## ملاحظة

المالك يربط المفاتيح مرة واحدة حسب [`HISABY-INTEGRATION-AR.md`](./HISABY-INTEGRATION-AR.md) ليبدأ الدفع/السحب التلقائي.
