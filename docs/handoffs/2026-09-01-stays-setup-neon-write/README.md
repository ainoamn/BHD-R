# تسليم — إعداد الإقامة اليومية + أرشفة المحادثة الكاملة

**تاريخ التوثيق:** 2026-09-01  
**وقت التوثيق (مسقط / Asia/Muscat / UTC+4):** 17:20  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main` (مدموج مباشرة — لا PR معلّق)  
**آخر commit عند التوثيق:** `38b4f26` — *Stays setup saves via Vercel Neon as 0.4.22.*  
**معرّف محادثة Cursor:** [d0d5551b-99f7-449e-92d1-5d812bcf527d](d0d5551b-99f7-449e-92d1-5d812bcf527d)

---

## أين توقّفنا الآن

### ما اكتمل في جلسة الإقامات اليومية (0.4.19 → 0.4.22)

| الإصدار | Commit | الملخص |
| --- | --- | --- |
| **0.4.19** | `8f3fb79` | API إعداد الإقامة + معالج 5 خطوات + نشر |
| **0.4.20** | `a7d6779` | إصلاح `STAYS_ORG_ALLOWLIST` الفارغ → pilot مفتوح |
| **0.4.21** | `737bf84` | تحميل سياق المعالج SSR + fallback قراءة Neon |
| **0.4.22** | `38b4f26` | **حفظ/نشر عبر Vercel/Neon** — لا يعتمد على Nest timeout |

### مشاكل المستخدم التي أُصلحت (0.4.22)

1. رسالة «تم التحميل من قاعدة البيانات (Nest: 503…). الحفظ يتطلب Nest» — **أُزيلت** عند توفر `DATABASE_URL` على Vercel.
2. **حفظ ومتابعة** + `Failed to fetch` — الحفظ يمر الآن عبر `/api/owner/stays/setup` على Vercel.
3. زر **إعداد الإقامة اليومية** — أصبح زراً بارزاً ضمن شبكة إجراءات العقار.
4. عرض العقار في المعالج — بطاقة ملخص + جدول وحدات (مثل المحفظة).

### تحقق فوري من الجهاز الثاني

- [ ] `git pull origin main` → HEAD = `38b4f26` أو أحدث
- [ ] [إدارة مبنى النور](https://r.bhd-om.com/ar/owner/properties/d0840631-707d-477a-853a-043572d49240) — زر «إعداد الإقامة اليومية» بارز
- [ ] [معالج الإعداد](https://r.bhd-om.com/ar/owner/stays/setup?propertyId=d0840631-707d-477a-853a-043572d49240) — بطاقة عقار + جدول وحدات، **بدون** رسالة Nest 503
- [ ] اختيار وحدات → **حفظ ومتابعة** → ينتقل للخطوة 2
- [ ] إكمال الخطوات حتى النشر → ظهور في `/ar/stays` (قد يحتاج Nest لاحقاً لمزامنة inventory عبر outbox)

---

## المحادثة كاملة (نسخة حرفية)

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript-FULL.jsonl`](./conversation-transcript-FULL.jsonl) | JSONL خام كامل (**3635** سطر) — SHA256 `e8412578b4d1601e4edc14e6817142b0e37f03f5e6ac3140d71f50cd1f7090d4` (**أسرار منقّحة**) |
| [`conversation-readable-FULL.md`](./conversation-readable-FULL.md) | نسخة مقروءة (**1270** رسالة مستخرجة) |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) | **خطة الاستكمال بالأولويات** |

**نطاق المحادثة:** من مراجعة BHD-OM وبناء BHD R (2026-08-23) حتى إصلاح إعداد الإقامة اليومية ورفع 0.4.22 (2026-09-01).

> **تنبيه أمني:** قبل الرفع إلى GitHub، استُبدلت مفاتيح API (Resend، Cloudflare، `DATABASE_URL`، إلخ) بـ `[REDACTED-…]` في JSONL والنسخة المقروءة. سياق المحادثة كامل؛ القيم الحساسة فقط مُنقّحة.

**تسليم سابق (2026-08-31):** [`../2026-08-31-evening-continue-tomorrow/`](../2026-08-31-evening-continue-tomorrow/)

---

## كيف تبدأ من الكمبيوتر الآخر

```bash
git clone https://github.com/ainoamn/BHD-R.git
cd BHD-R
git pull origin main
```

ثم افتح بالترتيب:

1. هذا الملف (`README.md`)
2. [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md)
3. [`docs/implementation/RELEASE-0.4.22-AR.md`](../../implementation/RELEASE-0.4.22-AR.md)
4. عند الحاجة: `conversation-readable-FULL.md` أو الـ JSONL الكامل

**في Cursor:** افتح محادثة جديدة واذكر:
> اقرأ `docs/handoffs/2026-09-01-stays-setup-neon-write/README.md` و `CONTINUE-PLAN-AR.md` ثم استكمل من آخر commit على `main`.

---

## حالة البيئة (عند التوثيق)

| الطبقة | المتغير / الحالة |
| --- | --- |
| **Vercel** | `STAYS_PLATFORM_ENABLED=true` · `DATABASE_URL` مطلوب للحفظ |
| **Render Nest** | `STAYS_PLATFORM_ENABLED=true` · `STAYS_ORG_ALLOWLIST=*` أو فارغ (0.4.20+) |
| **الإصدار** | `0.4.22` |
| **Nest للإعداد** | **اختياري** للتحميل/الحفظ — مطلوب لاحقاً لـ inventory rebuild من outbox |

---

## ملفات محورية (0.4.22)

```
apps/web/src/lib/stay-setup-neon.ts          # قراءة/كتابة Neon
apps/web/src/lib/stay-setup-context.ts       # SSR تحميل الصفحة
apps/web/src/app/api/owner/stays/setup/route.ts
apps/web/src/app/api/owner/stays/setup/context/route.ts
apps/web/src/components/stays/stay-setup-wizard.tsx
apps/web/src/components/property-manage-hub.tsx
apps/api/src/stays/stays-setup.service.ts    # Nest (مرجع + outbox consumer)
packages/contracts/src/stays/setup-schemas.ts
packages/config/src/feature-flags.ts
docs/product/daily-stays/                    # خطة المنتج
```

---

## commits ذات الصلة (الأحدث أولاً)

| Commit | الملخص |
| --- | --- |
| *(هذا التسليم)* | أرشفة المحادثة الكاملة + HANDOFF |
| `38b4f26` | 0.4.22 — حفظ إعداد الإقامة عبر Vercel/Neon |
| `737bf84` | 0.4.21 — SSR context + Neon read fallback |
| `a7d6779` | 0.4.20 — allowlist fix |
| `8f3fb79` | 0.4.19 — setup API + wizard |
| `59c7324` | رابط الإقامة في تصفح العقارات العام |

---

## ما لم يُغلق بعد (لا تفترض أنه جاهز)

- **inventory days** بعد النشر: outbox `stay.inventory.changed` — Nest worker يعيد البناء عند الاستيقاظ
- **Render redeploy** مطلوب إذا Nest قديم (< 0.4.20) على allowlist
- قسم «الإقامات» في قائمة المحفظة (شارات sale + rent + daily) — اختياري
- `scripts/set-database-url.mjs` — **محلي فقط**، غير مرفوع (قد يحتوي أسرار)
