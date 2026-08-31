# أمر GitHub Copilot لبناء BHD R Stays

انسخ النص التالي كاملاً إلى GitHub Copilot Coding Agent من داخل مستودع BHD-R. لا تحذف القيود أو شروط الانتقال.

---

## بداية الأمر

أنت مهندس برمجيات رئيسي تعمل داخل مستودع BHD-R. مطلوب منك بناء وحدة الإقامات اليومية `BHD R Stays` داخل النظام الحالي دون كسر البيع أو الإيجار الطويل أو العقود والفواتير والصيانة والبوابات الحالية.

قبل أي تعديل:

1. اقرأ بالكامل:
   - `docs/product/daily-stays/README.md`
   - `docs/product/daily-stays/BHD-R-DAILY-STAYS-MASTER-PLAN-AR.md`
   - `docs/product/daily-stays/BHD-R-DAILY-STAYS-IMPLEMENTATION-MATRIX-AR.md`
   - `docs/ARCHITECTURE.md`
   - `docs/SECURITY_CONTROLS.md`
   - `docs/COUNTRY_PACKS.md`
   - `docs/API_OVERVIEW.md`
   - أي `AGENTS.md` ينطبق على الملفات التي ستعدلها.
2. افحص `git status` واحفظ تغييرات المستخدم الحالية. لا تحذفها ولا تعيدها ولا تكتب فوقها.
3. افحص الـ schema والـ migrations والـ controllers والخدمات والاختبارات الموجودة، ولا تفترض أسماء أو APIs غير موجودة.
4. أنشئ فرعاً/PR مستقلاً لكل مرحلة أو Slice صغيرة إذا كانت البيئة تسمح، ولا تجمع النظام كله في commit واحد.

### قرارات معمارية إلزامية

- أنشئ bounded context باسم `stays` داخل الـ Modular Monolith الحالي.
- أعد استخدام `organizations`, `properties`, `units`, addresses, media, parties, outbox, work tasks, ledger وCountry Packs.
- لا تضف `daily` إلى `units.listingPurpose`.
- لا تستخدم `holds`, `reservations`, `leases` الحالية لحجز الليالي.
- لا تنشئ Lease وهمياً ولا تربط فاتورة يومية بـ lease وهمي.
- أنشئ `stay_inventory_locks` كمصدر حقيقة واحد لكل فترات Hold/Booking/Owner/Maintenance/Lease/Channel، مع PostgreSQL `daterange [)` وGiST exclusion على `unit_id` للفترات النشطة.
- اجعل `stay_inventory_days` read projection قابلة لإعادة البناء، وليست مصدر الحقيقة.
- اجعل جميع جداول stays مؤسسية مع `organization_id`, indexes وRLS.
- جميع الكتابات الجديدة Nest API فقط وfail-closed. لا تنشئ Neon write fallback جديداً داخل Next.
- ضع الميزة خلف Feature Flags مغلقة افتراضياً على مستوى المنصة والمؤسسة والعقار/الوحدة.
- طبق Expand–Migrate–Contract. لا تحذف أو تعيد تسمية أعمدة حالية أثناء مراحل الإضافة.
- استخدم minor units للتخزين وDecimal/string للحساب الوسيط؛ لا تستخدم floating point.
- افصل حالة الحجز عن حالة الدفع والاسترداد.
- كل أمر حساس يحتاج Idempotency-Key وAudit منقح.
- كل Webhook دفع يحتاج توقيعاً، event id فريداً، مطابقة المبلغ/العملة، ومعالجة idempotent.
- حافظ على العربية/الإنجليزية وRTL/LTR وAccessibility.

### طريقة العمل الإلزامية

نفذ مرحلة واحدة فقط في كل دورة. في بداية كل مرحلة:

1. اكتب خطة قصيرة بأسماء الملفات التي ستتغير.
2. اذكر المخاطر والتوافق مع النظام الحالي.
3. سجل baseline للاختبارات المطلوبة.

وفي نهايتها:

1. نفذ اختبارات المرحلة.
2. نفذ `pnpm check`.
3. نفذ E2E المناسب.
4. اكتب تقرير تحقق تحت `docs/verification/stays-phase-N.md` يتضمن الأوامر والنتائج والقيود المتبقية.
5. اكتب Release note موجزة.
6. لا تبدأ المرحلة التالية إذا فشل أي شرط قبول.
7. لا تجعل الاختبار skip ولا تضع mock يثبت نفسه لتجاوز فشل حقيقي.

