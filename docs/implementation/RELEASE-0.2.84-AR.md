# إصدار 0.2.84 — تنقيح أخطاء العميل + CSRF + Idempotency + عربون Nest-first

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P2-04** | `clientSafeErrorCode` — لا تُعاد رسائل DB/pgCode للمتصفح |
| **CSRF** | Origin إلزامي للكتابات (أو Sec-Fetch-Site)؛ CSRF على complete؛ اختبار سياسة CSRF |
| **Idempotency** | رؤوس `idempotency-key` لمعاينة/حجز (Nest submissionId + Neon مرجعية ثابتة) |
| **P0-02 (جزئي)** | `PATCH /v1/portfolio/properties/:id/deposit` + Next Nest-first مع Neon fallback |

## المتبقي

- Nest-only لإنشاء/تحديث العقار والوسائط والحجز
- ClamAV حقيقي
- E2E ضد Nest+DB
- دور Neon بلا BYPASSRLS
- ضبط `CRON_SECRET` عبر `scripts/ensure-vercel-cron-secret.mjs`

## تحقق

1. خطأ إنشاء عقار لا يعرض نص Postgres.  
2. `/api/public/bookings/complete` يرفض بلا `x-csrf-token` عند تفعيل sandbox.  
3. إعادة نفس `idempotency-key` للمعاينة يعيد نفس المرجع.  
4. عربون العقار يفضّل Nest عند جاهزيته (`via: nest`).

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`RELEASE-0.2.83-AR.md`](./RELEASE-0.2.83-AR.md)
