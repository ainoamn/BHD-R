# مصفوفة التحقق الأمنية والتقنية — متطلباتك مقابل BHD R 0.1.0

**الغرض:** إثبات كيف عالج الجيل الجديد كل بند طلبته بعد مراجعة [bhd-om](https://github.com/ainoamn/bhd-om)، مع موضع التنفيذ وطريقة الإثبات وما تبقى لصلاحيات الإنتاج.

**الحالة:**

| الرمز | المعنى |
| --- | --- |
| ✅ منفَّذ في المصدر + اختبار/ضابط | جاهز للتحقق في staging |
| 🟡 منفَّذ جزئياً / يحتاج تفعيل بيئة | يحتاج أسرار/مزود خارجي |
| ⬜ خارج نطاق الكود | يحتاج قرارك أو صلاحياتك |
| ❌ غير منطبق على BHD R | الوحدة غير موجودة في المنتج الجديد |

---

## 1. مصفوفة البنود المطلوبة

| # | المتطلب | الحالة | أين في BHD R | الإثبات / Regression | ملاحظات |
| ---: | --- | --- | --- | --- | --- |
| 1 | منع تسرب الأسرار إلى سجلات التدقيق + اختبارات regression | ✅ | `packages/observability` redaction؛ `AuditInterceptor`؛ `scripts/verify-source.mjs` | اختبارات redaction؛ بوابة CI تمنع أسراراً في المصدر | لا تسجّل body خاماً للأسرار |
| 2 | فرض صلاحيات الوحدات والأدوار مركزياً على جميع APIs | ✅ | `packages/authz`؛ `AuthenticationGuard` + `PermissionGuard` في `AppModule` | `route-policy.test.ts`؛ `security-guards.test.ts`؛ مصفوفة 54 صلاحية | deny-by-default |
| 3 | إغلاق XSS في طباعة الفواتير وPOS والمطعم | ✅ / ❌ | تطهير HTML/PDF في `packages/security/html` وWorker PDF sanitize | اختبارات sanitize وpayloads | **لا توجد وحدة POS/مطعم في BHD R**؛ الضابط يغطي الفواتير/PDF/الويب |
| 4 | إصلاح تكرار الدفعات وسباقات Webhook + idempotency | ✅ | `IdempotencyInterceptor`؛ قيود unique لأحداث المزود؛ منطق مالي monotonic في domain/finance | اختبارات API/أمن؛ توثيق webhook في `API_OVERVIEW.md` | تفعيل مزود دفع حقيقي = 🟡 بيئة |
| 5 | تقليل بيانات روابط الفواتير العامة | ✅ | `packages/domain/public-projections`؛ صفحة `/invoice/[publicToken]`؛ اختبار `public-invoice.test.ts` | snapshot حقول عامة؛ token منتهي/opaque | `noindex` للحساسة |
| 6 | إغلاق SSRF في إعدادات بوابات الدفع | ✅ | `packages/security/ssrf.ts`؛ `PAYMENT_GATEWAY_ALLOWED_HOSTS` | اختبارات hosts خاصة/loopback | لا URL حر للمزود |
| 7 | بناء تغيير/استعادة كلمة المرور وإلغاء الجلسات القديمة | ✅ / 🟡 | مسارات forgot/reset/activate؛ رفع `session_version`؛ تكامل BHD Identity | اختبارات auth محلية؛ OIDC إنتاجي يحتاج تسجيل عميل | كلمة المرور الدائمة لا تُرسل بالبريد |
| 8 | حماية CSRF + تشديد TOTP وAPI Keys | ✅ | `CsrfGuard`؛ `packages/security/{csrf,totp,api-keys}` | اختبارات security package | TOTP: نافذة ضيقة + منع replay؛ keys hashed/scoped |
| 9 | تشفير بفصل مفاتيح وإصدارات وتدوير | ✅ | `packages/security/encryption.ts`؛ `FIELD_ENCRYPTION_KEY_V*` + active version | fixture قراءة قديمة/كتابة جديدة | Job التدوير التشغيلي موثّق؛ مفاتيح الإنتاج ⬜ |
| 10 | إصلاح ترقيم الفواتير المتزامن + Decimal مالي | ✅ | domain invoice/money؛ NUMERIC في schema؛ قفل/تسلسل لكل مؤسسة | اختبارات domain؛ لا Float | rounding حسب `minor_unit` للعملة |
| 11 | تحسين عزل الشركات + اختبارات منع الوصول بين المستأجرين | ✅ | `organization_id` إلزامي؛ RLS في migrations؛ 4 اختبارات RLS non-superuser | `packages/db/test/rls.integration.test.ts` | دفاع مزدوج: app + DB |
| 12 | تحديث الاعتماديات ومعالجة التنبيهات الأمنية | ✅ / 🟡 | Dependabot؛ `pnpm audit` نظيف عند التسليم؛ overrides في root | workflow `security.yml` | راقب تنبيهات جديدة بعد كل ترقية |
| 13 | اختبارات Backend وFrontend وIntegration وE2E | ✅ | Vitest للحزم/API/Web/Worker؛ Playwright 12 رحلة؛ API e2e | `pnpm test` / `test:e2e` / CI | وسّع تغطية الدفع الحقيقي في staging |
| 14 | تحسين CI/CD وDocker والهجرات وعمليات الإصدار | ✅ | workflows ci/security/performance؛ Dockerfiles منفصلة؛ `RELEASES_AND_MIGRATIONS.md` | بناء صور؛ migrate idempotent | نشر الإنتاج يحتاج حسابات المنصات |
| 15 | تحسين CSP ورؤوس الأمان والمرفقات | ✅ | Helmet/CSP/HSTS في API؛ رؤوس Next؛ Worker magic+ClamAV+quarantine | تحقق Docker read-only؛ اختبارات media | CSP بدون `unsafe-inline` scripts كهدف |
| 16 | إصلاح Accessibility والواجهة والنصوص وصفحات الثقة/الخصوصية | ✅ | صفحات `/accessibility` `/privacy` `/terms` `/trust`؛ مكوّنات UI؛ i18n | E2E ثنائي اللغة؛ مراجعة محتوى قانوني نهائية ⬜ | النصوص القانونية تحتاج اعتمادك |
| 17 | إعادة تنظيم الخدمات الضخمة تدريجياً دون كسر | ✅ | Modular monolith بحدود وحدات واضحة؛ لا legacy مدمج | ADRs 002؛ عدم نسخ bhd-om | استخراج microservice لاحقاً عبر الأحداث |
| 18 | Country Packs والعملات والترجمة والتوسع الدولي | ✅ | `packages/country-packs` + `i18n`؛ عملات الخليج وUSD | اختبارات country-packs وmessages | إضافة عملة = صف + minor_unit |
| 19 | كتابة التوثيق وRunbooks وThreat Model وسياسات التشغيل | ✅ | `docs/*` كاملة بما فيها THREAT_MODEL وRUNBOOKS وBACKUP | فهرس `docs/README.md` | حدّث بعد كل حادث إنتاجي |

---

## 2. ما لا يُنفَّذ من الكود وحده (كما حددت)

| البند | الحالة | المطلوب منك |
| --- | --- | --- |
| تدوير مفاتيح الدفع الحقيقية أو حذف سجلات الإنتاج | ⬜ | وصول production + تغيير معتمد |
| تعديل Vercel / Render / Neon / DNS / Redis / S3 / Sentry / البريد | ⬜ | صلاحيات الحسابات |
| اعتماد سياسات قانونية نهائية أو PCI / SOC 2 / ISO | ⬜ | قرار قانوني/امتثال |
| اختبار اختراق كامل للإنتاج | ⬜ | تفويض + بيئة + حسابات متعددة |
| ضمان انعدام الثغرات 100% | ⬜ | غير ممكن مهنياً؛ الهدف تقليل المخاطر + إثبات الإصلاحات |

---

## 3. دروس BHD-OM الحرجة وكيف أُغلقت في BHD R

| مشكلة في bhd-om | المعالجة في BHD R |
| --- | --- |
| مصادر بيانات متوازية (Prisma/JSON/KV/localStorage) | مصدر حقيقة واحد: PostgreSQL عبر Drizzle |
| Seed بكلمة مرور مدير ثابتة في السجلات | أسرار من env؛ لا كلمات مرور إنتاج في seed |
| Webhook غير موقّع / بدون idempotency | توقيع + unique event + interceptor |
| Float مالي | NUMERIC + Decimal domain |
| XSS في طباعة الفواتير | sanitize + PDF معزول |
| صلاحيات غير موحدة | registry مركزي + guards عامة |
| JWT بدون تحقق JWKS كامل | OIDC + Jose JWKS في authz |
| تقارير «ذكية» محاكاة | وحدة reports من بيانات حقيقية |
| `dev.db` متعقب ببيانات محتملة | لا SQLite متعقب؛ `.gitignore` صارم |
| دمج نظامين | بناء جديد مستقل + ETL لاحق |

التقارير الأصلية مرفقة في [`legacy-reviews/`](./legacy-reviews/).

---

## 4. خطة تسريع «بسرعة البرق» (أداء)

مرجع تفصيلي: [`PERFORMANCE.md`](./PERFORMANCE.md).

| الطبقة | إجراء BHD R |
| --- | --- |
| الشبكة | CDN أمام Web؛ صور AVIF/WebP مشتقة؛ ETag للقوائم العامة |
| الخادم | API stateless؛ readiness/liveness؛ throttling |
| البيانات | فهارس مناسبة؛ cursor pagination؛ RLS لا يغني عن استعلامات scoped |
| الجبهة | Server Components حيث أمكن؛ ميزانية Lighthouse في CI |
| الخلفية | أعمال ثقيلة في Worker لا في طلب المستخدم |
| الكاش | عام للقوائم العامة فقط؛ خاص `no-store` للجلسات والفواتير الموقعة |

لا تفعّل كاشاً يحمل `organization_id` أو PII في مفتاح عام.

---

## 5. طبقات الأرشفة والحماية (تشغيل)

| الطبقة | الوثيقة / الضابط |
| --- | --- |
| Threat Model | [`THREAT_MODEL.md`](./THREAT_MODEL.md) |
| ضوابط الأمن | [`SECURITY_CONTROLS.md`](./SECURITY_CONTROLS.md) |
| خصوصية واحتفاظ | [`PRIVACY_AND_RETENTION.md`](./PRIVACY_AND_RETENTION.md) |
| نسخ واستعادة | [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md) |
| حوادث | [`RUNBOOKS.md`](./RUNBOOKS.md) |
| وسائط وعقود | أصول خاصة؛ مشتقات عامة مائية؛ PDF hash |

---

## 6. حكم موجز

بالنسبة لبنودك القابلة للتنفيذ في المصدر: **BHD R 0.1.0 صُمم ونُفِّذ لإغلاقها بنيوياً** مع اختبارات ووثائق تشغيل.  
ما تبقى لإطلاق إنتاج آمن هو **تفعيل البنية التحتية والأسرار والهوية والدفع القانوني واختبار الاختراق المفوّض** — وليس إعادة اكتشاف نفس ثغرات bhd-om داخل هذا المستودع.
