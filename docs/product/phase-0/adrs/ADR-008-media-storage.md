# ADR-008: الوسائط والمستندات والعلامة المائية

- **الحالة:** Accepted conceptually
- **التاريخ:** 23 أغسطس 2026

## القرار

- Originals خاصة ولا تعدل.
- Upload quarantine ثم MIME/size/dimension/AV validation.
- إزالة EXIF وإعادة ترميز الصور.
- Worker يولد AVIF/WebP/JPEG وعلامة `BHD R — A BHD Product`.
- المشتقات العامة عبر CDN؛ Originals والمستندات بروابط موقعة قصيرة.
- Object key لا يقبل من العميل ولا يستخدم كصلاحية.

## النتائج

- يمكن تغيير العلامة وإعادة التوليد دون فقد الأصل.
- يلزم Storage lifecycle وchecksum وorphan cleanup وrestore policy.
