# الضوابط الأمنية

## مبادئ ملزمة

- deny by default، وأقل صلاحية، وفصل واجبات المالية والتدقيق والإدارة.
- لا يكفي إخفاء الزر؛ كل API يمر بـ authentication ثم organization context ثم permission/resource grant.
- RLS وقيود قاعدة البيانات دفاع ثانٍ، وليست بديلاً عن authorization في التطبيق.
- الأسرار من Secret Manager في الإنتاج؛ لا تُحفظ في Git أو log أو audit payload.
- كل إصلاح أمني له regression test يُظهر أن الاستغلال القديم مرفوض.

## خريطة المتطلبات والتنفيذ

| الخطر                       | الضابط                                                                           | الإثبات المطلوب                                                |
| --------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| تسرب الأسرار في audit/logs  | redaction مركزي وقائمة حقول حساسة، عدم تسجيل body الخام                          | اختبارات logger/audit بأسرار وهمية وgitleaks                   |
| تجاوز صلاحيات API           | Guard مركزي + permission registry + resource grants                              | contract test يمر على كل route واختبار cross-tenant            |
| XSS في الفواتير/POS/المطعم  | sanitization allowlist، تعطيل JS والشبكة في Chromium، CSP                        | payloads لـ script/event/svg/img/URL وإثبات غيابها من HTML/PDF |
| تكرار الدفعات وسباق webhook | idempotency table وunique provider event وtransaction/locks                      | concurrent integration tests وreplay test                      |
| روابط فواتير عامة           | opaque one-time token hash، expiry، fields minimization، noindex                 | snapshot لحقول الرد واختبار token منتهي                        |
| SSRF في بوابة الدفع         | لا URL حر؛ registry للمزود، HTTPS، DNS/IP validation، منع redirect               | اختبارات loopback/private/link-local وDNS rebinding            |
| تغيير/استعادة كلمة المرور   | داخل BHD Identity، re-auth وsingle-use token وإبطال الجلسات                      | اختبار reuse/expiry/session revocation                         |
| CSRF/TOTP/API keys          | synchronizer token، SameSite، step-up، TOTP replay prevention، key hashes/scopes | browser test وtime-step replay وscope matrix                   |
| التشفير والتدوير            | envelope encryption، key purpose/version، dual-read/single-write                 | fixture قديم يقرأ ويعاد تشفيره بإصدار جديد                     |
| ترقيم الفواتير              | sequence/row lock لكل مؤسسة وسنة، لا `max+1`                                     | 50 إصداراً متزامناً بلا تكرار                                  |
| الحسابات المالية            | PostgreSQL NUMERIC وDecimal domain؛ rounding وفق العملة                          | property-based totals/tax/allocation tests                     |
| عزل المؤسسات                | org context غير قابل لتجاوز العميل + RLS + composite FKs                         | suite بمؤسستين لكل مورد حساس                                   |
| المرفقات                    | presigned upload قصير، magic bytes، حد bytes/pixels، ClamAV، quarantine          | MIME confusion, malware fixture وoversize tests                |

## الجلسات والاستعادة

الجلسة قصيرة مع refresh rotation واكتشاف reuse. تغيير كلمة المرور، استعادة الحساب، تعطيل المستخدم، تغيير الدور الحساس أو الاشتباه الأمني يزيد `session_version` ويلغي الجلسات القديمة. العمليات المالية، تنزيل وثيقة شديدة الحساسية، تغيير MFA والمفاتيح تحتاج re-auth حديثاً.

TOTP: secret مشفر بمفتاح مستقل، نافذة ±1 فقط، رفض إعادة نفس time-step، recovery codes hashed واستخدام أحادي، وتدقيق تشغيل/تعطيل العامل. لا تعرض seed بعد الإعداد.

## التشفير

كل ciphertext envelope يحمل `algorithm`, `keyPurpose`, `keyVersion`, `nonce`, `ciphertext`, `tag`. استخدم AEAD مثل AES-256-GCM. مفاتيح الجلسة، PII، TOTP، webhook ونسخ الاحتياطي منفصلة. القراءة تدعم الإصدارات الحالية والسابقة؛ الكتابة تستخدم active version فقط. التدوير job مراقب، قابل للاستئناف، لا يحذف المفتاح القديم قبل قياس صفر سجلات تعتمد عليه ومرور فترة الرجوع.

## HTTP والمتصفح

- CSP nonce/hash، ولا `unsafe-inline` للسكريبت.
- HSTS بعد التحقق من HTTPS لكل subdomains، `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, سياسة Permissions-Policy محدودة.
- CORS allowlist دقيق؛ لا wildcard مع credentials.
- كل المخرجات HTML encoded حسب السياق. لا `dangerouslySetInnerHTML` إلا renderer موثوق ومطهر.

## إدارة الثغرات

Dependabot أسبوعي، `pnpm audit`, CodeQL, Trivy, gitleaks وSBOM في CI. التنبيه Critical أو exploit معروف يوقف الإصدار، يملك SLA إصلاح واضح، ويوثق الاستثناء بمالك وتاريخ انتهاء. اختبار اختراق مستقل مطلوب قبل الإطلاق العام وبعد تغيير جذري في الدفع/الهوية؛ لا يمكن لأي فحص آلي ضمان انعدام الثغرات.
