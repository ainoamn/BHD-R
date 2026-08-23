# استراتيجية الاختبارات

## الهرم

- Unit: Money/Decimal، availability state machine، permissions، sanitizers وredaction.
- Backend integration: PostgreSQL/PostGIS حقيقي، transactions/locks/RLS والمigrations.
- API contract: schema، error shape، auth/CSRF/idempotency لكل route.
- Frontend component: RTL/LTR، forms، keyboard/focus، loading/error/empty states.
- E2E: الموقع العام واللوحات الأربع، OIDC test provider، العقار→وحدة→عقد→فاتورة→دفعة→صيانة.
- Security regression: exploit payloads محفوظة كـfixtures غير ضارة.
- Accessibility: axe + keyboard + screen reader spot checks.
- Performance: Lighthouse CI وquery benchmarks وload tests قبل الإطلاق.

## Matrix عزل المؤسسات

لكل مورد: org A owner يسمح، org A role ناقص يرفض، org B role مماثل يرفض، anonymous يرفض، platform role يحتاج permission صريحة وسبباً مدققاً. نفذ الاختبار عبر HTTP وليس repository فقط، ثم RLS test عبر SQL role محدود.

## Concurrency المالية

- 50 طلب إصدار فواتير متزامنة لنفس namespace: أرقام فريدة/مرتبة بلا `max+1`.
- 20 webhook بالـevent نفسه: payment/allocation واحد.
- Idempotency key نفسه/payload نفسه: نفس الرد؛ payload مختلف: 409.
- hold متزامن على وحدة: فائز واحد والبقية `UNIT_NOT_AVAILABLE`.
- مجموع line items/discount/tax/allocations يظل exact عبر property-based amounts والعملات 2/3 minor units.

## Fixtures الأمان

XSS (`script`, handlers, SVG, CSS URL)، SSRF (localhost, RFC1918, link-local metadata, IPv6, redirect وDNS rebind)، MIME confusion/oversize/decompression، CSRF missing/mismatch، TOTP replay، API key revoked/wrong scope، public invoice expired/field snapshot، log redaction لأسماء الحقول المتداخلة.

## بوابة الدمج

format, lint, strict typecheck, tests/coverage, build، migration repeatability، E2E، CodeQL/Trivy/gitleaks/audit وصور Docker. لا تجعل الاختبار يعتمد على production أو خدمة خارجية متغيرة؛ استخدم test adapters وحاويات pinned.

التغطية رقم مساعد لا هدف وحيد. المجالات الحرجة تتطلب branch/path assertions حتى لو تجاوز المشروع النسبة العامة.
