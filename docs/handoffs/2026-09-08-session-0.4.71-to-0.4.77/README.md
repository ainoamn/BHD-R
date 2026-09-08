# تسليم جلسة 2026-09-08 — من 0.4.71 إلى 0.4.77

**آخر commit على `main`:** `752e325`  
**الإصدار:** 0.4.77  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com · Vercel مشروع `bhd-r-api` (Root: `apps/web`)  
**الفرع الوحيد للعمل:** `main`

## على الجهاز الآخر — ابدأ هكذا

```sh
git fetch origin
git checkout main
git pull origin main
# يجب أن ترى: 752e325 … (0.4.77)
```

Node ≥ 22 مفضّل؛ إن ظهرت تحذيرات engines محلياً:

```sh
pnpm --config.engine-strict=false install
pnpm --config.engine-strict=false --filter @bhd-r/web exec tsc --noEmit
```

لا تعتمد على Cloudflare Workers لهذا المنتج — الواجهة على Vercel فقط.

---

## ماذا شُحن اليوم (ملخص زمني)

| إصدار | Commit | الغرض |
| --- | --- | --- |
| 0.4.71 | `870259b` + `ae5603f` + `ef31b54` | نبض عمليات العقار (حجوزات/عقود/مالية)، أوضاع التخصيص sale/monthly/yearly/daily، استبعاد daily-only من `/properties`، دمج مدفوعات الإقامة في المحاسبة، تصفية حجوزات الإقامة بـ `?propertyId=` |
| 0.4.72 | `be86e03` | إصلاح بناء Vercel: فصل `unit-offering-modes` (client) عن `ensure-unit-offering-modes-column` (server-only) |
| 0.4.73 | `9a26a35` | تسخين/prefetch تنقل البوابة (محاولة أولى) |
| 0.4.74 | `556388d` | إصلاح مهلة بناء الصفحة الرئيسية (Neon hang أثناء SSG) |
| 0.4.75 | `89835d9` | تنقل SPA: `PortalPage` / `persistentPortalPage`، prefetch متدرّج، History API للأقسام، soft save للعقار |
| 0.4.76 | `842db0b` | محاسبة: مطابقة أعمدة صفوف الإقامة + احتياطي حجوزات مؤكدة |
| 0.4.77 | `752e325` | محاسبة Neon-first + سقف Nest 1.2ث + race لـ healthz (إصلاح بطء دقيقتين) |

ملاحظات الإصدار: `docs/implementation/RELEASE-0.4.7{1..7}-AR.md`  
الأداء العام للبوابة: `docs/implementation/PORTAL-PERF-AR.md`

---

## ملفات محورية للمتابعة

### تنقل البوابة (SPA)
- `apps/web/src/components/portal-main-slot.tsx`
- `apps/web/src/components/portal-page.tsx`
- `apps/web/src/lib/persistent-portal-page.tsx`
- `apps/web/src/components/portal-route-prefetch.tsx`
- `apps/web/src/components/portal-nav.tsx`
- `apps/web/tests/unit/portal-navigation.test.tsx`

### محاسبة / نبض العقار
- `apps/web/src/lib/portal-ops-workspace.ts` — مسار accounting Neon-first
- `apps/web/src/lib/portal-ops-data.ts` — `listStayAccountingRows` + fallback الحجوزات
- `apps/web/src/lib/property-ops-pulse-neon.ts`
- `apps/web/src/components/property-manage-hub.tsx`

### أوضاع التخصيص
- `apps/web/src/lib/unit-offering-modes.ts` (بدون server-only)
- `apps/web/src/lib/ensure-unit-offering-modes-column.ts` (server-only)
- `apps/web/src/components/property-wizard.tsx`

---

## تحقق يدوي متبقٍ على الإنتاج

1. `/ar/owner` — انتظر ~3ث ثم تنقّل بين الأقسام (يجب أن يكون فورياً تقريباً).
2. مسودة إضافة عقار → زيارة عدة أقسام → الرجوع (تبقى الحقول).
3. `/ar/owner/accounting` — صفوف ST-… مع بيان وتاريخ خلال ثوانٍ (ليس دقيقتين). حدّث بـ Ctrl+F5 إن ظهرت بيانات قديمة من كاش الجلسة.
4. صفحة عقار مالك: نبض الحجوزات/المالية بعد دفع إقامة.
5. إضافة عقار بأوضاع بيع/شهري/سنوي/يومي؛ daily-only لا يظهر في `/ar/properties`.

---

## حدود معروفة / لا تلمس بالخطأ

- `id.bhd-om.com` و`www.bhd-om.com` مشروعان منفصلان — soft nav داخل BHD-R لا يشملهما.
- Nest على Render Free ينام؛ المحاسبة لم تعد تنتظره، لكن أقسام أخرى ما زالت قد تتأثر إن لم يوجد مسار Neon.
- كاش ops في المتصفح: TTL طازج ~5 دقائق — بعد إصلاح السيرفر قد تحتاج تحديثاً قاسياً مرة.
- مشروع Vercel الصحيح: **`bhd-r-api`** فقط (ليس مشروع `web` القديم).
- لا ترفع أسرار `.env*`؛ استخدم env على Vercel/Render.

---

## عمل مقترح للجهاز التالي (إن لزم)

1. تأكيد Vercel Success لـ `752e325` ثم إعادة اختبار المحاسبة والتنقل يدوياً.
2. إن بقي بطء في أقسام غير المحاسبة: نفس نمط Neon-first + race لـ Nest.
3. اختبار Playwright للتنقل/مسودات النماذج إن توفّر خادم محلي.
4. مراجعة فشلَي `next-write-route-policy.test.ts` القديمين (غير مرتبطين بهذه الجلسة).

---

## روابط سريعة

- الحالة: [`docs/implementation/STATUS.md`](../../implementation/STATUS.md)
- CHANGELOG الجذر: [`CHANGELOG.md`](../../../CHANGELOG.md)
- تنقل 0.4.75: [`../2026-09-08-portal-nav-0.4.75/`](../2026-09-08-portal-nav-0.4.75/)
- نبض عقار 0.4.71: [`../2026-09-08-property-ops-0.4.71/`](../2026-09-08-property-ops-0.4.71/)
