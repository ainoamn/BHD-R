# CONTINUE — 2026-10-11

**0.7.3** · صفحة العقد: `loadContractDetailFromNeon` (`lib/contract-detail-neon.ts`) بنفس شكل `/v1/leasing/contracts/:id` (شرط المنظمة، `ownerPartyScope`، المستأجر طرف إلزامي، توقيع PDF محلي 180 ثانية)؛ `ContractDetailView` Neon ← Nest ← رسالة بدل السقوط. وقت الدخول/المغادرة: `StampDateTimeField` (`components/stays/stamp-date-time-field.tsx`) نصّان يدويان + ص/م، يُخرج `YYYY-MM-DDTHH:MM` بتوقيت مسقط أو null؛ اختبار `tests/unit/stamp-date-time-field.test.ts`. التالي: قراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.3-AR.md`](./docs/implementation/RELEASE-0.7.3-AR.md)

**0.7.2** · مزامنة حية: جدول `live_changes` تكتبه مشغّلات جمل (`custom/0027_live_changes.sql`، دالة `live_changes_capture` SECURITY DEFINER، 57 جدولاً بعمود `organization_id`؛ جداول الإقامة الفرعية بـ `booking_id`). `GET /api/live/pulse` يعيد `max(id)` للمنظمة أو للحجز (`?booking=&ref=`)، و`v: null` إن غاب الجدول. `components/live-sync.tsx` يسأل كل 3 ثوانٍ (يتخطى `document.hidden`)، وعند التغيّر: `markOpsCacheStale` + حدث `bhd-r-live-change` (لوحة العمليات وسجلات العقار تعيد الجلب بصمت) + `PENDING_APPROVALS_CHANGED_EVENT` + `router.refresh()`. صفحة الضيف: Neon أولاً مع `ref`. الترحيل يحتاج تطبيقاً على الإنتاج بموافقة. التالي: قراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.2-AR.md`](./docs/implementation/RELEASE-0.7.2-AR.md)

**0.7.1** · دخول/مغادرة الإقامة: `recordStayStampOnNeon` في `lib/stay-arrival-neon.ts` (إجراءا `check_in`/`check_out` في `POST /api/owner/properties/[id]/records`)؛ الوقت (`datetime-local` بتوقيت مسقط +04:00) والملاحظات في `stay_booking_status_history.metadata_json` بلا ترحيل، وتُقرأ بـ `loadStayStamps` في `property-records-neon` (حقول `stage`/`checkedInAt`/…) وفي إسقاط الضيف (`checkIn`/`checkOut`). آلة الحالات: `confirmed → checked_in` مسموح. `/stays/booking/confirmed` يحوّل إلى `/guest/stays/[id]?ref=&welcome=1`. التالي: نفس التسجيل في صفحة حجوزات الإقامات (ما زالت عبر Nest)  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.1-AR.md`](./docs/implementation/RELEASE-0.7.1-AR.md)

**0.7.0** · تصميم هادئ موحّد: قسم «Portal calm design» في آخر `globals.css` (متغيرات `--calm-*` على `.portal-layout, .ops-modal`؛ كل المحددات تبدأ بـ `.portal-layout`، والنوافذ بـ `.ops-modal` لأنها تُرسم في `body` عبر `ModalPortal`). حقول النماذج بمحدد `:where(...) :is(.input…)` حتى تبقى `.field--missing`/`.field--ok` غالبة. حركة الدخول بـ `backwards` حتى لا تحبس `position: fixed`. التالي: مراجعة حية بحساب المالك وهياكل تحميل  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.0-AR.md`](./docs/implementation/RELEASE-0.7.0-AR.md)

