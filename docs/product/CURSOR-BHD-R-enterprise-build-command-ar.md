# أمر التنفيذ الكامل لـ Cursor — بناء BHD R كنظام مؤسسي

> انسخ النص من قسم «بداية الأمر» إلى Cursor Agent داخل جذر مستودع `BHD-R`.  
> هذا الأمر مصمم ليعمل بصورة ذاتية ومتسلسلة؛ لا ينتقل إلى مرحلة لاحقة قبل إثبات السابقة.

---

## بداية الأمر

أنت الآن المهندس الرئيسي المسؤول عن إكمال منصة **BHD R — إدارة العقارات / Real Estate Management** داخل هذا المستودع. المطلوب ليس نموذجاً أولياً ولا شاشات تجريبية، بل نظام تشغيل عقاري مؤسسي كامل، ثنائي اللغة، متعدد المؤسسات، به مصدر حقيقة واحد، وصلاحيات ومعاملات واختبارات قابلة للإثبات.

اعمل بصورة ذاتية مرحلة بعد مرحلة. لا تتوقف لتطلب موافقتي بين المراحل، ولا تعتبر الوثائق الحالية دليلاً على أن الكود مكتمل. افحص التنفيذ والاختبارات وقاعدة البيانات بنفسك. لا تنتقل إلى المرحلة التالية إذا فشل اختبار أو بقي شرط قبول بلا دليل. أصلح الفشل أولاً، ثم أعد بوابة المرحلة كاملة.

لا تطلب مني تدخلاً إلا إذا احتجت سراً أو صلاحية خارج المستودع، أو قراراً قانونياً نهائياً، أو تغييراً تدميرياً في إنتاج حقيقي. عند غياب خدمة خارجية ابنِ adapter وsandbox/fake موثوقاً واختبارات عقدية، ووثّق متطلبات التشغيل من دون اختراع نجاح إنتاجي.

### 1. المراجع الإلزامية قبل كتابة أي كود

اقرأ بالكامل وبالترتيب:

1. `apps/web/AGENTS.md`، ثم أدلة Next.js المحلية المناسبة داخل `apps/web/node_modules/next/dist/docs/` قبل تعديل Next.js.
2. `docs/product/BHD-R-BUILD-PLAN-AR.md`.
3. جميع ملفات `docs/product/phase-0/` و`docs/product/phase-0/adrs/`.
4. `docs/ARCHITECTURE.md` و`docs/OPERATIONS_SUITE_AR.md` و`docs/V1-COMPLETION-REPORT-AR.md`.
5. `docs/legacy-reviews/BHD-OM-complete-functional-architecture-review-ar.md`.
6. إن كان متاحاً في المجلد الأب: `../outputs/BHD-OM-operational-workflows-deep-review-ar.md`.
7. `docs/THREAT_MODEL.md`, `docs/SECURITY_CONTROLS.md`, `docs/TESTING.md`, `docs/RELEASES_AND_MIGRATIONS.md`, `docs/RUNBOOKS.md`, `docs/LEGACY_MIGRATION.md`.
8. مخطط قاعدة البيانات وجميع migrations والـRLS والاختبارات الحالية.

أنشئ بعد القراءة `docs/implementation/GAP-REGISTER.md` يقارن كل وظيفة مطلوبة بالكود الحقيقي، بحالات: `complete`, `partial`, `missing`, `unsafe`, `not-applicable`. لا تقبل عبارة «اكتمل V1» من وثيقة ما دون endpoint وmigration وواجهة واختبار.

### 2. القرارات المعمارية الثابتة

حافظ على البنية الحالية ولا تستبدلها بإطار آخر:

- Monorepo: pnpm 10 + Turborepo.
- Node.js 24 أو أحدث وفق `engines`.
- `apps/web`: Next.js 16.3 + React 19.2 + TypeScript 5.9 + Tailwind 4 + `next-intl`.
- `apps/api`: NestJS 11 + Fastify 5، API versioned تحت `/v1`.
- `apps/worker`: BullMQ + Redis للمهام الخلفية.
- PostgreSQL + PostGIS + Drizzle، وRLS كدفاع ثانٍ.
- S3-compatible private object storage؛ النسخ العامة المائية فقط قابلة للـCDN.
- Zod لعقود المدخلات والمخرجات، وعقود مشتركة في `packages/contracts`.
- BHD Identity عبر OIDC Authorization Code + PKCE S256 + state + nonce؛ لا تبنِ هوية موازية.
- OpenTelemetry/Pino/Sentry-compatible observability مع redaction.
- Vitest للاختبارات، Playwright للـE2E، واختبارات PostgreSQL حقيقية للتكامل والعزل.

ابقِه **Modular Monolith**. لا تنشئ microservices جديدة. يمكن فصل الـWorker فقط كما هو مخطط. افصل حدود الوحدات داخل API، ولا تسمح لوحدة بالكتابة مباشرة في جداول وحدة أخرى؛ استخدم خدمات المجال وoutbox events.

