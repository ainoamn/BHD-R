# خطة الاستكمال — بعد 0.4.63

## الحالة الآن
- الإنتاج على https://r.bhd-om.com يعمل بإصدار **0.4.63**.
- مسار الدفع → التوقيع مفعّل عبر env.
- صفحة التأكيد تعرض زر التوقيع للحجوزات المدفوعة غير الموقّعة (مثل `ST-0343C0F6` إن لم يُكمَل التوقيع).

## أولويات مقترحة للجهاز الثاني

### 1) إغلاق تجربة التوقيع (UX)
- [ ] التأكد أن ضيف `ST-0343C0F6` يكمل التوقيع بنجاح على الجوال.
- [ ] بعد التوقيع: إظهار العقد المعتمد بوضوح + PDF يتضمن حالة الاعتماد إن لزم.
- [ ] في بوابة المالك: عرض حالة «موقّع / غير موقّع» بجانب الحجز.

### 2) تقوية الأدلة الإلكترونية
- [ ] تخزين روابط/مراجع أقصر للصور بدل data-URL الضخمة في history إن ظهرت مشاكل حجم.
- [ ] ختم زمني أوضح (توقيع الضيف + اعتماد BHD) على مستند التأكيد PDF.

### 3) حجوزات قديمة
- [ ] أي حجز `confirmed/paid` بلا `pricingSnapshotJson.esign.completed` يظهر زر التوقيع تلقائياً (منطق 0.4.63).
- [ ] لا حاجة لإعادة دفع؛ فقط التوقيع.

### 4) استقرار التوفر/الدفع (من نفس المحادثة)
- [ ] راقب `dates_taken` بعد 0.4.60 — يجب ألا يظهر خطأ وهمي لنفس جلسة الضيف.
- [ ] التقويم بعد 0.4.59 يجب أن يطابق الأقفال والحجوزات الحية.

## ملفات محورية
| موضوع | مسار |
| --- | --- |
| أعلام التوقيع | `apps/web/src/lib/stay-esign-flags.ts` |
| معالج التوقيع | `apps/web/src/components/stays/stay-esign-wizard.tsx` |
| صفحة التوقيع | `apps/web/src/app/[locale]/stays/booking/sign/page.tsx` |
| صفحة التأكيد + زر التوقيع | `apps/web/src/app/[locale]/stays/booking/confirmed/page.tsx` |
| إكمال الدفع → returnPath | `apps/web/src/app/api/public/stays/payment-sessions/[reference]/sandbox-complete/route.ts` |
| حفظ التوقيع في Neon | `apps/web/src/lib/public-stays-esign-neon.ts` |
| إجراءات الضيف | `apps/web/src/components/stays/guest-stay-actions.tsx` |

## Env على Vercel (لا تغيّر بلا قصد)
| المتغير | القيمة المطلوبة |
| --- | --- |
| `STAY_ESIGN_REQUIRED` | `1` |
| `NEXT_PUBLIC_STAY_ESIGN_REQUIRED` | `1` |

> تغيير `NEXT_PUBLIC_*` يتطلب إعادة نشر (build) ليظهر في الواجهة.

## أوامر سريعة
```bash
git pull origin main
# بعد تعديلات محلية:
git push origin main
npx vercel@48.4.0 --prod --yes
```
