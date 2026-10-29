# الإصدار 0.8.135.x — إغلاق بوابات CI واستقرار Nest على Render

**التاريخ:** 2026-10-29  
**الالتزام الحالي على `main`:** `54c6b1a9` (وما قبله `48107e33` / `cc6fa4cf`)

## ما أُغلق

### Render API (`bhd-r.onrender.com`)

- `autoDeploy: false` في `render.yaml` لوقف وابل Failed خلال &lt;2 ثانية.
- `PII_LOOKUP_PEPPER` إلزامي (≥32 بايت عشوائي) وإلا يرفض Nest الإقلاع.
- التحقق الحي: `/healthz` → `nestReady: true`، `/health/ready` → `database: ok`.
- النشر: **Manual Deploy** فقط من لوحة Render (أو Deploy Hook). لا تعتمد على Auto-Deploy On Commit.

### ترحيلات قاعدة البيانات (`packages/db/src/migrate.ts`)

- المُرحِّل يطبّق **كل** ملفات `migrations/custom/*.sql` مرتبة بعد Drizzle generated.
- كان تخطّي `0020`–`0023` و`0046`–`0051` يترك أعمدة مثل `stay_profiles.deposit_minor` و`stay_deposit_claims.reference_code` ناقصة في CI.
- اختبار قفل المخزون يتعرّف على `stay_inventory_locks_slot_conflict` (ترحيل `0023`) بدل قيد GiST القديم.

### Playwright E2E (بوابة «mock API fixture»)

- محدّدات محدّثة: `.login-screen` / `.login-card`، ومعالج العقار `.wizard-progress__item` × 7.
- mock API يجيب `/healthz` (مسبار Next/Nest).
- `E2E_FORCE_NEST_FIXTURES=1` في تشغيل الويب أثناء e2e حتى لا تحجب قاعدة CI الفارغة صفوف الـ fixture عبر مسار Neon.

## ما بقي مفتوحًا

| المسار          | الحالة                                                     |
| --------------- | ---------------------------------------------------------- |
| Security        | ناجح على `54c6b1a9`                                        |
| CI / Playwright | راقب التشغيل `#938` على نفس الالتزام                       |
| Lighthouse      | ما زال يفشل (CLS / LCP / حجم JS) — مسار منفصل عن Nest/DB   |
| تدوير الأسرار   | إن ظهرت قيم إنتاج في الشات سابقًا، دوّرها في Render/Vercel |

## أوامر التحقق السريعة

```bash
# إنتاج Nest
curl -sS https://bhd-r.onrender.com/healthz
curl -sS https://bhd-r.onrender.com/health/ready

# محليًا بعد سحب main
pnpm db:migrate
pnpm --filter @bhd-r/web test:e2e
```

## مراجع

- `CHANGELOG.md` — إدخالات `0.8.135.12` … `0.8.135.15`
- [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md) — Manual Deploy و`PII_LOOKUP_PEPPER`
- `.github/workflows/ci.yml` — وظيفة Browser E2E
