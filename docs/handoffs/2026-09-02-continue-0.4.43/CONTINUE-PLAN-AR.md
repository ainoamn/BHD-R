# خطة الاستكمال — بعد 0.4.43

**تاريخ:** 2026-09-02

## P0 — سحب

```bash
git pull origin main
```

## P1 — تحقق بعد نشر Vercel

1. Quote مع وحدة صريحة:
   `POST /api/public/stays/al-noor-building-a-01/quotes` body يتضمن `"unitId":"fd6e559d-3f92-4b5d-be64-4ba0245ec662"` ثم تأكد أن الحجز الناتج على R-01.
2. مسار دفع كامل حتى `confirmed` عبر صفحة sandbox.
3. محفظة: شارات القنوات (0.4.42).

## P2 — نشر بقية الوحدات (مالك)

`/ar/owner/stays/setup?propertyId=d0840631-207d-477a-853a-043572d49240`

1. زر **اختر غير المنشور فقط**
2. أسعار (تُنسخ من مسعّر إن وُجد)
3. **نشر الإقامة**

المتوقع بعدها: كتالوج `/ar/stays` = 7.

## P4 — لا تكسر

لا ترفع أسرار / `set-database-url` / tmp migrate.
