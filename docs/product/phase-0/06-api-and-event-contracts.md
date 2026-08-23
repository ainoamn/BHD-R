# عقود API والأحداث والدخول الموحد — BHD R

## 1. مبادئ API

- Base path: `/api/v1`.
- REST resource-oriented، بلا Endpoint واحد يحمل عشرات `action` values.
- OpenAPI 3.1 هو العقد المنشور والعميل يولد منه.
- Zod schemas مشتركة للحدود، وDomain types منفصلة عن DTOs.
- كل Mutation خاصة تحتاج Session + CSRF أو API Key موثق + Scope.
- كل عملية قابلة للتكرار مالياً/تشغيلياً تحتاج `Idempotency-Key`.
- لا يقبل `tenant_id`, `role`, `bhd_sub`, `created_by` من Body كمصدر موثوق.
- أخطاء موحدة ولا تحتوي stack أو provider payload.
- الترقيم يبدأ بـV1؛ التغيير الكاسر يحتاج إصداراً جديداً أو فترة توافق.

## 2. شكل النجاح والخطأ

### نجاح مفرد

```json
{
  "data": { "id": "...", "version": 3 },
  "meta": { "requestId": "..." }
}
```

### قائمة

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "meta": { "requestId": "..." }
}
```

### خطأ

```json
{
  "error": {
    "code": "UNIT_NOT_AVAILABLE",
    "message": "Localized safe message",
    "fieldErrors": [],
    "requestId": "..."
  }
}
```

لا يختلف `code` حسب اللغة؛ تتغير الرسالة فقط.

## 3. Concurrency وIdempotency

- `If-Match: "<version>"` أو version داخل DTO للتعديلات المتزامنة.
- Version خاطئ: `409 VERSION_CONFLICT`.
- `Idempotency-Key` UUID/random، مقيد بالمستخدم/المؤسسة/action.
- يخزن request hash والنتيجة الآمنة وstatus/expiry.
- Body مختلف مع المفتاح نفسه: `409 IDEMPOTENCY_CONFLICT`.
- مزود الدفع يحصل على المفتاح نفسه حيث يدعم.

## 4. Namespaces

### Public

```text
GET  /api/v1/public/listings
GET  /api/v1/public/listings/{publicId}
GET  /api/v1/public/locations
GET  /api/v1/public/availability/{publicId}
POST /api/v1/public/viewing-requests
POST /api/v1/public/lease-applications
GET  /api/v1/public/content/{pageKey}
```

`PublicListingDto` يسمح فقط بـ:

- public id وslug.
- title/description localized.
- property/unit type والخصائص العامة.
- الموقع العام وفق Privacy precision.
- السعر والعملة ودورة الإيجار.
- صور مشتقة مائية وalt text.
- availability العامة.
- amenities والسياسات العامة.

ويمنع:

- tenant/organization/user IDs.
- اسم/هاتف/بريد المالك الخاص.
- سندات وتفويضات وملاحظات داخلية.
- عقود/طلبات/أرصدة/بوابات/Storage keys.
- إحداثيات دقيقة إذا صنفت خاصة.

### Session وContext

```text
GET  /api/v1/me
GET  /api/v1/me/contexts
POST /api/v1/me/context
GET  /api/v1/me/sessions
POST /api/v1/me/sessions/revoke
```

### Platform

```text
GET/POST/PATCH /api/v1/platform/organizations
GET/PATCH      /api/v1/platform/users/{id}
GET/POST/PATCH /api/v1/platform/plans
GET/POST/PATCH /api/v1/platform/content
GET/PATCH      /api/v1/platform/listing-reviews
GET            /api/v1/platform/audit-events
GET/POST       /api/v1/platform/support-cases
POST           /api/v1/platform/support-cases/{id}/access-grants
```

### Organization/property

```text
GET/PATCH      /api/v1/organizations/{orgId}
GET/POST       /api/v1/organizations/{orgId}/members
PATCH/DELETE   /api/v1/organizations/{orgId}/members/{memberId}
GET/POST       /api/v1/organizations/{orgId}/properties
GET/PATCH      /api/v1/organizations/{orgId}/properties/{propertyId}
POST           /api/v1/organizations/{orgId}/properties/{propertyId}/archive
GET/POST       /api/v1/organizations/{orgId}/properties/{propertyId}/units
GET/PATCH      /api/v1/organizations/{orgId}/units/{unitId}
POST           /api/v1/organizations/{orgId}/units/imports
GET            /api/v1/organizations/{orgId}/imports/{jobId}
```

`orgId` في URL يجب أن يطابق Active context؛ وجوده لا يمنح الصلاحية.

### Media/documents

```text
POST /api/v1/media/upload-intents
POST /api/v1/media/{assetId}/complete
GET  /api/v1/media/{assetId}/status
PATCH /api/v1/media/{assetId}
DELETE /api/v1/media/{assetId}
POST /api/v1/documents/upload-intents
GET  /api/v1/documents/{id}/download-intent
```

الرفع مباشر إلى Quarantine عبر URL مقيد بالحجم والنوع، ثم complete يطابق checksum.

### Listing

```text
GET/POST  /api/v1/organizations/{orgId}/listings
GET/PATCH /api/v1/organizations/{orgId}/listings/{id}
POST      /api/v1/organizations/{orgId}/listings/{id}/submit
POST      /api/v1/organizations/{orgId}/listings/{id}/publish
POST      /api/v1/organizations/{orgId}/listings/{id}/pause
```

### Leasing

```text
GET/PATCH /api/v1/organizations/{orgId}/viewing-requests/{id}
GET/PATCH /api/v1/organizations/{orgId}/lease-applications/{id}
POST      /api/v1/organizations/{orgId}/lease-applications/{id}/holds
POST      /api/v1/organizations/{orgId}/holds/{id}/confirm
POST      /api/v1/organizations/{orgId}/reservations/{id}/cancel
GET/POST  /api/v1/organizations/{orgId}/leases
GET/PATCH /api/v1/organizations/{orgId}/leases/{id}
POST      /api/v1/organizations/{orgId}/leases/{id}/activate
POST      /api/v1/organizations/{orgId}/leases/{id}/terminate
```

### Contracts/signatures

```text
GET/POST  /api/v1/organizations/{orgId}/contract-templates
POST      /api/v1/organizations/{orgId}/leases/{id}/contract-versions
POST      /api/v1/organizations/{orgId}/contracts/{id}/approve
POST      /api/v1/organizations/{orgId}/contracts/{id}/signature-envelopes
GET       /api/v1/signatures/{token}/context
POST      /api/v1/signatures/{token}/challenge
POST      /api/v1/signatures/{token}/complete
POST      /api/v1/signatures/{token}/reject
GET       /api/v1/contracts/{id}/verification
```

Signature token لا يحتوي contract data ولا user id، ويخزن Hash ويرتبط بـparticipant وexpiry.

### Tenant portal

```text
GET  /api/v1/tenant/leases
GET  /api/v1/tenant/leases/{id}
GET  /api/v1/tenant/invoices
GET  /api/v1/tenant/payments
GET  /api/v1/tenant/documents/{id}/download-intent
GET/POST /api/v1/tenant/maintenance-requests
GET/POST /api/v1/tenant/maintenance-requests/{id}/messages
```

لا تستقبل هذه المسارات `orgId` من المستخدم؛ تبني الوصول من Grants.

### Finance/payments

```text
GET/POST /api/v1/organizations/{orgId}/invoices
POST     /api/v1/organizations/{orgId}/invoices/{id}/issue
POST     /api/v1/organizations/{orgId}/payment-attempts
GET      /api/v1/organizations/{orgId}/payments
POST     /api/v1/organizations/{orgId}/payments/{id}/refunds
POST     /api/v1/webhooks/payments/{provider}
```

Webhook يستخدم raw body ولا Session/CSRF، لكنه يحتاج signature verification وInbox durable قبل 2xx.

### Reports

```text
POST /api/v1/organizations/{orgId}/report-jobs
GET  /api/v1/organizations/{orgId}/report-jobs/{id}
POST /api/v1/organizations/{orgId}/report-jobs/{id}/download-intent
```

## 5. عقد BHD Identity

### التطبيق

| البند        | القيمة المقترحة                              |
| ------------ | -------------------------------------------- |
| Issuer       | `https://id.bhd-om.com`                      |
| Client ID    | `bhd-r`                                      |
| Origin       | `https://r.bhd-om.com`                       |
| Redirect URI | `https://r.bhd-om.com/api/auth/bhd/callback` |
| Post logout  | `https://r.bhd-om.com/`                      |
| Flow         | Authorization Code + PKCE S256               |
| Scopes       | `openid profile email`؛ phone عند دعم موثق   |
| Cookie       | Host-only + HttpOnly + Secure + SameSite=Lax |

