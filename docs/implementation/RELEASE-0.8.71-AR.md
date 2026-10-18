# الإصدار 0.8.71 — ترحيل التأمين عند الاستلام وتحصيل القضايا والمطالبات

**التاريخ:** 2026-10-18  
**الحالة:** جاهز للرفع

## المشكلة

بعد 0.8.70 كانت استردادات التأمين تُرحَّل دون قيد «تأمين محتجز» عند الاستلام، وتحصيل القضايا ومطالبات الصيانة/المرافق كانت تُسجَّل كإيراد إيجار (4000) بدل حسابات مناسبة.

## الحل

1. **تأمين إقامة عند تسجيل الوصول:** قيد `stay_deposit_held` — مدين صندوق، دائن التزام تأمين 2100، مربوط بالضيف والمبنى والوحدة.
2. **عربون حجز إيجار/بيع من الموقع:** قيد `reservation_deposit` عند دفع العربون — مدين بنك، دائن 2100.
3. **تحصيل قضية:** عند زيادة `recoveredAmountMinor` يُرحَّل الفرق (`legal_recovery`) — مدين بنك، دائن إيرادات أخرى 4300، بأبعاد الطرف/المبنى/الوحدة. مفتاح مصدر UUID حتمي لمنع التكرار.
4. **مطالبات المستأجر:** التحصيل عبر `postingChargeReceipt` — صيانة/تلف/مرافق → 4300، خدمة → 4200 (وليس دائماً إيجار 4000).
5. مصروف الصيانة من جهة المؤجر يبقى عبر تبويب المصروفات بتصنيف «صيانة» → 5100 مع الأبعاد.

## الملفات

- `apps/web/src/lib/accounting-posting.ts` — `postingLegalRecovery` / `postingChargeReceipt` / `revenueCodeFromChargeCategory`
- `apps/web/src/lib/accounting-gl-neon.ts` — `deterministicSourceId`
- `apps/web/src/lib/stay-arrival-neon.ts`
- `apps/web/src/lib/public-lease-booking-neon.ts`
- `apps/web/src/lib/legal-case-neon.ts`
- `apps/web/src/lib/tenant-charges-neon.ts`
- `apps/web/tests/unit/accounting-posting.test.ts`

## التحقق

- vitest: 6 اختبارات في `accounting-posting` ناجحة.
- eslint للمسارات المعدّلة نظيف.
- لا ترحيل قاعدة بيانات.

## لاحقاً

ضريبة/فوترة عُمان، OCR، اقتراحات AI بموافقة بشرية، تبويب شيكات.