**0.6.9** · `loadOpsSectionFromNeon` (`lib/portal-ops-sections-neon.ts`) يخدم 12 قسماً كانت على Nest، بعد `loadOpsRecordsFromDb` وقبل أي فحص لـ Nest (فشل/8 ثوانٍ ← Nest)؛ صلاحيات Nest نفسها، `jsonSafe` للأرقام الكبيرة. `loadOpsContextExtras` يكمّل سياق Neon ليطابق `/v1/operations/context`. دور الموقع `neondb_owner` يتجاوز RLS ← شرط المنظمة إلزامي في كل استعلام. فهارس `custom/0026_portal_read_indexes.sql` مطبّقة على الإنتاج. مفاتيح API ما زالت عبر Nest. التالي: المرحلة 3 (تصميم)  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.9-AR.md`](./docs/implementation/RELEASE-0.6.9-AR.md)

**0.6.8** · سرعة لوحة المالك (مرحلة 1): `applySessionSettings`/`viewerTenantSettings` في `lib/db-session-settings.ts` (أمر `set_config` واحد لكل معاملة)؛ تحميل متوازٍ في `portal-overview`، `pending-approvals-neon`، `portal-ops-workspace` (القائمة + `loadOpsContextFromDb` معاً، TTL 20 ثانية ومفتاح يشمل المستخدم)، `property-ops-pulse-neon` (3 دفعات)، وصفحة تفاصيل العقار؛ `PortalMainSlot` يركّب اللوحة عند الزيارة فقط. التالي: Neon بدل Nest للأقسام المتبقية، فهارس (بموافقة)، ثم التصميم الموحّد  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.8-AR.md`](./docs/implementation/RELEASE-0.6.8-AR.md)

**0.6.7** · الضيف: نافذة إلغاء بتنبيه عدم الاسترداد؛ تعديل تواريخ فعلي عبر `POST /api/public/stays/guest/reschedule` (`rescheduleGuestStayBookingOnNeon` + `priceStayRangeForUnitOnNeon` + قاعدة `stayRescheduleCharge`: السعر = max(سعر التقويم، الأصلي)، والمدفوع لا يزيد إلكترونياً)؛ تقويم بخيار `ownRange`  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.7-AR.md`](./docs/implementation/RELEASE-0.6.7-AR.md)

**0.6.6** · `ops-vacant-strip` أصبح `<details>` مطوياً بعدد وسهم؛ كل نوافذ `ops-modal` تمر عبر `ModalPortal` (`createPortal` إلى `body`، لأن حركة `transform` على `.portal-ops-pane` كانت تحبس `position: fixed`) مع تصميم كامل الشاشة متجاوب في آخر `globals.css`  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.6-AR.md`](./docs/implementation/RELEASE-0.6.6-AR.md)

**0.6.5** · مؤشرات الحجوزات مطوية كقائمة منسدلة (`statsOpen` افتراضياً `false` في `bookings`)؛ إحصائيات مضغوطة موحّدة (`ops-metrics`، `ops-flow` مع `is-active`، `dash-metric`، `pmh-stats`، `psr-summary`) في قسم «Compact statistics» آخر `globals.css`  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.5-AR.md`](./docs/implementation/RELEASE-0.6.5-AR.md)

**0.6.4** · صفحة تفاصيل الإقامة للضيف على كامل الشاشة (`100dvh`، رأس الموقع وتذييله مخفيان): عمودان أفقياً، صورة بالأعلى عمودياً، شريط سفلي ثابت بالمبلغ والأزرار  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.4-AR.md`](./docs/implementation/RELEASE-0.6.4-AR.md)

**0.6.3** · صفحة تفاصيل الإقامة للضيف (`guest/stays/[bookingId]`) بتصميم جديد: صورة جامع السلطان قابوس بتدرّج شفاف، اسم العقار (`listingTitleAr/En`)، رسالة الحالة، مراحل الحجز، بطاقات التواريخ، وعمود المبلغ والأزرار (`guest-stay-detail*`)  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.3-AR.md`](./docs/implementation/RELEASE-0.6.3-AR.md)

**0.6.2** · الحجوزات مرتبة بالأولوية (الاعتماد أولاً) مع لون لكل حالة (`booking-priority.ts`)؛ تنبيهات «بانتظار اعتمادك» في الشاشة الرئيسية وجرس في رأس البوابة (`pending-approvals-neon.ts` + `GET /api/portal/pending-approvals` + `PortalApprovalsBell`)  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.2-AR.md`](./docs/implementation/RELEASE-0.6.2-AR.md)

