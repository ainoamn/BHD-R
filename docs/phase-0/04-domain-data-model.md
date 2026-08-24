# نموذج المجال والبيانات — BHD R

## 1. مبادئ النموذج

1. PostgreSQL هو مصدر الحقيقة الوحيد.
2. كل أصل عقاري يملك وحدة واحدة على الأقل.
3. `Property` يصف الأصل المشترك، و`Unit` يصف الشيء القابل للتأجير.
4. التوافر ليس Boolean؛ ينتج من حالات وقيود زمنية.
5. كل صف تشغيلي خاص بمؤسسة يحمل `tenant_id` إلزامياً.
6. مشاركة المستأجر تتم بـ`ResourceGrant` لا بكسر Tenant scope.
7. المال BigInt minor units؛ FX والنسب Decimal.
8. العقود والفواتير المصدرة وإثباتات التوقيع Immutable.
9. الملفات في Object Storage؛ قاعدة البيانات تحفظ metadata وhash وclassification فقط.
10. الأحداث الخارجية والداخلية تمر عبر Inbox/Outbox لمنع الفقد والتكرار.

## 2. الهوية والمؤسسات والوصول

```mermaid
erDiagram
  IDENTITY_LINK ||--o{ PLATFORM_ROLE_ASSIGNMENT : has
  IDENTITY_LINK ||--o{ MEMBERSHIP : joins
  ORGANIZATION ||--o{ MEMBERSHIP : contains
  ORGANIZATION ||--|| SUBSCRIPTION : subscribes
  PLAN ||--o{ SUBSCRIPTION : selected_by
  PLAN ||--o{ PLAN_ENTITLEMENT : defines
  ORGANIZATION ||--o{ RESOURCE_GRANT : owns
  IDENTITY_LINK ||--o{ RESOURCE_GRANT : receives
  IDENTITY_LINK ||--o{ API_KEY : creates
  ORGANIZATION ||--o{ API_KEY : scopes
  IDENTITY_LINK ||--o{ IDENTITY_INVITATION : invited

  IDENTITY_LINK {
    uuid id PK
    uuid bhd_sub UK
    string email_snapshot
    string status
    datetime last_login_at
  }
  ORGANIZATION {
    uuid id PK
    uuid tenant_id UK
    string type
    string legal_name
    string country_code
    string status
  }
  MEMBERSHIP {
    uuid id PK
    uuid organization_id FK
    uuid identity_link_id FK
    string role_key
    string status
    int policy_version
  }
  RESOURCE_GRANT {
    uuid id PK
    uuid grantee_identity_id FK
    string resource_type
    uuid resource_id
    string permission_set
    datetime expires_at
  }
```

### قيود

- `bhd_sub` فريد وغير قابل لإعادة التعيين.
- عضوية فعالة واحدة لكل `(organization_id, identity_link_id, role_key)`.
- `tenant_id` لا يأتي من Body؛ يستخرج من Active context ويثبت في Transaction.
- Grant لا يملك صلاحيات أوسع من المورد المحدد، وله issuer وreason وexpiry/revoked_at.
- Entitlement limit يعد داخل Transaction أو Counter ذري.

## 3. العقار والوحدة والإعلان

```mermaid
erDiagram
  ORGANIZATION ||--o{ PROPERTY : owns_or_manages
  PROPERTY ||--|| ADDRESS : located_at
  PROPERTY ||--|{ UNIT : contains
  PROPERTY ||--o{ PROPERTY_PARTY : relates
  IDENTITY_LINK ||--o{ PROPERTY_PARTY : represents
  PROPERTY ||--o{ MEDIA_ASSET : has
  UNIT ||--o{ MEDIA_ASSET : has
  MEDIA_ASSET ||--o{ MEDIA_VARIANT : derives
  UNIT ||--o{ LISTING : advertised_as
  LISTING ||--o{ LISTING_TRANSLATION : translated
  LISTING ||--o{ PUBLICATION : published
  UNIT ||--o{ AVAILABILITY_BLOCK : blocked_by
  UNIT ||--o{ VIEWING_REQUEST : viewed
  UNIT ||--o{ LEASE_APPLICATION : applied_for

  PROPERTY {
    uuid id PK
    uuid tenant_id FK
    string public_id UK
    string structure_type
    string asset_type
    string lifecycle_status
    int version
  }
  UNIT {
    uuid id PK
    uuid property_id FK
    string unit_number
    string availability_status
    boolean marketing_enabled
    bigint asking_amount_minor
    string currency_code
    int version
  }
  LISTING {
    uuid id PK
    uuid unit_id FK
    string purpose
    string status
    datetime published_at
    datetime expires_at
  }
  AVAILABILITY_BLOCK {
    uuid id PK
    uuid unit_id FK
    string source_type
    uuid source_id
    datetime starts_at
    datetime ends_at
    string status
  }
```

