# تسليم — استكمال خطة المنزل → 0.4.42

**تاريخ التوثيق:** 2026-09-02  
**وقت التوثيق (مسقط / UTC+4):** مساءً بعد سحب 0.4.41  
**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com  
**الفرع:** `main`  
**الإصدار:** `0.4.42`  
**محادثة Cursor:** [307d3b18-d433-4130-9cd4-fbf9f887f158](307d3b18-d433-4130-9cd4-fbf9f887f158)

---

## أين توقّفنا

### من خطة الاستكمال السابقة

| بند | الحالة |
| --- | --- |
| **P0** سحب المستودع | تم — HEAD كان `62fed32` (0.4.41) |
| **P1** تحقق الإنتاج | تم — كتالوج الإقامات = **3** (A-01, A-02, R-01) |
| **P2** نشر R-02/R-03/S-01/S-02 | معلّق — يحتاج جلسة مالك في المعالج |
| **P3** شارات القنوات + إصلاح h2 على الهاتف | **شُحن في 0.4.42** |
| **P4** لا ترفع أسرار/سكربتات مؤقتة | ملتزم |

### ما شُحن في 0.4.42

1. شارات قنوات (إيجار / بيع / إقامة) في محفظة العقارات (Web Neon + Nest).
2. حصر تصغير عناوين الأقسام على بوابة العمليات فقط — الصفحات العامة تحتفظ بحجم 0.4.40.

---

## المحادثة

| الملف | الوصف |
| --- | --- |
| [`conversation-transcript.jsonl`](./conversation-transcript.jsonl) | JSONL منقّح |
| [`conversation-readable.md`](./conversation-readable.md) | ملخص مقروء |
| [`MANIFEST.md`](./MANIFEST.md) | أحجام وهاش |
| [`CONTINUE-PLAN-AR.md`](./CONTINUE-PLAN-AR.md) | خطة الاستكمال التالية |

> **تنبيه أمني:** أُزيلت قيم حساسة محتملة (`DATABASE_URL`، مفاتيح، إلخ) بـ `[REDACTED-…]` قبل الرفع.

---

## روابط تحقق

- https://r.bhd-om.com/ar/stays?countryCode=OM&currency=OMR
- https://r.bhd-om.com/ar/owner/properties
- إعداد الإقامة: `/ar/owner/stays/setup?propertyId=d0840631-207d-477a-853a-043572d49240`
- إصدار: [`../../implementation/RELEASE-0.4.42-AR.md`](../../implementation/RELEASE-0.4.42-AR.md)
