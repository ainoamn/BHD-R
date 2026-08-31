# الإصدار — Stays Phase 0 (تثبيت بدون سلوك عام)

**الفرع:** `feat/stays-phase-0`  
**التاريخ:** 2026-08-31

## ماذا أُنجز؟

- ADR-010: bounded context منفصل عن Leasing.
- Threat Model خاص بالإقامات.
- Feature Flags مغلقة افتراضياً (`STAYS_PLATFORM_ENABLED`, `STAYS_ORG_ALLOWLIST` + طبقات عقار/وحدة fail-closed).
- Baseline regression وE2E يمنع ظهور `/stays` وتبويب الإقامة اليومية.
- لا migrations ولا Nest StaysModule ولا واجهة عامة.

## ماذا لم يُنفَّذ؟

المرحلة 1 (جداول، تسعير، locks) — عمداً، حسب أمر التنفيذ.

## تحقق

انظر [`docs/verification/stays-phase-0.md`](../verification/stays-phase-0.md).
