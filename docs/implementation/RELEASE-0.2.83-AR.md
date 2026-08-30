# إصدار 0.2.83 — سياسة مسارات Next + معاينة Nest-first + حدود معدّل + harden وسائط

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-02 (جزئي)** | اختبار inventory يفرض `requireLiveSession` على كتابات Next؛ معاينة Nest-first مع Neon fallback |
| **Abuse limits** | معدل حد viewing/booking/translate + public media |
| **P1-04 (جزئي)** | بث الوسائط العامة عبر `app.public` بلا `platform_admin` |
| **P2-06** | على Vercel لا يُشتق أصل Nest من Host؛ يتطلب HTTPS `API_INTERNAL_ORIGIN` |
| **Cron** | مقارنة Bearer بـ `timingSafeEqual`؛ سكربت `ensure-vercel-cron-secret.mjs` |
| **P0-03 (اختبار)** | worker `disabled`/`best-effort` ما زال ينتج variants عبر Sharp |

## المتبقي

- Nest-only لكل الكتابات
- ClamAV حقيقي
- E2E ضد Nest+DB
- دور Neon بلا BYPASSRLS

## تحقق

1. `pnpm --filter @bhd-r/web test` يشمل `next-write-route-policy`.  
2. طلب معاينة يفضّل Nest عند جاهزيته وإلا Neon (`via`).  
3. أكثر من 5 معاينات/دقيقة → 429.  
4. `/api/cron/*` بلا سر → 503.  
5. `node scripts/ensure-vercel-cron-secret.mjs` يضبط السر دون طباعته.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)
