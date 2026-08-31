# حزمة بناء الإقامات اليومية في BHD R

هذه الحزمة هي المرجع التنفيذي لإضافة التأجير اليومي إلى BHD R دون كسر البيع أو الإيجار الطويل أو العقود والفواتير الحالية.

## الملفات

1. [`BHD-R-DAILY-STAYS-MASTER-PLAN-AR.md`](./BHD-R-DAILY-STAYS-MASTER-PLAN-AR.md)  
   وثيقة المنتج والمعمارية والبيانات والواجهات والتشغيل والأمن والأداء والمراحل.
2. [`BHD-R-DAILY-STAYS-IMPLEMENTATION-MATRIX-AR.md`](./BHD-R-DAILY-STAYS-IMPLEMENTATION-MATRIX-AR.md)  
   خارطة الملفات والمراحل والاعتماديات واختبارات القبول وبوابات الانتقال.
3. [`BHD-R-DAILY-STAYS-COPILOT-PROMPT-AR.md`](./BHD-R-DAILY-STAYS-COPILOT-PROMPT-AR.md)  
   أمر جاهز لـ GitHub Copilot/Coding Agent للتنفيذ المنضبط مرحلةً مرحلة.
4. [`ADR-010`](../../phase-0/adrs/ADR-010-stays-bounded-context.md) · [`Threat Model`](./THREAT-MODEL-STAYS-AR.md) · [`Phase 0 baseline`](./PHASE-0-BASELINE-AR.md)
5. تحقق المرحلة 0: [`docs/verification/stays-phase-0.md`](../../verification/stays-phase-0.md)

## حالة التنفيذ

| المرحلة | الحالة |
| ------- | ------ |
| 0 — التثبيت | **قيد الدمج** على فرع `feat/stays-phase-0` (Flags مغلقة، بلا UI/API عام) |
| 1+ | لم تبدأ — لا تُفتح في نفس PR المرحلة 0 |

## قواعد لا يجوز تجاوزها

- الإقامة اليومية مجال مستقل، وليست قيمة جديدة داخل `units.listingPurpose`.
- لا يعاد استخدام `reservations` أو `leases` لحجوزات الليالي.
- لا ينشأ عقد إيجار وهمي ولا فاتورة مرتبطة بعقد وهمي.
- كل جدول جديد يحمل `organization_id` ويخضع للتفويض المركزي وRLS.
- جميع كتابات الإقامة اليومية تمر عبر Nest API؛ لا Neon write fallback جديد.
- كل هجرة Additive أولاً، وكل ميزة خلف Feature Flag مغلق افتراضياً.
- لا تنتقل أي مرحلة قبل نجاح بوابة التحقق الخاصة بها.
- إغلاق Feature Flag يجب أن يعيد سلوك البيع والإيجار الطويل الحالي دون اختلاف.

## نقطة البداية

ابدأ بقراءة الخطة الرئيسية كاملة، ثم استخدم مصفوفة التنفيذ، وبعد ذلك مرّر أمر Copilot الموجود في الملف الثالث. لا تنفذ المراحل كلها في commit واحد.
