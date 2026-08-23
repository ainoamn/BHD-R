# المساهمة في BHD R

## طريقة العمل

أنشئ فرعاً قصير العمر، غيّر نطاقاً واحداً، وأضف اختباراً وتوثيقاً مناسباً. Conventional Commits مفضلة مثل `feat(leasing): ...` و`fix(authz): ...`. لا ترفع `.env`, dumps، مفاتيح، access tokens أو بيانات شخصية.

```bash
pnpm install
docker compose up -d postgres redis minio minio-init mailpit clamav
pnpm db:migrate
pnpm check
```

## تعريف الاكتمال

- سلوك العربية والإنجليزية وRTL/LTR سليم.
- authorization في API لا UI فقط، واختبار cross-tenant موجود.
- الحساب المالي Decimal واختبار rounding/concurrency موجود عند الحاجة.
- migration expand/contract قابلة للتكرار وخطة rollback موثقة.
- logging/audit لا يتسرب منه secret/PII.
- الواجهة keyboard accessible، states واضحة وضمن performance budget.
- API/event/schema/documentation محدثة.

## تغييرات حساسة

الهوية والصلاحيات والدفع والتشفير وRLS والعقود تتطلب مراجعتين واختبارات security regression. لا تغيّر invoice/ledger history يدوياً. لا تضف base URL يحدده المستخدم لتكامل server-side من دون SSRF design review.

## قاعدة البيانات

لا تعدل migration منشورة. أضف migration جديدة. استخدم UUID وUTC وNUMERIC للمال، وابدأ الفهارس المؤسسية بـ`organization_id` حيث يناسب الاستعلام. اختبر قاعدة فارغة وترقية نسخة سابقة وRLS role محدود.

## Dependencies

اشرح الحاجة والبدائل، تحقق license/maintenance/security، وثبّت lockfile. لا تستخدم install scripts غير ضرورية. تحديث major يمر على staging وmigration/rollback plan إن غيّر البيانات أو السلوك.