### 3. قواعد لا يجوز خرقها

1. PostgreSQL هو مصدر الحقيقة الوحيد للأعمال. يمنع `localStorage` أو مصفوفات TypeScript أو JSON blobs كمصدر للعقارات والحجوزات والعقود والمال والصيانة والمهام.
2. كل سجل مؤسسي يحمل `organization_id`، وكل repository وquery يعمل داخل Tenant Context، مع RLS واختبار A/B.
3. لا `Float` أو JavaScript arithmetic للمال. خزّن المال `bigint amount_minor` مع `currency`، واستخدم Decimal فقط لسعر الصرف والنسب والحسابات الوسطية المعلنة.
4. لا PATCH حراً لحقل `status`. كل انتقال أمر صريح داخل آلة حالات خادمية.
5. كل إنشاء حساس أو مالي يدعم `Idempotency-Key`، ويحفظ الطلب والنتيجة ضمن نطاق المؤسسة والمسار والمستخدم.
6. كل webhook يتحقق من توقيع المزود على raw body، ويحفظ `provider + event_id` بقيد unique، ويقبل إعادة الترتيب والتكرار بأمان.
7. لا side effects في GET.
8. لا migration داخل `next build` أو `pnpm build`.
9. لا كلمة مرور مؤقتة دائمة، ولا كلمة مرور في response/log/audit. استخدم رابط تفعيل أحادي الاستخدام من BHD Identity.
10. لا `document.write` ولا HTML غير معقم ولا `dangerouslySetInnerHTML` لبيانات المستخدم في الفواتير والعقود والتقارير.
11. لا ملفات Data URL داخل سجلات الأعمال. كل ملف metadata + object key خاص + scan state + owner/tenant policy.
12. لا actors مكتوبين نصياً مثل «الإدارة»؛ استخرج الفاعل من الجلسة وسجل `actor_id`, `actor_type`, `request_id`.
13. لا placeholders أو أرقام عشوائية في KPIs والتقارير. إذا لم يوجد query حقيقي، لا تعرض المؤشر.
14. لا تسجل secrets أو tokens أو كلمات مرور أو بطاقات أو صور هوية. استخدم redaction عميقاً داخل objects/arrays/headers/errors.
15. لا تنقل مجلد `legacy` أو شيفرته إلى runtime الجديد؛ استعمل ETL/adapters قراءة واختبارات characterization فقط.
16. لا تعدّل بيانات إنتاج أو تدور مفاتيح حقيقية أو تحذف شيئاً خارج بيئة التطوير.

### 4. بروتوكول العمل الإلزامي لكل مرحلة

لكل مرحلة `N` نفّذ ما يلي:

1. حدّث `docs/implementation/phase-N-plan.md` بالمتطلبات، الجداول، endpoints، الصفحات، الأحداث والاختبارات.
2. اكتب اختبار characterization أو failing test للخلل قبل إصلاحه عندما يكون ذلك ممكناً.
3. نفّذ migration بنمط expand/contract وقابلة للتطبيق على قاعدة فيها بيانات.
4. طبّق RLS والفهارس والقيود الفريدة وforeign keys.
5. طبّق domain services وآلات الحالات ثم controllers وDTOs.
6. طبّق الواجهة العربية والإنجليزية، RTL/LTR، loading/empty/error/permission states.
7. طبّق audit/outbox/idempotency والـobservability.
8. اكتب Unit + Integration + API contract + E2E + security regression بحسب المرحلة.
9. شغّل بوابة التحقق أدناه من جذر المستودع.
10. اكتب `docs/verification/phase-N.md` وفيه الأوامر والنتائج وعدد الاختبارات ولقطات/أدلة التدفق وأي استثناء.
11. راجع `git diff` ولا تمس تغييرات مستخدم غير مرتبطة.
12. لا تغيّر حالة المرحلة إلى `complete` إذا بقي test skipped لمسار حرج أو TODO أو mock بدل قاعدة بيانات حيث يلزم التكامل.

بوابة التحقق الدنيا لكل مرحلة:

