# ADR-003: BHD Identity هو مصدر المصادقة الوحيد

- **الحالة:** Proposed for phase-zero gate
- **التاريخ:** 23 أغسطس 2026

## القرار

- OIDC Authorization Code + PKCE S256.
- `bhd_sub` هو الرابط المستقر.
- أدوار BHD R محلية ولا تأتي من Claims.
- لا تسجيل Google/Password محلي داخل المنتج.
- جلسات المنتج Host-only وتستبدل عند callback.
- الهدف الإلزامي قبل الإنتاج العام: asymmetric token signing وJWKS حقيقي مع rotation.

## حساب المستأجر

بعد Lease activation يربط حساباً موجوداً أو يطلب دعوة Identity أحادية الاستخدام. لا يخزن BHD R كلمة مرور.

## النتائج

- تجربة دخول موحدة وفصل مسؤوليات.
- يعتمد onboarding على Internal invitation API يجب إضافتها إلى Identity.
- تعطل Identity يوقف دخولاً جديداً ولا يمنع قراءة Session سارية ضمن TTL وسياسة المخاطر.

