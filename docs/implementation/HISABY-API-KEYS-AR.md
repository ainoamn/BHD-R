# أمر لـ Hisaby — الربط ومفاتيح API مع BHD R

**تاريخ:** 2026-09-09  
**حالة التنفيذ:** **منفّذ في Hisaby** (`6cab208`) + **منفّذ في BHD-R** (`a8caf1b` / `a2b200a`)  
**عقارات:** https://r.bhd-om.com · API https://api.r.bhd-om.com  
**محاسبة:** https://hisaby.bhd-om.com  
**دليل Hisaby الكامل:** https://github.com/ainoamn/hisaby/blob/main/docs/HISABY-BHD-R-INTEGRATION.md  
**معمارية:** [`HISABY-INTEGRATION-AR.md`](./HISABY-INTEGRATION-AR.md)

---

## من ينشئ أي مفتاح؟

| الاتجاه | من يُنشئ المفتاح؟ | أين؟ | من يستخدمه؟ |
| --- | --- | --- | --- |
| **دفع أحداث عقارات → حسابي** | **Hisaby** | `/bhd-r` أو إعدادات الشركة | BHD-R يخزّن الرمز ويرسل الأحداث |
| **سحب تفاصيل من حسابي ← عقارات** | **مالك العقارات** | [`/ar/owner/api-keys`](https://r.bhd-om.com/ar/owner/api-keys) | Hisaby يستدعي API كل 15 دقيقة |
| **دخول يومي** | لا مفتاح | SSO | hisaby.bhd-om.com |

بعد اللصق مرة واحدة: **مزامنة ثنائية تلقائية** (دفع فوري + سحب ربع ساعة) للعقارات والعناوين والوحدات والجهات والفواتير والتحصيلات الواردة والمصروفات الصادرة والتواريخ والمعاملات، مع ربط كل عقار بمركز تكلفة.

---

## خطوات المالك

### أ) رمز وارد (دفع فوري)

1. https://hisaby.bhd-om.com/bhd-r → **إنشاء رمز تكامل وارد**.  
2. انسخ الرمز.  
3. https://r.bhd-om.com/ar/owner/api-keys → الصق  
   `https://hisaby.bhd-om.com/api/integrations/bhd-r/events` + الرمز → **حفظ الربط التلقائي**.  
4. اختياري: اختبار الاتصال.

### ب) مفتاح قراءة (سحب كل 15 دقيقة)

1. نفس صفحة المفاتيح → **تعبئة صلاحيات حسابي الكاملة** → إنشاء → نسخ المفتاح مرة واحدة.  
2. في حسابي الصق المفتاح تحت تكامل BHD R واحفظ.  
3. المزامنة تبدأ فوراً ثم تلقائياً كل 15 دقيقة (`POST /api/integrations/bhd-r/sync` يدوي متاح).

### ج) SSO

من بوابة BHD — بدون مفاتيح في المتصفح.

---

## ترحيل الإنتاج

| نظام | أمر |
| --- | --- |
| Hisaby | `prisma migrate deploy` (ترحيلات `bhd_r_integration` + `bhd_r_auto_sync`) |
| BHD-R | `pnpm --filter @bhd-r/db migrate` (يشمل `0024_hisaby_links.sql`) |

بدون الترحيلين لن تكتمل المزامنة على الإنتاج.

> توليد Prisma محلياً إن سحب Prisma 7 بالخطأ: استخدم schema المسار  
> `backend/src/prisma/schema.prisma` ونسخة المشروع — لا يعيق النشر.

---

## مسار الاستقبال النهائي (مثبت)

```
POST https://hisaby.bhd-om.com/api/integrations/bhd-r/events
Authorization: Bearer <HISABY_INBOUND_TOKEN>
```

سحب مفضّل / مكمّل:

```
GET https://api.r.bhd-om.com/v1/integrations/hisaby/export
Authorization: Bearer <BHD_R_API_KEY>
```

Hisaby يسحب أيضاً المسارات المفصّلة (`/v1/portfolio/properties`, `/v1/parties`, `/v1/finance/*`, …) حسب دليله.

---

## أمان

- السر يُعرض مرة واحدة ولا يُعاد.  
- مفاتيح BHD-R للقراءة لا تنشئ مفاتيح أخرى.  
- أحداث الاستقبال **idempotent** حسب `idempotencyKey`.  
- لا تضع المفاتيح في Git.