```bash
pnpm format:check
pnpm verify:source
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

وشغّل اختبارات DB/RLS بمتحولات قواعد اختبار منفصلة. إذا لم تتوفر قاعدة اختبار، شغّل PostgreSQL/PostGIS مؤقتاً عبر Docker Compose غير إنتاجي. يجب أن تشمل بوابة الأمن: secret scan، dependency audit/SCA، migration dry-run، route-policy manifest، واختبارات tenant A/B. لا تخفِ فشل audit باستخدام `|| true`؛ وثق الاستثناء فقط إذا لم يوجد إصلاح آمن، مع مالك وتاريخ انتهاء، ولا تسمح باستثناء Critical/High قبل الإطلاق.

### 5. المرحلة 0 — تدقيق التنفيذ الحالي وتثبيت خط الأساس

#### المطلوب

- افحص `git status` وحافظ على أي تغييرات موجودة.
- شغّل baseline لكل الاختبارات والبناء والهجرات على DB نظيفة وDB تمثل إصداراً سابقاً.
- فهرس كل Controller route واربطه بتصنيف `public/authenticated/permission/tenant/resource`.
- فهرس كل جدول: هل يحمل `organization_id`؟ هل RLS مفروضة؟ هل له repository scoped؟
- قارن تنفيذ BHD R الحالي بكل رحلة في التقرير التشغيلي للنظام السابق.
- اكتشف الشاشات العامة/generic التي تعطي انطباع نظام بدائي، وحدد التصميم النهائي المطلوب لكل لوحة.
- سجل الديون الفعلية في GAP Register، ولا تكرر وظيفة موجودة وآمنة.
- ثبت عقود الحالات في `packages/domain` واكتب state diagrams machine-readable قدر الإمكان.

#### بوابة القبول

- baseline موثق وقابل للتكرار.
- route manifest كامل واختبار يفشل عند إضافة route غير مصنف.
- schema/RLS matrix كامل.
- لا تبدأ المرحلة 1 قبل تحديد كل `unsafe/partial/missing` ومسؤولية المرحلة التي ستغلقها.

### 6. المرحلة 1 — الهوية والعزل والصلاحيات والأمن الأفقي

#### المطلوب

- وحّد `User`, `Organization`, `Membership`, `Role`, `Permission`, `ResourceGrant`.
- افصل أدوار المنصة عن أدوار المؤسسة وعن كون المستخدم مالكاً/مستأجراً في سجل معين.
- أنشئ Policy Decision مركزياً: `can(actor, action, resource, tenantContext)` واستعمل Guard واحداً في جميع APIs.
- أضف test manifest يرفض أي handler خاص بلا decorator/policy.
- أضف RLS forced لكل الجداول المؤسسية، ودور migration منفصل عن runtime/worker.
- أكمل OIDC مع تحقق issuer/audience/signature/exp/iat/nonce/state/PKCE وJWKS caching و`kid` rotation.
- طبّق change password/reset password/one-time activation عبر Identity، و`session_version` لإبطال كل الجلسات القديمة عند reset/role change/disable.
- طبّق CSRF على cookie-authenticated mutations، SameSite/Host-only/Secure cookies، origin checks عند الحاجة.
- شدد TOTP: secret encrypted، replay prevention، recovery codes hashed، rate limits وstep-up auth.
- API Keys: prefix + hash فقط، scopes، tenant، expiry، last-used، revoke، rotation؛ لا تعرض المفتاح ثانية.
- audit append-only مع deep redaction واختبارات regression للأسرار داخل arrays/headers/nested errors.
- encryption envelope: keys منفصلة للأعمال، `kid/version/purpose`, new-write/current-key, dual-read، rotation/backfill resumable ومقاييس fallback.
- CSRF/CORS/CSP/HSTS/Permissions-Policy/Referrer-Policy/COOP حسب السطح.

#### اختبارات إلزامية

- كل role/action/resource allow/deny.
- Tenant A مقابل Tenant B لكل CRUD وبحث وتصدير وملف.
- تغيير كلمة المرور أو الدور يبطل cookies/tokens السابقة.
- secret fixtures لا تظهر في log/audit/error/Sentry payload.
- TOTP replay وAPI key revoke/expiry/scope.
- CSRF من origin خارجي مرفوض.

#### بوابة القبول

- لا route خاص غير مصنف.
- لا query مؤسسي بلا tenant context أو RLS.
- جميع اختبارات الأمن والعزل خضراء.

### 7. المرحلة 2 — الأطراف والمؤسسات والممثلون والباقات

#### المطلوب

- أكمل `Party`, `Person`, `Company`, `PartyIdentifier`, `Address`, `ContactPoint`, `Representative`, `PowerOfAttorney`.
- تحقق من الرقم المدني/الجواز/السجل التجاري حسب Country Pack مع تواريخ انتهاء.
- منع التكرار داخل المؤسسة مع merge workflow وسجل تدقيق، لا merge صامت.
- دعم مالك فرد أو شركة، ونسب ملكية متعددة بتاريخ بداية/نهاية.
- دعوات المشرفين والممثلين: one-time token hashed، expiry، acceptance، revoke.
- طبّق Entitlements وحدود الباقة transactionally على العقارات والوحدات والممثلين والتخزين والميزات.
- لا تستخدم `role` واحداً لعضوية شركات متعددة.

#### بوابة القبول

- E2E لشركة تدعو ممثلين بحسب الباقة، وتتجاوز الحد فترفض العملية على الخادم.
- ممثل شركة A لا يرى شركة B.
- تغيير أو انتهاء التفويض يسحب الصلاحية فوراً.

### 8. المرحلة 3 — العقارات والوحدات والوسائط والموقع العام

#### المطلوب

- أكمل النموذج: `Portfolio → Property → Building? → Unit → Listing`، مع `Ownership` و`PropertyAddress` و`Amenity` و`UtilityMeter` و`PropertyDocument`.
- العقار الفردي ينشئ Unit واحدة تلقائياً؛ المتعدد ينشئ وحدات حقيقية بمعرفات ثابتة.
- معالج إضافة من ست مراحل: الأساس والعنوان، الوحدات، التشغيل، الملكية/العدادات/المستندات، الصور، المراجعة.
- autosave للمسودة على الخادم مع version وoptimistic locking؛ `localStorage` يمكن أن يحمل UX draft مؤقتاً فقط ولا يصبح المصدر.
- الحفظ النهائي transaction وIdempotency-Key.
- availability مشتقة مركزياً؛ لا يظهر إلا Listing منشور ووحدة `available`.
- حالات `held/reserved/leased/sold/maintenance_blocked/frozen` تختفي فوراً من البحث العام وتبطل cache tags.
- Media pipeline: presigned upload، MIME + magic bytes + size + image bomb protection + AV/CDR، إزالة EXIF، WebP/AVIF variants، watermark BHD R، originals private.
- واجهة عمانية احترافية: هوية ONE-BHD، `#092D24`, `#08A39F`, `#174B70`, `#B58D55`, sand/warm-white، صور عمانية للقلاع والحصون والمناظر، لا بطاقات generic أو emoji كواجهة نهائية.
- استخدم الأصول المرخصة الموجودة في `docs/ASSETS.md` ولا hotlink.
- SSR/RSC للموقع العام، pagination cursor، PostGIS للبحث المكاني، فهارس مناسبة، CDN/cache tags.
- SEO: canonical، hreflang ar/en، sitemap ديناميكي للوحدات المنشورة فقط، JSON-LD RealEstateListing/Breadcrumb/Organization، noindex للروابط الخاصة.

