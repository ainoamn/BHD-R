# BHD R 0.4.74 — إصلاح مهلة بناء الصفحة الرئيسية على Vercel

## السبب
نشر `0.4.73` فشل بعد نجاح Compile/TypeScript: توليد `/ar` و`/en` تجاوز 60 ثانية (استعلام Neon للكتالوج أثناء `next build` مع ضغط الـ workers).

## الإصلاح
- `export const dynamic = 'force-dynamic'` على الصفحة الرئيسية.
- مهلة 8ث حول `searchPublicListingsFromNeon` في الصفحة الرئيسية.
- `staticPageGenerationTimeout: 180` في `next.config.ts`.

## ملاحظة
تحسينات تنقل البوابة في 0.4.73 تبقى كما هي؛ هذا الإصدار لإعادة النشر فقط.