### تمثيل الفردي والمتعدد

- `structure_type=SINGLE_UNIT`: قيد يضمن وحدة واحدة `is_primary=true`.
- `structure_type=MULTI_UNIT`: وحدة أو أكثر، ورقم الوحدة فريد داخل العقار عند وجوده.
- لا تخزن وحدات في JSON أو كمفاتيح `shop-0`.

### التوافر

يستخدم PostgreSQL range/exclusion constraint على `AvailabilityBlock(unit_id, tstzrange)` للحالات الفعالة. يمنع أي تداخل من نوع Hold/Reservation/Lease الذي لا يسمح به Policy.

`availability_status` Read model سريع يعاد حسابه Transactionally، لكنه لا يتغلب على قيد الفترات.

## 4. الحجز والعقد والتوقيع

```mermaid
erDiagram
  LEASE_APPLICATION ||--o| AVAILABILITY_HOLD : creates
  AVAILABILITY_HOLD ||--o| RESERVATION : confirms
  RESERVATION ||--o| LEASE : converts_to
  LEASE ||--|{ LEASE_PARTY : has
  LEASE ||--o{ CONTRACT_VERSION : documented_by
  CONTRACT_TEMPLATE ||--o{ CONTRACT_TEMPLATE_VERSION : versions
  CONTRACT_TEMPLATE_VERSION ||--o{ CONTRACT_VERSION : renders
  CONTRACT_VERSION ||--o{ SIGNATURE_ENVELOPE : signed_with
  SIGNATURE_ENVELOPE ||--|{ SIGNATURE_PARTICIPANT : requires
  SIGNATURE_PARTICIPANT ||--o{ SIGNATURE_EVIDENCE : proves
  CONTRACT_VERSION ||--o{ DOCUMENT : outputs
  LEASE ||--o{ RESOURCE_GRANT : shared_by

  LEASE {
    uuid id PK
    uuid tenant_id FK
    uuid unit_id FK
    string status
    date starts_on
    date ends_on
    string currency_code
    bigint rent_amount_minor
    int version
  }
  CONTRACT_VERSION {
    uuid id PK
    uuid lease_id FK
    int version_number
    json snapshot
    string pdf_sha256
    string status
  }
  SIGNATURE_ENVELOPE {
    uuid id PK
    uuid contract_version_id FK
    string status
    datetime expires_at
    string evidence_manifest_sha256
  }
  SIGNATURE_EVIDENCE {
    uuid id PK
    uuid participant_id FK
    string method
    string event_type
    datetime occurred_at
    string evidence_hash
  }
```

### قيود

- عقد واحد `ACTIVE` لكل وحدة وفترة متداخلة.
- `ContractVersion(status=EXECUTED)` لا يتغير؛ Amendment جديد فقط.
- Snapshot يحتوي البيانات القانونية وقت التوقيع، ولا يعتمد عرضه على Profile حي.
- OTP لا يخزن كنص، وله max attempts وexpiry وanti-replay.
- توقيع المالك لا يقبل إلا من Identity مخول في `LeaseParty` وقت التوقيع.

## 5. المال والتكامل والأحداث

```mermaid
erDiagram
  LEASE ||--|{ RENT_SCHEDULE_ITEM : schedules
  RENT_SCHEDULE_ITEM ||--o{ INVOICE_LINE : billed_as
  INVOICE ||--|{ INVOICE_LINE : contains
  INVOICE ||--o{ PAYMENT_ALLOCATION : settled_by
  PAYMENT ||--o{ PAYMENT_ALLOCATION : allocates
  PAYMENT_ATTEMPT ||--o| PAYMENT : produces
  PAYMENT_ATTEMPT ||--o{ WEBHOOK_EVENT : receives
  PAYMENT ||--o{ REFUND : refunded_by
  INVOICE ||--o{ DOCUMENT : renders
  OUTBOX_EVENT }o--|| ORGANIZATION : belongs_to
  WEBHOOK_EVENT ||--o{ JOB_RUN : processed_by

  INVOICE {
    uuid id PK
    uuid tenant_id FK
    string legal_number UK
    string status
    string currency_code
    bigint total_minor
    datetime issued_at
  }
  PAYMENT_ATTEMPT {
    uuid id PK
    uuid tenant_id FK
    string idempotency_key
    string request_hash
    string provider
    string provider_reference
    string status
  }
  WEBHOOK_EVENT {
    uuid id PK
    string provider
    string provider_event_id
    string payload_hash
    string signature_status
    string processing_status
  }
  OUTBOX_EVENT {
    uuid id PK
    uuid tenant_id FK
    string event_type
    string aggregate_type
    uuid aggregate_id
    datetime published_at
  }
```