#### اختبارات إلزامية

- إنشاء فردي ومتعدد وكل الحقول والصور.
- طلبان متزامنان بنفس idempotency يعيدان المورد نفسه.
- reserved/leased/maintenance لا تظهر في API العام أو sitemap أو cache.
- watermark ورفض ملف مزيف/ضخم/مصاب.
- Lighthouse mobile budgets وaxe وkeyboard/RTL.

#### بوابة الأداء

- Public listing p95 cached ≤ 300ms، uncached ≤ 800ms في بيئة الاختبار.
- LCP ≤ 2.0s، INP ≤ 150ms، CLS ≤ 0.05 على صفحات رئيسية ممثلة.
- لا حزمة JavaScript عميل ضخمة لصفحات عامة يمكن تنفيذها Server Components.

### 9. المرحلة 4 — CRM والمعاينات والحجوزات والمستندات والشيكات

#### المطلوب

- افصل `Lead`, `ViewingRequest`, `Hold`, `Reservation`, `RentalApplication`.
- المعاينة: `requested → scheduled → completed/no_show/cancelled → converted`.
- hold قصير العمر بقفل DB/unique constraint وworker expiry.
- الحجز: `draft → submitted → payment_pending → payment_confirmed → compliance_pending → ready_for_contract → converted` مع reject/cancel/refund/expire.
- امنع double booking عبر DB exclusion/unique strategy وtransaction، لا `find then create`.
- Snapshot قانونية للسعر والعملة والشروط عند الحجز.
- Document Requirements versioned بحسب فرد/شركة/Country Pack.
- مستندات خاصة، scan state، مراجعة قبول/رفض مع reason وactor/version.
- Cheque records طبيعية، Owner party، bank، amount_minor، due date، attachment، review state.
- Accounting confirmation أمر مستقل لا يقدر عليه إلا `finance.booking_payment.confirm` ضمن المؤسسة.
- Cancellation workflow يفصل الطلب والقرار ورد المبلغ والخصم، ولا يحذف السجل المالي.

#### بوابة القبول

- E2E: زائر → معاينة → تحويل إلى طلب → hold → حجز → دفع sandbox → اعتماد حسابات → مستندات/شيكات → جاهز للعقد.
- اختبار 50 طلباً متزامناً للوحدة ينتج حجزاً نشطاً واحداً فقط.
- عميل لا يعتمد مستنده أو دفعه بنفسه.
- حجز ملغى ذو دفع ينتج refund workflow لا حذفاً.

### 10. المرحلة 5 — العقود والاعتمادات والتوقيع والتفعيل

#### المطلوب