**0.6.1** · تسجيل عقد الإيجار كما في bhd-om (`lease-terms.ts` + `LeaseContractForm` + `LeaseTermsView`): بيانات المستأجر، الضريبة 5% والبلدية 3% والتسجيل، السماح، الإضافات والخصومات، جدول الشيكات بترقيم تلقائي، وحفظ الشروط في نسخة العقد مع جدول `cheques`  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.1-AR.md`](./docs/implementation/RELEASE-0.6.1-AR.md) · **مرجع:** [`LEASE-REGISTRATION-AR.md`](./docs/implementation/LEASE-REGISTRATION-AR.md) · **تسليم:** [`handoffs/2026-10-08-property-leasing-0.6.1`](./docs/handoffs/2026-10-08-property-leasing-0.6.1/README.md)

**0.6.0** · اعتماد الحجز من صفحة العقار يؤكّده وينشئ عقد إيجار موقّعاً باسم المستخدم (أو بانتظار اعتماد المدير) وإيجاراً لفترة الحجز؛ عقود يدوية للتأجير والبيع (`property-contracts-neon.ts` + `POST /api/owner/properties/:propertyId/records`)  
**تفاصيل:** [`docs/implementation/RELEASE-0.6.0-AR.md`](./docs/implementation/RELEASE-0.6.0-AR.md)

**0.5.9** · أقسام صفحة العقار من Neon لهذا العقار فقط (`property-records-neon.ts` + `GET /api/portal/property-records/:propertyId/:section` + `PropertySectionRecords`): العقود والتأجير بكل حالاتها وأسماء المستأجرين، وملخص مالي للفواتير والحسابات  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.9-AR.md`](./docs/implementation/RELEASE-0.5.9-AR.md)

**0.5.8** · صفحة إدارة العقار: أقسام الحجوزات والعقود والتأجير والبيع والصيانة والفواتير والحسابات تُعرض داخل الصفحة (`?section=`) ببيانات العقار فقط (`scopePropertyId` في `OperationsConsole`)  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.8-AR.md`](./docs/implementation/RELEASE-0.5.8-AR.md)

**0.5.7** · الشريط الجانبي: «العقارات» قائمة منسدلة (عرض العقارات / إدارة العقارات) + صفحة العرض بلا أزرار إجراءات وصفحة الإدارة بزر واحد لاختيار العقار  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.7-AR.md`](./docs/implementation/RELEASE-0.5.7-AR.md)

**0.5.6** · صفحة الحجز: بطاقة ملخّص أنيقة (صورة 16:10 بجانب النموذج على الشاشات الكبيرة، وبطاقة أفقية مدمجة على اللوحي والجوال) + شريط علوي مستقل  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.6-AR.md`](./docs/implementation/RELEASE-0.5.6-AR.md)

**0.5.5** · صفحة الحجز: صورة العقار أصغر (عمود أضيق وارتفاع أقل) وحقول التعبئة وبطاقات نوع الإقامة والأزرار أكبر  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.5-AR.md`](./docs/implementation/RELEASE-0.5.5-AR.md)

**0.5.4** · حجز الإقامة من الموقع أصبح فورياً دائماً (يُحوَّل الضيف إلى الدفع مباشرة) + رسائل دقيقة لأخطاء الدفع بدل «بوابة الدفع غير مفعّلة»  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.4-AR.md`](./docs/implementation/RELEASE-0.5.4-AR.md)

**0.5.3** · إعادة تصميم صفحة حجز الإقامة اليومية: بطاقة عقار مصوّرة (المزايا، السعر، التقييم، الأوقات) + نموذج أنيق بثلاثة أقسام وبطاقات لنوع الإقامة بأسعارها  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.3-AR.md`](./docs/implementation/RELEASE-0.5.3-AR.md)

**0.5.2** · صفحة الحجز: تحديث فوري للمبلغ عند + / − (جلب مسبق + ذاكرة مؤقتة) دون وميض، والخادم يحسب السعر والتوافر بالتوازي  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.2-AR.md`](./docs/implementation/RELEASE-0.5.2-AR.md)

**0.5.1** · صفحة الحجز: «إقامة مع مبيت» تبدأ بالوصول اليوم والمغادرة غداً، مع تغيير التاريخين وعدّاد ليالٍ للتمديد  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.1-AR.md`](./docs/implementation/RELEASE-0.5.1-AR.md)

**0.5.0** · إعادة تصميم شاشات الإقامات اليومية: شريط ثابت موحّد + لوحة الإقامات (حركة اليوم، القادمة، الوحدات، الأداء) + تقويم متناسق مع الشاشة + صفحة الأسعار بتعديل في مكانه + تبويب الحجوزات اليومية دون أقسام الإيجار الشهري  
**تفاصيل:** [`docs/implementation/RELEASE-0.5.0-AR.md`](./docs/implementation/RELEASE-0.5.0-AR.md)

