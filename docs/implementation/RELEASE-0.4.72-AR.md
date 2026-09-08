# BHD R 0.4.72 — إصلاح بناء Vercel بعد 0.4.71

## السبب
نشر Production فشل لأن `unit-offering-modes.ts` كان يستورد `server-only` بينما يُستورد من `property-wizard.tsx` (Client Component).

## الإصلاح
- الدوال النقية (parse/serialize/mapping) بقيت في `unit-offering-modes.ts` بدون `server-only`.
- `ensureUnitOfferingModesColumn` نُقل إلى `ensure-unit-offering-modes-column.ts` (server-only).

## تحقق
- [ ] `next build` ينجح محلياً.
- [ ] Vercel Production لـ `main` يصبح success.
- [ ] معالج إضافة عقار ما زال يعرض أوضاع البيع/شهري/سنوي/يومي.