- نماذج منفصلة: `Contract`, `ContractVersion`, `ContractParty`, `ContractTerm`, `PaymentSchedule`, `Deposit`, `ContractRequirement`, `ApprovalRequest`, `ApprovalDecision`, `SignatureEnvelope`, `SignatureEvent`.
- أنواع `RENT`, `SALE`, `INVESTMENT` بقوالب منفصلة، لا interface واحدة بمئات الحقول الاختيارية غير المنضبطة.
- كل نسخة عقد immutable بعد الإرسال للتوقيع، ولها PDF hash وtemplate version وlocale/country pack.
- آلة الحالات الخادمية:

```text
DRAFT
→ COMPLIANCE_READY
→ ADMIN_APPROVED
→ TENANT_SIGNATURE_PENDING
→ OWNER_SIGNATURE_PENDING
→ FINAL_REVIEW
→ ACTIVE
↘ REJECTED / CANCELLED / EXPIRED / TERMINATION_PENDING / TERMINATED
```

- طبّق سلسلة الاعتمادات: الحسابات، المستندات/الشيكات، الإدارة المبدئية، العميل، المالك، الإدارة النهائية.
- قرار الاعتماد يحمل actor، permission، resource version، reason/note، timestamps وrequest id.
- رابط التوقيع token عشوائي 256-bit، hash فقط، expiry، single-use، revoke، rate limit، noindex، DTO أدنى.
- وسائط التحقق في S3 خاص مشفر، لا Data URLs؛ signed read URLs قصيرة مع audit.
- اجعل التوقيع Envelope قابل الإثبات: consent text، PDF hash، IP masked/appropriate، user agent، timestamps، OTP/step-up وفق القرار القانوني. لا تدّع اعتماداً قانونياً نهائياً من دون مراجعة.
- finalization transaction واحدة: contract active + reservation converted + unit leased/sold + schedules/due amounts + outbox.
- التجديد `ContractAmendment` مرتبط بالأصل؛ لا تعدل النسخة الموقعة. الإنهاء والإخلاء والتسليم workflows موثقة.

#### اختبارات إلزامية

- محاولة القفز من DRAFT إلى ACTIVE مرفوضة حتى عبر API مباشر.
- توقيع المالك قبل العميل مرفوض إذا كانت السياسة تسلسلية.
- token منتهي/مستخدم/ملغى مرفوض ولا يكشف PII.
- تعديل نسخة بعد التوقيع يرفض أو ينشئ version جديدة.
- 20 finalization متزامنة تنتج activation واحدة واستحقاقات واحدة.
- E2E كامل بالعربية والإنجليزية للطرفين والإدارة.

### 11. المرحلة 6 — الفواتير والمدفوعات والمحاسبة والاشتراكات

#### المطلوب المالي

- `Money` بوحدات صغرى + ISO 4217 + exponent من Country Pack. اختبر OMR/BHD/KWD ثلاثية المنازل وSAR/AED/QAR/USD ثنائية.
- تسلسلات أرقام scoped بـorganization + type + fiscal_year، مع row lock/upsert ذري واختبار concurrency.
- Invoice lifecycle صريح، partial allocations، receipts، credit notes، refunds.
- Payment Orchestrator: `PaymentIntent`, `ProviderSession`, `PaymentAttempt`, `WebhookEvent`, `Payment`, `Allocation`, `Refund`.
- لا تثق بأي amount/userId/dueId من callback أو browser؛ اربط من metadata محفوظة عند إنشاء intent.
- توقيع webhook على raw body، event unique، out-of-order handling، replay safe، inbox/outbox.
- إعدادات البوابات لا تجلب URL يرسله المستخدم. إن لزم endpoint خارجي طبّق SSRF defense: allowlist scheme/host/port، DNS resolve ثم private/link-local/loopback/IPv6 reject، redirect revalidation، timeout/body limit، لا credentials في URL/log.
- روابط الفاتورة العامة token hashed/expiring/revocable، تعرض projection أدنى بلا بيانات داخلية/مالك/tenant، مع rate limit وnoindex.

#### المطلوب المحاسبي

- `LedgerAccount`, `JournalEntry`, `JournalLine`, `FiscalPeriod`, `AccountingDocument` كلها tenant-scoped.
- DRAFT/PENDING لا تؤثر في الأرصدة. POSTED فقط تدخل التقارير.
- قيد مرحل immutable؛ التصحيح Reversal + replacement.
- transaction واحدة تتحقق من توازن كل عملة ثم تنشئ الأسطر وposting/audit/outbox.
- لا تخزن رصيداً قابلاً للتعارض إلا إن كان projection يعاد بناؤه ومطابقته؛ مصدر الحقيقة الأسطر المرحلة.
- maker-checker: منشئ المستند لا يعتمد نفسه عندما تتطلب السياسة ذلك.
- انقل قواعد التقارير الصحيحة فقط: trial balance, P&L, balance sheet, cash flow, aging, property/tenant statement, VAT, bank reconciliation.
- reconciliation يومية بين المدفوعات والتخصيصات والقيود، وتنبيه لأي فرق.