### تحقق ID token

- algorithm allowlist `RS256/ES256` حسب discovery فقط.
- JWKS HTTPS، `kid`، cache/retry مضبوط.
- تحقق `iss`, `aud`, `exp`, `iat`, `nonce`, `sub`, `email_verified`.
- لا fallback إلى token غير موقع.
- مرحلة انتقال HS256 لا تعتمد للإطلاق العام، وإن وجدت في بيئة تكامل فتكون per-client secret واختبارات صريحة وموعد إزالة.

### ربط المستخدم

1. البحث بـ`bhd_sub`.
2. إن لم يوجد، الربط بالبريد الموثق مسموح فقط لسجل غير مرتبط وبعد قواعد collision.
3. أدوار المنتج لا تأتي من Claims.
4. callback يستبدل Session القديمة ولا يدمج مستخدمين.

### دعوة مستأجر

يتطلب Identity عقد خدمة داخلياً مثل:

```text
POST /internal/v1/product-invitations
```

بمصادقة workload/mTLS أو توقيع خدمة، ويقبل:

- product client id.
- normalized verified destination.
- requested username hint.
- locale.
- callback activation URI ثابت مسجل.
- opaque correlation id.

ولا يقبل Role منتج. يعيد `invitation_id`, `username`, `expires_at` فقط؛ raw activation secret يرسل عبر Identity channel أو يعاد مرة واحدة لخدمة إشعار موثوقة بلا logging.

