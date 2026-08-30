# إصدار 0.2.90 — تأكيد عربون الحجز عبر Webhook موقّع (P0-01)

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-01** | `POST /v1/webhooks/payments/:provider` يقبل `kind: reservation_deposit` + `checkoutSessionReference` |
| **أثر** | تأكيد الحجز pending → confirmed، قيد يومية `reservation_deposit`، تحويل hold، outbox/workflow |
| **سلامة** | مسار الفاتورة (بلا `kind` أو `kind: invoice`) دون تغيير؛ مبلغ/عملة يجب أن تطابق العربون؛ أحداث webhook مكررة تبقى idempotent |
| **Ops** | `scripts/simulate-reservation-deposit-webhook.mjs` للتوقيع والاختبار |

### شكل الحمولة (حجز)

```json
{
  "kind": "reservation_deposit",
  "organizationId": "<uuid>",
  "checkoutSessionReference": "bk_…",
  "amountMinor": "100000",
  "currency": "OMR",
  "providerReference": "…",
  "receivedAt": "2026-08-30T12:00:00.000Z",
  "method": "card"
}
```

التوقيع: رأس `x-bhd-signature: t=<unix>,v1=<hmac-sha256-hex>` على `{t}.{rawBody}` بمفتاح `PAYMENT_WEBHOOK_SECRET`، و`x-event-id` فريد.

## المتبقي

- محوّل بوابة دفع حقيقي (Thawani/…) يرسل هذا الشكل
- صف `payment_sessions` اختياري للحجز (ليس لازماً للتأكيد)
- ClamAV · Nest+DB E2E · Neon non-BYPASSRLS
- Redeploy Nest على Render لالتقاط webhook الجديد

## تحقق

1. فاتورة webhook القديمة ما زالت تعمل.  
2. حمولة `reservation_deposit` ناقصة → 400.  
3. جلسة `bk_…` صحيحة + مبلغ مطابق → confirmed + journal.  
4. إعادة نفس `x-event-id` → `{ duplicate: true }`.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)
