# إصدار 0.2.86 — إنشاء عقار ورفع وسائط Nest-first + حدود كتابة المالك

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02 (جزئي)** | `POST /v1/portfolio/properties` Nest-first لإنشاء العقار |
| **P0-02 / P0-03** | رفع الوسائط Nest-first: intent → ingress → complete (magic-bytes قبل Nest) |
| **Abuse** | حدود معدّل على إنشاء/تحديث العقار ورفع الوسائط |
| **Idempotency** | مفاتيح Neon لـ `PATCH /api/owner/properties/:id` (المعالج يرسل المفتاح مسبقاً) |
| **P1-07** | مزامنة `CRON_SECRET` عبر `ensure-vercel-cron-secret.mjs` عند الحاجة |

## المتبقي

- Nest-only لتحديث العقار الكامل (Nest PATCH رفيع حالياً)
- Nest public booking checkout
- ClamAV حقيقي · Nest+DB E2E · دور Neon بلا BYPASSRLS
- Redeploy Nest (Render) إن كان خلف 0.2.85+

## تحقق

1. إنشاء عقار جديد يعيد `via: nest` عند جاهزية Nest.  
2. رفع صورة من المعالج يعيد `via: nest` عند جاهزية Nest.  
3. إعادة نفس `idempotency-key` لـ PATCH edit تعيد نفس الحمولة.  
4. Cron warmup/expire-locks لا يعيدان `cron_unconfigured` بعد ضبط السر.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.85-AR.md`](./RELEASE-0.2.85-AR.md)