#### الاشتراكات

- السعر من Product/Price server-side، لا من body.
- الترقية بعد payment captured فقط، والتخفيض مجدول لنهاية الفترة أو يحتاج اعتماداً بحسب السياسة.
- entitlements تحدث من event موثوق، مع history وproration بوحدات صغرى.

#### XSS والطباعة

- أنشئ Print/PDF service مشتركة للعقود والفواتير والإيصالات والتقارير.
- استخدم templates typed وescaping افتراضياً، sanitization allowlist، CSP nonce، JavaScript/network disabled في PDF worker.
- أضف regression payloads لكل حقل نصي. لا تضف POS أو Restaurant إلى BHD R؛ لكن إذا أعيد استعمال أي renderer من Hisaby/أنظمة POS أو المطعم، يجب أن يمر بالخدمة الآمنة نفسها ولا ينفذ HTML.

#### بوابة القبول

- 100 webhook متطابق ينتج Payment واحداً وLedger posting واحداً.
- فواتير متزامنة كلها بأرقام فريدة ومتسلسلة ضمن السياسة.
- كل journal متوازن، ولا تعديل/حذف للمرحل.
- cancellation ينتج reversal صحيحاً.
- rounding golden tests لكل العملات.
- XSS payload لا ينفذ في preview/print/PDF.
- SSRF payloads localhost/private/link-local/redirect/DNS rebinding مرفوضة.
- تقارير المحاسبة تتطابق مع fixtures يدوية معروفة.

### 12. المرحلة 7 — الصيانة والموردون والمهام والاعتمادات والتقويم

#### الصيانة

- `MaintenanceTicket`, `MaintenanceCategory`, `WorkOrder`, `Vendor`, `Quote`, `MaintenanceApproval`, `Visit`, `WorkLog`, `Warranty`, `CostAllocation`.
- ربط إلزامي بـorganization/property/unit وlease عند طلب المستأجر.
- تحقق أن مقدم الطلب طرف في عقد الوحدة.
- حالات: reported, triaged, quote_requested, approval_pending, approved, scheduled, in_progress, work_completed, verified, invoiced, closed، مع cancelled/rejected/reopened.
- SLA حسب الأولوية، escalation worker، vendor assignment، صور قبل/بعد، مرفقات ممسوحة.
- قواعد حد مالي: اعتماد مدير/مالك/حسابات بحسب التكلفة ونوع التحميل.
- maintenance blocker يغير availability مشتقة ولا ينشر الوحدة.
- تكلفة وفاتورة/مصروف/تحميل مستأجر transactionally وبـidempotency.

#### المهام

- `WorkTask`, `TaskParticipant`, `TaskMessage`, `TaskAttachment`, `TaskLink`, `TaskEvent`.
- مسؤولون ومطلعون، تحويل، تعليقات threaded، follow-up، due/overdue/escalation، audit.
- ربط بأي resource typed، لا free-form identifier بلا تحقق.
- مهام آلية من outbox: تجديد عقد، انتهاء مستند، شيك للإيداع، متأخرات، صيانة، جلسة قانونية.
- unique `source_type + source_id + rule_version + occurrence` لمنع التكرار.

#### الاعتمادات والتقويم والإشعارات

- Approval Engine عام لكن policy خاصة بكل مجال؛ لا تجعل جدولاً عاماً يحل محل قواعد المجال.
- read models للوحة «مطلوب مني» و«طلباتي» وSLA.
- التقويم من الاستحقاقات والعقود والمواعيد والمهام والجلسات، مع timezone Country Pack.
- Outbox → Worker → In-app/Email/SMS/WhatsApp adapter، dedupe، retries محدودة وDLQ.

#### بوابة القبول

- E2E بلاغ مستأجر → triage → quote → موافقة مالك → تنفيذ → صور → تحقق → فاتورة/مصروف → إغلاق.
- الطلب على وحدة لا تخص المستخدم مرفوض.
- مهمة آلية واحدة فقط رغم retries.
- اكتمال صيانة حاجبة يعيد الوحدة متاحة فقط إذا لم يوجد مانع آخر.

### 13. المرحلة 8 — المحاماة والمطالبات والامتثال

#### المطلوب