## 6. Domain events

| الحدث                              | المنتج       | المستهلكون                                     | Idempotency key      |
| ---------------------------------- | ------------ | ---------------------------------------------- | -------------------- |
| `property.created.v1`              | Property     | audit، search                                  | event id             |
| `unit.availability_changed.v1`     | Availability | listing cache، sitemap، notifications          | aggregate version    |
| `listing.published.v1`             | Listing      | CDN invalidation، search                       | listing id + version |
| `hold.created.v1`                  | Leasing      | availability، notifications                    | hold id              |
| `hold.expired.v1`                  | Worker       | availability، listing                          | hold id + expiry     |
| `reservation.confirmed.v1`         | Leasing      | contract workflow                              | reservation id       |
| `contract.executed.v1`             | Contracts    | lease activation، document archive             | contract version id  |
| `lease.activated.v1`               | Lease        | tenant invitation، rent schedule، listing hide | lease id + version   |
| `identity.invitation_requested.v1` | Lease        | Identity adapter                               | lease party id       |
| `invoice.issued.v1`                | Finance      | PDF، notification                              | invoice id           |
| `payment.confirmed.v1`             | Payments     | allocation، receipt، reports                   | payment id           |
| `maintenance.created.v1`           | Maintenance  | notification/SLA                               | request id           |

كل Event envelope يحمل:

```json
{
  "id": "uuid",
  "type": "lease.activated.v1",
  "occurredAt": "ISO-8601",
  "tenantId": "uuid",
  "aggregate": { "type": "lease", "id": "uuid", "version": 4 },
  "correlationId": "uuid",
  "causationId": "uuid",
  "data": {}
}
```

لا يحمل Event سراً أو صورة هوية أو PDF أو نص عقد كامل.

## 7. Webhook response policy

- توقيع غير صحيح: 400/401 ولا معالجة.
- حدث صحيح جديد وحفظ durable: 2xx ثم معالجة async.
- Duplicate معروف: 2xx مع عدم تكرار.
- فشل تخزين مؤقت: 5xx ليعيد المزود.
- حدث غير مدعوم: يحفظ النوع والhash وفق السياسة ثم 2xx.
- Payload limits وtimeouts وrate limits مستقلة لكل مزود.

## 8. Versioning وDeprecation

- API version في path.
- Event version في النوع.
- DTO field additive لا يكسر العميل.
- Deprecation header ووثيقة موعد إزالة.
- Contract tests بين Web/API وIdentity/payment adapters في CI.
