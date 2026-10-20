# مواصفة تبديل حساب BHD — صورة + بريد

> **الحالة:** معتمدة. انسخ هذا الملف إلى `docs/BHD-ACCOUNT-SWITCHER.md` في كل منتج ونفّذه مع `BhdAppSwitcher`.  
> **المصدر:** [ainoamn/ONE-BHD](https://github.com/ainoamn/ONE-BHD) — `docs/BHD-ACCOUNT-SWITCHER.md`  
> **التاريخ:** 20 أكتوبر 2026  
> **الهوية:** `https://id.bhd-om.com`  
> **يعتمد على:** [`BHD-APP-SWITCHER.md`](BHD-APP-SWITCHER.md) · [`BHD-SESSION-POLICY.md`](BHD-SESSION-POLICY.md)

المرجع البصري: قائمة حسابات جوجل (صورة دائرية ثم البريد في صف واحد). لا تعرض الاسم كمعرّف أساسي لأنه يتكرر بين الحسابات.

---

## 1. شكل البطاقة (إلزامي)

بعد النقر على صورة الحساب في الرأس تظهر بطاقة بيضاء عرضها ≈ 360px.

```
┌──────────────────────────────────┐
│  (صورة 56px)   email@domain     │  ← الحساب النشط
│       G         إدارة الحساب    │
├──────────────────────────────────┤
│  (صورة 40px)   other@domain      │  ← تبديل
│       G                          │
│  (+)           إضافة حساب آخر    │
├──────────────────────────────────┤
│  خروج من هذا الحساب              │
│  خروج من كل الحسابات             │
└──────────────────────────────────┘
```

| عنصر | القاعدة |
|---|---|
| الصف | `flex`، محاذاة وسط، فجوة 12px، ارتفاع صف القائمة 52px |
| الصورة | دائرة 40px (56px للحساب النشط). إن تعذّرت الصورة: الحرف الأول من الاسم أو البريد |
| النص الأساسي | **البريد** (`dir="ltr"` حتى في الواجهة العربية). وإلا اسم المستخدم ثم الهاتف |
| سطر ثانٍ | اسم المستخدم و/أو الهاتف فقط إن اختلفا عن البريد |
| شارة المصدر | دائرة 18px على زاوية الصورة: `G` جوجل · `f` فيسبوك · `WA` واتساب · `●` تسجيل عادي |
| إضافة حساب | دائرة بعلامة `+` ثم النص، نفس صف الصورة+النص |
| الخروج | صفوف نصية أسفل فاصل، بلا زر داكن عريض |

ممنوع: صف فيه الاسم فقط، أو «تبديل إلى: اسم»، أو أزرار خضراء/داكنة لكل حساب.

---

## 2. البيانات

من `GET https://id.bhd-om.com/api/auth/me` (مع بيانات الاعتماد إن كان الطلب من منتج):

```json
{
  "user": { "id": "…", "email": "a@x.com", "name": "…", "picture": "…", "username": null, "phone": null, "providers": ["google"] },
  "accounts": [ { "id": "…", "email": "b@x.com", "picture": "…", "providers": ["password"] } ]
}
```

- التبديل: `POST /api/auth/switch` `{ "sub": "<id>" }`
- إضافة: `https://id.bhd-om.com/login?add=1`
- خروج هذا: `POST /api/auth/logout`
- خروج الكل: `POST /api/auth/logout` `{ "all": true }` ثم `end-session?all=1`

---

## 3. مكوّنات CSS (انسخ الأسماء كما هي)

`bhd-switcher-account` · `bhd-switcher-account-now` · `bhd-switcher-account-list` · `bhd-switcher-account-foot` · `bhd-switcher-person` · `bhd-switcher-face` · `bhd-switcher-who` · `bhd-switcher-account-choice` · `bhd-switcher-provider`

المصدر الحي للأنماط والمكوّن:

- `BHD-Complete-Brand-and-Portal-v1.1.0/app/components/bhd/BhdAppSwitcher.tsx`
- `BHD-Complete-Brand-and-Portal-v1.1.0/app/globals.css` (قسم `.bhd-switcher-account`)

---

## 4. اختبار قبول

1. الحساب النشط: صورة دائرية كبيرة والبريد بجانبها، مقروء حتى لو تطابقت الأسماء.
2. حساب آخر: نفس الصف (صورة 40px + بريد). النقر يبدّل فوراً.
3. شارة المصدر ظاهرة على زاوية الصورة.
4. «إضافة حساب آخر» بنفس تخطيط الصورة+النص.
5. البطاقة لا تقطع البريد: قصّ بنقاط `ellipsis` لا لفّ عشوائي.

انسخ هذا الملف كما هو إلى مستودع كل موقع BHD بعد نسخ `BhdAppSwitcher`.