- ابنِ وحدة حقيقية لا مجرد قائمة: `LegalCase`, `LegalParty`, `LegalNotice`, `Hearing`, `Judgment`, `EnforcementAction`, `Settlement`, `Claim`, `Evidence`, `LegalExpense`, `LegalEvent`.
- حالات: assessment, notice, filed, hearing, judgment, enforcement, settlement, closed، مع stayed/appealed.
- ربط بالعقد والوحدة والمستأجر والمتأخرات والمستندات، مع snapshot أدلة لا تتغير.
- صلاحيات قانونية مستقلة وneed-to-know، ومرفقات خاصة وlegal hold يمنع الحذف حسب السياسة.
- إشعارات المواعيد والمهام والتكاليف وربطها بالمحاسبة كمصروف/مطالبة بعد اعتماد.
- قوالب إنذار ثنائية اللغة versioned، لكنها DRAFT حتى يعتمدها المستشار القانوني.
- لا تكتب ادعاءات قانونية أو مهلاً نهائية غير معتمدة في الشيفرة؛ اجعلها إعدادات Country Pack/Template reviewed.

#### بوابة القبول

- مستخدم بلا `legal.*` لا يرى وجود القضية أو ملفاتها.
- legal hold يمنع purge.
- كل انتقال وجلسة ومستند وقرار في timeline غير قابل للمحو.
- لا تعتبر النصوص شهادة قانونية؛ أظهر حالة المراجعة.

### 14. المرحلة 9 — اللوحات الأربع والتقارير وCMS والأرشيف والترحيل

#### اللوحات

ابنِ تجربة مكتملة لا console generic واحدة:

- **Platform:** المؤسسات، الباقات، المستخدمون، المخاطر، الدعم، CMS، الإعلانات، مراقبة التكاملات.
- **Owner:** العقارات والوحدات والإشغال والدخل والمصروفات والاعتمادات والممثلون والصيانة والتقارير.
- **Developer:** المشاريع والمخزون والمبيعات والحجوزات والتحصيل والتسليم والمقاولين.
- **Tenant:** العقد والفواتير والإيصالات والدفعات والمستندات والصيانة والطلبات والمهام والتنبيهات.

لكل لوحة navigation وسطح معلومات خاص، مع breadcrumb، filters، saved views، pagination، bulk actions المصرح بها، loading/empty/error، responsive وkeyboard.

#### التقارير

- تعريف KPI موثق لكل تقرير، query server-side scoped، `as_of`, currency ومصدر drill-down.
- تقارير: إشغال، Rent roll، دخل/مصروف وصافي مالك، متأخرات، حجز/تحويل، صيانة/SLA/vendor، مبيعات، قضايا، مهام، محاسبة وضرائب.
- report job + outbox + worker، ملفات CSV UTF-8 BOM مع formula injection defense، XLSX حقيقي، PDF آمن.
- private object + signed download قصير + expiry + audit.
- scheduled reports من worker فعلي، لا localStorage.

#### CMS والثقة

- صفحات عمانية احترافية: الرئيسية، من نحن، الخدمات، العقارات، المشاريع، التواصل، الباقات، الثقة، الخصوصية، الشروط، Accessibility.
- draft/review/publish/version/rollback للمحتوى.
- ترجمة عربية/إنجليزية كاملة بلا نصوص hard-coded أو مفاتيح ظاهرة.

#### الأرشيف والاحتفاظ

- Archive ليس تغيير status فقط: policies، retention، legal hold، export، restore فعلي واختبار.
- soft delete where needed، purge worker بموافقة وaudit، ولا يمس سجلات مالية/قانونية محمية.
- backup/PITR runbook منفصل عن archive.

#### الترحيل من BHD-OM

- ETL resumable من Prisma + BookingStorage + ContractStorage + AppSetting + Legacy KV + ملفات التصدير.
- staging tables، source IDs، checksums، count reconciliation، quarantine للأخطاء.
- characterization tests للسلوك القديم المفيد.
- shadow read ثم dual-run مالي محدود ثم canary tenant ثم cutover.
- لا تنسخ JSON core كما هو؛ حوّله إلى كيانات طبيعية.
- لا cutover إذا بقي فرق مالي غير مفسر أو عقد/وحدة بلا تطابق.

#### بوابة القبول

- كل لوحة لها E2E بحسب الدور، وTenant A/B.
- كل تقرير fixture حقيقي ورابطه خاص.
- restore لسجل مؤرشف يثبت إعادة العلاقات المسموحة.
- migration rehearsal مرتان من snapshot مع تقرير فروق صفري/مفسر.

### 15. المرحلة 10 — الأداء، Accessibility، الحماية، CI/CD والإصدار

#### الأداء

- SQL explain وخطط فهارس للبحث واللوحات والتقارير.
- منع N+1، cursor pagination، projections صغيرة، caching آمن tenant-aware، invalidation events.
- image sizes/srcset/priority صحيحة، Server Components حيث يناسب، dynamic imports للأجزاء الثقيلة.
- k6/Artillery load tests للحجز والدفع والقوائم والويبهوك والتقارير.
- budgets في CI تمنع التراجع.

#### Accessibility والواجهة

