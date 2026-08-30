# إصدار 0.2.85 — حذف وسائط Nest-first + Idempotency العربون + كتالوج آمن

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02 (جزئي)** | `DELETE /v1/media/:id` + Next Nest-first مع Neon+S3 fallback |
| **Idempotency** | `@Idempotent` على `PATCH .../deposit` + مفاتيح Neon + تمرير `idempotency-key` |
| **P2-04** | `clientSafeErrorCode` على مسارات المالك (عقار/وسائط) + بوابة اختبار CI |
| **كتالوج** | حد معدّل 60/دقيقة؛ SELECT بعد heal تحت `app.public` وليس `platform_admin` |

## المتبقي

- Nest-only لإنشاء/تحديث العقار ورفع الوسائط والحجز العام
- ClamAV حقيقي
- E2E ضد Nest+DB
- دور Neon بلا BYPASSRLS
- ضبط `CRON_SECRET` عبر `scripts/ensure-vercel-cron-secret.mjs`
- Redeploy Nest (Render) لالتقاط `DELETE /v1/media` وIdempotency العربون

## تحقق

1. حذف صورة من المعالج يفضّل Nest عند جاهزيته (`via: nest`).  
2. إعادة نفس `idempotency-key` لـ PATCH deposit تعيد نفس النتيجة.  
3. خطأ رفع/إنشاء لا يعرض نص Postgres.  
4. `/api/public/catalogue` يعيد 429 عند تجاوز الحد.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.84-AR.md`](./RELEASE-0.2.84-AR.md)
