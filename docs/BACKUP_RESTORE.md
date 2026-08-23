# النسخ الاحتياطي والاستعادة

## الأهداف الأولية

- PostgreSQL: RPO ≤ 5 دقائق عبر WAL/PITR، RTO ≤ 60 دقيقة للطيار.
- S3: versioning + replication/backup، RPO ≤ 15 دقيقة، RTO ≤ 4 ساعات للأرشيف الكبير.
- Redis: لا يعد مصدر الحقيقة؛ استعادته تخدم الطوابير فقط، والأحداث غير المرسلة تعاد من outbox.
- مفاتيح KMS/Secret Manager لها backup/escrow وإجراءات وصول مزدوج؛ backup البيانات بلا مفاتيح غير قابل للاستعادة.

الأهداف النهائية تعتمد SLA والبنية المختارة.

## النسخ

- PostgreSQL managed automated backups + PITR، تشفير ومشروع/حساب منفصل حيث يمكن.
- snapshot أسبوعي طويل المدة بعد اختبار سلامة، وفق GFS المعتمد.
- S3 versioning، lifecycle إلى طبقة أرخص، منع public على private bucket وObject Lock للسجلات المطلوبة.
- export مشفر لإعدادات غير سرية وIaC؛ الأسرار يعاد إنشاؤها من Secret Manager لا من `.env`.
- راقب آخر backup ناجح، WAL lag، مساحة التخزين وexpiry.

## تمرين الاستعادة الفصلي

1. افتح ticket وحدد نقطة زمنية وبيئة isolated بلا outbound email/payment.
2. استعد PostgreSQL إلى instance جديدة ولا تكتب فوق الحالية.
3. استعد عينات S3، تحقق checksum والربط مع DB.
4. استعد key versions اللازمة بهوية break-glass مدققة.
5. شغّل migrations المطلوبة للصورة المختارة.
6. تحقق counts وFKs، عينة مؤسستين، totals المالية، عقود/PDF وصور.
7. شغّل التطبيق smoke mode، ولا ترسل إشعارات/webhooks.
8. سجل RPO/RTO الفعلي والفجوات ثم دمّر البيئة المؤقتة بأمان.

## استعادة الإنتاج

أوقف الكتابة أو حوّلها إلى maintenance mode، اعزل integrations، حدد آخر نقطة سليمة قبل الحادث، واستعد إلى بنية جديدة. بعد التحويل: زد session version إذا كانت سرقة محتملة، دوّر الأسرار المتأثرة، أعد webhook reconciliation، ثم فعّل workers تدريجياً. لا تحذف القاعدة المتضررة قبل انتهاء التحقيق والاحتفاظ الجنائي.
