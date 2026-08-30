# إصدار 0.2.89 — أدوات نشر Nest + تقليل صلاحيات القراءة العامة

**التاريخ:** 2026-08-30  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**التقرير المرجعي:** [`../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md`](../security/BHD-R-platform-security-and-architecture-review-ar-2026-08-30.md)

## ما نُفّذ

| بند | الإجراء |
| --- | --- |
| **P1-07 / Render** | `render.yaml`: `branch: main` + `autoDeploy: true` |
| **Ops** | `scripts/trigger-render-deploy.mjs` + `scripts/verify-nest-health.mjs` + توثيق `RENDER_DEPLOY_HOOK_URL` |
| **P1-04** | عرض العقار العام يفضّل `app.public` ثم يرتفع للمسودات (QR) فقط |
| **P1-04** | `loadViewerContact` يقرأ بـ `app.user_id` أولاً |
| **Abuse** | حدود معدّل على PATCH deposit و DELETE media |

## المتبقي

1. أنشئ Deploy Hook في Render وضَع `RENDER_DEPLOY_HOOK_URL` محلياً ثم:  
   `node scripts/trigger-render-deploy.mjs`  
   أو Manual Deploy من `main` حتى يظهر `booking-checkouts` و property UPDATE على Live.  
2. Webhook دفع موقّع → تأكيد حجز (ليس مسار الفواتير الحالي).  
3. ClamAV · Nest+DB E2E · Neon non-BYPASSRLS.

## تحقق

1. `node scripts/verify-nest-health.mjs` → `nestReady:true`.  
2. بعد Deploy: حجز عام يعيد `via: nest`.  
3. عرض عقار منشور لا يحتاج `platform_admin` في القراءة العامة.

## وثائق

- [`CHANGELOG.md`](../../CHANGELOG.md) · [`STATUS.md`](./STATUS.md) · [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md) · [`ENV-MANIFEST.md`](./ENV-MANIFEST.md)
