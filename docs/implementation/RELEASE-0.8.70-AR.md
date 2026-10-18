# الإصدار 0.8.70 — محرك ترحيل محاسبي وأستاذ تحليلي (مبنى / وحدة / طرف)

**التاريخ:** 2026-10-18  
**الحالة:** جاهز للرفع

## المشكلة

محور المحاسبة في 0.8.69 سجّل القيود يدوياً، لكن مبالغ الإيجار والتأمين والمصروفات لم تُرحَّل تلقائياً إلى دفتر الأستاذ مع ربطها بالمستأجر والمبنى والوحدة. وثيقة المتطلبات (SaaS محاسبي، قيد مزدوج، أبعاد، بدون ترحيل من الذكاء الاصطناعي) تفرض أن كل مستند مصدر ينتج قيداً متوازناً قابلاً للتتبع.

## الحل (مرحلة النواة — MVP من الوثيقة)

1. **محرك قواعد ترحيل حتمي** (`accounting-posting.ts`): إيجار، تأمين محتجز/مسترد/محتجز كإيراد، مصروف (صيانة/قانوني/مرافق…)، فاتورة ذمم وتحصيل — مبالغ INTEGER فقط، وأبعاد `partyId` / `propertyId` / `unitId` على كل سطر.
2. **ترحيل ذري متكرر بأمان** عبر `postSourceDocumentInTx` (مفتاح تفرد org + sourceType + sourceId) و`ensureAccountCodeMap`.
3. **ربط المصادر:**
   - قبض الإيجار (`rent-collection-neon`) → Dr نقد/بنك، Cr إيراد إيجار 4000.
   - رسوم المستأجر المدفوعة (`tenant-charges-neon`) بنفس القاعدة.
   - استرداد/احتجاز التأمين (`stay-deposit-refund-neon`) → 2100 / نقد أو 4300.
   - تسجيل مصروف من المحور → Dr مصروف حسب التصنيف، Cr بنك، مع أبعاد اختيارية.
4. **أستاذ تحليلي:** تبويب «أستاذ تحليلي» + `GET /api/owner/accounting/ledgers` حسب مبنى أو وحدة أو طرف، مع ميزان مدين/دائن للفترة.
5. نموذج المصروفات يقبل معرّفات المبنى/الوحدة/الطرف لربط الحركة.

ما تبقى لاحقاً (حسب خارطة الوثيقة): ضريبة فوترة عُمان، OCR، اقتراحات AI بموافقة بشرية فقط، ترحيل قضايا قانونية من لوحة القضايا، احتجاز التأمين عند الاستلام الأولي، حزم دولية.

## الملفات

- `apps/web/src/lib/accounting-posting.ts`
- `apps/web/src/lib/accounting-gl-neon.ts` — ensureAccountCodeMap، postSourceDocumentInTx، loadDimensionLedger، ترحيل المصروف
- `apps/web/src/lib/rent-collection-neon.ts` / `tenant-charges-neon.ts` / `stay-deposit-refund-neon.ts`
- `apps/web/src/app/api/owner/accounting/ledgers/route.ts`
- `apps/web/src/app/api/owner/accounting/expenses/route.ts` — unitId / partyId
- `apps/web/src/components/accounting/accounting-hub.tsx` + `accounting-hub.css`
- `apps/web/tests/unit/accounting-posting.test.ts`

## التحقق

- vitest: `accounting-posting` + `accounting-gl` (9 اختبارات).
- eslint لمسارات المحاسبة الجديدة نظيف.
- لا ترحيل قاعدة بيانات؛ لا DDL إنتاج.

## مبدأ السلامة (من الوثيقة)

الذكاء الاصطناعي لا يرحّل أرصدة رسمية؛ الترحيل عبر قواعد محاسبية وصلاحيات فقط، والأرقام قابلة لإعادة الإنتاج من المستند المصدر.
