# النشر

## طوبولوجيا الإنتاج

- CDN/WAF أمام Web وAPI مع TLS حديث وrate limits.
- Web وAPI وWorker صور immutable مبنية من commit SHA؛ لا build على خادم الإنتاج.
- PostgreSQL managed مع PITR وPostGIS، اتصال TLS ومستخدم runtime محدود.
- Redis managed مع TLS/auth وpersistence مناسب للطوابير، وليس exposed للإنترنت.
- S3 private/public منفصلان؛ originals والعقود لا تصبح public مطلقاً.
- Secret Manager/KMS للمفاتيح، مزود بريد، ClamAV service، observability collector.
- ثلاث بيئات منفصلة: development, staging, production بحسابات ومفاتيح وقواعد مستقلة.

Docker Compose مخصص للتطوير/الاختبار الأحادي، وليس بديلاً عن orchestration وmanaged databases في الإنتاج.

## متغيرات الإنتاج

حقن الأسرار runtime. تحقق من طول/صيغة كل متغير عند startup. أهمها:

- `DATABASE_URL` لحساب عضو `bhd_r_app` و`SYSTEM_DATABASE_URL` لحساب عضو `bhd_r_system`، وكلاهما بلا superuser/BYPASSRLS.
- `WORKER_DATABASE_URL` لحساب عضو `bhd_r_worker` محدود ومستقل، بلا superuser/BYPASSRLS.
- `MIGRATION_DATABASE_URL` لا يصل إلى حاويات runtime؛ يستخدمه job migration المراقب فقط. في managed PostgreSQL يطبق DBA ملفات `migrations/privileged` عندما لا يملك migrator `CREATEROLE`.
- `REDIS_URL` مع TLS/auth.
- اعتمادات S3 ذات policy لأسماء buckets المطلوبة فقط.
- OIDC issuer/client secret/redirect URI.
- session وCSRF secrets مستقلان.
- field encryption keys بإصدارات، وactive version.
- payment webhook secrets لكل provider/merchant.
- SMTP credentials وtelemetry endpoints.

لا تستخدم `NEXT_PUBLIC_*` لأي سر؛ قيمها تدخل bundle المتصفح.

## مسار النشر

1. Merge عبر PR أخضر ومراجعة شخصين للتغييرات الأمنية/المالية.
2. توليد SBOM، فحص الثغرات وبناء الصور مرة واحدة وتوقيعها.
3. أخذ/التحقق من backup قبل migration عالية المخاطر.
4. تطبيق expand migration بواسطة identity مستقلة عن runtime.
5. نشر API/Worker ثم Web بطريقة rolling أو canary.
6. smoke tests: login, public search, cross-tenant denial, create property, invoice dry-run, queue, health.
7. مراقبة 30–60 دقيقة: 5xx/p95, DB saturation, queue lag, webhook failures, auth denials anomalies.
8. تشغيل backfill مراقب، ثم contract migration في إصدار لاحق.

ترتيب migration المعتمد: extensions → generated schema → RLS/functions → privileged runtime/worker grants. `APPLY_PRIVILEGED_ROLES=true` مخصص لبيئة يملك migrator فيها السلطة اللازمة؛ في managed production يطبق DBA ملفات privileged مرةً أو عند تغيرها، ثم يعمل migrator بلا `CREATEROLE`. حسابات API/Worker لا تطبق migrations مطلقاً.

## Hardening للحاويات

صور Debian slim، مستخدم UID 10001، `no-new-privileges`, root filesystem read-only و`tmpfs /tmp`. لا Docker socket ولا cloud admin role. ضع CPU/memory/PID limits، seccomp/AppArmor، egress policy وdrop Linux capabilities في منصة النشر. Chromium يعزل في Worker؛ لا تشغله root ولا تمرر `--no-sandbox`.

صور Compose مفصولة إلى API وWeb وWorker وMigration. يستخدم الويب Next.js standalone، وتستخدم الخدمات الأخرى `pnpm deploy` مع production dependencies فقط، ولا تحتوي صور runtime على بقية monorepo أو الاختبارات أو حزم التطوير. في اختبار الإصدار 0.1.0 كانت الأحجام التقريبية: Web ‏459MB، API ‏480MB، Migration ‏353MB، وWorker ‏1.56GB. يظل Worker أكبر بسبب Chromium وخطوط Noto اللازمة لعقود PDF العربية؛ لا تحذفهما من دون visual regression لعقود العربية والإنجليزية. راقب الأحجام في CI واعتبر النمو غير المبرر فشل إصدار.

## Checklist قبل الإنتاج

- [ ] DNS/TLS/HSTS وCSP مجربة على staging.
- [ ] OIDC callbacks المسجلة دقيقة وlogout/revocation مجربان.
- [ ] production secrets مختلفة ومفاتيح dev غير موجودة.
- [ ] RLS وcross-tenant suite ناجحان.
- [ ] webhook replay/concurrency وpayment reconciliation ناجحة.
- [ ] restore drill حديث يحقق RPO/RTO.
- [ ] DLQ alerts وqueue dashboards وon-call فعالون.
- [ ] صفحات الثقة والخصوصية والشروط معتمدة قانونياً.
- [ ] accessibility audit وCore Web Vitals ضمن الميزانية.
- [ ] runbooks وصلاحية break-glass مجربتان ومدققتان.

لا يتم تدوير مفاتيح حقيقية أو تعديل DNS/Vercel/Render/Neon/Redis/S3/Sentry والبريد من هذا المستودع؛ ذلك يحتاج وصولاً وتغييراً معتمداً في البيئة.
