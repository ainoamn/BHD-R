# الإصدار 0.4.19 — إعداد ونشر الإقامة اليومية (Setup API + معالج)

**التاريخ:** 2026-09-01  
**العلم:** `STAYS_PLATFORM_ENABLED` + `STAYS_ORG_ALLOWLIST` — لا يظهر للجمهور حتى التفعيل.

## ماذا أُضيف؟

### Nest API — إعداد الإقامة

| Method | Path | الصلاحية |
| ------ | ---- | -------- |
| GET | `/v1/stays/setup/context?propertyId=` | `stay.inventory.manage` |
| POST | `/v1/stays/setup/unit-types` | `stay.inventory.manage` |
| POST | `/v1/stays/setup/profiles` | `stay.inventory.manage` |
| PATCH | `/v1/stays/setup/profiles/:id` | `stay.inventory.manage` |
| POST | `/v1/stays/setup/profiles/:id/rate-plan` | `stay.rate.manage` |
| POST | `/v1/stays/setup/listings` | `stay.inventory.manage` |
| POST | `/v1/stays/setup/profiles/:id/publish` | `stay.inventory.manage` |

- إنشاء `stay_unit_types`، `stay_profiles`، `stay_rate_plans`، `stay_public_listings`.
- النشر يفعّل الملف والإعلان ويُعيد بناء `stay_inventory_days` فوراً + حدث outbox للـ worker.

### الواجهة

- **معالج الإعداد** (`/owner|developer/stays/setup?propertyId=`) — 5 خطوات فعلية: وحدات → سعة → سعر → محتوى → نشر.
- `browserGet` لقراءة سياق الإعداد من Nest عبر BFF.

## تفعيل إنتاجي (بشري)

### 1) Neon

```bash
pnpm --filter @bhd-r/db migrate
# تأكد من 0015_stays_core + 0015_stays_rls
```

### 2) Render (Nest + Worker)

```env
STAYS_PLATFORM_ENABLED=true
STAYS_ORG_ALLOWLIST=<uuid-مؤسستك>   # أو * للاختبار الداخلي فقط
```

أعد النشر من `main`.

### 3) Vercel (Web)

```env
STAYS_PLATFORM_ENABLED=true
```

(السماح للمؤسسة يُفرَض على Nest؛ الويب يتحكم في تبويب الصفحة الرئيسية و`/stays`.)

### 4) مسار التجربة

1. افتح عقاراً → **إعداد الإقامة اليومية**.
2. اختر وحدة/وحدات → سعة → سعر الليلة → عنوان وslug → **نشر**.
3. تحقق: `https://r.bhd-om.com/ar/stays` — يظهر الإعلان.
4. تحقق: الصفحة الرئيسية — تبويب **إقامة يومية**.

## ما لم يتغيّر

- البيع والإيجار الطويل — كما هو.
- استيراد iCal/OTA — ما زال موقوفاً.
- الدفع — sandbox حتى بوابة حقيقية.

## تحقق

| فحص | متوقع |
| --- | ----- |
| Flag off | `/ar/stays` → 404؛ لا تبويب يومي في الرئيسية |
| Flag on + allowlist | `/v1/stays/inventory/health` → 200 للمالك |
| بعد النشر | `GET /v1/public/stays/search` يعيد slug المنشور |
| Regression | حفظ عقار + إيجار + بيع — بدون انكسار |
