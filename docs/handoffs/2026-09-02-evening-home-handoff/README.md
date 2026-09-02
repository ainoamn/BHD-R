# تسليم — أرشفة المحادثة الكاملة + 0.4.38–0.4.40 (استكمال من المنزل)

**تاريخ التوثيق:** 2026-09-02  
**وقت التوثيق (مسقط / UTC+4):** 17:08  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**آخر commit عند التوثيق:** `b728a35` — *Archive full Cursor conversation and home handoff for 0.4.40.*  
**الإصدار:** `0.4.40`  
**معرّف محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

---

## أين توقّفنا الآن

### ما أُنجز في هذه الجلسة (0.4.38 → 0.4.40)

| الإصدار | Commit | الملخص |
| --- | --- | --- |
| **0.4.38** | `2bcf82e` | كatalog إقامات — بطاقة لكل وحدة منشورة + `StaysBrowse` (فلاتر، خريطة، قائمة/شبكة/جدول) |
| **0.4.39** | `f00ff0a` | إصلاح SQL الكatalog (0 نتائج على `/ar/stays`) + fallback بحث |
| **0.4.40** | `2e4b80b` | عناوين أقسام أكبر + خلفيات متناوبة فاتح/غامق على صفحات الإقامة والوحدة |

### تحقق سريع من جهاز المنزل

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
git log -1 --oneline   # 0079e42 أو أحدث
```

- [ ] [صفحة الإقامات](https://r.bhd-om.com/ar/stays?countryCode=OM&currency=OMR) — 3 وحدات (A-01, A-02, R-01)
- [ ] [إقامة R-01](https://r.bhd-om.com/ar/stays/al-noor-building-a-01?unit=fd6e559d-3f92-4b5d-be64-4ba0245ec662) — عناوين أكبر + أقسام فاتح/غامق
- [ ] [وحدة A-02](https://r.bhd-om.com/ar/units/90cd9d0b-3526-4419-8066-4c24f6534b90) — نفس التنسيق
- [ ] `GET /api/public/stays/catalogue?countryCode=OM` — يعيد 3 وحدات

---

## المحادثة كاملة (نسخة حرفية)

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript-FULL.jsonl`](./conversation-transcript-FULL.jsonl) | JSONL خام كامل (**4461** سطر) — SHA256 `536abc29b8684c7a387ce138624636149a75f12e108dcd07452f723d5870f261` (**أسرار منقّحة**) |
| [`conversation-readable-FULL.md`](./conversation-readable-FULL.md) | نسخة مقروءة (**1933** رسالة مستخرجة) |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) | **خطة الاستكمال بالأولويات** |

**نطاق المحادثة:** من مراجعة BHD-OM وبناء BHD R (2026-08-23) حتى أرشفة 0.4.40 (2026-09-02).

> **تنبيه أمني:** قبل الرفع إلى GitHub، استُبدلت مفاتيح API و`DATABASE_URL` وكلمات مرور Neon بـ `[REDACTED-…]`. سياق المحادثة كامل؛ القيم الحساسة فقط مُنقّحة.

**أرشيف سابق (حتى 0.4.22):** [`../2026-09-01-stays-setup-neon-write/`](../2026-09-01-stays-setup-neon-write/) — يُستبدل بـ JSONL هذا للجلسة الكاملة المحدّثة.

---

## كيف تبدأ من الكمبيوتر الآخر

```bash
git pull origin main
```

ثم افتح بالترتيب:

1. هذا الملف (`README.md`)
2. [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md)
3. [`docs/implementation/RELEASE-0.4.40-AR.md`](../../implementation/RELEASE-0.4.40-AR.md)
4. عند الحاجة: `conversation-readable-FULL.md` أو الـ JSONL الكامل

**في Cursor:** افتح محادثة جديدة واذكر:

> اقرأ `docs/handoffs/2026-09-02-evening-home-handoff/README.md` و `CONTINUE-PLAN-AR.md` ثم استكمل من آخر commit على `main`.

---

## ملفات محورية (0.4.38–0.4.40)

```
apps/web/src/components/stays/stays-browse.tsx
apps/web/src/lib/stays-browse-filters.ts
apps/web/src/lib/search-stays-catalogue-neon.ts
apps/web/src/app/api/public/stays/catalogue/route.ts
apps/web/src/app/[locale]/stays/page.tsx
apps/web/src/components/stays/stay-guest-info-section.tsx
apps/web/src/components/property-detail-manager.tsx
apps/web/src/app/globals.css                    # property-360 alternating sections
docs/implementation/RELEASE-0.4.38-AR.md
docs/implementation/RELEASE-0.4.39-AR.md
docs/implementation/RELEASE-0.4.40-AR.md
```

---

## ما لم يُغلق بعد

- نشر بقية وحدات مبنى النور (R-02, R-03, S-01, S-02) من معالج الإعداد (`publish_status = published`)
- `scripts/set-database-url.mjs` و `packages/db/tmp-migrate-*.mjs` — **محلي فقط**، غير مرفوع
- Pilot flags: `STAYS_PLATFORM_ENABLED` + `STAYS_ORG_ALLOWLIST` على Render/Vercel

---

## commits ذات الصلة (الأحدث أولاً)

| Commit | الملخص |
| --- | --- |
| *(هذا التسليم)* | أرشفة المحادثة الكاملة + handoff المنزل |
| `0079e42` | تصحيح hash وثيقة 0.4.40 |
| `2e4b80b` | 0.4.40 — عناوين أكبر + خلفيات متناوبة |
| `9c7d0a8` | توثيق 0.4.38–0.4.39 |
| `f00ff0a` | 0.4.39 — إصلاح SQL الكatalog |
| `2bcf82e` | 0.4.38 — browse إقامات per-unit |
