# المتطلبات غير الوظيفية وبوابات الإطلاق — BHD R

## 1. الأداء

| المؤشر | هدف V1 |
|---|---:|
| Mobile p75 LCP للعام | `< 2.0s` |
| p75 INP | `< 200ms` |
| CLS | `< 0.10` |
| Cached TTFB | `< 300ms` |
| p95 API read شائع | `< 500ms` داخل المنطقة المستهدفة |
| p95 API mutation غير async | `< 800ms` باستثناء الطرف الخارجي |
| Initial JS للصفحات العامة | هدف `100–150KB gzip` |
| صور الغلاف | responsive variant + أبعاد ثابتة + lazy load لما بعد الأولى |

Budgets تفشل CI على Routes الحرجة إذا تجاوزت الحد المعتمد بعد Baseline.

## 2. الاعتمادية

- SLO مبدئي API/Web للرحلات الحرجة: 99.9% شهرياً.
- Queue jobs: at-least-once transport مع idempotent consumers.
- لا Event أعمال مهم من دون Transactional Outbox.
- Health endpoints منفصلة: liveness وreadiness وdependency diagnostics محمية.
- Timeout/retry/circuit breaker لكل Adapter؛ retry فقط للأخطاء المؤقتة وبـjitter.
- Degraded modes معلنة: تعطل الدفع لا يمنع قراءة العقد؛ تعطل الصور لا يمنح نشر ملف غير مفحوص.

## 3. النسخ والاستعادة

- RPO مبدئي: 15 دقيقة.
- RTO مبدئي: 4 ساعات.
- PITR لقاعدة الإنتاج حيث يدعم المزود.
- Object versioning/retention للمستندات الحرجة.
- نسخ مشفرة بمفاتيح مستقلة عن التطبيق.
- Restore drill إلى بيئة معزولة قبل Pilot ثم دورياً.
- مطابقة counts/sums/checksums والعقود/الفواتير بعد الاستعادة.

## 4. الأمان

- TLS فقط وHSTS بعد استقرار النطاق.
- CSP nonce-based بلا `unsafe-eval`، وتقليل `unsafe-inline` إلى صفر للـscript.
- Cookies Host-only وSecure وHttpOnly.
- CSRF لكل Cookie-authenticated mutation.
- TOTP/WebAuthn للإدارة الحساسة.
- RLS واختبارات tenant isolation.
- KMS/envelope encryption وفصل أغراض المفاتيح.
- SAST/SCA/secret/container/IaC scans وSBOM.
- Audit منقح وappend-only للأحداث الحساسة.
- Penetration test مستقل قبل الإطلاق العام.

## 5. الخصوصية

- Data inventory وclassification وpurpose لكل حقل حساس.
- Data minimization في Public DTO وanalytics/logs.
- Retention matrix قابلة للإصدار حسب Country Pack.
- Subject export/delete/restrict workflow.
- Consent/notice للاتصالات والتحليلات غير الضرورية.
- DPA وقائمة subprocessors قبل الإنتاج.
- لا تستخدم بيانات العملاء لتدريب AI افتراضياً.

## 6. Accessibility

- WCAG 2.2 AA للرحلات الأساسية.
- Keyboard-only وfocus visible وskip links.
- أسماء Accessible للأزرار والحقول والأيقونات.
- Errors مرتبطة بالحقول و`aria-live` بحذر.
- Contrast واختبار zoom 200% وreflow 320px.
- RTL/LTR بلا ترتيب بصري يخالف DOM.
- PDF مقروء قدر الإمكان وعقود بديل HTML متاح للمستخدم المخول.

## 7. الترجمة والتوطين

- ar/en coverage 100% للواجهة الحرجة.
- CI يمنع missing keys وHardcoded UI strings المحددة بالlint.
- Arabic first وserver-rendered `lang/dir`.
- Country Pack version مثبت على العقد والفاتورة.
- التواريخ والأرقام والعملات تستخدم Intl + domain rules.

## 8. SEO

- Canonical وhreflang وlocalized metadata.
- Sitemap للعامة المنشور فقط.
- noindex للوحة والعقد والمشاركة والغير متاح طويل المدة.
- Structured data يمر serialization آمن واختبار validator.
- Redirect map للروابط القديمة.
- لا صفحات Programmatic thin content.

## 9. القابلية للصيانة

- TypeScript strict ولا `skip typecheck` في build gate.
- حدود Modules واختبارات Architecture تمنع imports عكسية.
- حجم ملف/تعقيد thresholds مع استثناء موثق.
- ADR لكل قرار واسع الأثر.
- OpenAPI وSchema migrations versioned.
- Docs version report مولد من manifests لتجنب تقادم README.
- Feature flags لها owner وexpiry؛ لا flags دائمة مجهولة.

## 10. الرصد

- Correlation/request/event IDs.
- Structured logs منقحة.
- Metrics: latency، error rate، saturation، queue age، DB pool، webhook lag، payment mismatch، availability conflicts.
- Traces عبر Web/API/Worker/adapters دون PII.
- Alerts مرتبطة Runbook، لا Alerts بلا Owner.
- Client Web Vitals حسب route/locale/device دون إرسال نص المستخدم.

## 11. جودة الاختبارات

- Unit/Property tests لقواعد المال والحالات.
- Integration على PostgreSQL/Redis/Object storage حقيقية في CI.
- E2E للأدوار واللغتين.
- Security regression لكل P0.
- Load/soak على البحث والحجز وWebhook.
- Migration rehearsal وrestore drill.

## 12. بوابة Production Go/No-Go

### Go فقط إذا

- جميع P0 وP1 المتفق عليها مغلقة ومثبتة بالاختبار.
- Cross-tenant matrix كاملة.
- التزامن يمنع duplicate reservation/lease/payment/invoice number.
- BHD Identity يستخدم asymmetric signing/JWKS أو استثناء انتقال مغلق زمنياً لبيئة Pilot غير عامة.
- النسخ والاستعادة مختبران.
- Performance budgets محققة على بيانات ممثلة.
- Runbooks وon-call/incident contacts موجودة.
- Privacy/terms/security pages معتمدة.
- Migration reconciliation موقع عليه.

### No-Go عند

- فشل عزل واحد.
- إمكانية عقد/دفع مزدوج.
- سر Production في repo/log.
- هجرة destructive بلا backup/restore proof.
- اختبار E2E حرج flaky أو معطل.
- Critical/High vulnerability غير مستثناة بتوقيع وموعد.

