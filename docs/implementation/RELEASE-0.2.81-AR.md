# إصدار 0.2.81 — TOTP step-up + OIDC/JWKS + صدق الوسائط + عزل الكتابات + بوابة E2E

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P1-01** | إعادة تسجيل TOTP تتطلب رمزًا حاليًا/recovery؛ throttle؛ إلغاء الجلسات الأخرى عند التأكيد |
| **P1-03** | تحقق RS256/ES256 عبر JWKS؛ مضيف هوية دقيق (`.bhd-om.com`)؛ بلا تفاصيل خطأ في `?x=`؛ تمرير `accessToken` لـ Nest |
| **P0-03 (جزئي)** | رفع الوسائط يضع `queued`/`pending` + outbox `media.uploaded` (العام ينتظر worker) |
| **P1-04 (جزئي)** | deposit عبر GUCs للمستأجر؛ حجوزات/معاينات عامة تكتب تحت org بدون `platform_admin` طوال المعاملة |
| **P1-05 (جزئي)** | API e2e على Express؛ إزالة `--passWithNoTests`؛ Playwright CI = chromium + fixture فقط |

## المتبقي

- تحويل كامل كتابات Next → Nest (P0-02)
- ClamAV حقيقي + Sharp watermark
- رحلات E2E حقيقية ضد Nest+DB
- دور Neon بلا BYPASSRLS؛ P1-06/P1-07

## تحقق

1. `POST /v1/auth/totp/enroll` مع MFA مفعّل بلا `currentCode` → 401.  
2. OIDC callback لا يضع تفاصيل الاستثناء في URL.  
3. صورة مرفوعة حديثًا لا تظهر علنًا حتى يعالجها الـ worker.  
4. `pnpm --filter @bhd-r/api test:e2e` أخضر.  
5. sandbox booking complete ما زال 403 في الإنتاج.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.80-AR.md`](./RELEASE-0.2.80-AR.md)
