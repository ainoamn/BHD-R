# تسليم العمل — جلسة Nest على Render (2026-08-26)

**الغرض:** متابعة العمل من جهاز آخر دون فقدان السياق.  
**المستودع:** [ainoamn/BHD-R](https://github.com/ainoamn/BHD-R) — الفرع **`main`** (مدمج ومرفوع؛ لا يوجد PR معلّق).  
**آخر commit موثّق لهذه الجلسة:** انظر `git log -20 --oneline` (يشمل `06151d5` إصلاح CORS و`8cd1a3e` التوثيق).  
**إصدار المنتج:** **0.2.45** (`CHANGELOG.md`).

---

## 1) أين نحن الآن (الحالة الحية)

| مكوّن | عنوان | ملاحظة |
| --- | --- | --- |
| Nest API (Render Free Docker) | https://bhd-r.onrender.com | خدمة `BHD-R` / `srv-da6nrmm7bikc739638og` |
| واجهة المالك (Vercel) | https://bhd-r-api-phi.vercel.app | Root = `apps/web` |
| فرع Git | `main` ↔ `origin/main` | كل إصلاحات الجلسة على `main` مباشرة |

### فحص سريع (يجب أن ينجح قبل أي عمل جديد)

```text
GET https://bhd-r.onrender.com/healthz
→ {"status":"ok","service":"bhd-r-api","nestReady":true,"dispatch":"express-proxy",...}

GET https://bhd-r.onrender.com/raw-ping
→ {"ok":true,"via":"express"}

GET https://bhd-r.onrender.com/health/live
→ {"status":"ok","service":"bhd-r-api","timestamp":"..."}

GET https://bhd-r.onrender.com/v1/auth/csrf   (بدون كوكي)
→ 401 Authentication is required   ← هذا صحيح؛ يعني Nest يرد
```

إذا `/healthz` ok و`/raw-ping` أو `/health/live` يعلّقان → **ارجع إلى القسم 5** (تشخيص).

---

## 2) المعمارية الحالية لـ API على Render (بعد 0.2.45)

الملف الحرج: `apps/api/src/main.ts`

```text
الإنترنت
   │
   ▼
[حافة Node خام]  listen(PORT=10000, 0.0.0.0)
   │  • GET /healthz  → JSON فوري (Render Health Check)
   │  • غير ذلك       → إن nestReady: بروكسي إلى 127.0.0.1:(PORT+1)
   │                   وإلا 503 { status: "starting" }
   ▼
[Nest + Express]  listen(NEST_INTERNAL_PORT أو PORT+1, 127.0.0.1)
   │  • GET /raw-ping     → Express خام (قبل مسارات Nest)
   │  • /health/live|/v1/* → Nest controllers + guards
```

**لماذا Express وليس Fastify؟**  
Fastify على Render ظهر أنه يستمع دون معالجة HTTP بشكل موثوق (صفحات بيضاء / مهلات). التحويل إلى `@nestjs/platform-express` + الحافة أعلاه.

**لماذا CORS callback؟**  
حزمة `cors` في Express تستدعي `origin(origin, callback)`. تمرير دالة متزامنة فقط (`resolveCorsOrigin`) **لا تستدعي callback أبداً** → كل مسارات Nest تعلّق إلى الأبد، بينما `/raw-ping` (مسجّل قبل `enableCors`) يبدو سليماً.

```ts
// الصحيح في main.ts
origin: (origin, callback) => {
  callback(null, resolveCorsOrigin(origin));
}
```

**إعدادات Render المطلوبة**

| إعداد | قيمة |
| --- | --- |
| Health Check Path | **`/healthz`** |
| `PORT` | **`10000`** |
| Dockerfile | `Dockerfile.api` |
| Branch | `main` |

**Vercel (web)** يجب أن يحتوي على:

- `API_INTERNAL_ORIGIN` = `https://bhd-r.onrender.com`
- `API_ORIGIN` = نفس القيمة (إن استُخدم)
- طلبات المتصفح للكتابة تمر عبر BFF: `/api/backend/v1/*` (مهلة كتابة ~25s)

---

## 3) المشكلة الظاهرة للمستخدم (طوال اليوم)

1. الموقع Live و`/healthz` يعرض `{"status":"ok",...}`.
2. `/raw-ping` صفحة بيضاء / لا رد.
3. في `/ar/owner/properties/new` → «جاري حفظ العقار…» ثم:
   > تعذر الوصول إلى Nest أو انتهت المهلة. من Render تأكد أن الخدمة Live ثم افتح /healthz

**الاستنتاج التشخيصي:**  
`/healthz` كان يُجاب من Node خام (أو مسار قصير) **بدون** أن يعني أن مسارات Nest `/v1/*` تعمل. الواجهة تعتبر الخدمة «متصلة» بينما الحفظ يفشل.

---

## 4) سجل المشاكل والمحاولات (مرتّب زمنياً تقريباً)

| # | المشكلة / العرض | المحاولة | النتيجة | الدرس |
| ---: | --- | --- | --- | --- |
| 1 | Nest نائم / cold start (Free) | `/api/warm` + cron كل 5 دقائق على `/healthz` | يخفّف النوم؛ لا يصلح علّق المسارات | Free tier يبقى هشاً |
| 2 | `REDIS_URL` = رابط لوحة Upstash (HTTPS) | فرض `redis://` / `rediss://` في config | إصلاح إقلاع | لا تلصق رابط المتصفح |
| 3 | Render: No open HTTP ports / `PORT=4000` vs 10000 | فرض أو مواءمة `PORT=10000` | ضرورية للمنصة | Dashboard `PORT=10000` |
| 4 | `/health/ready` يعلّق على Neon Free | Health check → `/health/live` ثم لاحقاً `/healthz` | المنصة تبقى Live | جاهزية DB منفصلة عن port-scan |
| 5 | Fastify `serverFactory` يقطع `/healthz` مبكراً | short-circuit للصحة فقط | **كسر** `/raw-ping` و`/v1` | لا تعترض الطلب قبل Fastify بالكامل |
| 6 | early-bind نفس السيرفر لـ Fastify | ربط Node ثم Nest على نفس السوكِت | صحة ok؛ مسارات Nest معلّقة | لا يكفي |
| 7 | بروكسي عام → Fastify على `127.0.0.1:PORT+1` (`acf8283`) | فصل الحافة عن Nest | `/healthz` ok؛ `/raw-ping` معلّق | Fastify TCP/HTTP مكسور عملياً |
| 8 | `fastify.inject()` بدون `listen` (`fe8686a`) | حقن الطلبات من الحافة | Nest لم يصبح جاهزاً / `ready` علّق | inject ليس حلاً إنتاجياً هنا |
| 9 | التحويل إلى Express (`a72e60e`…) | ExpressAdapter + بروكسي | `/raw-ping` Express يعمل؛ Nest controllers تعلّق | ليس Fastify وحده |
| 10 | تعطيل الحراس مؤقتاً (`5df0402`) | تشخيص | ما زال `/health/live` يعلّق | ليس Guard |
| 11 | **CORS sync على Express** (`06151d5`) | `origin(origin, cb)` | **`/health/live` و`/v1` يردّان** | **الجذر الحقيقي الأخير** |

### ما تغيّر في الكود (ملفات أساسية)

- `apps/api/src/main.ts` — حافة + بروكسي + Express + CORS callback
- `apps/api/src/common/api-http.ts` / `http-request.ts` — أنواع Express بدل Fastify
- حراس/filters/controllers — `ApiRequest` / `ApiResponse` + كوكيز Express (`maxAge` بالميلي ثانية)
- إزالة `@nestjs/platform-fastify` و`@fastify/*` من `apps/api`
- ويب سابقاً في الجلسة الأوسع: BFF `/api/backend`، warm/cron على `/healthz`، قراءة عقارات من Neon عند تعطل Nest

---

## 5) إذا عادت المشكلة — مسار التشخيص (اتبع بالترتيب)

### أ) مصفوفة الأعراض → السبب المحتمل

| العرض | المعنى الأرجح | الخطوة التالية |
| --- | --- | --- |
| Render Unhealthy / Failed | إقلاع أو Health path خاطئ | Logs + Health=`/healthz` + `PORT=10000` |
| `/healthz` لا يرد | الحاوية ميتة أو نامية جداً | Manual Deploy / Upgrade من Free |
| `/healthz` ok و`nestReady:false` طويل | Nest لم يُكمل `listen` الداخلي | Logs: ابحث `bootstrap failed` / Redis / env |
| `/healthz` ok و`/raw-ping` أبيض | الحافة لا تصل لـ Express أو Express لم يقلع | Logs: `Nest Express listening on 127.0.0.1` |
| `/raw-ping` ok و`/health/live` يعلّق | **انحدار CORS أو middleware Nest** | راجع `enableCors` يجب أن يستدعي `callback` |
| `/health/live` ok والحفظ يفشل بـ 401/403 | جلسة/CSRF وليست شبكة | CSRF cookie + BFF Origin |
| الحفظ يفشل بعد ~25s برسالة المهلة | BFF لم يصل Nest أو Nest بطيء/نائم | warm ثم أعد؛ راقب Render Metrics |
| قوائم تظهر وحفظ لا | متوقع: قراءة Neon احتياطية؛ الكتابة تحتاج Nest | أصلح Nest أولاً |

### ب) أوامر فحص سريعة (من أي جهاز)

```powershell
curl.exe -sS -m 15 https://bhd-r.onrender.com/healthz
curl.exe -sS -m 15 https://bhd-r.onrender.com/raw-ping
curl.exe -sS -m 15 https://bhd-r.onrender.com/health/live
```

في Render → Logs بعد الإقلاع يجب أن ترى تقريباً:

```text
BHD-R API public edge listening ...
BHD-R API Nest Express listening on 127.0.0.1:10001 (public 10000)
BHD-R API internal /health/live → 200 ...
```

### ج) مسارات بديلة إذا تعذّر الحل على Render Free

1. **ترقية Render** إلى instance لا ينام (يزيل cold start 50s+).
2. **استضافة Nest** على Fly.io / VM / Docker على VPS مع نفس `Dockerfile.api`.
3. **الإبقاء على قراءة Neon من Vercel** للقوائم (موجود) — لا يغني عن Nest للحفظ/الوسائط/العقود.
4. **لا ترجع إلى Fastify على Render** دون إثبات محلي + staging؛ التكلفة كانت يوماً كاملاً من التشخيص المضلل.
5. **لا تستخدم `serverFactory` short-circuit** لمسارات الصحة فقط — يكسر باقي المسارات.
6. عند لمس CORS على Express: **دائماً** `callback(null, result)` — لا تعتمد على القيمة الراجعة المتزامنة وحدها.
7. تدوير الأسرار إن ظهرت في محادثات سابقة (Neon / Redis / OAuth) قبل الإنتاج النهائي.

---

## 6) قائمة استكمال مقترحة (الجهاز الآخر)

1. من البوابة: حفظ عقار تجريبي بعد «إعادة الاتصال بـ Nest» والتأكد من ظهوره في القائمة.  
2. التحقق من رفع صورة العقار عبر `/v1/media/ingress/...` (rawBody معطّل حالياً على Nest — قد تحتاج مسار raw محدود للويب هوك/الرفع لاحقاً).  
3. تأكيد Vercel Preview/Production على نفس `API_INTERNAL_ORIGIN`.  
4. مراجعة أن Health Check في Render ما زال `/healthz`.  
5. (اختياري) تبسيط الحافة لاحقاً إن ثبت أن Express `listen` مباشرة على `0.0.0.0:PORT` مستقر مع CORS الصحيح — اليوم الحافة+البروكسي هو المسار المعتمد.  
6. تطبيق هجرات Neon إن لم تُطبَّق (`STATUS.md`).  
7. **لا ترفع** `scripts/set-database-url.mjs` إن وُجد محلياً (قد يحتوي أسراراً) — يبقى untracked عمداً.

---

## 7) روابط مرجعية داخل المستودع

| وثيقة | محتوى |
| --- | --- |
| هذا الملف | تسليم الجلسة + سجل الأعطال |
| [`NEST-API-HOSTING.md`](./NEST-API-HOSTING.md) | تشغيل Nest / Render / Vercel |
| [`VERCEL-MANUAL-AR.md`](./VERCEL-MANUAL-AR.md) | خطوات Vercel بالعربي |
| [`STATUS.md`](./STATUS.md) | حالة التنفيذ العامة |
| [`../../CHANGELOG.md`](../../CHANGELOG.md) | 0.2.33 → 0.2.45 |
| محادثة Cursor | [Nest Render hang session](d0d5551b-99f7-449e-92d1-5d812bcf527d) |

---

## 8) جملة واحدة للمتابعة

> Nest على Render يعمل الآن بـ **Express خلف حافة `/healthz`**، والعلّق الأخير كان **CORS بدون callback**. قبل أي تغيير جديد: أثبت `/raw-ping` و`/health/live` و`/v1` ثم جرّب حفظ العقار.
