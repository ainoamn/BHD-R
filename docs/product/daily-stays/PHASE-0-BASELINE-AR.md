# Regression baseline — قبل تفعيل BHD R Stays

**التاريخ:** 2026-08-31 · **المرحلة:** 0  
**الالتزام المرجعي للسلوك الحالي:** `main` عند بدء `feat/stays-phase-0`

## قنوات العرض الحالية (لا تتغير في المرحلة 0)

| القناة | آلية العرض | ملاحظات |
| ------ | ---------- | ------- |
| بيع | `units.listing_purpose` ∈ `sale` \| `both` | كتالوج `/properties` |
| إيجار طويل | `listing_purpose` ∈ `rent` \| `both` + availability | حجز → عقد |
| إقامة يومية | **غير موجودة** | Feature Flags مغلقة؛ لا `/stays` |

قيد القاعدة: `units_listing_purpose_check` يسمح فقط `rent` / `sale` / `both` — **لا `daily`**.

## مسارات regression إلزامية (يجب أن تبقى خضراء)

1. إضافة عقار ووحدات (معالج العقار الحالي).
2. نشر للبيع / للإيجار الطويل.
3. كتالوج عام `/[locale]/properties` (قائمة/شبكة/جدول + خريطة).
4. حجز عربون الإيجار (reservation deposit).
5. التحويل إلى عقد وتوقيع وفواتير.
6. الصيانة والمهام.
7. بوابات المالك / المطور / المستأجر / المنصة.
8. عزل المؤسسات (RLS + authz).
9. جلسة التسويق `/api/auth/me` متسقة مع البوابة.

## ما يُمنع في المرحلة 0

- أي migration سلوكية أو جدول `stay_*`.
- أي مسار عام `/stays` أو تبويب «إقامة يومية» في البحث.
- أي Nest `StaysModule` ظاهر.
- أي كتابة Neon fallback جديدة لـ stays.

## Feature Flags (مغلقة)

انظر `@bhd-r/config` → `feature-flags.ts`:

- `STAYS_PLATFORM_ENABLED` default false
- `STAYS_ORG_ALLOWLIST` default empty
- property/unit layers fail-closed حتى تُفعَّل صراحة لاحقاً