**0.4.99** · تعديل العقار: عربون حجز التأجير وعربون حجز الشراء منفصلان لكل وحدة + لوحة «إعدادات الإيجار اليومي» (الضيوف، الليالي، الأوقات، الأسعار، التأمين) + إصلاح تحوّل الوحدات اليومية إلى شهرية عند الحفظ  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.99-AR.md`](./docs/implementation/RELEASE-0.4.99-AR.md)

**0.4.98** · صفحة حجز الإقامة: مبلغ التأجير يظهر في الخطوة 1 حسب اختيار المستخدم + عدد الضيوف بأرقام 1–9 ثم فئات (≥ 10 و < 20 … ≥ 90 و < 100) ثم «≥ 100» مع إدخال العدد الإجمالي + بيانات البطاقة التوضيحية في صفحة الدفع أكثر شفافية  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.98-AR.md`](./docs/implementation/RELEASE-0.4.98-AR.md)

**0.4.97** · إعادة تصميم صفحة إدارة العقار: شريط «إجراءات هذا العقار» ثابت دائماً في الأعلى، بطاقة رئيسية بالصورة والمعلومات، أرقام سريعة، الحجوزات والعقود والوحدات، التنبيهات والمالية في عمود جانبي  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.97-AR.md`](./docs/implementation/RELEASE-0.4.97-AR.md)

**0.4.96** · سرعة التقويم (دوال Vercel في لندن `lhr1` بجانب قاعدة البيانات بدل واشنطن) + تقويم موحّد للمالك/المطوّر لكل العقارات: أحمر = محجوز، أخضر = شاغر، الضغط على التاريخ يعرض الحجوزات، واختيار عقار من قائمة منسدلة مع بحث  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.96-AR.md`](./docs/implementation/RELEASE-0.4.96-AR.md)

**0.4.95** · التقويم يميّز الحجز الكلي من الجزئي (الصباحية بدون مبيت / المسائية مبيت فقط) مع علامتي ✓ و✗ وسعر الفترة المتبقية حسب سعر المالك، في صفحة العقار وتقويم المالك وتفاصيل الحجز  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.95-AR.md`](./docs/implementation/RELEASE-0.4.95-AR.md)

**0.4.94** · صفحة حجز الإقامة اليومية بنفس تصميم صفحة الإيجار (صورة أصغر ونموذج أكبر، 4 خطوات، تبديل اللغة) + «هل الحجز لك؟» لنفسك أو لشخص آخر + «تم الحجز بواسطة» في العقد  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.94-AR.md`](./docs/implementation/RELEASE-0.4.94-AR.md)

**0.4.93** · بنود ملحق عقد الإيجار كاملة حرفياً (17 عنواناً و52 بنداً) كشروط افتراضية للإيجار الشهري / السنوي  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.93-AR.md`](./docs/implementation/RELEASE-0.4.93-AR.md)

**0.4.92** · شروط أولية قانونية شاملة للإيجار والبيع والإيجار اليومي + ترجمة وصياغة وتدقيق بالذكاء الاصطناعي + نسخ البنود بين أنواع العقود  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.92-AR.md`](./docs/implementation/RELEASE-0.4.92-AR.md)

**0.4.91** · شروط منظّمة بعناوين وبنود مرقّمة تلقائياً (عربي يمين / إنجليزي يسار) + طباعة بترويسة الشركة  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.91-AR.md`](./docs/implementation/RELEASE-0.4.91-AR.md)

**0.4.90** · صيغة موحدة للشروط والأحكام تستوردها كل العقارات + تخصيص لعقار معيّن  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.90-AR.md`](./docs/implementation/RELEASE-0.4.90-AR.md)

**0.4.89** · الحجز بالعربون (إيجار/شراء) + شروط المالك مع بوابة التمرير + «هل الحجز لك؟» والأشخاص المحفوظون  
**تفاصيل:** [`docs/implementation/RELEASE-0.4.89-AR.md`](./docs/implementation/RELEASE-0.4.89-AR.md)

**مطلوب يدوياً:**

1. إضافة السر `CRON_SECRET` في GitHub Actions.
2. تشغيل `pnpm db:migrate` على قاعدة الإنتاج (الترحيل 0025).
3. إضافة `AI_GATEWAY_API_KEY` (أو `OPENAI_API_KEY`) في متغيرات Vercel لتفعيل الصياغة والتدقيق والترجمة بالذكاء الاصطناعي.

```sh
git pull origin main
```
