# Cloudflare Workers `bhd-r` — لماذا كل البناء فاشل؟

## الخلاصة

**مشروع Cloudflare Workers باسم `bhd-r` ليس مسار النشر المعتمد لـ BHD-R.**  
فشل كل البناء هناك متوقع ولا يوقف الموقع الحقيقي.

| دور | المنصة الصحيحة | ملاحظة |
| --- | --- | --- |
| الواجهة Next (`apps/web`) | **Vercel** مشروع `bhd-r-api` | Preview مثل `bhd-r-api-phi.vercel.app` · إنتاج `r.bhd-om.com` |
| Nest API (`apps/api`) | **Render** Docker | `https://bhd-r.onrender.com` |
| طوابير الخلفية (`apps/worker`) | حاوية Node (Render/VM لاحقاً) | **ليست** Cloudflare Workers — الاسم متشابه فقط |

لا يوجد في المستودع `wrangler.toml` ولا إعداد OpenNext لـ Cloudflare. ربط Git بـ Workers يحاول نشر monorepo Next/Nest كـ Worker فيفشل دائماً.

## ماذا تفعل الآن (موصى به)

1. افتح [Worker `bhd-r` → Settings → Builds](https://dash.cloudflare.com/61a8dcee7462dfc4baa21bb0b7b7fc10/workers/services/view/bhd-r/production).
2. **Disconnect** مستودع GitHub (أو عطّل Automatic deployments / احذف الـ triggers).
3. تجاهل شارة «Latest build failed» بعد الفصل — لن تؤثر على Vercel أو Render.
4. راقب النشر من:
   - Vercel → مشروع `bhd-r-api`
   - Render → خدمة Nest (`bhd-r` / `bhd-r-api`)

## إن أردت لاحقاً استضافة على Cloudflare

يحتاج مشروعاً منفصلاً وعملاً كبيراً (مثلاً OpenNext for Cloudflare + `wrangler.toml` باسم يطابق الـ Worker)، **وليس** إصلاح بناء Worker الحالي على نفس إعدادات Nest/Next الحالية. لا يُنصح به الآن بينما Vercel يعمل.

## لحل مشاكل الحفظ والبطء

ارجع إلى:

- [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md) — إصلاح Render و`/health/ready`
- [`PORTAL-PERF-AR.md`](./PORTAL-PERF-AR.md) — أداء البوابة
- [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md) — متغيرات Vercel
