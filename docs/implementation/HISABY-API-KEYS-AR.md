# أمر لـ Hisaby — الربط ومفاتيح API مع BHD R

**تاريخ:** 2026-09-09  
**عقارات:** https://r.bhd-om.com · مستودع [BHD-R](https://github.com/ainoamn/BHD-R)  
**محاسبة:** https://hisaby.bhd-om.com · مستودع [hisaby](https://github.com/ainoamn/hisaby)  
**مرجع المعمارية:** [`HISABY-INTEGRATION-AR.md`](./HISABY-INTEGRATION-AR.md)

---

## من ينشئ أي مفتاح؟ (قاعدة واضحة)

| الاتجاه | من يُنشئ المفتاح؟ | أين؟ | من يستخدمه؟ |
| --- | --- | --- | --- |
| **دفع أحداث من العقارات → Hisaby** (المسار الأساسي) | **Hisaby** | إعدادات الشركة / تكاملات في Hisaby | **BHD-R** يخزّن المفتاح سرّاً ويرسل webhooks/أحداث |
| **قراءة بيانات عقار من Hisaby ← BHD-R** (اختياري للمطابقة) | **BHD-R (المالك)** | [`/ar/owner/api-keys`](https://r.bhd-om.com/ar/owner/api-keys) | **Hisaby** يستدعي API العقارات بمفتاح القراءة |
| **دخول المستخدم** | لا مفتاح | SSO BHD Identity | المستخدم يفتح Hisaby من بوابة التطبيقات |

**الخلاصة للمالك:**  
- لربط المحاسبة المفصّلة: أنشئ **رمز تكامل وارد في Hisaby**، ثم الصقه لاحقاً في إعدادات الربط داخل BHD-R (مرحلة B).  
- لإنشاء مفتاح على صفحة العقارات: اضغط **تعبئة صلاحيات حسابي الكاملة** ثم الصق المفتاح في Hisaby. بعدها يسحب حسابي العقارات والعناوين والجهات والفواتير والحسابات الواردة والصادرة والتواريخ والمعاملات **تلقائياً كل 15 دقيقة بدون تدخل بشري**.


لا يُنشأ مفتاح Hisaby من صفحة `/owner/api-keys` في BHD-R؛ تلك الصفحة تخص **مفاتيح BHD-R الصادرة للشركاء**.

---

## أمر تنفيذ لوكيل Hisaby (انسخه كما هو)

```text
المستودع: ainoamn/hisaby (BHD Pro)
الهدف: تمكين تكامل وارد من BHD-R (عقارات) حسب docs في BHD-R:
https://github.com/ainoamn/BHD-R/blob/main/docs/implementation/HISABY-INTEGRATION-AR.md
و https://github.com/ainoamn/BHD-R/blob/main/docs/implementation/HISABY-API-KEYS-AR.md

المطلوب في Hisaby:

1) شاشة إعدادات الشركة → «تكامل BHD R / العقارات»:
   - زر «إنشاء رمز تكامل وارد» (Inbound integration token).
   - عرض الرمز مرة واحدة فقط + تحذير النسخ.
   - إمكانية إلغاء الرمز وإعادة إنشائه.
   - حقل اختياري: لصق مفتاح قراءة BHD-R (للسحب العكسي لاحقاً).
   - رابط عميق/SSO إلى https://r.bhd-om.com إن وُجد ربط مؤسسة.

2) Endpoint استقبال أحداث (مثال مقترح — ثبّت المسار في Swagger):
   POST /api/integrations/bhd-r/events
   Authorization: Bearer <HISABY_INBOUND_TOKEN>
   Body JSON:
   {
     "idempotencyKey": "string",
     "type": "stay.payment.succeeded|lease.invoice.issued|lease.payment.received|expense.paid|bhd-r.connection.ping",
     "occurredOn": "ISO-8601",
     "amountMinor": "string",
     "currency": "OMR",
     "organizationExternalId": "bhd-r-org-uuid",
     "propertyId": "uuid?",
     "unitId": "uuid?",
     "counterparty": { "name": "...", "externalId": "..." },
     "memo": "string",
     "sourceRefs": { "bookingId": "...", "invoiceId": "...", "paymentId": "..." }
   }
   السلوك: idempotent → إنشاء/تحديث فاتورة أو سند قبض + ترحيل GL حسب دليل حسابات الشركة.

2b) سحب اختياري من BHD-R (مفتاح قراءة يُنشأ في /ar/owner/api-keys):
   GET https://api.r.bhd-om.com/v1/integrations/hisaby/export
   Authorization: Bearer <BHD_R_API_KEY>
   → لقطة JSON (عقارات+عناوين، أطراف، إيجارات، فواتير، مدفوعات، مصروفات، قيود، حجوزات).
   يُفضّل جدولة السحب كل 15 دقيقة داخل Hisaby بعد لصق المفتاح.

3) توثيق عربي داخل Hisaby: «كيف أربط برنامج العقارات BHD R».

4) لا تنسخ كود BHD-R داخل Hisaby؛ التكامل عبر API + SSO فقط.

5) بعد التنفيذ: أعطِ BHD-R مسار الـ endpoint النهائي وأسماء الحقول لتحديث HISABY-INTEGRATION-AR.md.
```

---

## خطوات المالك (واجهة)

### أ) الربط الأساسي (دفع إلى Hisaby)

1. ادخل https://hisaby.bhd-om.com بنفس حساب BHD.  
2. إعدادات الشركة → تكامل BHD R → **إنشاء رمز تكامل وارد** (بعد أن يوفّره Hisaby).  
3. انسخ الرمز ومسار الأحداث (مثال: `https://hisaby.bhd-om.com/api/integrations/bhd-r/events`).  
4. في BHD-R افتح https://r.bhd-om.com/ar/owner/api-keys → نموذج **حفظ الربط التلقائي** → الصق الرابط والرمز واحفظ.  
5. اختياري: «اختبار الاتصال». بعد النجاح، دفع إقامة/فاتورة يُرسل تلقائياً إلى Hisaby دون تدخل بشري.

### ب) مفتاح قراءة من العقارات (للسحب من Hisaby)

1. افتح https://r.bhd-om.com/ar/owner/api-keys  
2. **إنشاء مفتاح API** باسم مثل `Hisaby — قراءة مالية`.  
3. اضغط **تعبئة صلاحيات Hisaby (قراءة)** (عقارات وعناوين، أطراف، فواتير، مدفوعات وارد، حسابات/مصروفات، تواريخ، معاملات، إقامة…).  
4. انسخ المفتاح **مرة واحدة**.  
5. الصقه في Hisaby تحت «مفتاح قراءة BHD R». Hisaby يستدعي `GET /v1/integrations/hisaby/export` (وجدولة السحب من جهة Hisaby).

### ج) الدخول اليومي

من بوابة BHD أو رابط المنتج Hisaby عبر SSO — بدون مفاتيح في المتصفح.

---

## أمان

- المفتاح السري يُعرض مرة واحدة في BHD-R ولا يُعاد.  
- مفاتيح BHD-R لا تستطيع إنشاء مفاتيح أخرى ولا التوقيع ولا إعدادات المنصة.  
- انتهاء صلاحية بين ساعة وسنة.  
- TOTP عند التفعيل مطلوب للإنشاء/الإلغاء.  
- لا تضع المفاتيح في Git أو لقطات شاشة عامة.
