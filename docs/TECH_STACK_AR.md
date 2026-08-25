# تقنيات ومنصة BHD R — توثيق كامل

**الإصدار المرجعي:** 0.2.20+  
**المستودع:** [ainoamn/BHD-R](https://github.com/ainoamn/BHD-R)  
**المقارنة:** الجيل الجديد مقابل النظام السابق [ainoamn/bhd-om](https://github.com/ainoamn/bhd-om)

---

## 1. الجواب المختصر

**نعم.** BHD-R مبني بمنهجية أقرب للمنتجات المؤسسية: فصل واضح بين الواجهة والـ API والعامل الخلفي، مخطط قاعدة بيانات علائقي مع عزل مؤسساتي (RLS)، عقود مشتركة، اختبارات، وهجرة منظمة.

**bhd-om** كان جيلاً عملياً سريعاً (Next.js واحد + Prisma + بيانات مدمجة/localStorage في أجزاء التسويق) نجح في إثبات المنتج، لكنه أصعب في الصيانة والتوسع عندما تتداخل الوحدات داخل نفس التطبيق.

| البعد | BHD-R (الحالي) | bhd-om (السابق) |
|------|----------------|-----------------|
| الشكل | Monorepo + Modular Monolith | تطبيق Next واحد غالباً |
| API | NestJS + Fastify منفصل | مسارات API داخل Next |
| البيانات | وحدات/عقارات جداول منفصلة + RLS | وحدات متعددة كمصفوفات JSON داخل العقار + overrides |
| الخلفية | Worker + BullMQ + Outbox | مهام محدودة داخل نفس التطبيق |
| الحزم | packages مشتركة (contracts, authz, db…) | منطق موزّع داخل `lib/` و`components/` |
| الجودة | turbo، typecheck صارم، vitest، playwright، CI | lint/e2e موجودة لكن حدود المجالات أضعف |
| الهوية | BHD Identity OIDC موحّد | next-auth + مسارات محلية |

هذا **لا يعني** أن bhd-om «سيئ» — هو أساس منتج ناضج وظيفياً. BHD-R يعيد البناء على دروسه بهندسة أنظف.

---

## 2. معمارية BHD-R

```text
المتصفح  →  Next.js Web (Vercel)
                ↓  API_INTERNAL_ORIGIN
           NestJS/Fastify API (Render / حاوية)
                ↓
     PostgreSQL(+PostGIS) · Redis · S3 · Identity
                ↓  outbox
           Worker (BullMQ) → صور / PDF / بريد / فحص
```

التفاصيل: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

**مبدأ التصميم:** Modular Monolith — عملية API واحدة، لكن كل مجال (محفظة، تأجير، مالية…) له جداول وخدمات وحدود صلاحيات. أخف من microservices، وأوضح من «كل شيء في Next».

---

## 3. التطبيقات (apps)

| تطبيق | التقنية | الدور | نشر مقترح |
|-------|---------|------|-----------|
| `apps/web` | **Next.js 16** · **React 19** · **next-intl** · Tailwind 4 | موقع عام + بوابات (منصة/مالك/مطور/مستأجر) | **Vercel** |
| `apps/api` | **NestJS 11** · **Fastify 5** · Zod · Drizzle | مصدر الحقيقة: صلاحيات، معاملات، `/v1/*` | **Render** Docker / VM |
| `apps/worker` | Node · **BullMQ** · Sharp · Playwright · Nodemailer | مهام خلفية: وسائط، PDF، إشعارات، outbox | حاوية منفصلة |

---

## 4. الحزم المشتركة (packages)

| حزمة | الغرض |
|------|--------|
| `@bhd-r/db` | مخطط **Drizzle ORM**، migrations، seed، اتصال PostgreSQL |
| `@bhd-r/contracts` | مخططات Zod / DTOs مشتركة بين web وapi |
| `@bhd-r/authz` | أدوار وصلاحيات وسياق المؤسسة |
| `@bhd-r/security` | تشفير حقول، أدوات أمنية مشتركة |
| `@bhd-r/domain` | قواعد مجال وحسابات مالية دقيقة |
| `@bhd-r/i18n` | رسائل **عربي / إنجليزي** |
| `@bhd-r/ui` | مكوّنات واجهة مشتركة (Field, Card, Logo…) |
| `@bhd-r/country-packs` | حزم دول (عُمان أولاً: عملة، مستويات عنوان) |
| `@bhd-r/config` | تحميل وتهيئة البيئة |
| `@bhd-r/observability` | تسجيل/مراقبة مشتركة |

إدارة المستودع: **pnpm workspaces** + **Turborepo**.

---

## 5. طبقة البيانات والأمان

| عنصر | التقنية / الأسلوب |
|------|-------------------|
| قاعدة البيانات | **PostgreSQL** (+ PostGIS للعناوين الجغرافية) |
| ORM / SQL | **Drizzle ORM** + SQL صريح عند الحاجة (تسلسلات، RLS) |
| الهجرات | ملفات SQL مرقّمة تحت `packages/db/migrations` |
| العزل | `organization_id` + **Row Level Security** كدفاع ثانٍ |
| المبالغ | عدد صحيح/minor units + عملة — بدون float |
| المعرفات | **UUID** |
| الجلسات | كوكي `bhd_r_session` + تحقق JWT/`jose` + جدول sessions |
| الهوية | **BHD Identity OIDC** (`id.bhd-om.com`) |
| التخزين | **S3-compatible** (خاص/عام، علامة مائية عبر Worker) |
| الطوابير | **Redis** + **BullMQ** |
| البريد | SMTP عبر Worker |
| فحص ملفات | ClamAV (بيئة Docker) |

---

## 6. الواجهة والتجربة

| عنصر | التفاصيل |
|------|----------|
| الإطار | Next.js App Router (`[locale]/…`) |
| اللغات | `ar` (RTL) · `en` (LTR) — `localePrefix: always` |
| الخطوط | IBM Plex Sans / IBM Plex Sans Arabic |
| الأنماط | CSS عالمي + Tailwind 4 |
| البوابات | `owner` · `developer` · `tenant` · `platform` عبر `PortalShell` |
| الهوية في الواجهة | هيدر مستخدم + مبدّل تطبيقات BHD |

---

## 7. الجودة والصيانة

| طبقة | الأدوات |
|------|---------|
| لغة | **TypeScript** صارم (`exactOptionalPropertyTypes` على الويب) |
| بناء حزم | `tsc` لكل package |
| اختبار وحدة | **Vitest** (api, web, db, …) |
| اختبار متصفح | **Playwright** |
| تنسيق / فحص | Prettier · ESLint · `pnpm check` |
| CI | GitHub Actions (lint, test, security, performance) |
| أسرار | `.env.example` فقط في Git — لا أسرار إنتاج في المستودع |

---

## 8. البنية التحتية (الإنتاج الحالي)

| خدمة | دور |
|------|-----|
| GitHub `ainoamn/BHD-R` | مصدر الكود |
| Vercel (`bhd-r-api` / `apps/web`) | واجهة الويب |
| Render (Docker Nest) | API طويل الأمد |
| Neon | PostgreSQL مُدار |
| Upstash / Redis | طوابير وتخزين مؤقت |
| S3 / R2 | وسائط |
| BHD Identity | تسجيل دخول موحّد |

أدلة: [`VERCEL_DEPLOYMENT_AR.md`](./VERCEL_DEPLOYMENT_AR.md) · [`implementation/NEST-API-HOSTING.md`](./implementation/NEST-API-HOSTING.md) · [`DEPLOYMENT.md`](./DEPLOYMENT.md)

---

## 9. لماذا هذا أفضل للصيانة والتوسع؟

1. **حدود واضحة:** تغيير واجهة لا يكسر منطق العقود؛ تغيير API لا يختلط بصفحات Next.
2. **نموذج بيانات صريح:** `properties` → `units` → `listings` بدل مصفوفات وحدات داخل كائن عقار.
3. **صلاحيات مركزية:** كل طلب API يُفحوص — الواجهة لا تمنح سلطة وحدها.
4. **Outbox:** العمليات المالية/الوسائط متسقة مع إعادة المحاولة الآمنة.
5. **حزم مشتركة:** عقود Zod واحدة تمنع انحراف web عن api.
6. **قابلية الفصل لاحقاً:** يمكن استخراج المالية أو الـ Worker كخدمة مستقلة دون إعادة كتابة المنتج.

ما زال النظام في مرحلة نضج تشغيلي (هجرات Neon، ربط Nest، أسرار الإنتاج) — لكن **الأساس الهندسي** مهيأ للتوسع.

---

## 10. تقنيات bhd-om (للمقارنة)

من مستودع [bhd-om](https://github.com/ainoamn/bhd-om):

- Next.js + React + next-intl
- Prisma (PostgreSQL / تاريخياً SQLite في بعض المسارات)
- next-auth
- Upstash Redis / Vercel Blob في أجزاء
- وحدات متعددة كـ JSON على العقار + نشر عبر `?unit=`
- تركيز قوي على لوحة إدارة ويب متكاملة في تطبيق واحد

مناسب للإطلاق السريع والتحكم اليدوي؛ أقل ملاءمة لعزل مؤسسي صارم وعمال خلفية وواجهات متعددة طويلة الأمد.

---

## 11. خريطة سريعة لمجلدات BHD-R

```text
BHD-R/
  apps/web      → Next.js
  apps/api      → NestJS/Fastify
  apps/worker   → BullMQ jobs
  packages/*    → db, contracts, authz, ui, i18n, …
  docs/         → معمارية، أمن، نشر، عمليات
  docker-compose.yml
  render.yaml / Dockerfile.api
```

---

## 12. مراجع داخل المستودع

| موضوع | ملف |
|------|-----|
| معمارية | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| توثيق مشروع | [`PROJECT_DOCUMENTATION_AR.md`](./PROJECT_DOCUMENTATION_AR.md) |
| أمن | [`SECURITY_CONTROLS.md`](./SECURITY_CONTROLS.md) · [`SECURITY_CHECKLIST_MATRIX_AR.md`](./SECURITY_CHECKLIST_MATRIX_AR.md) |
| مراجعة إرث OM | [`legacy-reviews/`](./legacy-reviews/) |
| حالة التنفيذ | [`implementation/STATUS.md`](./implementation/STATUS.md) |
| معالج العقار | [`implementation/PROPERTY-WIZARD-AR.md`](./implementation/PROPERTY-WIZARD-AR.md) |
| بوابات التحكم | [`implementation/PORTAL-CHROME-AR.md`](./implementation/PORTAL-CHROME-AR.md) |

---

**الخلاصة:** نعم — نبني جيلاً أقوى هندسياً وأكثر قابلية للصيانة والتوسع من نموذج bhd-om الأحادي، مع الإبقاء على دروس المنتج والهوية العُمانية وثنائية اللغة.
