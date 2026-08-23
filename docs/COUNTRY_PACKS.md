# Country Packs والعملات والتوسع الدولي

## الهدف

لا تتناثر افتراضات عمان داخل الشاشات والخدمات. `CountryPack` نسخة configuration تحمل:

- ISO country code، الاسم والترتيب والـtimezone الافتراضية.
- المحافظات/الولايات وصيغة العنوان والرمز البريدي.
- اللغات، direction، locale وتنسيق الأرقام والتاريخ.
- العملات المسموحة، العملة الافتراضية وminor units.
- قوالب وترقيم الفواتير والحقول الضريبية **بعد اعتماد قانوني**.
- متطلبات العقار/العقد ومزودي الدفع/البريد المتاحين.

الإطلاق يبدأ بهوية عمانية (`OM`) مع العربية والإنجليزية، ويشمل OMR, AED, SAR, BHD, KWD, QAR وUSD. إضافة عملة configuration + اختبارات، لا تعديل schema.

## تمثيل المال

```ts
type Money = { amount: string; currency: CurrencyCode };
```

في DB: `NUMERIC(24, 6)` أو دقة مناسبة و`CHAR(3)`، وفي TypeScript مكتبة Decimal/domain، وعند API amount نص. لا `number` للحساب. minor units من ISO/config: OMR/BHD/KWD عادة 3، AED/SAR/QAR/USD عادة 2، لكن config versioned هو المرجع التشغيلي. rounding صريح لكل tax/line/total مع اختبارات.

لا تحول العملات تلقائياً. عقد/فاتورة/دفعة تحمل عملة واحدة. التحويل يحتاج `FxQuote` بقيمة ومصدر ووقت، ledger منفصل وفروق صرف؛ لا تستخدم آخر سعر عام لحساب تاريخي.

## العناوين

العنوان structured + localized label:

- `countryCode`, `governorateCode`, `wilayatCode`, locality, street, building, unit, postalCode.
- إحداثيات PostGIS منفصلة، بدقة وصول مقيدة؛ الموقع العام يمكن أن يعرض منطقة تقريبية.
- الأكواد ثابتة، والأسماء مترجمة في pack؛ لا تحفظ الاسم المترجم كمفتاح.

## النسخ والتغيير

كل pack له `version`, `effectiveFrom`, checksum وحالة draft/active/retired. العقد والفاتورة تحفظ pack/version المستخدم كي لا يتغير المستند التاريخي عند تحديث ترجمة أو قاعدة. نشر pack يحتاج validation، fixtures للعملات والعناوين وموافقة business/legal عند الحقول النظامية.

## الترجمة

مفاتيح ICU مشتركة، لا concatenate لجمل. اختبارات تمنع missing keys وتتحقق من RTL، pluralization والعملات. أسماء المستخدم والعقار لا تترجم. PDF والبريد يستخدمان locale العقد/المستلم مع fallback إنجليزي واضح ومراقب.
