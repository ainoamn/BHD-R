# تكامل المحاسبة: BHD-R ↔ Hisaby

**تاريخ:** 2026-09-09  
**الحالة:** **منشور على `main`** (BHD-R `1478983` · Hisaby `6c410e4`) — يتطلب ترحيل قواعد البيانات على الإنتاج قبل أول ربط  
**قرار:** D-207  
**دليل Hisaby التشغيلي:** [HISABY-BHD-R-INTEGRATION.md](https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md)

**المستودعات:**
- عقارات: [ainoamn/BHD-R](https://github.com/ainoamn/BHD-R) · https://r.bhd-om.com · API https://api.r.bhd-om.com  
- محاسبة: [ainoamn/hisaby](https://github.com/ainoamn/hisaby) · https://hisaby.bhd-om.com  

---

## النتيجة للمالك

بعد حفظ المفاتيح **مرة واحدة**، الاتجاهان يعملان تلقائياً بدون تدخل لاحق:

| الاتجاه | الآلية |
| --- | --- |
| عقارات → حسابي (فوري) | Worker يدفع إلى `POST https://hisaby.bhd-om.com/api/integrations/bhd-r/events` |
| حسابي ← عقارات (دوري) | Hisaby يسحب كل 15 دقيقة (+ فوراً بعد حفظ المفتاح) |

**ما يُنقل:** العقارات والعناوين والوحدات، الجهات (اسم/هاتف/بريد/عنوان)، الفواتير، التحصيلات الواردة، المصروفات الصادرة، التواريخ، والمعاملات. كل عقار → **مركز تكلفة** في المحاسبة.

---

## قرار معماري (لا نسخ)

BHD-R = محاسبة تشغيلية مبسّطة للعقار. Hisaby = GL مفصّل. التكامل عبر API + SSO فقط — لا دمج مستودعات.

```
BHD-R (عقارات)                    Hisaby (محاسبة)
─────────────────                 ─────────────────
فواتير / مدفوعات / مصروفات  ──►  فواتير + سندات + قيود + مراكز تكلفة
SSO + مفاتيح + outbox push        سحب 15 د + استقبال أحداث
```

---

## خطوات الربط (مرة واحدة)

1. في حسابي [`/bhd-r`](https://hisaby.bhd-om.com/bhd-r): أنشئ **رمز التكامل الوارد**.  
2. في العقارات [`/ar/owner/api-keys`](https://r.bhd-om.com/ar/owner/api-keys): الصق الرمز +  
   `https://hisaby.bhd-om.com/api/integrations/bhd-r/events` → **حفظ الربط التلقائي**.  
3. في العقارات: **تعبئة صلاحيات حسابي الكاملة** → أنشئ المفتاح → انسخه مرة واحدة.  
4. في حسابي: الصق مفتاح القراءة واحفظ → تبدأ المزامنة فوراً ثم كل 15 دقيقة.

تفاصيل المفاتيح: [`HISABY-API-KEYS-AR.md`](./HISABY-API-KEYS-AR.md)

---

## ترحيل الإنتاج (إلزامي قبل أول ربط)

### حسابي
```sh
# من جذر مشروع hisaby على السيرفر / CI
prisma migrate deploy
# يطبّق ترحيلات bhd_r_integration و bhd_r_auto_sync
```
توليد عميل Prisma محلياً إن فشل بسبب Prisma 7: استخدم نسخة المشروع ومرّر  
`--schema=backend/src/prisma/schema.prisma` — **لا يوقف النشر**؛ المهم `migrate deploy` على الإنتاج.

### عقارات (BHD-R)
```sh
pnpm --filter @bhd-r/db migrate
# يطبّق custom/0024_hisaby_links.sql (جدول hisaby_links + RLS + منح العامل)
```
أو نفّذ SQL الملف مباشرة على Neon. عند أول `PUT /v1/integrations/hisaby/connection` يُنشأ الجدول أيضاً عبر `ensureHisabyLinksTable` إن غاب الترحيل — لكن منح `bhd_r_worker` تحتاج 0024 أو `APPLY_PRIVILEGED_ROLES=true`.

---

## نقاط API ثابتة

| دور | مسار |
| --- | --- |
| استقبال أحداث (Hisaby) | `POST https://hisaby.bhd-om.com/api/integrations/bhd-r/events` |
| تصدير لقطة (BHD-R) | `GET /v1/integrations/hisaby/export` |
| ربط الدفع (BHD-R) | `PUT/GET /v1/integrations/hisaby/connection` |
| إدارة الرمز (Hisaby) | `/api/integrations/bhd-r/*` وواجهة `/bhd-r` |

---

## ما يبقى تحسينات داخل BHD-R فقط

**0.4.80:** تفاصيل الحركة + طباعة + كشف CSV على `/owner/accounting` (تشغيلي).  
الميزان/الأستاذ/الكشوفات الضريبية تبقى في **Hisaby** — لا نسخ bhd-om.
