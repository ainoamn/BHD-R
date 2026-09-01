# تسليم — 0.4.24 الإقامات العامة + إصلاح المحفظة

**تاريخ:** 2026-09-01  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الفرع:** `main`  
**معرّف محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

---

## ما أُنجز في هذه الجلسة (0.4.23 → 0.4.24)

| الإصدار | الملخص |
| --- | --- |
| **0.4.23** | إصلاح BigInt في JSON عند حفظ السعر (معالج الإقامة) |
| **0.4.24** | ترجمة + AI + معاينة + redirect + inventory Neon + صفحات `/stays` غنية + إصلاح المحفظة |

### 0.4.24 — تفاصيل

1. **المعالج:** `translateText`، `generateListingDescriptions`، `summaryEn`، معاينة بطاقة، `publish_profiles` دفعة واحدة، `router.push(/stays/{slug})`.
2. **Neon:** `rebuildStayInventoryDaysOnNeon` بعد كل نشر.
3. **عام:** `load-public-stays-neon.ts`، `StayPublicShowcase`، `StayCard` بصور وسعر مُنسّق.
4. **Nest search:** cover + rate fallback + حقول تفصيل إضافية.
5. **المحفظة:** لا يُطبَّق `?propertyId=` على قسم `properties`؛ `organization_owner` في `ORG_WIDE_ROLES`؛ Nest `leftJoin` للعناوين/المالك.

---

## مشكلة المحفظة (3 في الإحصاء، 1 في الجدول)

**السبب:** عند العودة من معالج الإقامة (`?propertyId=…`) كان فلتر URL يُطبَّق على قائمة العقارات فيُظهر عقاراً واحداً بينما الإحصاء يحسب الكل.

**الإصلاح:** `operations-console.tsx` — تجاهل `propertyId` في قسم `properties`.

**إضافي:** مالك المؤسسة (`organization_owner`) يرى كل العقارات دون تقييد `partyId`.

---

## كيف تبدأ من جهاز آخر

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
```

في Cursor:

> اقرأ `docs/handoffs/2026-09-01-stays-public-and-portfolio/README.md` و `docs/implementation/RELEASE-0.4.24-AR.md` ثم استكمل من HEAD على `main`.

---

## المحادثة الكاملة

| المصدر | الموقع |
| --- | --- |
| **تسليم سابق (JSONL كامل حتى 0.4.22)** | [`../2026-09-01-stays-setup-neon-write/`](../2026-09-01-stays-setup-neon-write/) |
| **استمرار هذه الجلسة** | Transcript Cursor: `d0d5551b-99f7-449e-92d1-5d812bcf527d` |

---

## تحقق بعد النشر على Vercel

- [ ] `/ar/owner/properties` — كل العقارات (ليس 1 فقط)
- [ ] `/ar/stays` — بطاقة بصورة وسعر
- [ ] `/ar/stays/al-noor-building-a-01` — صفحة حجز غنية
- [ ] معالج الإقامة — ترجمة + نشر → redirect للصفحة العامة

---

## متغيرات Vercel / Render

| الطبقة | مطلوب |
| --- | --- |
| Vercel | `DATABASE_URL`, `STAYS_PLATFORM_ENABLED=true` |
| Render | `STAYS_PLATFORM_ENABLED=true` (للـ outbox/worker اختياري) |

**ملاحظة:** `scripts/set-database-url.mjs` محلي فقط — لا يُرفع.
