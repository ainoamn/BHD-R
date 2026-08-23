# BHD R

منصة عمانية ثنائية اللغة لإدارة العقارات، الوحدات، العقود، المستأجرين، التحصيل، الصيانة، والإعلانات العامة. الحرف **R** يعني **Real Estate Management — إدارة العقارات**.

**التوثيق المفصل:** [`docs/PROJECT_DOCUMENTATION_AR.md`](./docs/PROJECT_DOCUMENTATION_AR.md)  
**واجهة عُمانية 2026-08-23:** [`docs/OMANI_UI_2026-08-23.md`](./docs/OMANI_UI_2026-08-23.md)  
**مصفوفة الأمن:** [`docs/SECURITY_CHECKLIST_MATRIX_AR.md`](./docs/SECURITY_CHECKLIST_MATRIX_AR.md)  
**ربط Vercel:** [`docs/VERCEL_DEPLOYMENT_AR.md`](./docs/VERCEL_DEPLOYMENT_AR.md) — Root Directory = `apps/web`  
**هوية BHD:** [`docs/BHD-R-IDENTITY-SETUP.md`](./docs/BHD-R-IDENTITY-SETUP.md)  
**مراجعات BHD-OM:** [`docs/legacy-reviews/`](./docs/legacy-reviews/)

## الحالة

هذا المستودع هو الجيل الجديد المستقل لمنظومة BHD. بُني كـ modular monolith لتقليل التعقيد التشغيلي مع إبقاء حدود الوحدات واضحة وقابلة للفصل لاحقاً. المستودع المستهدف: [ainoamn/BHD-R](https://github.com/ainoamn/BHD-R).

## المتطلبات

- Node.js 24+
- pnpm 10+
- Docker 28+ (لبيئة التطوير المتكاملة)

## تشغيل سريع

```bash
cp .env.example .env
docker compose up -d postgres redis minio minio-init mailpit clamav
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

للتطوير عبر HTTP المحلي غيّر `COOKIE_SECURE=false` في `.env`. اتركه `true` في staging والإنتاج. ويمكن تشغيل المنظومة كلها بالحاويات عبر `docker compose --profile app up -d --build`؛ عندها تطبق خدمة migration المخطط، ثم تنشئ حسابات التشغيل غير فائقة الصلاحية قبل بدء التطبيقات.

- الواجهة: `http://localhost:3000`
- API: `http://localhost:4000/v1`
- توثيق API: [`docs/API_OVERVIEW.md`](./docs/API_OVERVIEW.md)
- Health: `http://localhost:4000/health/ready`

راجع `docs/` للتصميم، الأمان، التشغيل، النشر، والهجرة.

## التطبيقات

- `apps/web`: الموقع العام واللوحات الأربع (المنصة، المالك، المطور، المستأجر).
- `apps/api`: الـ API المركزية، الدخول الموحد، الصلاحيات، والمعاملات.
- `apps/worker`: الصور والعلامة المائية وPDF والإشعارات والمهام الخلفية.

## فحوص التسليم

```bash
pnpm format:check
pnpm check
pnpm test:coverage
pnpm test:e2e
pnpm audit --audit-level=high
```

لا تُنسخ أسرار الإنتاج إلى المستودع. ابدأ من `.env.example` واستخدم مدير أسرار في بيئة النشر.