- WCAG 2.2 AA: contrast، focus، labels، errors، keyboard، skip links، dialogs، tables، reduced motion.
- axe automated + اختبارات يدوية موثقة للشاشات الحرجة بالعربية والإنجليزية.
- RTL حقيقي لا قلب بصري مكسور، أرقام وعملات وتواريخ صحيحة.
- لا emoji كأيقونات إنتاجية أساسية؛ استخدم نظام أيقونات موحد accessible.

#### الحماية

- CSP nonce/hash بلا `unsafe-inline` قدر الإمكان، وTrusted Types إن أمكن.
- headers كاملة، rate limits موزعة، brute-force controls، body limits، request timeouts.
- attachments private، AV/CDR، quarantine، content-disposition، filename sanitization.
- dependency updates، lockfile frozen، audit/SBOM/CodeQL/secret scan/container scan.
- Threat Model محدث لكل trust boundary واختبارات regression لكل P0/P1.

#### CI/CD وDocker

- Pipeline PR: format/lint/type/unit/integration/contract/E2E/axe/security/migration/performance smoke.
- Docker multi-stage، non-root، minimal image، pinned digest، read-only FS حيث يمكن، health/readiness، graceful shutdown.
- build artifact لا يتصل بـDB.
- migration job منفصل بقفل واحد، backup check، dry-run، expand/contract.
- preview environment مع بيانات synthetic فقط.
- release: canary، smoke، promote، rollback للكود وforward-fix للـDB، release notes وmigration notes.

#### التوثيق النهائي

- OpenAPI كامل وexamples، C4، ADRs، state diagrams، data classification، retention، RACI.
- Runbooks: secret/PII leak، account takeover، webhook lag/replay، duplicate payment، provider outage، reconciliation mismatch، key rotation، migration failure، PITR/restore، malware file، queue/DLQ، rollback.
- SLO/SLI وalerts: login, API latency, error rate, DB saturation, queue age, webhook lag, journal imbalance, reconciliation, cross-tenant denials, encryption fallback.

#### بوابة الإطلاق النهائية

لا تعلن الاكتمال إلا إذا تحقق كله:

- كل `GAP-REGISTER` إما complete بدليل أو deferred خارج V1 بقرار موثق، ولا P0/P1 deferred.
- كل API مصنف ومختبر deny.
- كل اختبار Unit/Integration/E2E/Security/A11y/Build أخضر بلا skipped للمسار الحرج.
- صفر Critical/High غير مستثنى، والاستثناءات الأخرى لها مالك وتاريخ.
- Tenant A لا يرى أي مورد أو ملف أو بحث أو export أو event لـB.
- 100 webhook replay = أثر مالي واحد.
- كل journal مرحل متوازن، وكل invoice number فريد تحت التزامن.
- لا secret fixtures في logs/audit.
- لا XSS في HTML/print/PDF.
- restore وmigration rehearsal موثقان.
- performance budgets ناجحة.
- الموقع واللوحات الأربع احترافية عمانية وليست واجهات generic.

### 16. أسلوب التسليم أثناء التنفيذ

بعد كل مرحلة حدّث:

- `docs/implementation/STATUS.md`: المرحلة الحالية، المنجز، المتبقي، المخاطر.
- `docs/verification/phase-N.md`: الأدلة الفعلية.
- `docs/CHANGELOG.md` أو changelog المشروع.
- GAP Register.

أنشئ commits صغيرة مترابطة بعد نجاح البوابة، ولا تستخدم force/reset أو تمس تاريخ المستخدم. لا تنشئ commit يقول «complete» قبل اكتمال البوابة. إذا وجدت خدمة ضخمة، قسمها تدريجياً مع characterization tests ولا تعيد كتابتها دفعة واحدة.

في النهاية أعطني تقريراً واحداً صادقاً يحتوي:

1. ما تم بناؤه لكل مرحلة.
2. migrations والجداول والـAPIs والصفحات.
3. عدد وأنواع الاختبارات ونتائج الأوامر.
4. نتائج العزل والأمن والتزامن والأداء وAccessibility.
5. قائمة أي عنصر يتطلب credentials/صلاحيات إنتاج أو مراجعة قانونية.
6. خطوات النشر الدقيقة وrollback.
7. روابط ملفات verification واللقطات.

ابدأ الآن بالمرحلة 0، ولا تنتقل إلى المرحلة 1 حتى تنجح بوابتها. ثم استمر تلقائياً حتى المرحلة 10 وفق القواعد أعلاه.

## نهاية الأمر

---

## ملاحظة للاستخدام

إذا كان Cursor مفتوحاً على نسخة من `BHD-R` لا ترى مجلد `../outputs`، انسخ ملف التقرير التشغيلي إلى:

```text
docs/legacy-reviews/BHD-OM-operational-workflows-deep-review-ar.md
```

ثم أبقِ بقية الأمر كما هو. لا تمنح Cursor مفاتيح إنتاج في المحادثة أو ملفات `.env` المتعقبة؛ استخدم Secret Manager وبيئة اختبار منفصلة.
