# نظرة API

جميع المسارات تحت `/v1`. الردود JSON وUTF-8. التاريخ ISO-8601 UTC، والمبالغ نصوص decimal مع رمز العملة.

## سياق الطلب

- جلسة المتصفح في Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
- عمليات التغيير تحتاج CSRF token مرتبطاً بالجلسة.
- API keys للخوادم فقط، مخزنة hash ومقيدة scopes وIP/وقت عند الإمكان.
- `X-Correlation-Id` يُقبل إذا كان UUID؛ وإلا يولد الخادم واحداً.
- المؤسسة الفعالة تأتي من جلسة موثوقة/عضوية، لا من body يرسله العميل.

## شكل الخطأ

```json
{
  "error": {
    "code": "UNIT_NOT_AVAILABLE",
    "message": "The unit is not available",
    "correlationId": "5c9ad5b8-9e91-48bb-97cc-836ea6de3bb3",
    "details": []
  }
}
```

لا تعرض stack traces أو SQL أو أسرار أو معلومات وجود مورد من مؤسسة أخرى. الطلب بين مؤسستين يعاد كـ `404` عند الحاجة لمنع enumeration.

## Idempotency

يلزم `Idempotency-Key` في إنشاء/تحصيل/رد دفعة، إصدار فاتورة، إنشاء hold والتوقيع. المفتاح:

- عشوائي 128-bit على الأقل، حد أقصى 200 حرف.
- نطاقه `(organization, actor, route)`.
- يُخزن مع hash للطلب والرد 24–72 ساعة حسب العملية.
- إعادة المفتاح مع payload مختلف تعيد `409 IDEMPOTENCY_CONFLICT`.
- concurrent insert يحسمه unique constraint؛ الطلب الخاسر ينتظر النتيجة أو يعيد `409 IN_PROGRESS`.

## Webhooks

1. قراءة raw body قبل JSON parsing.
2. التحقق من timestamp والتوقيع constant-time ومنع replay window.
3. whitelist لمصدر المزود عندما تكون عناوينه ثابتة، من دون الاعتماد عليها وحدها.
4. إدخال `(provider, external_event_id)` في unique constraint قبل أي أثر مالي.
5. الرد 2xx سريعاً بعد الحفظ، ثم المعالجة async.
6. الانتقال المالي monotonic؛ event متأخر لا يعكس `succeeded` إلى `pending`.
7. reconciliation مجدول يقارن المزود بالسجل الداخلي.

## أهم الموارد

| المجال   | أمثلة المسارات                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------- |
| الهوية   | `/auth/login`, `/auth/callback`, `/auth/logout`, `/me`, `/sessions`                                 |
| العقارات | `/properties`, `/properties/:id`, `/properties/:id/units`, `/media/upload-intents`                  |
| السوق    | `/public/listings`, `/public/listings/:slug`, `/units/:id/holds`                                    |
| الحجوزات | `/leasing/holds`, `/leasing/reservations`, `/operations/viewings`                                   |
| العقود   | `/leasing/contracts`, `/leasing/contracts/:id/signatures`, `/leasing/leases`                        |
| المالية  | `/finance/invoices`, `/finance/payments`, `/payment-webhooks/:provider`                             |
| المحاسبة | `/accounting/accounts`, `/accounting/journals`, `/accounting/trial-balance`, `/accounting/expenses` |
| التشغيل  | `/operations/requests`, `/operations/tasks`, `/operations/approvals`                                |
| البيع    | `/operations/sales`, `/operations/sales/totals`                                                     |
| الصيانة  | `/maintenance`, `/operations/work-orders`, `/operations/vendors`                                    |
| المحاماة | `/operations/legal-cases`, `/operations/legal-cases/:id/events`                                     |
| التقارير | `/reports`, `/reports/operational-summary`, `/reports/:id/download`                                 |
| المنصة   | `/platform/organizations`, `/plans`, `/entitlements`, `/cms`                                        |

## Pagination وcache

قوائم الإدارة cursor-based: `?limit=50&after=...` بحد أقصى 100. الموقع العام يدعم CDN عبر ETag و`stale-while-revalidate`; الصفحات الخاصة والروابط الموقعة `private, no-store`. لا تدخل `organization_id` أو PII في cache key عام.
