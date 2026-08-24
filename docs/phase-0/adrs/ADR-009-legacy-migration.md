# ADR-009: ترحيل Legacy دون دمج شيفرة

- **الحالة:** Accepted conceptually
- **التاريخ:** 23 أغسطس 2026

## القرار

نستخدم ETL versioned وقابل لإعادة التشغيل من Snapshots إلى Staging ثم Reconciliation وPilot. لا ينسخ BHD R `legacy` أو KV bridge أو static property data.

## القواعد

- `legacy_source/id/migration_run_id` لكل سجل.
- Quarantine للحالات الغامضة.
- لا نقل Passwords.
- الوحدات تصبح Rows.
- العقود القديمة موسومة Imported ولا ننسب لها Evidence لم يوجد.
- Cutover بعد backup/restore proof وfinal delta.

## النتائج

- يحتاج Discovery وصولاً read-only إلى كل مصادر الإنتاج الفعلية.
- لا حذف أو تدوير مفاتيح إنتاج ضمن التطوير دون صلاحية مستقلة.