### المرحلة 0 — التثبيت والحماية من الانحدار

نفذ فقط:

- ADR لقرار bounded context والفصل عن Leasing.
- Threat Model إضافي للإقامات.
- Feature Flag definitions مغلقة افتراضياً.
- Regression tests لمسارات البيع والإيجار الطويل والحجز والعقد والفاتورة والصيانة.
- توثيق baseline دون تغيير سلوكي.

شرط القبول:

- Feature Flags off تعيد السلوك الحالي تماماً.
- `pnpm check` وE2E الحاليان ناجحان.
- لا migration سلوكية ولا مسار عام جديد ظاهر.

بعد النجاح توقف واعرض تقرير المرحلة 0 ولا تبدأ المرحلة 1 في نفس PR.

### المرحلة 1 — Contracts, Domain, DB, Authz

نفذ:

- Zod contracts للإعداد، الأسعار، البحث، Quote، Hold، Booking وGuest projection.
- Booking state machine منفصلة.
- Pricing domain بدقة مالية.
- `stay_unit_types`, `stay_profiles`, `stay_public_listings`, `stay_rate_plans`, `stay_rate_rules`, `stay_fees`, `stay_policies`.
- `stay_inventory_locks`, `stay_inventory_days`, `stay_quotes`, `stay_holds`, `stay_bookings`, `stay_booking_guests`, status history.
- `stay_folios`, charges, payment intents/allocations/refunds, reviews.
- القيود والفهارس وRLS.
- الصلاحيات المركزية المحددة في الخطة.

اختبارات قبول إلزامية:

- 50 طلب lock متزامناً لنفس الوحدة والفترة ينتج فائزاً واحداً.
- check-out يمكن أن يساوي check-in للحجز التالي.
- Hold منتهي لا يحجب الحجز حتى لو لم يعمل Worker.
- Cross-tenant access يفشل.
- العملات والتقريب صحيحة.
- Migration تعمل على قاعدة حالية بلا حذف بيانات.

بعد النجاح توقف واعرض تقرير المرحلة 1.

### المرحلة 2 — API وWorker

نفذ Nest `StaysModule` مع فصل الخدمات:

- profile/unit type management.
- pricing and policies.
- calendar and inventory locks.
- quote engine.
- admin booking.
- public read endpoints.
- outbox events.
- inventory-day projector.
- hold expiry worker.

قواعد:

- كل service يعيد التحقق من `organization_id` والصلاحية.
- لا stack traces أو SQL أو enumeration في الردود.
- search projection سريع، لكن أمر الحجز يعيد التحقق من المصدر داخل transaction.
- المستهلكون idempotent.

شرط القبول:

- API integration tests مع PostgreSQL حقيقية.
- جميع endpoints مخفية أو ترفض عند Flag off.
- replay للحدث لا يكرر projection/job.

بعد النجاح توقف واعرض تقرير المرحلة 2.

### المرحلة 3 — لوحة المالك والمطور

نفذ:

- مجموعة تنقل «الإقامات اليومية».
- Setup wizard منفصل بعد حفظ العقار؛ لا توسع معالج العقار الحالي بصورة تعرقل مستخدمي البيع/الإيجار.
- Property/channel badges.
- Calendar شهري/أسبوعي.
- Rate plan editor.
- Owner blocks.
- Booking list/detail.
- Arrivals/departures overview.

قواعد UI:

- استخدم نفس Portal Shell والتصميم والهوية العمانية.
- التنقل soft navigation ويستخدم cache/prefetch الحالي.
- لا full-page reload عند التنقل بين لوحات stays.
- جميع النصوص في i18n.
- RTL/LTR وkeyboard وscreen reader.

شرط القبول:

- المالك يهيئ وحدة ويغير سعراً ويغلق يوماً دون نشر عام.
- مستخدم بلا صلاحية لا يرى أو ينفذ العملية عبر API.
- لا regression في صفحات العقار الحالية.

بعد النجاح توقف واعرض تقرير المرحلة 3.

### المرحلة 4 — الموقع العام

نفذ:

- تبويبات شراء/إيجار سنوي/إقامة يومية في مربع البحث.
- `/[locale]/stays`.
- `/[locale]/stays/[slug]`.
- بحث destination/dates/guests.
- بطاقات تعرض nightly/total price بوضوح.
- تفاصيل، معرض، مرافق، تقويم، Guest selector وPrice breakdown.
- عرض أنواع الوحدات المتعددة مع عدد المتاح.
- SEO, canonical, hreflang, structured data وsitemap rules.

