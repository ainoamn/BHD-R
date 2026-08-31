# الإصدار 0.4.11 — تصدير تقويم الإقامة (iCal) للقراءة فقط

**التاريخ:** 2026-08-31  
**العلم:** مغلق افتراضياً — مسارات التقويم تردّ 404/401/403 حتى التفعيل والسماح للمؤسسة.

## ماذا أُضيف؟

- `GET /v1/stays/calendar-units` — وحدات ذات ملف إقامة للتنزيل.
- `GET /v1/stays/units/:unitId/calendar.ics` — ملف ICS من أقفال المخزون النشطة (ملخّصات Busy بدون بيانات ضيف).
- واجهة `/owner|developer/stays/calendar` بروابط تنزيل `.ics`.
- استيراد القنوات / OTA **ما زال موقوفاً** (`staysChannelSyncBlockedReason`) حتى ضوابط SSRF.

## تحقق

| فحص | نتيجة |
| --- | --- |
| بلا جلسة → calendar.ics | 401 أو 404 |
| Domain ICS builder | اختبارات units |
| لا جلب URL خارجي | تصدير فقط |

## تفعيل

نفس علم المنصة + allowlist؛ صلاحية `stay.booking.read`.
