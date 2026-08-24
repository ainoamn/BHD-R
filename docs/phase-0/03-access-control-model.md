# نموذج الوصول والصلاحيات — BHD R

## 1. الهدف

منع تكرار نموذج `user.role` الواحد أو الاعتماد على إخفاء عناصر الواجهة. كل طلب خاص يمر على خمس طبقات بالترتيب:

```text
Authentication → Active context → Tenant/Grant scope → Permission policy → Entitlement/business invariant
```

أي طبقة مفقودة تعني الرفض. Route جديد بلا Policy metadata يفشل اختبار Inventory في CI.

## 2. مكونات الهوية والوصول

### Identity

- `IdentityLink.bhd_sub` يثبت الشخص.
- لا كلمة مرور محلية للمستخدم النهائي.
- خصائص الملف من Identity لا تمنح دوراً داخل المنتج.

### Platform role

صلاحية تشغيل BHD R نفسه. لا تمنح تلقائياً وصولاً لبيانات كل مؤسسة. الوصول الداعم إلى مورد عميل يحتاج Support case وسبباً ومدة وAudit.

### Organization membership

يربط الشخص بمؤسسة مالك أو مطور ودور محلي. كل عضوية لها حالة ومدة ومَن منحها.

### Resource grant

وصول ضيق لطرف خارجي—مثل المستأجر—إلى Lease أو Document أو Maintenance request محدد، دون جعله عضواً في مؤسسة المالك.

### Entitlement

يحدد هل الميزة أو العدد مسموحان في الباقة، ولا يساوي Permission. المستخدم قد يملك Permission للإضافة، لكن الباقة تمنع تجاوز الحد.

## 3. الأدوار المختصرة في المصفوفة

| الرمز | الدور                                                       |
| ----- | ----------------------------------------------------------- |
| PUB   | زائر عام                                                    |
| PSA   | Platform Super Admin                                        |
| PA    | Platform Admin                                              |
| LM    | Listing Moderator                                           |
| SUP   | Support Agent                                               |
| PFO   | Platform Finance Operator                                   |
| SAUD  | Security Auditor                                            |
| CE    | Content Editor                                              |
| OA    | Owner Admin                                                 |
| PM    | Property Manager                                            |
| LA    | Leasing Agent                                               |
| FM    | Finance Manager                                             |
| MC    | Maintenance Coordinator                                     |
| OV    | Organization Viewer/Auditor                                 |
| DA    | Developer Admin                                             |
| DPM   | Developer Project Manager                                   |
| DIM   | Developer Inventory Manager                                 |
| DLA   | Developer Sales/Leasing Agent                               |
| DFV   | Developer Finance Viewer                                    |
| DRV   | Developer Report Viewer                                     |
| LGL   | Contract/Legal Reviewer داخل المؤسسة أو المنصة بحسب التكليف |
| TP    | Tenant Primary                                              |
| TR    | Tenant Representative                                       |
| OCV   | Occupant Viewer                                             |
| SYS   | Worker/Internal service identity                            |

## 4. رموز المصفوفة

| الرمز | المعنى                                    |
| ----- | ----------------------------------------- |
| A     | على مستوى المنصة وفق Policy إضافية        |
| O     | داخل المؤسسة النشطة فقط                   |
| R     | على الموارد المسندة للمستخدم داخل المؤسسة |
| G     | على مورد حصل عليه عبر ResourceGrant       |
| S     | على بياناته الشخصية فقط                   |
| C     | مشروط بباقة/Feature flag/اعتماد إضافي     |
| I     | عملية داخلية للخدمة وليست للمستخدم        |
| N     | مرفوض                                     |

القيمة `O+C` تعني أن الشرطين مطلوبان. المصفوفة Seed أولي لا بديل عن Resource context.

## 5. قواعد لا تعبر عنها الخانة وحدها

1. `PSA` لا يستخدم حسابه اليومي للتشغيل؛ يحتاج Step-up authentication.
2. `SUP` لا يقرأ مستندات الهوية أو أسرار الدفع؛ Support access مؤقت ومسبب.
3. `LM` يرى محتوى الإعلان ونسخ الصور العامة، لا سند الملكية أو عقد المستأجر.
4. `PFO` يرى اشتراك المنصة وتسوياتها، لا حسابات إيجار المؤسسة إلا بتفويض منفصل.
5. `OA/DA` لا يستطيعان رفع صلاحية عضو أعلى من صلاحياتهما أو تجاوز Entitlements.
6. `PM/DPM/DIM` قد تكون صلاحياتهم `R` على عقارات/مشاريع مختارة لا `O` دائماً.
7. `Tenant` يرى Snapshot العقد ومبالغه الخاصة؛ لا يرى تقارير الإشغال أو مالكاً آخر.
8. توقيع العقد Permission مرتبط بكون المستخدم Party مخولاً في Envelope، لا بالدور وحده.
9. التفعيل المالي والحذف/الاستعادة والتصدير الكبير تحتاج Reauthentication وربما Dual control.
10. API Key يخضع لنفس Tenant/Permission، وتكون Scopes أضيق من منشئه.

## 6. تنفيذ Policy

صيغة قرار السياسة:

```text
authorize(subject, action, resource, context) -> allow | deny(reason_code)
```

`context` يحتوي:

- `identity_sub`
- `active_context_id` و`tenant_id`
- platform role عند الحاجة
- membership role/status/version
- resource owner/assignment/grants
- plan entitlements وquota usage
- session assurance level وreauth age
- country pack وbusiness state

يستخدم API استعلامات scoped من البداية، ولا يجلب مورداً عالمياً ثم يفحصه بعد القراءة.

## 7. اختبارات القبول

- Inventory لكل Route وAction.
- Matrix آلية مشتقة من CSV.
- اختبارات عزل بمؤسستين على كل قراءة/كتابة/بحث/تصدير/ملف.
- تبديل IDs وslugs وstorage keys وjob ids.
- مستخدم متعدد السياقات مع تبديل متكرر.
- عضو معطل أثناء جلسة قائمة.
- ترقية/خفض الباقة أثناء عملية.
- Grant منتهي أو ملغى.
- API Key صحيح لمؤسسة خاطئة.
- Support access بلا Case أو بعد انتهاء مدته.
