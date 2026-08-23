# نموذج التهديد

## النطاق والأصول

الأصول الأعلى حساسية: هوية المستخدم وجلساته، بيانات المستأجر والعقد، صور الوثائق، مفاتيح الدفع، ledger والفواتير، توقيع العقد وأدلته، بيانات الشركات، مفاتيح التشفير والنسخ الاحتياطية.

المهاجمون المفترضون: مستخدم عادي يحاول تجاوز مؤسسته، مشرف مفوض بصلاحية محدودة، مستأجر خبيث، طرف خارجي غير مسجل، حساب مسروق، webhook مزور، ملف خبيث، موظف تشغيلي فضولي، واعتمادية برمجية مخترقة.

## حدود الثقة

1. الإنترنت ↔ CDN/WAF.
2. المتصفح ↔ Web/API؛ كل input غير موثوق.
3. API ↔ BHD Identity وبوابة الدفع والبريد.
4. API/Worker ↔ PostgreSQL وRedis وS3.
5. private bucket ↔ public derived bucket.
6. CI ↔ registry/production؛ صلاحيات CI ليست صلاحيات runtime.

## STRIDE مختصر

| الفئة                  | سيناريو                            | التخفيف                                                                 |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Spoofing               | سرقة جلسة أو callback OIDC مزور    | PKCE، state/nonce، issuer/audience/JWKS، cookies آمنة، session rotation |
| Tampering              | تعديل مبلغ أو حالة webhook         | توقيع raw body، idempotency، state machine وledger immutable            |
| Repudiation            | إنكار توقيع عقد                    | evidence envelope، hash للنسخة، UTC، actor/session وaudit append-only   |
| Information disclosure | IDOR بين شركتين أو رابط فاتورة غني | authz مركزي، RLS، opaque token، field minimization وno-store            |
| Denial of service      | صور ضخمة/PDF متكرر/بحث مكلف        | limits، pixel cap، queues، concurrency، rate limits وstatement timeout  |
| Elevation of privilege | owner يكتسب platform admin         | فصل namespaces والأدوار، deny default، step-up وapproval حساس           |

## مسارات إساءة ذات أولوية

### Cross-tenant IDOR

المهاجم يبدل UUID لعقار أو فاتورة. لا تُحمّل repository المورد بالمعرف وحده؛ يجب أن يكون المفتاح `(organization_id, id)`. بعدها guard يفحص permission/resource grant، وRLS يعيد المنع إذا أخطأ التطبيق.

### Payment replay/race

يرسل المهاجم الحدث نفسه أو حدثين متزامنين. unique `(provider, external_event_id)` يحسم مرة واحدة. تحديث invoice allocation داخل transaction، ومجموع allocation لا يتجاوز payment/invoice بواسطة قيود وفحص Decimal.

### SSRF

لا تحفظ base URL بوابة قابلاً للتعديل من لوحة المستخدم. platform adapter يختار endpoint من code/config allowlist. إن وجدت تكاملات webhook صادرة: HTTPS فقط، resolve DNS ثم منع loopback/private/link-local/metadata IPv4 وIPv6، تثبيت عنوان الاتصال مع تحقق Host/TLS، تعطيل redirects وإعادة التحقق عند كل محاولة.

### Stored XSS إلى PDF

بيانات المستأجر/العقار قد تحتوي HTML. renderer يقبل fragment محدوداً، يحذف script/style/svg/img/link/event handlers، يشغل Chromium بلا JavaScript، ويقطع كل network request. PDF يخزن خاصاً مع SHA-256.

### Malicious upload

الامتداد وContent-Type غير موثوقين. worker يفحص magic bytes والحجم والـpixels، يمرر الأصل إلى ClamAV، يحجر المصاب، ثم يعيد encode الصورة بـSharp من دون EXIF. لا يصل الأصل الخاص إلى CDN.

## مخاطر متبقية

- اعتماد قانونية التوقيع وسياسات الخصوصية يحتاج مراجعة قانونية عمانية/خليجية.
- بوابة الدفع وBHD Identity حدود خارجية؛ outages وcompromise جزئي محتملان ويحتاجان reconciliation وrevocation.
- ClamAV يقلل الخطر ولا يثبت سلامة الملف قطعياً.
- insiders ذوو الصلاحيات العالية يحتاجون مراجعة دورية، فصل واجبات وتنبيه سلوكي.

يُراجع النموذج كل ستة أشهر وقبل تغيير الهوية، الدفع، public sharing أو تخزين نوع جديد من البيانات.