قواعد:

- لا تعرض وحدة إلا إذا كانت متاحة لكل ليلة وتستوعب الضيوف ولها Rate coverage.
- لا تعرض رقم الوحدة أو المالك أو العنوان الدقيق.
- صفحات البحث المفلترة بالتواريخ noindex.
- الصور responsive ومائية.

شرط القبول:

- اختبارات البحث الصحيحة عبر حدود التواريخ.
- RTL/LTR وAccessibility.
- LCP وCLS ضمن أهداف الوثيقة على build إنتاجي واقعي.

بعد النجاح توقف واعرض تقرير المرحلة 4.

### المرحلة 5 — الحجز والدفع وبوابة الضيف

نفذ:

- Quote immutable وموقوت.
- Hold لمدة configurable.
- Instant book وRequest-to-book.
- Payment intent.
- `stay_booking` في webhook الدفع الحالي دون كسر invoice/reservation kinds.
- Confirm/cancel/no-show الأساسية.
- قسيمة PDF آمنة.
- Guest portal منفصلة الصلاحيات عن Tenant portal.

اختبارات قبول:

- E2E من البحث إلى التأكيد.
- إعادة Idempotency-Key تعيد نفس النتيجة.
- payload مختلف بالمفتاح نفسه يعيد 409.
- webhook replay لا يكرر booking/payment/journal/outbox.
- XSS payload لا ينفذ في القسيمة أو البريد أو لوحة الإدارة.
- Guest A لا يرى Booking Guest B.

بعد النجاح توقف واعرض تقرير المرحلة 5.

### المرحلة 6 — التشغيل والمالية

نفذ:

- pre-arrival, check-in, checked-out, no-show.
- Folio/charges/payment allocations.
- Cancellation/refund policy engine.
- فصل refund request/approval/execution.
- Journal postings بمصادر فريدة.
- housekeeping/inspection tasks.
- maintenance inventory block.
- notifications and runbooks.

شرط القبول:

- دورة إقامة كاملة تعيد الوحدة متاحة بعد التنظيف.
- فشل الفحص يغلق التقويم وينشئ صيانة.
- Folio = payments + outstanding/refunds وتتطابق قيود ledger.
- الاسترداد المكرر لا يكرر المال أو القيد.

بعد النجاح توقف واعرض تقرير المرحلة 6.

### المرحلة 7 — التقارير والتقييمات

نفذ:

- Occupancy، ADR، RevPAR، lead time، cancellation/no-show، revenue by property/unit.
- Verified review بعد checked-out فقط.
- تقارير المالك والمطور والمنصة مع النطاق المؤسسي.
- Export jobs عبر Worker عند كبر التقرير.

شرط القبول:

- التقارير تتطابق مع fixtures واستعلامات المصدر.
- Timezone والعملات لا تختلط.
- Review لا يقبل من غير ضيف حجز مكتمل.

بعد النجاح توقف واعرض تقرير المرحلة 7.

### المرحلة 8 — القنوات الخارجية والتوسع

لا تبدأها دون موافقة وبيانات اعتماد القناة.

نفذ بعد الموافقة:

- iCal import/export مع SSRF protections.
- channel mappings.
- sync cursor, retries, DLQ وconflict resolution.
- adapters منفصلة لكل مزود.
- Country Pack/versioned legal/tax configuration.

شرط القبول:

- اختبارات URL/redirect/private network.
- فشل القناة لا يفتح أياماً مغلقة.
- لا double booking عند وصول أحداث متزامنة.
- credentials خارج DB plaintext وخارج logs.

### قواعد التوقف والتقرير

إذا اكتشفت أن قراراً جديداً سيغير نموذج المنتج أو الحساب أو القانون أو يتطلب سر إنتاج/حساب مزود:

- لا تخمن.
- وثق القرار المطلوب وتأثير الخيارات.
- توقف عند بوابة المرحلة دون تنفيذ تغيير خطر.

عند كل تسليم اعرض:

1. الملفات المعدلة.
2. المهاجرات.
3. الاختبارات ونتائجها.
4. مخاطر/قيود متبقية.
5. طريقة التفعيل والتراجع.
6. إثبات أن البيع والإيجار الطويل لم يتغيرا.

## نهاية الأمر
