# المنتج والقرارات المعتمدة — نسخة ذاتية الاكتفاء

هذه الوثيقة تدمج القرارات الأساسية من حزمة المرحلة صفر التي أُعدت في مساحة العمل الأصلية:

- `outputs/BHD-R-BUILD-PLAN-AR.md`
- `outputs/BHD-R-phase-0/` بما فيها Product Brief، journeys، access model، threat model وADRs.

لا يعتمد المستودع المنشور على وجود `outputs`; هذا ملخص القرار المرجعي، وتفاصيل التنفيذ موزعة في بقية `docs`.

## هدف المنتج

BHD R منصة عمانية ثنائية اللغة لإدارة وتسويق العقارات والوحدات، العقود الإلكترونية، الفواتير والمدفوعات والصيانة والتقارير. تخدم مالكاً فرداً أو شركة، مطوراً، مستأجراً وإدارة المنصة، بهوية موحدة مع منتجات BHD، مع قابلية توسع خليجية ودولية.

## السلوك الأساسي

- الإدارة تضيف عقاراً فردياً أو متعدد الوحدات؛ الفردي ينشئ وحدة واحدة ضمنياً والمتعدد يدخل تفاصيل وحداته.
- الصور إلزامية حسب سياسة النشر، أصلها خاص وكل نسخة عامة تحمل العلامة الرسمية.
- زر النشر لا يكفي وحده: الظهور العام مشتق من اكتمال listing وتوفر الوحدة. المؤجر/المحجوز/الممسوك/الصيانة يختفي تلقائياً.
- العقد versioned ويوقع إلكترونياً مع evidence وhash، ثم ينشأ lease والفوترة.
- عند التفعيل، يحصل المستأجر على username/دعوة تفعيل آمنة، لا كلمة مرور دائمة بالبريد.
- المالك الفرد/الشركة يعين مشرفين/ممثلين ضمن entitlement الباقة وresource grants.
- اللوحات منفصلة: platform، owner، developer، tenant؛ لا دور يرث الآخر ضمنياً.

## ADRs المعتمدة

1. **Modular Monolith Monorepo:** أسرع وأخف وأوضح من دمج تطبيقين أو microservices مبكرة.
2. **PostgreSQL/PostGIS + Drizzle:** مصدر الحقيقة، migrations مراجعة، RLS دفاع ثانٍ.
3. **Central AuthZ:** permission registry وorganization/resource context لكل API، deny-by-default.
4. **Unit first-class:** كل إشغال/تسعير/عقد يتعلق بوحدة حتى العقار الفردي.
5. **Derived availability:** holds/reservations/leases/maintenance state machine وقيود concurrency.
6. **OIDC BHD Identity:** `bhd-r`, Authorization Code+PKCE، JWKS asymmetric والتحقق الكامل.
7. **Async durable work:** transactional outbox + Redis/BullMQ للصور/PDF/الإشعار والتقارير.
8. **Private originals/public derivatives:** S3، scan/re-encode/EXIF removal وعلامة مائية وresponsive variants.
9. **Country Packs:** عمان أولاً، العربية/الإنجليزية، عملات الخليج وUSD، Money Decimal/config versioned.

## التقنية المعتمدة

Node 24، pnpm/Turbo/TypeScript 5.9 strict، Next.js 16/React 19/Tailwind 4/next-intl، NestJS 11/Fastify، PostgreSQL 17+PostGIS/Drizzle، Redis/BullMQ، S3/Sharp/AVIF-WebP، Chromium PDF، OIDC/Jose، Vitest/Playwright، OpenTelemetry/Sentry adapters، Docker وGitHub Actions.

## قرارات الإطلاق

- النطاق المقترح `r.bhd-om.com` والهوية `BHD R — A BHD Product`؛ R = Real Estate Management / إدارة العقارات.
- V1: إضافة العقار بواسطة الإدارة افتراضياً، وself-onboarding entitlement لاحقاً.
- pilot مؤسسة واحدة، بوابة مطابقة دفعات أولاً ثم تفعيل gateway بعد اختبارات التسوية.
- توقيع حساس بـOTP/re-auth وevidence envelope حسب القرار القانوني.
- migration عبر ETL لا مشاركة DB أو نسخ كود النظام السابق.

## حدود التفويض

المستودع يوفر الكود والخطط والاختبارات ولا يدوّر مفاتيح دفع حقيقية، لا يحذف production logs/data، لا يعدل DNS/مزودي النشر/Neon/Redis/S3/Sentry والبريد دون صلاحيات، ولا يمنح PCI/SOC2/ISO أو اعتماداً قانونياً. اختبار اختراق إنتاجي يحتاج تفويضاً وبيئة وحسابات؛ الهدف تقليل المخاطر وإثبات الإصلاحات لا ادعاء 100% بلا ثغرات.
