# Runbooks التشغيل والحوادث

## نموذج الاستجابة

الأدوار: Incident Commander، Operations، Application، Security/Privacy، Communications. افتح قناة وتذكرة، استخدم UTC، سجل القرارات ولا تضع أسراراً/PII في التذكرة. الأولوية لاستقرار البيانات ومنع الضرر ثم استعادة الخدمة ثم التحليل.

تصنيف أولي: SEV-1 تسرب/فساد مالي/تعطل شامل، SEV-2 وظيفة أساسية أو مؤسسة كبيرة، SEV-3 أثر محدود. أهداف التنبيه الأولية: SEV-1 خلال 5 دقائق، SEV-2 خلال 15 دقيقة.

## API 5xx أو latency مرتفع

1. قارن error rate/p95 مع deploy/migration حديث.
2. افحص saturation: DB connections/locks/slow queries، CPU/memory وupstream timeouts.
3. أوقف report/backfill غير الضروري، فعّل rate limit أشد أو rollback الصورة إن كان آمناً.
4. لا ترفع connection pool بلا حساب حد DB؛ قلل concurrency أولاً.
5. smoke test login/property/invoice read، ثم راقب التعافي.

## Queue lag أو jobs فاشلة

1. قس lag لكل queue وأقدم job وfailure code، ولا تطبع payload.
2. تحقق Redis، Worker readiness، ClamAV/Chromium/SMTP/S3.
3. أصلح التبعية ثم زد replicas تدريجياً ضمن قدرة DB/SMTP.
4. افحص DLQ: أعد job فقط بعد تحديد أن العملية idempotent ومعالجة السبب.
5. لا تمسح queue أو Redis. outbox هو سجل الإنقاذ، وقارن processed/unprocessed.

## Webhook/دفعات

1. إذا التوقيع أو provider مشكوك فيه: عطّل adapter/merchant عبر kill switch، لا تعطل القراءة.
2. احفظ الأدلة والـIDs والتوقيت من دون كشف secret/raw PII.
3. قارن provider events مع unique event table والدفعات والallocations.
4. شغّل reconciliation read-only، ثم adjustments مع approval؛ لا تعدل ledger يدوياً.
5. دوّر webhook secret من لوحة المزود فقط بصلاحية معتمدة، وادعم overlap قصيراً للإصدارين إن أمكن.

## اشتباه cross-tenant أو تسرب

1. SEV-1: جمّد المسار/feature المتأثر، احفظ logs/audit وابدأ legal/privacy workflow.
2. حدد الموارد والمستخدمين والفترة والاستعلام المسبب.
3. ألغِ sessions/API keys المتأثرة وزد session version؛ لا تحذف الأدلة.
4. أصلح repository scope + guard + RLS وأضف regression لمؤسستين.
5. تحقق من access logs/object URLs/CDN، واتبع خطة الإخطار القانونية.

## هوية/SSO معطل

تحقق issuer DNS/TLS، JWKS cache/rotation، clock skew وredirect URI. حافظ على الجلسات الصالحة حسب السياسة، ولا تضف login bypass. حساب break-glass للمنصة فقط، MFA قوي، مخزن خارج IdP، محدود الوقت وكل استخدام ينبه ويدقق.

## اشتباه سر متسرب

1. ألغِ/دوّر السر في المصدر مع سجل تغيير.
2. ابحث استخدامه لا قيمته في logs/CI/artifacts، وأعد كتابة التاريخ فقط بقرار أمني لأن ذلك disruptive.
3. دوّر الأسرار المشتقة والجلسات، راجع الوصول منذ أول exposure.
4. أضف gitleaks pattern/regression. لا تضع السر الحقيقي في ticket أو commit إصلاح.

## قاعدة البيانات

- lock storm: أوقف العملية المسببة، لا تقتل sessions عشوائياً، التقط blocking tree.
- مساحة منخفضة: أوقف backfill/report، وسّع storage؛ لا تحذف WAL/audit يدوياً.
- corruption/خطأ منطقي: maintenance mode وPITR إلى instance جديدة وفق backup runbook.

## ما بعد الحادث

خلال 5 أيام عمل: timeline بلا لوم، root/systemic causes، أثر مالي/خصوصي، ما نجح/فشل، actions بمالك وموعد، واختبار يمنع التكرار. حدث threat model/runbook وراقب الإجراء حتى الإغلاق.
