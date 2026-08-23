# Worker والطوابير

## الطوابير

| الاسم                | الغرض                                  | concurrency الافتراضي |
| -------------------- | -------------------------------------- | --------------------: |
| `bhd-r.media`        | فحص الصور، الأصل الخاص وvariants مائية |                     3 |
| `bhd-r.pdf`          | عقود وفواتير وإيصالات PDF              |                     2 |
| `bhd-r.notification` | البريد                                 |                     5 |
| `bhd-r.dead-letter`  | metadata للفشل النهائي فقط             |      لا مستهلك تلقائي |

الـpayload يحتوي organization/correlation IDs ولا يكتب إلى log. attempts=5 مع exponential backoff. jobs تستخدم `outbox.id` كـjobId لمنع التكرار. DLQ لا يخزن recipient أو HTML أو token؛ فقط queue/job/error code/time.

## Transactional outbox

داخل transaction المجال، يسجل API صفاً في `outbox_events`:

```sql
id uuid primary key,
organization_id uuid,
topic text not null,
aggregate_type text not null,
aggregate_id uuid not null,
payload jsonb not null,
attempts integer not null default 0,
occurred_at timestamptz not null default now(),
published_at timestamptz
```

Worker يقفل دفعة بـ`FOR UPDATE SKIP LOCKED`، يضيف job، ثم يعلّم `published_at`. commit failure قد يعيد add، لكن jobId الحتمي يمنع duplicate. retry backoff مشتق من `occurred_at/attempts`، وبعد 12 محاولة يبقى الحدث غير منشور وينشأ سجل DLQ قليل البيانات للتنبيه. الأحداث العامة تنشر إلى `bhd-r.domain`، فيما تتحول أحداث الصور والعقود والفواتير ودعوات الحساب إلى jobs متخصصة بعد materialization من مصدر الحقيقة.

## دور قاعدة البيانات وRLS

في الإنتاج يستخدم Worker `WORKER_DATABASE_URL` لحساب login عضو في دور `bhd_r_worker`، بلا `SUPERUSER` ولا `BYPASSRLS` ولا platform-admin. كل transaction تنفذ `SET LOCAL app.worker='true'`; دالة RLS لا تقبل العلم إلا إذا أثبت `pg_has_role` عضوية الدور. migration الأمني يعرّف `app_private.is_worker()` وسياسات/GRANTs دقيقة فقط:

- `outbox_events`: `SELECT, UPDATE`.
- `media_assets`: `SELECT, UPDATE`; و`unit_media, units`: `SELECT` لربط العقار.
- `contracts`: `SELECT` و`UPDATE` لحقلي PDF فقط عبر procedure أو column grants؛ `contract_templates, invoices`: `SELECT`.
- `credential_tokens, users`: الأفضل SECURITY DEFINER function ضيقة تعيد email/display name لأحداث الدعوة فقط، بدلاً من grant عام.

لا تمنح Worker كتابة على ledger/users ولا تسمح له باختيار organization GUC كطريقة تجاوز. في Compose المحلي فقط يعاد استخدام دور التطوير، أما الإنتاج فيجب أن يرفض الإطلاق إذا لم يوجد دور Worker مستقل وفق قائمة النشر.

## Pipeline الصور

1. API ينشئ presigned upload إلى prefix مؤقت خاص، بحد حجم/type وexpiry.
2. Worker يقرأ private bucket فقط ويقارن الحجم وmagic bytes.
3. ClamAV في `required`؛ outage يؤدي retry وليس تجاوز الفحص. الإصابة تنتقل quarantine وتحذف من incoming.
4. Sharp يفرض pixel cap، يطبق orientation ويعيد encode بلا EXIF.
5. الأصل يبقى private تحت content hash.
6. علامة رسمية `BHD R — A BHD Product` بألوان عمانية، ثم AVIF/WebP 480/960/1600 من دون تكبير.
7. variants فقط في public bucket بـimmutable caching؛ النتيجة تعيد key/width/height/format/bytes.

إن كانت الصورة أصغر من عرضين، يجب أن تتجنب خدمة التكامل `srcset` التكرار حسب actual width. لا تنشر original URL ولا signed URL طويل المدة.

## PDF

Renderer allowlist يزيل script, style, SVG, images, links وevent attributes. Chromium يعمل JavaScript disabled، service workers blocked وكل network request aborted لمنع XSS/SSRF. المستند A4 بخط Noto وألوان الهوية، يخزن private مع SHA-256. عند التوقيع، hash يرتبط بنسخة العقد وevidence envelope؛ إعادة render تنشئ version جديدة ولا تستبدل الموقعة.

## الإشعارات

قوالب versioned خارج payload النهائي حيث يمكن. البريد يمر عبر SMTP TLS في الإنتاج، recipient لا يظهر في log (hash قصير فقط)، notification ID في header للتتبع. unsubscribe/consent حسب نوع الرسالة؛ رسائل العقد/الأمن transactional منفصلة عن التسويق.

## التشغيل والمقاييس

- `/live`: العملية حية. `/ready`: Redis وPostgreSQL متاحان.
- alerts: oldest job age، waiting/active/failed، DLQ count، outbox unprocessed age، scanner/PDF/SMTP failures.
- autoscale على lag مع سقف يحمي DB/SMTP. لا ترفع concurrency PDF بلا ذاكرة كافية.
- shutdown يوقف outbox ويغلق workers/queues/pool.

إعادة DLQ عملية يدوية/أداة مدققة: أصلح السبب، تحقق idempotency، انسخ job metadata إلى طلب إعادة مستقل، ولا تعدل سجل DLQ أو تمسح Redis.
