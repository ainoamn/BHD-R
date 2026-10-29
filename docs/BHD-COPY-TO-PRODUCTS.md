# وثيقة النسخ إلى مواقع BHD — 29 أكتوبر 2026

ارفع هذه الملفات إلى كل مستودع منتج (وازن، حسابي، نَسَب، المتجر، المكتب، الموارد البشرية، …) ثم طبّق القسم الخاص بالجلسة والكتالوج.

**المصدر الحي:** [ainoamn/ONE-BHD](https://github.com/ainoamn/ONE-BHD) — `BHD-Complete-Brand-and-Portal-v1.1.0/docs/`

| انسخ الملف | إلى |
|---|---|
| `docs/BHD-SESSION-POLICY.md` | سياسة الجلسة 40 يوماً ثم دخول جديد + نوافذ متعددة |
| `docs/BHD-SECURITY-PROTECTION.md` | الاحتيال، حظر IP، قفل الحساب، `/recover` |
| `docs/BHD-APP-SWITCHER.md` | المشغّل + الموارد البشرية |
| `docs/BHD-ACCOUNT-SWITCHER.md` | بطاقة الحساب |
| `docs/BHD-PRODUCT-SSO-ADMIN.md` | SSO صامت + أدمن محلي |
| `docs/BHD-UNIFIED-LOGIN-AND-APPS.md` | الدليل المرجعي |
| `docs/BHD-IDENTITY-RUNTIME.md` | **الربط الحي:** API + `bhd-identity.js` بدل نسخ الجلسة في كل موقع |
| `docs/BHD-CURSOR-PRODUCT-WIRE.md` | أمر جاهز للصقه في كورسر على مستودع المنتج |
| `app/lib/bhd/apps.ts` | احتياطي إن لم يُقرأ الكتالوج من الهوية بعد |
| أيقونات `BhdAppIcon` إن تغيّرت العلامات | نفس المسار في المنتج |

الهوية: `https://id.bhd-om.com` — الإدارة: [`https://id.bhd-om.com/admin#connect`](https://id.bhd-om.com/admin#connect) (تفاصيل الربط الحي) ثم [`#clients`](https://id.bhd-om.com/admin#clients) لتسجيل OAuth.

---

## 1. نوافذ متعددة = حسابات متعددة في نفس المتصفح

كوكي `bhd_id` واحدة لكل ملف المتصفح، لذلك **لا يمكن** أن تختلف بين نوافذ Chrome العادية عن طريق الكوكي وحدها.

ما نُفّذ في الهوية:

- كل نافذة تحتفظ بـ JWT في `sessionStorage` (`bhd_window_token`).
- كل طلب إلى الهوية يرسل `Authorization: Bearer …` عبر `identityFetch`.
- تبديل الحساب **يعيد كتابة** كوكي `bhd_id` للحساب النشط (خصوصية). رمز النافذة (`Bearer`) يبقى لعزل استدعاءات API بين التبويبات.
- نافذة جديدة بلا رمز تتبنّى الكوكي الحالية (آخر دخول كامل، لا آخر تبديل).
- خروج «هذا الحساب» في نافذة يضع `bhd_window_signed_out` ولا يمسح جلسات النوافذ الأخرى. خروج الكل يمر بـ `end-session?all=1`.

### ماذا يفعل المنتج؟ (حي من الهوية)

1. حمّل `https://id.bhd-om.com/bhd-identity.js` — التفاصيل في [`BHD-IDENTITY-RUNTIME.md`](BHD-IDENTITY-RUNTIME.md).
2. اقرأ مدة الجلسة من `GET https://id.bhd-om.com/api/bhd/runtime` لا من ثابت محلي.
3. لا تنسخ منطق النوافذ. السكربت يرسل Bearer لكل نافذة.
4. بعد التبديل يجب أن تختفي بيانات الحساب السابق فوراً. المسار الآمن: `POST /api/auth/bhd/rebind` بـ Bearer النافذة (انظر [`BHD-ACCOUNT-ISOLATION.md`](BHD-ACCOUNT-ISOLATION.md)). ممنوع فتح `/start` بعد تبديل Bearer بلا handoff. ممنوع `BroadcastChannel` لمزامنة الحساب بين النوافذ.

---

## 2. مدة الدخول: 40 يوماً ثم تسجيل الدخول من جديد

للحماية: بعد **40 يوماً** من إصدار الجلسة ينتهي JWT والكوكي ويُطلب الدخول على الهوية. الخمول لا يُسقط الجلسة قبل ذلك. «خروج» يمسحها فوراً.

| البند | القيمة |
|---|---|
| JWT `exp` وكوكي `bhd_id` / `bhd_portal` / `bhd_id_roster` | 40 يوماً (`expires` + `maxAge`) بتاريخ مطلق |
| Access token OIDC | 10 دقائق (يُجدَّد بالـ refresh طالما الجلسة لم تنتهِ) |
| Refresh | 40 يوماً — لا يمدّد بعد انتهاء الجلسة |
| خمول | لا يُسقط الجلسة قبل الـ 40 يوماً |

المنتجات تأخذ `maxAgeSec` من `/api/bhd/runtime`. ممنوع تجديد الكوكي في `GET /api/auth/me`.

---

## 3. الحماية (تفاصيل الإجراءات في `BHD-SECURITY-PROTECTION.md`)

- سجل IP + دولة + حساب في `/admin` → الحماية والتدقيق.
- 12 فشلاً من نفس IP / 15 د → حظر IP ساعة.
- 8 فشل على حساب → قفل أمني حتى `/recover` (مدني، انتهاء، ميلاد، بريد، واتساب، آخر دخول، وصف نشاط، ثم رموز بريد وواتساب).
- واتساب: جهّز المسار؛ فعّل لاحقاً بـ `WHATSAPP_TOKEN` و`WHATSAPP_FROM`.

المنتج لا يعيد بناء هذا المنطق. أحلِ المستخدم إلى الهوية.

---

## 4. هل تتغيّر الأيقونات والروابط تلقائياً في كل المواقع؟

**إن قرأ المنتج `/api/bhd/catalog` أو حمّل `bhd-identity.js`:** نعم. الشعار والمسمّى والرابط تُدار من [`/admin#apps`](https://id.bhd-om.com/admin#apps) وتنعكس خلال ثوانٍ.

**إن بقي الكتالوج منسوخاً في `apps.ts`:** لا. انقلوا المشغّل إلى قراءة `/api/bhd/catalog` أو حمّلوا `bhd-identity.js`.

---

## 5. قائمة تحقق سريعة للمنتج

- [ ] `<script src="https://id.bhd-om.com/bhd-identity.js">`
- [ ] كوكي المنتج `maxAge` من `runtime.session.maxAgeSec`
- [ ] الكتالوج من `/api/bhd/catalog` لا من نسخة محلية قديمة
- [ ] hops إلى `workspacePath` مباشرة إن وُجدت جلسة المنتج
- [ ] رابط الاستعادة `https://id.bhd-om.com/recover` عند `ACCOUNT_SECURITY_HOLD`
