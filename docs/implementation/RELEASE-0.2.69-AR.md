# إصدار 0.2.69 — مركز إدارة العقار + الحجز والمعاينة

**التاريخ:** 2026-08-30  
**Commit:** `2e54d98` على فرع **`main`** (إنتاج Vercel)  
**المستودع:** https://github.com/ainoamn/BHD-R

## ملخص

| السطح | التغيير |
| ----- | -------- |
| `/ar/properties` | علامة حالة على البطاقة: متاح / متاح للإيجار / متاح للبيع / محجوز / مؤجر / مباع |
| `/ar/units/:id` و `/ar/properties/:id` | زرّان: **طلب معاينة** و **احجز الآن** (يلزمان تسجيل الدخول) |
| `/ar/book/:unitId` | شاشة دفع عربون الحجز (sandbox) |
| `/ar/owner/properties/:id` | **مركز عمليات** فقط (إحصائيات، تنبيهات، عربون، أزرار) — بدون تخطيط صفحة العرض العام |
| أقسام ops | `?propertyId=` يصفّي العقود / التأجير / البيع / الحجوزات / الصيانة / الفواتير لهذا العقار |

## مسارات API الجديدة (Vercel → Neon)

- `PATCH /api/owner/properties/:id/deposit` — حفظ مبلغ العربون
- `POST /api/public/viewing-requests` — طلب معاينة (جلسة مطلوبة)
- `POST /api/public/bookings` — بدء حجز + hold/reservation
- `POST /api/public/bookings/complete` — تأكيد دفع sandbox

## تحقق بعد النشر

1. Vercel Deployment لـ `main` / `2e54d98` = Ready.  
2. [العقارات المتاحة](https://r.bhd-om.com/ar/properties) — صورة + علامة حالة.  
3. [إدارة عقار](https://r.bhd-om.com/ar/owner/properties) — «إدارة العقار» → hub بدون معرض تسويقي؛ عيّن العربون واحفظ.  
4. من العرض العام: طلب معاينة وأنت مسجّل؛ احجز الآن → شاشة الدفع.  
5. من hub: العقود/التأجير/… تظهر مقيّدة بـ `propertyId`.

## وثائق مرتبطة

- [`CHANGELOG.md`](../../CHANGELOG.md) — 0.2.69  
- [`STATUS.md`](./STATUS.md)  
- [`PROPERTY-IDENTITY-QR-AR.md`](./PROPERTY-IDENTITY-QR-AR.md)  
- [`ASSETS.md`](../ASSETS.md) — BrandMark + وسائط عامة
