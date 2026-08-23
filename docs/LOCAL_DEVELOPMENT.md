# التطوير المحلي

## المتطلبات

- Node.js 24+
- pnpm 10.14+
- Docker Engine مع Compose v2
- Git

لا تستخدم بيانات إنتاج أو مفاتيح حقيقية محلياً. Mailpit وMinIO وClamAV مخصصة للتطوير.

## البدء

```bash
cp .env.example .env
docker compose up -d postgres redis minio minio-init mailpit clamav
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

النقاط الافتراضية:

- Web: `http://localhost:3000/ar`
- API: `http://localhost:4000`
- Worker readiness: `http://localhost:4001/ready`
- MinIO console: `http://localhost:9001`
- Mailpit: `http://localhost:8025`

تحتوي Compose على كلمة مرور تطوير افتراضية فقط. عند تشغيل profile التطبيقات يجب تمرير القيم الإلزامية في `.env`. لا ترفع `.env` إلى Git.

## التشغيل بالحاويات كاملاً

```bash
docker compose --profile app build
docker compose --profile app up -d
docker compose --profile app ps
```

عند تشغيل profile `app` تنفذ Compose الترتيب التالي آلياً: PostgreSQL/bootstrap للأدوار → migrations بدور `bhd_r_migrator` → مزامنة حسابات runtime → API/Worker/Web. داخل migration يكون الترتيب extensions → generated schema → RLS/functions → privileged grants. لا يستخدم التطبيق حساب `POSTGRES_USER`. حسابات التشغيل المحلية منفصلة:

- `bhd_r_api_login` عضو `bhd_r_app` لـ`DATABASE_URL`.
- `bhd_r_system_login` عضو `bhd_r_system` لـ`SYSTEM_DATABASE_URL`.
- `bhd_r_worker_login` عضو `bhd_r_worker` لـ`WORKER_DATABASE_URL`.

كلها `NOSUPERUSER` و`NOBYPASSRLS`. كلمات المرور الافتراضية محلية فقط ويمكن استبدالها عبر `API_DB_PASSWORD`, `SYSTEM_DB_PASSWORD`, `WORKER_DB_PASSWORD`, `MIGRATOR_DB_PASSWORD`. عند تغيير كلمة مرور volume قائم يعيد `provision-db-logins` مزامنة حسابات runtime، أما كلمة مرور migrator فتحتاج مطابقة cluster القائم.

الدخول المحلي same-origin: المتصفح يتعامل مع `http://localhost:3000/v1/*`، وNext يعيد الطلب داخلياً إلى `http://api:4000`. callback المسجل هو `http://localhost:3000/v1/auth/oidc/callback`. تضبط Compose `COOKIE_SECURE=false` محلياً فقط؛ لا تستخدم هذه القيمة مع HTTPS الإنتاج.

## أوامر الجودة

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

شغّل `pnpm check` قبل فتح Pull Request. عند تعديل المخطط: ولّد migration، راجعه يدوياً، طبقه على قاعدة فارغة ثم طبقه مرة ثانية لإثبات repeatability.

## اختبار الأدوار والعزل

استخدم seed بمؤسستين على الأقل. كل اختبار authorization يجب أن يغطي:

1. نجاح المستخدم صاحب الصلاحية داخل مؤسسته.
2. رفض مستخدم بلا الصلاحية داخل المؤسسة نفسها.
3. رفض مستخدم بصلاحية مماثلة من مؤسسة أخرى.
4. رفض معرف مورد صحيح عند تبديل `organization_id` أو حذف السياق.

## أعطال شائعة

- Worker غير ready: افحص PostgreSQL وRedis، ثم `docker compose logs worker clamav`.
- الصور تبقى معلقة: ClamAV يحتاج تحميل قاعدة التواقيع أول مرة؛ لا تغيّر `MEDIA_SCAN_MODE=required` في الإنتاج.
- PDF يفشل محلياً خارج Docker: ثبت Chromium وحدد `CHROMIUM_EXECUTABLE_PATH`.
- OIDC callback مرفوض: يجب تطابق redirect URI حرفياً مع المسجل في BHD Identity.
- خطأ `permission denied` بعد ترقية volume قديم: شغّل `docker compose --profile app run --rm provision-db-logins` ثم migration؛ لا تحول URL إلى migrator كحل مؤقت.
