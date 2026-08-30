# إصدار 0.2.82 — ترقية وسائط best-effort + تدوير تشفير fail-closed + cron انتهاء + manifest بيئة

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P0-03 (جزئي)** | `MEDIA_PUBLIC_PROMOTE_MODE` — افتراضي `magic_bytes_best_effort` مع ملاحظة تدقيق؛ outbox ما زال يُكتب |
| **P1-06** | تدوير التشفير لا يعلن `done` عند فشل؛ يوقف السلسلة ويسجّل `ciphertextHash` بلا plaintext |
| **P1-07 (جزئي)** | `render.yaml` يصرّح CSRF/S3/Webhook/PUBLIC_PROPERTY؛ [`ENV-MANIFEST.md`](./ENV-MANIFEST.md) |
| **P1-02 تعزيز** | cron `/api/cron/expire-locks` كل 10 دقائق؛ الكتالوج ينهي reservations أيضًا |
| **P2-02 جزئي** | `/api/translate` يتطلب جلسة حيّة + CSRF؛ حد 2000 حرف |
| **sandbox complete** | يستخدم `requireLiveSession` + CSRF عند تفعيل sandbox |

## المتبقي

- Nest-only لكتابات الأعمال (P0-02)
- ClamAV حقيقي (ليس best-effort)
- E2E ضد Nest+DB
- دور Neon بلا BYPASSRLS

## تحقق

1. رفع صورة على Vercel → تظهر علنًا مع `scanNote: magic_bytes_promoted_worker_offline`.  
2. `MEDIA_PUBLIC_PROMOTE_MODE=await_worker` → تبقى pending حتى الـ worker.  
3. backfill بصف غير قابل للفك → لا `done` ولا استمرار تلقائي.  
4. `/api/cron/expire-locks` بلا `CRON_SECRET` → 503.  
5. sandbox complete ما زال 403 في الإنتاج.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`ENV-MANIFEST.md`](./ENV-MANIFEST.md) · [`RELEASE-0.2.81-AR.md`](./RELEASE-0.2.81-AR.md)
