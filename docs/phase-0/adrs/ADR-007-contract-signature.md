# ADR-007: العقد والتوقيع والحساب التلقائي

- **الحالة:** Proposed pending legal/signature decision
- **التاريخ:** 23 أغسطس 2026

## القرار

- Templates ذات Versions.
- ContractVersion يحمل Snapshot وPDF hash.
- SignatureEnvelope له Participants وEvidence append-only.
- OTP/Reauthentication أساس V1، مع Adapter لمزود توقيع مؤهل.
- Lease لا ينشط قبل اكتمال الأطراف المطلوبة.
- تفعيل Lease يطلق دعوة/ربط Identity للمستأجر عبر Outbox.

## المرفوض

- صورة توقيع وحدها كدليل كامل.
- تعديل PDF بعد التوقيع.
- صور هوية Base64 داخل JSON.
- إرسال كلمة مرور دائمة من API المنتج.

## النتائج

- يحتاج رأياً قانونياً حول مستوى التوقيع والاحتفاظ.
- PDF generation يعمل في Worker معزول وقوالب آمنة.