### المال

- `amount_minor BIGINT` لكل مبلغ.
- Currency catalog يحدد `minor_units`.
- FX rates `NUMERIC(24,12)` مع مصدر ووقت.
- لا يسمح بجمع عملتين مختلفتين دون Conversion context صريح.
- Invoice counter ذري لكل `(legal_entity_id, fiscal_year, document_type)`.
- رقم ملغى لا يعاد استخدامه.

### Idempotency

- قيد فريد `(tenant_id, idempotency_key, action)`.
- نفس المفتاح ونفس request hash يعيد النتيجة.
- نفس المفتاح وBody مختلف يعيد `409 IDEMPOTENCY_CONFLICT`.
- Webhook unique على `(provider, provider_event_id)`، مع fallback payload hash وفق مزود.

## 6. الصيانة والمراسلات والتقارير

```mermaid
erDiagram
  LEASE ||--o{ MAINTENANCE_REQUEST : permits
  UNIT ||--o{ MAINTENANCE_REQUEST : concerns
  MAINTENANCE_REQUEST ||--o{ WORK_ORDER : creates
  MAINTENANCE_REQUEST ||--o{ THREAD_MESSAGE : discusses
  WORK_ORDER ||--o{ VENDOR_ASSIGNMENT : assigns
  MAINTENANCE_REQUEST ||--o{ DOCUMENT : attaches
  ORGANIZATION ||--o{ REPORT_JOB : requests
  REPORT_JOB ||--o| DOCUMENT : outputs
  IDENTITY_LINK ||--o{ NOTIFICATION : receives
```

## 7. الحقول المشتركة

كل جدول تشغيلي مناسب يحمل:

- `id UUIDv7/UUID`
- `tenant_id UUID`
- `created_at`, `created_by`
- `updated_at`, `updated_by`
- `version INT` للتفاؤل في التزامن
- `archived_at` عند الحاجة
- `country_pack_version` للكيانات القانونية

لا يوضع `deleted_at` عشوائياً على كل شيء؛ سياسة الحذف حسب نوع الكيان.

## 8. تصنيف البيانات

| التصنيف      | أمثلة                               | السياسة                              |
| ------------ | ----------------------------------- | ------------------------------------ |
| PUBLIC       | عنوان الإعلان العام، وصف، صور مائية | CDN وCache مسموح                     |
| INTERNAL     | حالات التشغيل، IDs داخلية           | جلسة وصلاحية                         |
| CONFIDENTIAL | عقود، مبالغ، مراسلات، تقارير        | تشفير ووصول مورد                     |
| RESTRICTED   | هوية، سند، IBAN، مفاتيح بوابة، TOTP | Purpose keys، Audit، وصول محدود جداً |

## 9. قواعد RLS الأولية

- مستخدم المؤسسة: `tenant_id = current_setting('app.tenant_id')::uuid` مع Membership فعالة.
- المستأجر: لا RLS على مؤسسة المالك مباشرة؛ View/Policy تربط `ResourceGrant` بالمورد.
- Platform operations: Service role منفصل، ويظل التطبيق يطبق Policy؛ لا يستخدم مفتاح bypass في الويب.
- Worker: Job يحمل tenant id وaggregate id وpolicy purpose؛ لا يقبل tenant id من payload خارجي بلا تحقق.

## 10. Queries وفهارس حرجة

- `units(tenant_id, property_id, availability_status)`.
- `listings(status, published_at)` مع partial index لـ`PUBLISHED`.
- `properties(tenant_id, lifecycle_status, address_id)`.
- `availability_blocks(unit_id, period)` GiST.
- `leases(tenant_id, unit_id, status, starts_on, ends_on)`.
- `memberships(identity_link_id, status, organization_id)`.
- `resource_grants(grantee_identity_id, resource_type, resource_id, revoked_at)`.
- `invoices(tenant_id, status, due_at)`.
- `webhook_events(provider, provider_event_id)` unique.
- `outbox_events(published_at, created_at)` partial على غير المنشور.

الفهرس لا يعتمد قبل `EXPLAIN ANALYZE` على حجم ممثل.
