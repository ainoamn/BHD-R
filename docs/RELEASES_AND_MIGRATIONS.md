# الإصدارات والهجرات والرجوع

## سياسة الإصدار

الإصدار مرتبط بـ Git tag وصور container digest وmigration set وSBOM. يسجل changelog للتغييرات المرئية، تغييرات API، flags والمخاطر. لا تعاد كتابة tag أو image منشورة.

## Expand / Migrate / Contract

1. **Expand:** أضف جدولاً/عموداً nullable أو index `CONCURRENTLY`. يبقى الكود القديم صالحاً.
2. **Migrate:** انشر dual-read/single-write أو backfill على دفعات صغيرة مع checkpoint وrate limit.
3. **Contract:** بعد القياس ومرور إصدار رجوع، اجعل العمود not-null أو احذف القديم في إصدار منفصل.

ممنوع rename/drop وتغيير نوع locking في نفس إصدار الكود الذي يعتمد على الشكل الجديد. migration يجب أن تملك timeout واضحاً، ولا تضع transaction ضخمة حول backfill كامل.

## قواعد المالية

- migration لا يعيد حساب ledger بصمت؛ اكتب adjustment أو نسخة algorithm واحتفظ بالأثر.
- تغيير rounding/currency minor units يحتاج fixture قبل/بعد واعتماد مالي.
- invoice number لا يعاد استخدامه بعد rollback؛ التسلسل يستمر والفجوة موثقة أفضل من التكرار.

## Rollback

Rollback الكود أولاً إذا كان schema متوافقاً. إذا كُتبت بيانات بالشكل الجديد، استخدم forward fix عادةً. لا تنفذ down migration مدمرة تلقائياً. قرار الرجوع يحدد:

- incident commander ووقت القرار.
- image digest السابق.
- توافق schema/data وflags.
- معالجة jobs/webhooks التي وصلت أثناء الإصدار.
- smoke test بعد الرجوع.
- reconciliation للدفعات والفواتير، لا تخمين.

## Feature flags

flags لكل مؤسسة عند rollout، افتراضها off، لها owner وتاريخ إزالة. لا تستخدم flag لتجاوز authorization أو ترك مخططين دائمين. Worker payload يحمل `schemaVersion` عندما يتغير العقد؛ المستهلك يدعم الإصدار السابق خلال نافذة النشر.

## Migration check في CI

تطبق migrations على PostgreSQL/PostGIS نظيف ثم تعاد مرة ثانية. الاختبار منفصل عن unit tests. قبل release عالي المخاطر طبّق نسخة production الحجم على clone منزوع الهوية وقس locks والمدة والمساحة.
