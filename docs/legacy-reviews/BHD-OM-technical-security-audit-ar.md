# تقرير المراجعة التقنية والأمنية لمشروع BHD‑OM

**تاريخ المراجعة:** 11 أغسطس 2026  
**المستودع:** [ainoamn/bhd-om](https://github.com/ainoamn/bhd-om)  
**الإصدار المثبّت للمراجعة:** [`1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59`](https://github.com/ainoamn/bhd-om/commit/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59)  
**نوع المراجعة:** فحص مصدر محلي، بناء، اختبارات متاحة، تدقيق اعتماديات، وتحليل معماري وأمني. ليست اختبار اختراق للإنتاج ولا شهادة امتثال.

## 1. الخلاصة التنفيذية

المشروع منصة كبيرة لإدارة العقارات والحجوزات والعقود والمحاسبة والمدفوعات والأرشفة، بواجهة عربية/إنجليزية ومجموعة واسعة من صفحات الإدارة وواجهات API. البنية الحديثة الأساسية جيدة: Next.js وReact وTypeScript وPrisma/PostgreSQL، ويوجد CI واختبارات وحدة وE2E أولية، كما نجح بناء نسخة الإنتاج محلياً.

لكن المشروع **غير جاهز بعد للتعامل الآمن مع مدفوعات حقيقية أو عزل شركات متعددة في الإنتاج**. توجد مشكلات شديدة الخطورة يمكن استغلال بعضها مباشرة من منطق الكود، أهمها:

1. ملف seed يعيد تعيين حساب المدير إلى كلمة مرور ثابتة ويطبعها في السجل.
2. Webhook الدفع غير موقّع، ويقبل GET، ولا يملك idempotency ذرّية؛ كما توجد سباقات في إنشاء القيود وترقيمها.
3. عزل الشركات غير مطبق على غالبية الجداول المالية والحجوزات والأرشيف.
4. ملف `dev.db` متعقب في مستودع عام ويحتوي مؤشرات على بيانات أشخاص؛ يجب معاملته كحادثة خصوصية محتملة والتحقق منها فوراً.
5. طباعة الفواتير والإيصالات وقالب الفاتورة تبني HTML من بيانات غير مهربة ثم تستخدم `document.write` أو `innerHTML`، ما يفتح Stored/DOM XSS.
6. الصلاحيات موزعة وغير موحدة؛ عدد من APIs الحساسة يعتمد على طبقة proxy فقط، وبعض المسارات لا يظهر فيها حارس مركزي.
7. الروابط العامة للإيصالات/العقود تعتمد على معرّف الحجز وتعيد بيانات أكثر من المطلوب.
8. التشفير لا يطبق فعلياً فصل مفاتيح أو إصدارات أو تدويراً للبيانات، وبعض دواله ترجع إلى النص الصريح عند الفشل.
9. القيم المالية تستخدم `Float` ولا توجد قيود تفرد كافية على أرقام القيود والمستندات.

النتيجة العملية: المشروع يملك قاعدة جيدة للاستمرار، لكن يلزمه **برنامج إصلاح أمني منظم قبل التوسع أو تشغيل الدفع الإنتاجي**. لا أنصح بإعادة كتابة شاملة؛ الأفضل إصلاح المخاطر الحرجة أولاً، ثم إحاطة الوحدات القديمة بخدمات وحدود واختبارات، ونقلها تدريجياً.

## 2. نطاق المراجعة وحدودها

تم تنفيذ الآتي:

- تنزيل المستودع العام وتثبيت المراجعة على commit محدد لمنع تغيّر النتائج أثناء الفحص.
- قراءة البنية والـ APIs ومخطط Prisma والمصادقة والصلاحيات والمدفوعات والطباعة والأرشفة والتشفير والرفع والـ CI.
- تثبيت الاعتماديات، توليد Prisma Client، تشغيل اختبارات الوحدة، TypeScript، ESLint، Prisma validate، و`next build` مباشرة.
- تشغيل `npm audit` و`npm outdated` في تاريخ المراجعة.
- فحص ملف قاعدة البيانات المتعقب **للمخطط والمؤشرات الإحصائية فقط** دون نسخ أو نشر أي بيانات شخصية.

لم يتم تنفيذ الآتي:

- اختبار اختراق لخدمة إنتاج أو تجاوز حماية أو إنشاء حسابات فعلية.
- تدوير مفاتيح أو أسرار حقيقية، حذف بيانات، أو تغيير Vercel/Render/Neon/Redis/S3/Sentry/DNS والبريد.
- تشغيل E2E محلياً لأن خدمة PostgreSQL/Docker المطلوبة لم تكن متاحة في بيئة المراجعة.
- إثبات إعدادات الإنتاج الفعلية أو سلامة البيانات الموجودة في Neon/Vercel.
- تقديم اعتماد PCI DSS أو SOC 2 أو ISO أو صياغة قانونية نهائية.

## 3. كيف يعمل البرنامج

### 3.1 التقنية المستخدمة

| الطبقة          | التقنية                                                |
| --------------- | ------------------------------------------------------ |
| الواجهة والخادم | Next.js 16 App Router وReact 19 وTypeScript 5          |
| التصميم         | Tailwind CSS 4                                         |
| تعدد اللغات     | `next-intl` للعربية والإنجليزية                        |
| قاعدة البيانات  | PostgreSQL عبر Prisma 7 و`@prisma/adapter-pg`          |
| المصادقة        | NextAuth 4 Credentials إضافة إلى مسارات دخول مخصصة     |
| الاختبارات      | Node test runner وPlaywright                           |
| النشر المتوقع   | Vercel، مع تكاملات اختيارية لـ Upstash وVercel Blob    |
| الدفع           | طبقة موحدة لعدة بوابات، مع ربط محاسبي وإشعارات Webhook |
| الأمن الإضافي   | TOTP عبر `otplib`، تشفير AES-GCM مخصص، تدقيق وأرشفة    |
| OCR/ملفات       | Tesseract وواجهات رفع محلية/Blob                       |

### 3.2 التدفق الوظيفي

1. تعرض صفحات Next.js واجهات عامة للعقارات والمشاريع والخدمات، وواجهات محمية للإدارة والمحاسبة والحسابات.
2. تتصل Server Components ومسارات `/api` بخدمات داخل `lib/` ثم بقاعدة PostgreSQL عبر Prisma.
3. توجد طبقة proxy تقوم بحماية أولية لبعض البادئات، ثم تستعمل APIs حراساً مثل `requireAuth` و`requireRoles` بدرجات متفاوتة.
4. تُخزن بعض الوحدات في جداول طبيعية، بينما ما زالت الحجوزات والعقود وجهات الاتصال تستعمل JSON/Legacy KV وبيانات متزامنة مع `localStorage`، لذلك النظام هجين وليس له مصدر حقيقة واحد في كل الوحدات.
5. تنشئ بوابات الدفع جلسة، ثم يفترض أن يصل Webhook لتأكيد العملية وإنشاء قيد محاسبي وتحديث الاستحقاق.
6. تقوم وحدات الأرشفة بتشفير snapshots وتخزين metadata، لكن الاستعادة الحالية لا تعيد الكيان فعلياً بصورة مكتملة.

### 3.3 حجم وتعقيد المشروع

- يوجد نحو **180 مسار API**.
- يوجد **742 ملف TS/TSX** نشط داخل `app/components/lib`.
- نحو **231 ملفاً** معلّماً بـ`use client`، وتمثل ملفات العميل قرابة 60% من الحجم المصدري لتلك الطبقات.
- لا توجد استخدامات واضحة لـ`next/dynamic`، بينما توجد صفحات/مكونات تتجاوز 100–240 كيلوبايت للملف الواحد.
- يوجد 71 موضعاً تقريباً يستخدم `force-dynamic` و104 مواضع تقريباً تستخدم `no-store`، ما يقلل فرص التخزين المؤقت.
- لا يوجد Dockerfile نشط في جذر التطبيق؛ الموجود مرتبط بطبقة legacy.

هذه الأرقام لا تعني وحدها أن الموقع بطيء، لكنها تشير إلى تكلفة JavaScript وصعوبة صيانة مرتفعة، وتحتاج قياساً فعلياً لـCore Web Vitals وp95 قبل وبعد كل تحسين.

## 4. ما هو جيد في المشروع

- اختيار تقني حديث ومتوافق مع التطوير طويل الأمد.
- استخدام TypeScript وPrisma migrations بدلاً من SQL عشوائي في التطبيق.
- نجاح بناء الإنتاج المحلي يدل على أن مسارات البناء الأساسية متماسكة.
- وجود اختبارات وحدة وPlaywright وWorkflow يشغل PostgreSQL ومهاجرات وseed واختبارات وبناء.
- وجود رؤوس أمنية أساسية: HSTS في الإنتاج، `nosniff`، Referrer Policy، Permissions Policy، COOP/CORP، وإيقاف `X-Powered-By`.
- استخدام AES-GCM وbcrypt، وتشفير بعض حقول PII وTOTP بدلاً من ترك كل شيء واضحاً.
- وجود مولّد أرقام ذرّي جيد في [`lib/server/serialNumbers.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/server/serialNumbers.ts)، ويمكن توحيد النظام عليه.
- وجود loading boundaries وصور Next.js وبعض cursor pagination وعمليات `Promise.all`.
- وجود وثائق داخلية كثيرة للمحاسبة والنشر والأدوار، وإن كانت تحتاج مزامنة مع الواقع.
- دعم RTL والعربية والإنجليزية، وهي نقطة جيدة للتوسع الدولي لاحقاً.

## 5. نتائج البناء والاختبارات

| الفحص                                 | النتيجة        | الملاحظة                                                                                                                                                    |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                              | نجح            | تم تثبيت 584 حزمة تقريباً؛ ظهر تحذير deprecation لـ`otplib` 12                                                                                              |
| اختبارات الوحدة                       | **نجحت 51/51** | فشلت أول مرة لعدم توليد Prisma Client، ثم نجحت بعد `prisma generate`                                                                                        |
| `prisma validate`                     | نجح            | المخطط صالح بنيوياً                                                                                                                                         |
| `next build` المباشر                  | نجح            | تم البناء وتوليد 247 صفحة ثابتة تقريباً                                                                                                                     |
| `tsc --noEmit`                        | فشل            | 7 أخطاء في fixtures الاختبارات، منها حقول timestamps/totals ناقصة                                                                                           |
| ESLint كامل                           | فشل            | 355 خطأ و5,508 تحذيرات، ويشمل legacy                                                                                                                        |
| ESLint للشفرة النشطة                  | فشل            | 292 خطأ و267 تحذيراً في 160 ملفاً                                                                                                                           |
| `npm audit`                           | فشل أمني       | 14 تنبيهاً: 1 حرج، 7 عالية، 6 متوسطة في لقطة يوم المراجعة                                                                                                   |
| E2E محلي                              | لم يُشغّل      | PostgreSQL/Docker غير متاح                                                                                                                                  |
| آخر GitHub Actions على commit المفحوص | **فشل**        | تشغيل [E2E verify رقم 29912639408](https://github.com/ainoamn/bhd-om/actions/runs/29912639408) فشل في خطوة `Install dependencies` قبل الوصول إلى الاختبارات |

مهم: أمر `npm run build` في `package.json` يشغل `prisma migrate deploy` قبل `next build`. لذلك استُخدم `next build` مباشرة حتى لا تتصل المراجعة بقاعدة غير مقصودة. ربط البناء بالهجرة مخاطرة تشغيلية يجب إزالتها.

## 6. مصفوفة التحقق من المتطلبات المطلوبة

الرموز: **متحقق** = مطبق بصورة كافية، **جزئي** = توجد بداية لكن بها فجوات، **غير متحقق** = لم يتحقق أو توجد ثغرة مضادة له، **خارج النطاق** = الوحدة غير موجودة في هذا المستودع.

| المتطلب                                                | الحالة                | الدليل المختصر                                                                                                       |
| ------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| منع تسرب الأسرار إلى سجلات التدقيق مع regression tests | **غير متحقق**         | يتم `JSON.stringify` لتفاصيل حرة بلا redaction، وseed يطبع كلمة مرور، ولا توجد اختبارات أسرار متداخلة                |
| فرض صلاحيات الوحدات والأدوار مركزياً على جميع APIs     | **جزئي/غير كافٍ**     | حراس موجودون، لكن السياسات موزعة؛ 17 مساراً تقريباً يعتمد على proxy فقط و24 لا يظهر فيها حارس أو سر مركزي            |
| إغلاق XSS في طباعة الفواتير                            | **غير متحقق**         | إدخال حقول HTML مباشرة ثم `document.write`/`dangerouslySetInnerHTML`                                                 |
| إغلاق XSS في POS والمطعم                               | **خارج النطاق**       | لم تظهر وحدة POS أو مطعم نشطة؛ يلزم المستودع/المسار الخاص بها إن كانت منفصلة                                         |
| منع تكرار الدفعات وسباقات Webhook وإضافة idempotency   | **غير متحقق**         | لا توقيع webhook ولا event table فريدة، واستخدام find-then-create و`count()+1` بلا transaction                       |
| تقليل بيانات روابط الفواتير العامة                     | **غير متحقق**         | `bookingId` يكفي في بعض المسارات، وتُعاد booking/contact وحقول داخلية أكثر من اللازم                                 |
| إغلاق SSRF في إعدادات بوابات الدفع                     | **جزئي**              | الروابط تقبل بلا validation؛ لم أجد حالياً server-side fetch مباشر لها، فهي مخاطرة كامنة لا استغلال SSRF مثبت حالياً |
| تغيير/استعادة كلمة المرور وإلغاء الجلسات القديمة       | **غير متحقق**         | صفحة “نسيت” تطلب الاتصال بالمدير، reset يعيد كلمة مؤقتة، ولا يوجد `sessionVersion`/إبطال شامل                        |
| حماية CSRF وتشديد TOTP وAPI Keys                       | **غير متحقق**         | مولّد CSRF غير مستخدم، TOTP اختياري وبلا منع replay كافٍ، ولا يوجد نظام دورة حياة API keys                           |
| فصل مفاتيح التشفير والإصدارات والتدوير                 | **غير متحقق**         | مفتاح واحد وsalt ثابت، ciphertext بلا key id/version؛ rotation يسجل hash لمفتاح غير مستخدم ولا يعيد التشفير          |
| ترقيم الفواتير المتزامن وDecimal                       | **جزئي/غير كافٍ**     | يوجد helper ذري جيد، لكن الدفع يستخدم `count()+1`، والحقول المالية `Float`                                           |
| عزل الشركات واختبارات منع الوصول                       | **غير متحقق**         | `organizationId` غائب عن معظم جداول المحاسبة والحجوزات والأرشيف، ولا توجد اختبارات tenant سلبية شاملة                |
| تحديث الاعتماديات والتنبيهات الأمنية                   | **غير متحقق**         | `npm audit` سجل 14 تنبيهاً، وNext/NextAuth/Prisma وغيرها لها تحديثات                                                 |
| Backend/Frontend/Integration/E2E tests                 | **جزئي**              | 51 وحدة و9 ملفات E2E تقريباً؛ لا توجد coverage كافية للأمن والمدفوعات والمستأجرين والواجهة                           |
| CI/CD وDocker والهجرات والإصدارات                      | **جزئي**              | CI وهجرات موجودة؛ لا lint/tsc/audit gates، لا Docker نشط، والبناء يشغل الهجرة، ولا release/rollback واضح             |
| CSP ورؤوس الأمان والمرفقات                             | **جزئي/غير كافٍ**     | رؤوس جيدة أساساً؛ CSP واسعة مع `unsafe-inline`، والرفع/التنزيل لا يفرضان فحص النوع والملكية دائماً                   |
| Accessibility والواجهة والنصوص وصفحات الثقة والخصوصية  | **غير متحقق بالكامل** | لا axe/Lighthouse gates، مشاكل lint كثيرة، وصفحات الخصوصية/الشروط/الثقة غير موجودة                                   |
| إعادة تنظيم الخدمات الضخمة تدريجياً                    | **غير متحقق بعد**     | توجد ملفات 100–246KB ومزج UI/domain/storage؛ يمكن تنفيذ strangler دون كسر النظام                                     |
| Country Packs والعملات والترجمة والتوسع الدولي         | **غير متحقق**         | اللغات ثابتة ar/en وOMR/عُمان hard-coded في مئات المواضع                                                             |
| التوثيق وRunbooks وThreat Model والسياسات              | **جزئي**              | وثائق تشغيلية موجودة، لكن لا Threat Model رسمي ولا runbooks حوادث/تدوير/استعادة/rollback متكاملة                     |
| تحسين طبقة الأرشفة                                     | **غير متحقق بالكامل** | تشفير snapshot جيد كبداية، لكن tenant غير واضح، restore لا يعيد الكيان، ويمكن تكرار الأرشفة                          |

## 7. النتائج الأمنية والتقنية التفصيلية

### 7.1 [حرج] حساب مدير ثابت يُعاد تعيينه من seed

في [`prisma/seed.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/prisma/seed.ts#L14-L54) توجد بيانات `admin@bhd-om.com / admin123`. إذا كان المستخدم موجوداً، يعيد seed تعيين كلمة مروره ويجعله super-admin، ثم يطبع كلمة المرور في السجل. كما يضع PIN افتراضياً. وتشير وثائق النشر إلى استخدام seed، ما يزيد احتمال وصول ذلك إلى بيئة حقيقية.

**الإصلاح:**

- حذف كل سر افتراضي من المصدر فوراً.
- جعل bootstrap يعتمد على متغير بيئة مطلوب وكلمة عشوائية قوية، ويرفض العمل في production إلا بعلم `ALLOW_PRODUCTION_BOOTSTRAP=true` مؤقت.
- عدم تعديل حساب موجود أبداً من seed؛ يفصل seed المرجعي عن bootstrap المستخدمين.
- عدم طباعة أي كلمة مرور/PIN/token.
- تدوير بيانات هذا الحساب ورفع `sessionVersion` وإلغاء كل الجلسات إن استُخدم seed على أي بيئة مشتركة.
- إضافة اختبار يفشل إذا ظهرت كلمات مثل `admin123` أو قيمة سر في stdout أو سجل التدقيق.

### 7.2 [حرج] قاعدة بيانات متعقبة في مستودع عام

ملف `dev.db` في جذر المستودع متعقب تاريخياً، بينما `.gitignore` الحالي يستثني `prisma/dev.db` و`*.db`. فحص إحصائي محلي وجد صفوف مستخدمين وحقول بريد وهاتف، وبعضها ليس من نطاقات الاختبار الواضحة. لم تُدرج أي قيمة في هذا التقرير.

**الاستجابة الصحيحة:**

1. تحديد مالك البيانات وهل هي حقيقية؛ التعامل معها كحادثة خصوصية حتى يثبت العكس.
2. حصر commits/forks/clones ومدة التعرض.
3. تدوير كلمات المرور/الجلسات/tokens المرتبطة إن كانت حقيقية، حتى لو كانت كلمات المرور bcrypt.
4. إزالة الملف من HEAD ثم التاريخ بواسطة `git filter-repo` في نافذة منسقة، لأن إعادة كتابة التاريخ تؤثر على كل المطورين.
5. إضافة فحص أسرار وPII وملفات DB في pre-commit وCI.
6. توثيق قرار الحادث والإخطار القانوني حسب جهة الاختصاص؛ لا تحذف أدلة الإنتاج قبل أخذ نسخة جنائية مصرح بها.

### 7.3 [عالٍ] تسرب الأسرار إلى السجلات والتدقيق

تقوم [`lib/audit.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/audit.ts#L12-L22) و[`lib/server/securityAudit.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/server/securityAudit.ts#L13-L21) بتسلسل `details` الحرة كما هي. كما يسمح `/api/audit/log` لمستخدم مصادق بإرسال تفاصيل حرة، وتوجد مئات مواضع `console.error/warn` بلا redactor مركزي.

**الإصلاح:** إنشاء `secureLogger` و`auditEvent` بمخططات أحداث محددة وredactor recursive قبل أي sink. يجب إخفاء المفاتيح بحسب الاسم والقيمة: `password`, `authorization`, `cookie`, `token`, `secret`, `apiKey`, `privateKey`, `otp`, `civilId`, أرقام البطاقات، وسلاسل JWT/Bearer. يضاف حد للحجم والعمق، وتُمنع التفاصيل الدائرية، ولا يعد سجل مرسل من العميل سجلاً تدقيقياً موثوقاً.

**اختبارات regression المطلوبة:** أسرار مباشرة ومتداخلة داخل arrays/objects، اختلاف حالة الأحرف، headers، URL query، Error cause/stack، JWT، Basic/Bearer، مفاتيح بوابات الدفع، مدخل دائري، ومدخل ضخم. الاختبار يثبت عدم وجود القيمة الأصلية في DB/stdout/Sentry payload.

### 7.4 [عالٍ] الصلاحيات ليست سياسة مركزية شاملة

يوجد proxy وحراس متعددة، وهذا جيد كبداية، لكن المراجعة الإحصائية لمسارات API وجدت اعتماداً غير متسق: مسارات محاسبية حساسة تعتمد على proxy فقط، ومسارات أخرى لها أدوار محلية مختلفة. الأهم أن `requiredPermissions` في [`lib/api-guard.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/api-guard.ts) لا يختبر قائمة صلاحيات فعلية؛ يكفي دور “admin-like”. كما أن enum الأدوار في Prisma لا يطابق كل الأدوار المتوقعة في [`lib/auth/roles.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/auth/roles.ts).

الـproxy ليس حد أمن نهائياً، خصوصاً مع وجود تنبيهات أمنية حديثة حول Next middleware/proxy. يجب أن يكون كل handler آمناً لو تم استدعاؤه مباشرة.

**الإصلاح:**

- واجهة واحدة: `authorize({actor, permission, tenantId, resource})` بنمط default-deny.
- manifest يصرح بكل route: public/authenticated/permission/service-secret؛ ويفشل CI إذا ظهر route غير مصنف.
- توحيد نموذج الأدوار في DB مع permission grants؛ لا تستخدم أسماء أدوار متناثرة كسياسة.
- التحقق من tenant/resource بعد الدور، وليس الدور وحده.
- اختبارات جدولية لكل API: anonymous، role عادي، role غير مخول، tenant آخر، disabled user، stale session، service token.

### 7.5 [عالٍ] XSS في الطباعة والمعاينات

يقوم [`InvoicePrint.tsx`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/components/admin/InvoicePrint.tsx#L63-L201) بإدخال أسماء العملاء والشركة والملاحظات والبنك والوصف والألوان والشعار في HTML، ثم يستخدم `document.write` و`dangerouslySetInnerHTML` لاحقاً. النمط نفسه موجود في [`receiptPrint.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/utils/receiptPrint.ts) ومحرر قالب الفاتورة.

**الإصلاح المفضل:** إنشاء صفحة طباعة React مستقلة تقبل ID وتسترجع DTO من الخادم، وتعرض النص كعقد نصية لا HTML. إذا كان HTML المخصص مطلباً، يُنظف عبر DOMPurify بسياسة allowlist صغيرة، وتُتحقق URLs والألوان/CSS، ويُستخدم Trusted Types وCSP nonce. لا يكفي escape عام إذا كان السياق URL أو CSS أو attribute.

**اختبارات:** payloads تشمل إغلاق `style/script`, `img onerror`, SVG/data URL, اقتباسات attributes، CSS `url()`, وUnicode obfuscation، مع اختبار preview والطباعة الفعلية. لم تظهر وحدة POS أو مطعم نشطة في هذا المستودع، لذلك لا يمكن اعتماد إغلاقهما دون إتاحة شفرتها.

### 7.6 [حرج] Webhook الدفع وidempotency والسباقات

في [`app/api/webhooks/payment/route.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/app/api/webhooks/payment/route.ts):

- لا يوجد تحقق من توقيع provider على raw body.
- يقبل المسار POST وGET.
- يستخرج `userId` و`dueId` وبيانات أخرى من جسم الطلب غير الموثوق بعد التحقق من session.
- يرجع 200 في بعض حالات الخطأ، ما يفسد سياسة retry والمراقبة.

وفي [`lib/payment/accounting-link.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/payment/accounting-link.ts#L109-L220) توجد عملية `findFirst` ثم `create` وترقيم `count()+1` وتحديث استحقاق/تنبيه/legacy sync خارج transaction واحدة. طلبان متزامنان يمكن أن ينشئا قيدين أو الرقم نفسه.

**الإصلاح:**

- جدول `WebhookEvent(provider,eventId)` بقيد unique، يخزن hash الجسم وحالة المعالجة.
- جدول/قيد `Payment(provider,providerTransactionId)` فريد.
- توقيع raw body، timestamp tolerance، وallowlist لنوع الحدث لكل مزود.
- عدم الثقة في metadata الواردة: استخرج الطلب/المبلغ/العملة/المستأجر من سجل داخلي مرتبط بمعرّف provider، وقارنها كلها.
- state machine ذرية بواسطة `updateMany where status=PENDING` أو transaction Serializable/advisory lock.
- transaction واحدة للقيد المالي والاستحقاق وoutbox؛ ترسل الإشعارات والمزامنة من worker قابل لإعادة المحاولة.
- unique مركب `(organizationId, fiscalYear, documentType, serialNumber)`، واستعمال counter ذري لا `count()+1`.
- اختبارات توازي 20–100 طلب للحدث نفسه، ترتيب أحداث معكوس، timeout، retry، refund مزدوج، ومبالغ/عملات خاطئة.

### 7.7 [عالٍ] الروابط العامة تكشف أكثر من المطلوب

يعلن [`public-receipt`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/app/api/bookings/public-receipt/route.ts) صراحة أنه يعتمد على `bookingId`. وفي [`publicContractAccess.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/server/publicContractAccess.ts#L89-L190) يمكن تحميل booking كامل وcontact/raw fields ووثائق/شيكات حسب التدفق.

**الإصلاح:** رمز مشاركة عشوائي 256-bit، لا يُخزن إلا hash، وله scope وtenant وexpiry وrevocation وmaxUses. يعيد endpoint DTO صغيراً: رقم الوثيقة، التاريخ، البنود والمجموع وحالة الدفع فقط؛ لا `contactId`, `bankAccountId`, raw booking/contact/checks أو metadata داخلية. أضف `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, rate limit، استجابة 404 موحدة، وسجل وصول منقح.

### 7.8 [متوسط حالياً/عالٍ عند استخدامه] روابط بوابات الدفع وSSRF

يخزن [`app/api/payment/config/route.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/app/api/payment/config/route.ts#L82-L104) `webhookUrl/successUrl/cancelUrl` دون validation. لم يظهر في النسخة المفحوصة server-side fetch مباشر إلى هذه الحقول؛ لذلك لا يصح وصفها بثغرة SSRF مستغلة الآن. لكنها تصبح SSRF أو open redirect بمجرد استعمالها في fetch/redirect لاحقاً.

**الإصلاح:** HTTPS فقط، origin منفصل للعودة العامة، allowlist ثابت لعناوين مزودي الدفع، منع credentials/fragments، حل DNS ثم منع loopback/private/link-local/multicast/metadata IPv4 وIPv6، إعادة التحقق بعد كل redirect، ومنع DNS rebinding. لا تستخدم URL مخزناً في طلب صادر إلا عبر عميل egress مركزي بهذه السياسة.

### 7.9 [عالٍ] تغيير/استعادة كلمة المرور وإبطال الجلسات

صفحة [`forgot-password`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/app/%5Blocale%5D/forgot-password/page.tsx) تطلب الاتصال بالمدير. مسار الإدارة يولد كلمة مؤقتة بـ`Math.random` ويعيدها في JSON، بينما JWT صالح حتى 24 ساعة ولا يرتبط بـ`passwordChangedAt` أو `sessionVersion`، لذلك قد تبقى الجلسات القديمة صالحة بعد reset أو تغيير الدور.

**الإصلاح:**

- تغيير ذاتي يتطلب كلمة المرور الحالية وreauth للعمل الحساس.
- reset token عشوائي CSPRNG، يخزن hash فقط، TTL قصير، single-use، وربط بالمستخدم والغرض.
- استجابة anti-enumeration موحدة ورسالة بريد، مع rate limit وCAPTCHA تدريجي.
- `sessionVersion` و`passwordChangedAt`; كل تغيير/تعطيل/تغيير دور يزيد النسخة، ويتحقق منها كل طلب أو عبر cache قصير.
- صفحة الأجهزة/الجلسات وإبطال جلسة أو الجميع، مع إشعار أمني.
- لا تعاد كلمة مرور في API ولا ترسل plaintext permanent password.

### 7.10 [عالٍ] CSRF وTOTP وAPI Keys

يوجد مولّد CSRF في `lib/security` لكنه غير مستخدم كسياسة عامة. حماية NextAuth الداخلية لا تغطي تلقائياً كل APIs المخصصة. TOTP موجود ومشفّر، لكنه اختياري، ولا توجد حماية واضحة من إعادة استخدام نفس timestep أو recovery codes وإعادة مصادقة قوية لكل تغييرات الإعداد. `otplib` 12 نفسه deprecated. لم يظهر نظام تطبيق متكامل لإنشاء API keys بصلاحيات وانتهاء وتدوير؛ مفاتيح بوابات الدفع شأن مختلف وبعضها مخزن في DB.

**الإصلاح:**

- Cookies `Secure`, `HttpOnly`, `SameSite=Lax/Strict` حسب التدفق، وفحص Origin وFetch Metadata؛ token double-submit أو synchronizer لكل mutation المعتمدة على cookies.
- فرض TOTP على super-admin والدفع والتصدير، مع reauth، recovery codes مشفرة/hashed، replay prevention وrate limit وتسجيل أحداث.
- API key بصيغة prefix + 256-bit secret؛ تخزين hash فقط، scopes وtenant وexpiry وlastUsedAt وrevocation وrotation، وعدم عرضه بعد الإنشاء.

### 7.11 [عالٍ] التشفير لا ينفذ فصل/إصدارات/تدويراً حقيقياً

في [`lib/encryption/index.ts`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/lib/encryption/index.ts#L42-L162) يشتق مفتاح واحد بـscrypt وsalt ثابت، وصيغة ciphertext هي `iv:tag:ciphertext` بلا version أو key ID أو AAD. عملية rotation تنشئ مفتاحاً عشوائياً ثم تخزن hash فقط؛ دوال التشفير لا تستعمله ولا تعيد تشفير البيانات. كما أن search hash بلا pepper افتراضياً، وبعض wrappers ترجع النص الصريح عند فشل التشفير.

**الإصلاح:** envelope versioned مثل `{v,keyId,alg,nonce,ciphertext,tag}`، وKMS/KEK خارج DB، وDEK أو HKDF domain keys منفصلة لـPII/TOTP/archive/payment credentials/search index. اجعل AAD يشمل `tenantId + table + field + recordId`. نفذ dual-read/primary-write ثم backfill checkpointed، واحسب نسبة البيانات القديمة، واختبر rollback. يجب أن تفشل الكتابة الحساسة مغلقة، لا أن تخزن plaintext. search index يستخدم HMAC بمفتاح pepper مستقل وقابل للتدوير.

### 7.12 [حرج للمحاسبة] Float وترقيم غير آمن

يحتوي [`prisma/schema.prisma`](https://github.com/ainoamn/bhd-om/blob/1ebbcf88740342e8a06c29f1d7ccf261c7a7fb59/prisma/schema.prisma) على 19 حقلاً `Float` تقريباً؛ المالية منها تشمل balances وamount/debit/credit/totals وأسعار الخطط والاستحقاقات. لا توجد قيود تفرد كافية على serial في بعض جداول القيود/المستندات. Float يسبب أخطاء ثنائية تراكمية وعدم توازن سنتات/بيسات.

**الإصلاح:** `Decimal(20,3)` لعُمان أو scale ضمن Country Pack، وDecimal.js من DB إلى domain؛ ترسل APIs المال كسلسلة لا JavaScript number. أضف DB constraint لتوازن المدين والدائن وقيد unique مركب. نفذ migration توسعية: أعمدة Decimal ظل، backfill وتحقق من الفروقات، dual-write مؤقت، switch read، ثم إزالة Float في إصدار لاحق.

### 7.13 [حرج إذا كانت المنصة SaaS] عزل الشركات

`organizationId` موجود في عدد قليل من النماذج فقط، بينما جداول المحاسبة والحجوزات وجهات الاتصال والمستندات والأرشيف لا تحمل tenant key بصورة منهجية. بعض نطاقات “العميل” تُحسب بعد تحميل/فك JSON والمقارنة بالبريد/الهاتف، وليس كشرط tenant في SQL. هذا يجعل الخطأ في handler واحد كافياً لتسريب شركة إلى أخرى.

**الإصلاح:**

- `tenantId NOT NULL` في كل سجل مملوك لشركة، بما في ذلك files/events/outbox/audit/archive/counters.
- كل unique/index يتضمن tenant حيث يلزم.
- طبقة repositories لا تقبل استعلاماً بلا tenant context، مع حظر الاستخدام المباشر لـPrisma في route handlers.
- PostgreSQL RLS كدفاع ثانٍ إن أمكن، مع transaction-local tenant setting وحساب DB محدود.
- backfill مع quarantine للصفوف التي لا يمكن نسبها، وعدم التخمين الصامت.
- اختبارات مستأجرين A/B لكل CRUD/search/export/file/public link، ومحاولات IDOR المتسلسلة والعشوائية.

### 7.14 [عالٍ] المرفقات والرفع

الرفع العام يبني الاسم من الامتداد ولا يفرض size/MIME/magic bytes. رفع شعار الشركة يسمح SVG في أصل الموقع، ما قد يسبب stored XSS بحسب طريقة العرض. مسارات أخرى تتحقق من الامتداد فقط، وVercel Blob قد يستخدم `public`، بينما تنزيل ملف booking لا يثبت دائماً ملكية/tenant المستخدم قبل تقديم الملف.

**الإصلاح:** تخزين خاص خارج web root، فحص magic bytes وتطابق MIME/extension، حد حجم وعدد، أسماء عشوائية، AV/CDR، منع SVG أو rasterize، تنزيل بعد authorization وtenant check، signed URLs قصيرة ومحددة الغرض، `Content-Disposition: attachment` و`nosniff`، وCSP sandbox للمعاينة. اختبر polyglot، SVG script، double extension، path traversal، ملفاً ضخماً، وملف tenant آخر.

### 7.15 [عالٍ] الاعتماديات

في لقطة 11 أغسطس 2026 أرجع `npm audit` 14 تنبيهاً، منها تنبيهات تمس Next/NextAuth وحزماً انتقالية مثل Hono/Prisma tooling/Sharp/Undici/PostCSS. كما ظهرت تحديثات لـNext وNextAuth وPrisma وReact وPlaywright وTailwind، وانتقال رئيسي لـ`otplib`.

**الإصلاح:** فرع تحديث أمني صغير أولاً إلى أحدث patch مدعوم، ثم `npm audit --omit=dev` وSCA/CodeQL، وتشغيل كل الاختبارات. تُعالج major upgrades، خصوصاً otplib، في PR منفصل مع اختبارات TOTP. أضف Renovate/Dependabot بسياسة تجميع وحظر merge عند critical/high المستغلة أو غير المقبولة، وSBOM وlockfile integrity.

## 8. الأرشفة

الجوانب الجيدة: توجد snapshot مشفرة وchecksum وسجل restore، وcron محمي بسر. لكن توجد فجوات:

- POST يستطيع قبول snapshot من العميل بدلاً من بناء الصورة من المصدر الموثوق على الخادم.
- `ArchiveRecord` لا يملك tenant واضحاً.
- البحث قد يعيد snapshot مفكوكة واسعة لأدوار إدارية.
- restore يسجل العملية لكنه لا يعيد الكيان وحالته بصورة مكتملة، ولا يظهر تحقق checksum شامل قبل الاستعادة.
- التشغيل التلقائي قد يعيد أرشفة نفس العقار لأن state machine/unique active archive غير محكمين.
- `organizationId` في policy لا ينعكس على كل عملية.
- README الأرشفة يصف قدرات وملفات/اختبارات لا تطابق التنفيذ الحالي.

الحل: state machine صريحة `ACTIVE → ARCHIVING → ARCHIVED → RESTORING → ACTIVE/FAILED`، قفل وunique لكل tenant/entity/version، بناء snapshot خادمي، checksum قبل وبعد، restore transactional، legal hold وretention، تخزين immutable/WORM عند الحاجة، واختبارات tenant/تكرار/فساد snapshot/انقطاع منتصف العملية.

## 9. الأداء: كيف نجعل الموقع سريعاً جداً

لا يمكن ضمان “سرعة البرق” بشعار أو minification فقط. يلزم budget وقياس ثم إزالة أكبر عنق زجاجة. الترتيب المقترح:

### 9.1 القياس أولاً

- Web Vitals حقيقية RUM حسب الصفحة والجهاز والدولة: LCP وINP وCLS وTTFB.
- traces للـAPI وPrisma: p50/p95/p99، عدد queries، وقت pool، slow queries.
- bundle analyzer لكل route، وحجم JS الأولي والمكونات المكررة.
- أهداف إطلاق: LCP أقل من 2.5 ثانية، INP أقل من 200ms، CLS أقل من 0.1، API p95 أقل من 300ms للقراءات البسيطة، وJS أولي أقل من 170KB gzip للصفحات العامة، ثم تعديلها وفق القياس.

### 9.2 أعلى التحسينات أثراً

1. تحويل صفحات العرض إلى Server Components، وحصر `use client` في widgets الصغيرة.
2. تقسيم المحررات وOCR والرسوم والتبويبات الثقيلة بـdynamic import، وعدم تحميلها قبل فتحها.
3. إزالة `PropertyStorageMigration` و`SiteContentHydrator` العامة من كل صفحة؛ تنفيذ migration مرة على الخادم وعرض المحتوى server-side.
4. إلغاء `force-dynamic/no-store` حيث لا توجد بيانات خاصة، واستعمال `revalidate` وtags. لا تُخزن صفحات حساب/فاتورة خاصة في CDN.
5. نقل البحث والترشيح من فك JSON في الذاكرة إلى أعمدة مفهرسة وSQL، مع cursor pagination وحدود ثابتة.
6. إضافة indexes من traces الفعلية: tenant + status/date، bookingId، provider transaction، document serial، normalized search fields.
7. precompute للتقارير الثقيلة، background jobs وoutbox للأرشفة/OCR/الإشعارات/migration بدلاً من انتظار المستخدم.
8. CDN للصور والملفات العامة، AVIF/WebP وأحجام responsive، وprivate signed delivery للمرفقات.
9. استخدام pooler خارجي مضبوط لـserverless؛ `max=1` يحمي DB لكنه قد يخنق كل invocation إذا نفذت عدة queries متوازية.
10. budget في CI يمنع زيادة bundle أو تراجع Lighthouse/API benchmark فوق نسبة متفق عليها.

## 10. SEO والأرشفة في محركات البحث

الإيجابي: يوجد sitemap وrobots وJSON-LD أساسي ومسارات ar/en. المشكلات:

- sitemap يضم login/register/forgot-password، وهي صفحات لا ينبغي فهرستها.
- لا يضم العقارات والمشاريع الديناميكية، و`lastModified` لا يعكس تاريخ المحتوى الحقيقي.
- لا توجد canonical و`hreflang` شاملة أو metadata ديناميكية لكل لغة/عقار.
- robots لا يحمي ولا يحجب كل صفحات الحساب/الدفع/البوابة، مع التأكيد أن robots ليس آلية أمن.
- العناوين والوصف ليست دائماً localized، وOpenGraph/Twitter محدودة.
- صفحات الخصوصية والشروط والكوكيز والأمان/الثقة غير موجودة.

**الخطة:** noindex للمصادقة والإدارة والحساب/الدفع والاختبار، sitemap ديناميكي للعقارات المنشورة فقط، canonical وhreflang `ar/en/x-default`، metadata وصور OG ديناميكية، JSON-LD صالح للعقارات/المنظمة/breadcrumbs، 404/redirect audit، وربط Search Console. لا تنشر PII أو أسعار/عقود خاصة في structured data.

## 11. Accessibility والواجهة

لا توجد اختبارات axe أو Lighthouse gates. البحث الساكن وجد استعمالاً واسعاً لـ`onClick` و`img` الخام، مع `aria-label` أقل بكثير، إضافة إلى أخطاء hooks/lint. بعض `alt=""` زخرفي صحيح، لذلك لا يعد كل ظهور خطأ.

الأولوية: semantic buttons/links، labels وأخطاء مرتبطة بالحقول، تنقل كامل بلوحة المفاتيح، focus trap/restore في dialogs، skip link، live regions للتحديثات، contrast، target size، reduced motion، RTL، وتعريب رسائل الخطأ. أضف `eslint-plugin-jsx-a11y` وaxe داخل Playwright للصفحات العامة والتدفقات الحرجة، ثم مراجعة يدوية بـNVDA/VoiceOver.

## 12. CI/CD وDocker والهجرات والإصدار

يوجد workflow جيد كبداية يشغل Postgres 16، migrations، seed، الوحدة، البناء وE2E. لكن يجب فصل مراحل النظام:

- **PR:** format/lint، TypeScript، unit، integration مع Postgres، Playwright حرجة، audit/SAST/secret scan، migrations dry-run، bundle/accessibility budgets.
- **Build:** artifact/container immutable فقط؛ لا يتصل بقاعدة بيانات ولا يشغل migration.
- **Release:** backup/PITR check، `prisma migrate deploy` مرة واحدة بقفل وapproval، smoke tests، ثم promote/canary.
- **Rollback:** rollback للكود، وforward-fix للهجرة بنمط expand/contract؛ لا تعتمد down migration مدمرة.
- **Docker:** multi-stage، user غير root، image minimal مثبتة digest، read-only FS، health/readiness، init مناسب، لا أسرار داخل layer، وفحص Trivy/SBOM/signing.
- **الإصدار:** tags وchangelog وrelease notes وmigration notes وfeature flags وخطة رجوع، مع حماية branch ومراجعتين للتغييرات الأمنية/المالية.

يجب تعديل `package.json`: يصبح `build = prisma generate && next build` فقط، وتنتقل الهجرة إلى release job منفصل. كما يجب تحديث وثيقة النشر التي تقول إن البناء لا يهاجر بينما الأمر الحالي يفعل العكس.

## 13. إعادة التنظيم دون كسر النظام

النهج المقترح Strangler وليس big-bang:

1. كتابة characterization tests حول السلوك الحالي قبل نقل أي وحدة.
2. تعريف حدود domains: Identity/Access، Tenant، Properties، Bookings/Contracts، Accounting، Payments، Files، Archive.
3. إبقاء route handlers رفيعة: validate → authorize → service → DTO.
4. منع UI من استدعاء localStorage/KV/Prisma مباشرة؛ كل domain له repository/interface ومصدر حقيقة واحد.
5. البدء بالمدفوعات والهوية والعزل، ثم الملفات، ثم العقود/الحجوزات، ثم المحاسبة والتقارير.
6. تشغيل القديم والجديد خلف feature flag، مع shadow read/compare وtelemetry، ثم إزالة القديم عندما تتطابق النتائج.
7. تقسيم أكبر ملفات الواجهة إلى page shell وserver data وclient widgets وforms/schemas.

## 14. Country Packs والتوسع الدولي

حالياً تتكرر `OMR` و`ر.ع` و`ar-OM/en-GB` في مئات المواضع. يلزم abstraction مبكر قبل إضافة دولة ثانية:

```ts
interface CountryPack {
  country: 'OM';
  locales: string[];
  currency: { code: 'OMR'; minorUnits: 3 };
  tax: TaxRules;
  invoiceNumbering: NumberingPolicy;
  address: AddressSchema;
  phone: PhoneRules;
  holidays: HolidayCalendar;
  paymentProviders: string[];
  legalTemplateSet: string;
}
```

يجب أن تكون قيمة المال `Money { amount: Decimal; currency: ISO4217 }`، مع CLDR/Intl للتنسيق لا نصوص ثابتة، وفحص missing/unused translations في CI. ابدأ بحزمة عُمان، ثم اختبر دولة تختلف في VAT وعدد المنازل العشرية قبل تعميم النموذج.

## 15. التوثيق وThreat Model وRunbooks

المطلوب كتابته وتحديثه:

- C4 context/container/component ومخطط تدفق بيانات PII/مال/ملفات.
- Threat Model بأسلوب STRIDE وحدود الثقة: المتصفح، Next، DB، Blob، Redis، البريد، بوابات الدفع، callbacks، الإدارة.
- تصنيف البيانات والاحتفاظ والحذف وlegal hold وDPA/subprocessors.
- Runbooks: حادث أسرار/PII، webhook متوقف، دفع مزدوج، تسوية مالية، key rotation، account takeover، restore/PITR، migration فاشلة، provider outage، S3/Blob malware، rollback.
- SLO/SLI وإنذارات: login abuse، webhook lag/failure، duplicate payment constraint، journal imbalance، cross-tenant denial، encryption fallback، queue age، DB saturation.
- ADRs للقرارات الأمنية والمالية، وRACI ومراجعة صلاحيات ربع سنوية.
- مزامنة README الأرشفة مع التطبيق الفعلي؛ لا تُذكر اختبارات أو قدرات غير موجودة.

## 16. خارطة طريق الإصلاح المقترحة

### المرحلة 0 — خلال 24–72 ساعة

- تعطيل أي دفع إنتاجي حتى توقيع webhooks وidempotency والتحقق من المبلغ/العملة/الطلب.
- إزالة backdoor seed، تدوير حساب المدير/PIN والجلسات، والبحث عن تشغيل سابق للـseed.
- فتح incident لملف `dev.db` والتحقق القانوني والتقني، ثم إزالة من HEAD/history بخطة منسقة.
- تحديث Next/NextAuth والحزم ذات التنبيهات الحرجة/العالية، وتشغيل smoke tests.
- تعطيل HTML templates غير المنقحة أو قصرها على نص آمن حتى إصلاح XSS.
- جعل المرفقات الخاصة غير عامة، ومنع SVG مؤقتاً.

### المرحلة 1 — أسبوعان

- webhook signature + event/payment unique + transaction/outbox + اختبارات concurrency.
- سياسة authorization مركزية وroute manifest، وسد كل مسار غير مصنف.
- share tokens محدودة بدلاً من bookingId، وتصغير DTO.
- reset/change password وsessionVersion وإبطال الجلسات.
- secure logger/redactor واختبارات regression.
- Origin/CSRF/Fetch Metadata وTOTP مشدد.
- CI gates لـlint/tsc/unit/integration/audit/secrets؛ إصلاح أخطاء TypeScript الحالية.

### المرحلة 2 — 3 إلى 6 أسابيع

- tenantId/backfill/compound indexes/RLS واختبارات مستأجرين A/B.
- Decimal migration وserial constraints وتسوية مالية.
- envelope encryption v2 وفصل المفاتيح والتدوير التدريجي.
- private file service وفحص MIME/malware/authorization.
- CSP nonce/Trusted Types على مرحلتين Report-Only ثم Enforce.
- فصل build عن migration وإعداد release/rollback وDocker.

### المرحلة 3 — 6 إلى 12 أسبوعاً

- تفكيك المكونات والخدمات الضخمة خلف feature flags.
- تحويل الصفحات إلى Server Components وتقسيم bundles والتخزين المؤقت والفهارس.
- إصلاح الأرشيف state machine وrestore فعلي واختبارات فساد/تكرار.
- Accessibility وSEO وصفحات الخصوصية/الشروط/الثقة بعد مراجعة قانونية.
- Country Pack لعُمان وتجربة دولة ثانية.
- Threat Model وrunbooks وتمارين restore/incident/tabletop.

## 17. بوابات قبول تمنع إغلاق المشكلات شكلياً

لا يعتبر الإصلاح منتهياً حتى ينجح ما يلي:

- صفر critical/high مقبول بلا استثناء موثق وموعد انتهاء.
- كل route مصنف وله اختبار anonymous/role/tenant.
- 100 طلب webhook متوازٍ ينتج Payment وقيداً واحداً فقط.
- مجموع debit يساوي credit في DB، وكل serial فريد داخل tenant والسنة والنوع.
- اختبارات XSS لا تنفذ JavaScript في preview/print/PDF.
- اختبارات redaction لا تجد السر الأصلي في logs/audit/Sentry.
- مستأجر A لا يستطيع قراءة/تعديل/تصدير/تنزيل أي مورد لـB.
- تغيير كلمة المرور/الدور/التعطيل يبطل كل الجلسات القديمة ضمن زمن محدد.
- تدوير مفتاح تجريبي يقرأ القديم ويكتب الجديد ويكمل backfill ويمكن الرجوع بأمان.
- restore قاعدة البيانات والأرشيف مجرّب، لا موثق فقط.
- budgets للأداء والوصولية والبناء لا تتراجع في CI.

## 18. القيود والقرارات التي تحتاج المالك

أتفق مع القيود المذكورة في الطلب: لا يمكن من مراجعة المستودع وحدها تدوير مفاتيح الدفع الحقيقية أو حذف سجلات إنتاج، تعديل Vercel/Render/Neon/DNS/Redis/S3/Sentry والبريد، اعتماد سياسات قانونية، منح شهادات، أو ضمان انعدام الثغرات 100%. كما لا ينبغي إجراء اختبار اختراق إنتاجي بلا تفويض مكتوب وبيئة وحسابات متعددة وخطة تعامل مع البيانات.

القرارات المطلوبة من المالك قبل التنفيذ الإنتاجي:

1. هل `dev.db` يحتوي بيانات حقيقية، ومن هو مسؤول الحادث والخصوصية؟
2. ما نموذج tenancy الرسمي: مؤسسة واحدة أم SaaS متعدد الشركات؟
3. ما بوابات الدفع الفعلية، وكيف توفر مفاتيح sandbox وتوثيق توقيع webhooks؟
4. ما سياسة الاحتفاظ والخصوصية والدول المستهدفة ومرجعية العملة/الضريبة؟
5. ما أهداف الأداء وSLO والميزانية التشغيلية للـDB/cache/queues/CDN؟

## 19. الحكم النهائي

**التقييم الهندسي:** قاعدة وظيفية واسعة وحديثة، لكنها تحمل ديناً تقنياً واضحاً بسبب النظام الهجين والملفات الضخمة وتداخل الواجهة والتخزين والخدمات.  
**التقييم الأمني:** مخاطر غير مقبولة حالياً في seed والمدفوعات والعزل والطباعة والملفات والجلسات.  
**التقييم التشغيلي:** البناء يعمل، لكن quality gates والإصدار والهجرات والـDocker والاستعادة تحتاج إعادة تنظيم.  
**القرار المقترح:** لا توسع ولا دفع إنتاجي جديد قبل إكمال المرحلة 0 و1، ولا إعلان “multi-tenant secure” قبل إكمال عزل المرحلة 2 واختباراته السلبية.

هذا التقرير يثبت الحالة عند commit المحدد فقط؛ أي commit لاحق يحتاج delta review وإعادة الاختبارات.
