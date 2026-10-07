# CONTINUE — 2026-10-07

**0.4.93** · بنود ملحق عقد الإيجار كاملة حرفياً (17 عنواناً و52 بنداً) كشروط افتراضية للإيجار الشهري / السنوي  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.93-AR.md`](./docs/implementation/RELEASE-0.4.93-AR.md)

**0.4.92** · شروط أولية قانونية شاملة للإيجار والبيع والإيجار اليومي + ترجمة وصياغة وتدقيق بالذكاء الاصطناعي + نسخ البنود بين أنواع العقود  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.92-AR.md`](./docs/implementation/RELEASE-0.4.92-AR.md)

**0.4.91** · شروط منظّمة بعناوين وبنود مرقّمة تلقائياً (عربي يمين / إنجليزي يسار) + طباعة بترويسة الشركة  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.91-AR.md`](./docs/implementation/RELEASE-0.4.91-AR.md)

**0.4.90** · صيغة موحدة للشروط والأحكام تستوردها كل العقارات + تخصيص لعقار معيّن  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.90-AR.md`](./docs/implementation/RELEASE-0.4.90-AR.md)

**0.4.89** · الحجز بالعربون (إيجار/شراء) + شروط المالك مع بوابة التمرير + «هل الحجز لك؟» والأشخاص المحفوظون  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.89-AR.md`](./docs/implementation/RELEASE-0.4.89-AR.md)

**مطلوب يدوياً:**

1. إضافة السر `CRON_SECRET` في GitHub Actions.
2. تشغيل `pnpm db:migrate` على قاعدة الإنتاج (الترحيل 0025).
3. إضافة `AI_GATEWAY_API_KEY` (أو `OPENAI_API_KEY`) في متغيرات Vercel لتفعيل الصياغة والتدقيق والترجمة بالذكاء الاصطناعي.

```sh
git pull origin main
```
