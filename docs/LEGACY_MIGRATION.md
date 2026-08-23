# الانتقال من النظام السابق

لا يُدمج كود النظامين القديمين داخل BHD R. النقل ETL محدد المصدر، قابل للإعادة، مع reconciliation ومرحلة read-only/cutover.

## المراحل

1. **Inventory:** جداول/حقول/ملفات/IDs، quality profile، العملات والتواريخ والتكرارات.
2. **Mapping:** source→canonical لكل مؤسسة وعقار ووحدة ومستخدم وعقد وفاتورة ودفعة.
3. **Extract:** snapshot read-only مشفر، checksum وwatermark للوقت.
4. **Transform:** normalize phones/addresses/currencies، لا تخمين للمبالغ أو الملكية.
5. **Load:** staging tables ثم domain APIs/import service بمعرف `legacy_source` و`legacy_id` unique.
6. **Reconcile:** counts، totals، orphan/duplicate reports وعينة بشرية.
7. **Delta:** CDC أو exports متزايدة حتى freeze.
8. **Cutover:** منع الكتابة القديمة، delta نهائي، تحقق، DNS/traffic بقرار مستقل.
9. **Archive:** القديم read-only ضمن retention، لا حذف قبل اعتماد قانوني وتشغيلي.

## قواعد البيانات

- كل legacy tenant يطابق Organization واحدة موثقة. صف غير معروف tenant يذهب quarantine لا default org.
- العقار الفردي ينشئ وحدة canonical واحدة. متعدد الوحدات يحافظ على رقم الوحدة الداخلي ويولد UUID جديداً.
- user يربط إلى BHD Identity عبر claim/دعوة؛ لا تنقل password hashes غير المتوافقة. المستخدم يفعل حسابه برابط أحادي.
- عقود موقعة تبقى immutable artifacts مع hash ومصدر؛ لا ندعي signature evidence غير موجود.
- invoice/payment totals لا تصلح آلياً. الفرق يذهب exception queue ويعتمد adjustment صريح.
- legacy IDs في mapping table، لا تصبح public IDs.

## جداول reconciliation

لكل كيان: extracted, transformed, loaded, skipped, quarantined, duplicates، checksum. للمالية: مجموع الفواتير والمدفوعات والرصيد حسب المؤسسة/العملة والشهر. النجاح يتطلب صفر cross-tenant، صفر duplicate invoice number ضمن namespace، وكل فرق مالي مفسر ومعتمد.

## Rollback النقل

قبل cutover يبقى القديم مصدر الحقيقة. بعد cutover لا تعد الكتابة في النظامين بلا CDC مصمم. rollback يعيد traffic فقط إذا لم تبدأ كتابات غير قابلة للمزامنة؛ وإلا maintenance/forward fix. احتفظ mapping/checkpoints، واجعل import idempotent ليستأنف من آخر batch.

## الخصوصية

بيئة النقل معزولة، صلاحيات مؤقتة، logs بلا PII، extracts مشفرة وTTL حذف. لا تستخدم نسخة إنتاج في تطوير أو اختبار اختراق من دون نزع الهوية والتفويض.
