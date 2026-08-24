# ADR-002: Modular Monolith داخل Monorepo

- **الحالة:** Proposed for phase-zero gate
- **التاريخ:** 23 أغسطس 2026

## القرار

نستخدم Monorepo يحوي `web`, `api`, `worker` وحزماً مشتركة، مع Domain modules واضحة وقاعدة PostgreSQL واحدة. لا Microservices في V1.

## الأسباب

- فصل نشر الموقع العام عن API والمهام الثقيلة.
- Policy وTransactions مركزية.
- خفة تشغيلية مقارنة بخدمات كثيرة.
- إمكانية استخراج Module مستقبلاً عبر OpenAPI/Events من دون كتابة النواة كشبكة موزعة مبكراً.

## البدائل المرفوضة

- Next.js full-stack فقط: أخف، لكن يفصل Webhooks/Workers والسياسات بدرجة أقل مع نمو المنتج.
- Microservices: تعقيد واتساق موزع بلا قياسات تبرره.
- نسخ النظام السابق: يعيد تعدد مصادر الحقيقة وLegacy bridge.

## الضوابط

- Architecture tests تمنع imports بين Modules بغير العقود.
- لا Module يقرأ جداول Module آخر مباشرة إلا عبر Application service/read model موثق.
- Outbox للأحداث المؤثرة.

