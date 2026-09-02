# الإصدار 0.4.41 — بوابة دفع تجريبية + مسار الإدارة `/admin`

**التاريخ:** 2026-09-02  
**الإنتاج:** https://r.bhd-om.com  
**Commit:** _(after push)_

## الملخص

1. **بوابة دفع تجريبية للإقامات:** مسار دفع جديد على Vercel + Neon (`/api/public/stays/payment-sessions`) بدلاً من الاعتماد على Nest في الإنتاج — يزيل رسالة «بوابة الدفع غير مفعّلة في هذه البيئة» عند **ادفع الآن**.
2. **تفعيل تلقائي في مرحلة الإقامات:** عند `STAYS_PLATFORM_ENABLED=true` تُفعَّل المدفوعات التجريبية تلقائياً حتى يُربَط PSP حي.
3. **صفحة الإدارة:** `/ar/admin` و `/ar/ADMIN` (وأي قسم فرعي) تُحوَّل إلى لوحة المنصة `/ar/platform` — نفس نمط WAZEN / hisaby / Nasab / ONE-BHD.
4. **رابط كتالوج الإقامات** في شريط جانبي لوحة المنصة للمراقبة السريعة.

## الملفات الرئيسية

| الملف | التغيير |
|-------|---------|
| `packages/config/src/payment-sandbox.ts` | `isPaymentSandboxPilotEnabled()` |
| `apps/web/src/lib/public-stays-payment-neon.ts` | إنشاء جلسة + إتمام sandbox |
| `apps/web/src/app/api/public/stays/payment-sessions/` | POST جلسة + POST sandbox-complete |
| `apps/web/src/components/stays/stay-checkout.tsx` | استدعاء API محلي بدلاً من Nest |
| `apps/web/src/components/sandbox-payment-form.tsx` | إتمام دفع الإقامة عبر Vercel |
| `apps/web/src/proxy.ts` + `app/[locale]/admin/` | تحويل `/admin` و `/ADMIN` → `/platform` |
| `apps/api/src/finance/finance.service.ts` | نفس منطق sandbox للمسار الاحتياطي على Render |
| `render.yaml` | `PAYMENT_SANDBOX_ENABLED=true` |

## تحقق بعد النشر

- [ ] حجز إقامة → **ادفع الآن** → صفحة sandbox → تأكيد → حالة **confirmed**
- [ ] https://r.bhd-om.com/ar/ADMIN → `/ar/platform`
- [ ] https://r.bhd-om.com/ar/admin → `/ar/platform`
- [ ] Vercel ينشر من `main`؛ Render يعيد النشر عند الحاجة

## متغيرات البيئة

| المنصة | المتغير | القيمة الموصى بها |
|--------|---------|-------------------|
| Vercel | `STAYS_PLATFORM_ENABLED` | `true` (موجود) |
| Vercel | `DATABASE_URL` | Neon (موجود) |
| Render | `STAYS_PLATFORM_ENABLED` | `true` |
| Render | `PAYMENT_SANDBOX_ENABLED` | `true` (في render.yaml) |

لا حاجة لمتغير إضافي على Vercel إذا كان `STAYS_PLATFORM_ENABLED=true` — sandbox يُفعَّل تلقائياً.

## روابط

- [حجز تجريبي — مبنى النور](https://r.bhd-om.com/ar/stays/al-noor-building-a-01/book)
- [لوحة الإدارة](https://r.bhd-om.com/ar/platform)
- [دخول الإدارة SSO](https://r.bhd-om.com/api/auth/admin-entry)
