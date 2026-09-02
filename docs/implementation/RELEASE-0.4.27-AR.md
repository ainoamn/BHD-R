# الإصدار 0.4.27 — تقويم كامل + بحث نحيف + تقييمات Booking

**التاريخ:** 2026-09-02

## الملخص

- **التقويم:** نُقل إلى عمود المحتوى الرئيسي بعرض كامل (`stays-calendar--large`) — لم يعد في الشريط الجانبي الضيق.
- **الوحدات:** قائمة مطوية افتراضياً (`details/summary`) في المباني المتعددة؛ مخفية في صفحة الإقامة اليومية.
- **شريط البحث:** أنحف، حواف دائرية، عرض محدود، زر بحث بلون BHD الأخضر.
- **التقييمات:** شارة تقييم في عنوان العقار + قسم مراجعات بأسلوب Booking (درجة /10 + بطاقات أفقية).

## التفاصيل

### التقويم في صفحة الإقامة
- `PropertyDetailManager` → قسم «التوفر — اختر تواريخ إقامتك» في العمود الرئيسي.
- الشريط الجانبي: ملخص تواريخ + ضيوف + معالج الحجز (`StayCheckout embedded`).

### الوحدات
- `property-360__units--accordion` — كل وحدة سطر قابل للتوسيع.
- `!stayBooking` — إخفاء قسم الوحدات على `/stays/{slug}`.

### البحث `/stays`
- `booking-bar` — padding أقل، `border-radius: 999px`، `max-width: 56rem`.
- `.booking-bar__submit` — `background: var(--oman-teal)`.
- نص hero محدّث في i18n (بدل «واجهة تشغيلية أولية»).

### التقييمات
- `PropertyReviewScore` — شارة بجانب العنوان.
- `ReviewsPanel` — بطاقات أفقية، درجة /10، مدمج في Property 360.
- إزالة التكرار من `/properties/{id}` (المراجعات داخل المكوّن).

## ملفات محورية

| الملف | التغيير |
| --- | --- |
| `property-detail-manager.tsx` | تقويم + accordion + reviews |
| `property-review-score.tsx` | شارة التقييم |
| `reviews-panel.tsx` | تصميم Booking |
| `stay-checkout.tsx` | وضع embedded |
| `globals.css` | booking-bar + calendar + reviews |

## تحقق بعد النشر

- [ ] `/ar/stays` — شريط بحث نحيف، زر أخضر
- [ ] `/ar/stays/al-noor-building-a-01` — تقويم كبير في المحتوى، لا قائمة وحدات
- [ ] `/ar/units/...` — وحدات مطوية، تقييمات أسفل الصفحة
- [ ] شارة التقييم بجانب عنوان العقار (عند وجود مراجعات)
