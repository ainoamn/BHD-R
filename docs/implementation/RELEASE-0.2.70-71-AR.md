# إصدار 0.2.70–0.2.71 — تنقّل البوابة + إصلاح الهيدر

**التاريخ:** 2026-08-30  
**Commits على `main`:**  
- `d66ec81` — 0.2.70 تنقّل SPA-like + كاش أقسام التشغيل  
- `445f4f0` — 0.2.71 إصلاح تداخل عناصر الهيدر  

**المستودع:** https://github.com/ainoamn/BHD-R  
**الإنتاج:** https://r.bhd-om.com (Vercel من فرع `main`)

## ملخص

| الإصدار | التغيير |
| ------- | -------- |
| **0.2.70** | عند فتح `/ar/owner` تُسخَّن أقسام التشغيل في الخلفية (`/api/portal/ops/...`)؛ النقر من الشريط يرسم من كاش الذاكرة بدون انتظار Nest في RSC |
| **0.2.71** | الهيدر: شريحة نص للاسم/الدور + أفاتار واحد من مبدّل تطبيقات BHD (بدون دائرتين متداخلتين) |

## تحقق بعد النشر

1. Vercel Deployment لـ `445f4f0` / أحدث `main` = Ready.  
2. افتح [لوحة المالك](https://r.bhd-om.com/ar/owner) — الهيدر سطر واحد: لغة · اسم · شبكة تطبيقات · أفاتار.  
3. انتظر ~5ث ثم تنقّل فواتير ↔ عقود — محتوى فوري تقريباً، الشريط ثابت.  
4. Network: لا Document reload كامل عند نقر الشريط الجانبي.

## وثائق مرتبطة

- [`CHANGELOG.md`](../../CHANGELOG.md)  
- [`STATUS.md`](./STATUS.md)  
- [`PORTAL-CHROME-AR.md`](./PORTAL-CHROME-AR.md)  
- [`PORTAL-PERF-AR.md`](./PORTAL-PERF-AR.md)  
- [`WAZEN-SPEED-LESSONS-AR.md`](./WAZEN-SPEED-LESSONS-AR.md)
