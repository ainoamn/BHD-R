# CONTINUE — 2026-10-12 22:50 (مسقط)

**تسليم الجلسة كاملة (0.2.24 → 0.8.33):** للاستكمال من جهاز آخر ابدأ من [`docs/handoffs/2026-10-12-session-0.2.24-to-0.8.33/README.md`](./docs/handoffs/2026-10-12-session-0.2.24-to-0.8.33/README.md). فيه خطوات الإعداد، والمراحل بالتاريخ والوقت، والمهام المفتوحة. ويرافقه فهرس الإصدارات (251 إصداراً) والمحادثة كاملة بعد حذف الأسرار.

# CONTINUE — 2026-10-14 09:15 (مسقط)

**0.8.60** · صفحة الطرف في دفتر العناوين:

- **البيانات:** `contacts-neon.ts` (`listContacts` و`readContact` و`updateContact`)، عبر `withinViewerTenant` واستعلامات SQL مباشرة. النطاق لمالك المبنى في `partyScope` و`propertyScope`.
- **المبالغ:** في `loadMoney`، وتُجمع بالعملة.
  - إقامات الطرف بحالة confirmed فما بعدها.
  - العرابين من `terms_snapshot.depositPaidAt`.
  - `invoices.paid_minor`.
  - `stay_refunds.paid_minor`.
  - مصروفات المورّد عبر `vendors.party_id`.
  - ولعقارات المالك: إقامات وعرابين وفواتير ومصروفات بحسب `property_id`.
- **المسارات:** `GET /api/portal/contacts`، و`GET` و`PATCH` على `/api/portal/contacts/:partyId` (`party.read` و`party.write` مع CSRF).
- **الصفحة:** `/owner/contacts/[partyId]` (`ContactWorkspace`). والقسم يعرض `ContactsBoard` عبر `listOverride` في بوابة المالك.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.60-AR.md`](./docs/implementation/RELEASE-0.8.60-AR.md)

# CONTINUE — 2026-10-14 08:45 (مسقط)

**0.8.59** · مركز الاعتمادات:

- **البيانات:** `loadApprovalsHub` في `approvals-hub-neon.ts`، عبر `GET /api/portal/approvals` (يتطلب `approval.read`). يجمع ثلاثة أشياء:
  - عناصر الجرس من `loadPendingApprovals`.
  - طلبات `approval_requests` مع مراجع العقد والمصروف وأمر الصيانة ومبالغها.
  - سجل التوقيعات من `signatureRegister`.
- **الترقيم:** `signatureRegister` في `contract-verify.ts` يشارك استعلام الترقيم مع `numberedSignatures`، فتطابق الأرقام المطبوعة. يرفع `app.platform_admin` مؤقتاً، فلا يُشغَّل بالتوازي على نفس المعاملة.
- **الواجهة:** `ApprovalsHub` تُمرَّر `listOverride` لقسم `approvals` في `PortalMainSlot`.
  - قرار المصروف وأمر الصيانة عبر Nest: `PATCH /v1/operations/approvals/:id`.
  - طلب العقد يُفتح للتوقيع ولا يُعتمد مجرداً.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.59-AR.md`](./docs/implementation/RELEASE-0.8.59-AR.md)

# CONTINUE — 2026-10-13 18:55 (مسقط)

**0.8.58** · رمز QR لملف المالك العام:

- **المكوّن:** `HostShareQr` في `host-share-qr.tsx`. يأخذ SVG الرمز من الخادم (`contractQrSvg` بشعار BHD، تصحيح Q) والرابط `publicWebOrigin()/<locale>/profiles/hosts/<orgId>`.
- **صورة التنزيل:** تُرسم على canvas (1080×1350). ويُضاف للـSVG عرض وارتفاع قبل رسمه، لأن SVG المكتبة بلا أبعاد.
- **الاختبار:** قراءة الرمز بـjsQR (مثبّتة مؤقتاً خارج المستودع) أعادت الرابط حرفياً.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.58-AR.md`](./docs/implementation/RELEASE-0.8.58-AR.md)

# CONTINUE — 2026-10-13 18:40 (مسقط)

**0.8.57** · دور المحامي والقضايا والمحادثة:

- **المحامي:** عضوية `lawyer` بـ`party_id` = طرف المحامي.
  - `lawyerParty(access)` يعيد الطرف إن كان الحساب محامياً، وليس مالك عقار، ولا يحمل دوراً على مستوى المنشأة.
  - وهو حساب «مقيّد» (`scopedOwnerParty`)، فبيانات الأقسام تعود فارغة.
  - و`canOpenSection` يفتح له `legal` وحده.
- **وحدة القضايا كلها في `legal-case-neon.ts`:**
  - **الجلسة:** معاملة مرفوعة الصلاحية (`app.platform_admin`)، بفلتر صريح للمنشأة، ولطرف المحامي إن كان محامياً.
  - **صفوف `legal_events`:** الرسائل `type='message'`، والتحديثات من `LEGAL_UPDATE_TYPES`، وتغييرات البيانات `case_change` (ملاحظاتها JSON).
  - **صفوف `workflow_events`:** المرفقات `legal_event.file`، والقراءة `legal_case.read`.
- **غير المقروء:** ما كتبه غيرك بعد آخر قراءة لك. وعند الفريق يُحسب ما كتبه طرف المحامي فقط.
  - يظهر في الجرس عبر `unreadLegalCases`.
  - البريد عبر صندوق الإرسال، بنافذة 10 دقائق لكل مستلم وقضية.
- **التحميل المسبق ورسالة القسم غير المتاح:** `PortalShell` يحسب الأقسام المسموحة بـ`canOpenSection`، ويمررها إلى `PortalRoutePrefetch` و`PortalMainSlot`.
- **لاختبار القضايا على فرع مؤقت:**
  - لا قضايا في الإنتاج. أُدرجت قضية تجريبية مباشرة، لأن إنشاءها يمر عبر Nest.
  - المحامي يُضاف بـ`POST /api/owner/team/lawyers`، وجلسته تُصنع من عضويته (`accessFromMemberships`).

**تفاصيل:** [`docs/implementation/RELEASE-0.8.57-AR.md`](./docs/implementation/RELEASE-0.8.57-AR.md)

# CONTINUE — 2026-10-13 17:55 (مسقط)

**0.8.56** · معاينة، قبول فوري، الشروط أساس العقد، تسليم بالرمز:

- **المعاينة:** `FilePreviewDialog` يجرّب `<img src>` أولاً، فيستفيد من الصورة المصغّرة الظاهرة رغم `no-store`. وعند خطأ الصورة يجلب الملف `blob:` ويعرضه في `<iframe>`. ويحتاج ذلك `frame-src blob:` في `proxy.ts`. وعارض PDF في كروم يعمل مع `object-src 'none'`.
- **القبول الفوري:** حالة `decisions` في `lease-reservation-workflow.tsx` تُطبَّق على `lifecycle` المعروض حتى يعكسها الخادم. والمرحلة تُحسب بـ`documentsPhase`. و`reservationOwnerAction(..., { defer })` يؤجل الإصدار الآلي عبر `after()`.
- **التسليم:**
  - الرمز من `handover-pass.ts`: AES-GCM بمفتاح HKDF من سر الجلسة، ونوافذ 5 دقائق، و4 نوافذ صالحة.
  - التسليم `status: 'awaiting_tenant'` يُبقي المرحلة `awaiting_handover`، والقبول يجعلها `handed_over`.
  - الصور في `workflow_events` (`reservation_handover`)، وتُقرأ بـ`handoverPhotoDataUrl`.
- **قراءة صور التسليم للمستأجر تحتاج `applyOrgScope`** قبل `workflow_events`، وإلا تعيد RLS صفاً فارغاً (404).
- **الملحق A1 لعقد الحجز:** `leaseHandoverAnnex` في `contract-annex-neon.ts`. والصور: `n` و`recipient` و`defect-n`.
- **لاختبار التسليم على فرع مؤقت:** المستأجر في `RSV-KMF42LNE` هو حساب المالك نفسه، فجلسة واحدة تكفي للطرفين.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.56-AR.md`](./docs/implementation/RELEASE-0.8.56-AR.md)

# CONTINUE — 2026-10-13 17:20 (مسقط)

**0.8.55** · طباعة العقد:

- **جذر من اليمين إلى اليسار يُقصّ في طباعة كروم:** أثناء `printing-contract` و`printing-terms` يصير `html` من اليسار إلى اليمين، والمستند المطبوع يحمل `dir` بنفسه. أي غلاف طباعة جديد يحتاج `dir` خاصاً به.
- **لفحص الطباعة:** `page.pdf` في Playwright يطلق `afterprint`، فيزيل غلاف الطباعة بعد أول ملف. أعِد الضغط على «طباعة» قبل كل ملف. ومحاكاة وسائط الطباعة (`emulateMedia`) لا تُظهر هذا القصّ، فافحص الـPDF نفسه (مثلاً بمكتبة PyMuPDF).
- **صور التقييمات الأربع القديمة** ضُغطت وخُتمت على الإنتاج بمعرّفات جديدة، والترحيل 0030 مطبَّق.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.55-AR.md`](./docs/implementation/RELEASE-0.8.55-AR.md)

# CONTINUE — 2026-10-13 16:40 (مسقط)

**0.8.54** · الفريق والأدوار:

- **العضوية:** صف لكل دور في `memberships`. والدور المخصص `role_key = 'custom:<organization_roles.id>'`. عند الدخول تجمع `accessFromMemberships` (في authz) الأدوار وصلاحيات الأدوار المخصصة (`loadSavedRolePermissions`) وصلاحيات `permissions` الإضافية. ومالك العقار `property_owner` يحمل `party_id` لمالكه، وهو نطاقه.
- **فتح الأقسام:** `apps/web/src/lib/portal-access.ts` هو المرجع الوحيد: `canOpenSection` و`canOpenPortalPath` و`scopedOwnerParty`. ويستخدمه الشريط الجانبي ولوحة التحكم ومسارات ops وصفحات الإقامة والشروط (`requirePortalPath`).
- **`team-shared.ts` يُحمَّل في المتصفح:** لا يستورد من `@bhd-r/authz` إلا الأنواع، لأن الحزمة تستورد `node:crypto`.
- **مسارات الفريق** تستدعي `requireLiveSession({ requireCsrf: true, anyPermission: TEAM_WRITE })` و`clientSafeErrorCode` بنفسها، لأن اختبار السياسة يقرأ نص المسار.
- **الترحيل 0030 على الإنتاج ينتظر موافقة المستخدم.** `readSavedRoles` تعمل بنقطة حفظ (savepoint)، فالصفحة لا تتعطل قبل الترحيل.
- **بعد تعديل `portal-overview.tsx`** قدّم خادم التطوير نسخة نصف محدَّثة. أعِد تشغيله واحذف `.next/dev` قبل الحكم على النتيجة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.54-AR.md`](./docs/implementation/RELEASE-0.8.54-AR.md)

# CONTINUE — 2026-10-13 15:50 (مسقط)

**0.8.53** · تقييم الوحدة مقابل تقييم المبنى:

- **الكتالوج:** `withGuestRatings` تعطي الوحدة `byUnit` فقط. أما `byProperty` فتُطلب وتُستخدم فقط حين `propertyKind !== 'multi_unit'`.
- **صفحة الوحدة:** في `property-detail-manager`، `reviewedUnitId = multi_unit && focusUnitId`، فيُمرَّر إلى `PropertyReviewScore unitId` ويصير `ReputationView subject='unit'`. وصفحة المبنى بقيت `subject='property'`، أي مجموع الوحدات.
- **محلياً** تتجاوز صفحة `/properties/[id]` مهلة `withTimedResult` (4 ثوانٍ) من هذا الجهاز. لا تُرفع المهلة في الكود.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.53-AR.md`](./docs/implementation/RELEASE-0.8.53-AR.md)

# CONTINUE — 2026-10-13 15:30 (مسقط)

**0.8.52** · الصورة بحجم الشاشة، وضغط الصور المرفوعة وختمها بالشعار:

- **`brandUploadedPhoto(dataUrl, maxChars)`** في `brand-uploaded-photo.ts` تستخدم sharp: تدوير، ثم `resize` داخل 1600، ثم raw مع شارة SVG (مسارات الشعار بالأبيض مضمّنة دون قراءة ملفات)، ثم WebP بجودة 82 وتتدرّج حتى `maxChars`. وعند الخطأ تُرجع الأصل.
- **تُستدعى في** `prepareReview` (`booking-reviews-neon.ts`) و`recordStayStampOnNeon` (`stay-arrival-neon.ts`، وsha256 للمحفوظ). ولا تُطبَّق على الهوية ولا الإيصال ولا esign.
- **الصور القديمة** دون شعار. إعادة معالجتها على الإنتاج تحتاج موافقة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.52-AR.md`](./docs/implementation/RELEASE-0.8.52-AR.md)

# CONTINUE — 2026-10-13 15:10 (مسقط)

**0.8.51** · التقييم في `/properties` وعارض صور التقييمات:

- **الكتالوج:** استعلام `searchPublicListingsFromNeon` ما زال يُرجع `null::float as avg_rating`. بعده تملأ `withGuestRatings` القيم من `loadUnitRatings`، وإلا من `loadPropertyRatings` (guest_to_host، منشور، `released`)، بالتوازي مع `withTimeoutFallback` لمدة 2.5 ثانية. الشارة `StayRatingBadge` تظهر عبر `catalogueRating` في الصف والبطاقة والجدول.
- **العارض:** `PhotoViewer` في `reputation-view.tsx`، بعنصر `<dialog>` و`showModal()`، ومسار أفقي بـscroll-snap، والفئة `photo-viewer-open` على `<html>`. التنظيف لا يستدعي `dialog.close()`، وإلا ينغلق العارض في StrictMode.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.51-AR.md`](./docs/implementation/RELEASE-0.8.51-AR.md)

# CONTINUE — 2026-10-13 15:00 (مسقط)

**0.8.50** · «مسار الحجز ومستجداته» في `/owner/stays/bookings/[bookingId]` (وبوابة المطوّر):

- **البيانات:** `loadTimelineFacts` في `owner-stays-ops-neon.ts`، داخل `getOwnerStayBookingContractOnNeon`. تجمع `stay_booking_status_history` (خفيفاً، دون esign أو الصور)، و`loadStayStamps`، و`loadBookingDeposits`، و`loadDepositRefunds`، و`loadDepositClaims`، و`loadBookingReviewMoments` (تقييم الضيف بعد `released` فقط).
- **البناء:** `buildStayBookingTimeline` في `stay-booking-timeline.ts` (نقية ومختبرة). صفوف السجل `checked_in` و`checked_out` و`deposit_refund` تُروى من المصادر الأغنى لا من السجل.
- **الدفع:** `paymentStatus` تكون `succeeded` فقط بدفع إلكتروني ناجح. وتكون `offline` إن كانت الحالة في `SETTLED_STATUSES` دون دفع، لأن حجوزات «الطلب» يبقى intent فيها `pending` بلا مزوّد.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.50-AR.md`](./docs/implementation/RELEASE-0.8.50-AR.md)

# CONTINUE — 2026-10-13 14:40 (مسقط)

**0.8.49** · مساعد الذكاء الاصطناعي في تقييم المؤجر للضيف، وتقييم أعمى متبادل:

- **المساعد:** `ReviewForm` تأخذ `assistant` (`guestReviewAssistant(ref)` أو `hostReviewAssistant(propertyId, bookingId)`، مع `useMemo`). مسار المؤجر `POST /api/owner/properties/[propertyId]/guest-review/assist` يستدعي `draftReviewSummary({direction: 'host_to_guest'})`. الترجمة والاقتراحات من `OWNER_NOTE_SERVICE`.
- **الظهور (`released` في `booking-reviews-neon.ts`):** `depositSettled` AND (`created_at < BLIND_REVIEWS_SINCE` 2026-10-13T10:00Z، أو مرّ `REVEAL_AFTER_DAYS` = 14 يوماً، أو قيّم الطرف الآخر). يُطبَّق على الاتجاهين، وفي حالة الضيف (`hostWrote` بلا `fromHost` = معلّق).
- **الإعلان:** `claimReleasedReviews` (FOR UPDATE SKIP LOCKED) تسجّل `workflow_events` بالنوع `stay.review.released` مرة لكل تقييم. ثم `announceReleasedReviews` في `review-release-neon.ts` (ملف منفصل لتجنّب استيراد دائري مع deposit-refund) ترسل بريد الضيف وتحدّث الخلاصات.
- **المستدعون:** حفظ التقييمين، و`confirm_receipt`، و`refund_decide`، وإغلاق المطالبات (`after()`)، و`/api/cron/review-release` (Vercel 03:30 UTC، والـ workflow كل 10 دقائق).
- **ملاحظة اختبار:** صفحة الضيف تحتاج `?ref=ST-…` وإلا 404. وفي `outbox_events` العمود `occurred_at` لا `created_at`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.49-AR.md`](./docs/implementation/RELEASE-0.8.49-AR.md)

# CONTINUE — 2026-10-13 13:50 (مسقط)

**0.8.48** · سياسة الاعتماد (تلقائي أو يدوي) لحجوزات الإيجار والشراء من الموقع:

- **التخزين:** `stay_policies` بالنوع `other` والرمز `approval_policy:{propertyId|org}`. يحوي `rulesJson.policy {booking, contract, payment}` و`delegate {userId, name}`. الحفظ يؤرشف النسخة السابقة. الترتيب: العقار، ثم المؤسسة، ثم الافتراضي `{manual, manual, auto}`.
- **التنفيذ الآلي:** `runReservationAutomation` في `lease-reservation-lifecycle-neon.ts`، في معاملة مستقلة بعد:
  - التوقيع الإلكتروني (من المسار، لتجنّب استيراد دائري)؛
  - رفع مستند؛
  - `confirm_payment` و`save_contract` و`review_document`.

  إصدار العقد داخل savepoint. الفشل يُسجَّل `reservation.auto_contract_skipped`.

- **المفوَّض:** يوقّع العقد الآلي باسم من حفظ السياسة. `delegateClaims` تعيد بناء صلاحياته من `memberships` النشطة، وتشترط `contract.create` و`contract.sign` و`lease.create`.
- **مراحل وإجراءات جديدة:**
  - `awaiting_payment_review` (مع `lifecycle.paymentReview`)؛
  - `confirm_payment` و`reject_payment` و`verify_document`؛
  - `lifecycle.cancellation`: يلغي العقد والإيجار أو صفقة البيع حتى التسليم.
- **ملاحظة اختبار:** في وضع التطوير ينتظر Playwright اكتمال hydration قبل النقر، ويتأخر `router.refresh()` عدة ثوانٍ.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.48-AR.md`](./docs/implementation/RELEASE-0.8.48-AR.md)

# CONTINUE — 2026-10-13 13:10 (مسقط)

**0.8.47** · ربط الحجز بالحساب، وحذف «التقييم الذكي»:

- **السبب:** `createPublicStayBookingOnNeon` كان يكتب `bookedBy` في `pricing_snapshot_json` فقط. صار يكتب أيضاً `userId: bookedBy?.userId ?? null`.
- **«التقييم الذكي»:** حُذف من `StayGuestInfoSection`، وحُذف `loadStaySmartScoreOnNeon` (من `stay_reviews` والإشغال) وحقوله من `stayPublicDetailSchema`.
- **«قيّم إقاماتك»:** صارت `listPendingGuestReviews` في `booking-reviews-neon`. تعرض الحجوزات `checked_out` أو `closed` للحساب بلا `guest_to_host`، خلال 90 يوماً، برابط `#stay-review`.
- **محذوف:** `stay-reviews-neon.ts` و`stay-reviews-hub.tsx` و`/api/public/stays/reviews` و`/reviews/assist`. جدول `stay_reviews` باقٍ.
- **نُفّذ بموافقة المستخدم:** ربط 3 حجوزات قديمة على الإنتاج (ST-6C2A8BBC وST-FE61E6C8 وST-1E372C24) بحساب الحاجز، وربط تقييم الضيف لـ ST-FE61E6C8 بحسابه. الاستعلام في ملاحظات الإصدار.
- **ملاحظة تشغيل:** بعد حذف مسارات يجب `npx next typegen`، وإلا يفشل `tsc` بسبب `.next/types/validator.ts` القديم.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.47-AR.md`](./docs/implementation/RELEASE-0.8.47-AR.md)

# CONTINUE — 2026-10-13 12:45 (مسقط)

**0.8.46** · طلب «قيّم الضيف» عند المغادرة وفي الجرس:

- **بند جديد في الجرس:** `guest_review` في `loadPendingApprovals`، للحجوزات `checked_out` أو `closed` بلا `host_to_guest`.
  - النافذة 60 يوماً من `max(stay_booking_status_history.created_at where to_status='checked_out')`، وإلا `updated_at`.
  - الصلاحية `canReviewGuests`.
  - الرابط `?section=bookings&focus=id&review=1`.
- **في جدول الحجوزات (`property-section-records`):**
  - يفتح `ReviewForm` بعد `check_out`، مع إعادة تحميل صامتة كي لا يضيع موضع الانتقال؛
  - يفتحه أيضاً من `review=1`؛
  - يرسل `PENDING_APPROVALS_CHANGED_EVENT` بعد الحفظ.
- **لوحة التحكم:** تنبيه `guest_reviews`.
- **ملاحظة تشغيل:** في المعاينة المحلية كانت كل مسارات `/api` تعطي 404 بسبب ذاكرة Turbopack قديمة. الحل حذف `apps/web/.next/dev`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.46-AR.md`](./docs/implementation/RELEASE-0.8.46-AR.md)

# CONTINUE — 2026-10-13 12:15 (مسقط)

**0.8.45** · ملف الضيف لم يعد 404:

- **السبب:** `subjectName('guest')` كانت تعيد undefined، فتظهر 404، كلما لم توجد تقييمات `host_to_guest`.
- **الإصلاح:** إن لم توجد تقييمات للضيف وكان مفتاحه بصمة بريد، يُبحث عن تقييم `guest_to_host` منشور ومُظهَر له، بمطابقة `left(encode(sha256(convert_to('bhd-r:guest:' || lower(btrim(contact_email)), 'UTF8')), 'hex'), 32)` مع المفتاح. ويؤخذ الاسم من `authorName` عبر `publicPersonName`.
- **مفتوح:** ST-FE61E6C8 فيه `user_id` فارغ مع أن `bookedBy.userId` موجود في اللقطة. يحتاج فحص مسار إنشاء الحجز.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.45-AR.md`](./docs/implementation/RELEASE-0.8.45-AR.md)

# CONTINUE — 2026-10-13 12:10 (مسقط)

**0.8.44** · أشكال عرض التقييمات:

- **الحالة:** `ReputationView` فيها `view: 'list' | 'grid' | 'table'`، تُقرأ من `localStorage` بالمفتاح `bhd-r-reviews-view` عند التركيب. هو تفضيل عرض فقط.
- **الأشكال:** القائمة والشبكة تستعملان `ReviewCard` داخل `.reputation__list--{view}`. الجدول يستعمل `ReviewRow` في `.reputation-table`. كلها تأخذ بيانات التقييم من `reviewFacts`.
- **الهاتف:** صفوف الجدول تصير بطاقات، والعناوين من `data-label` عبر `td::before`. لذلك محتوى كل خلية ملفوف بعنصر واحد.
- **انتبه في سكربتات المعاينة:** متغيرات `BASE` و`RESOLVE` تبقى في جلسة الطرفية بعد الفحص الحي. امسحها قبل المعاينة المحلية.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.44-AR.md`](./docs/implementation/RELEASE-0.8.44-AR.md)

# CONTINUE — 2026-10-13 12:00 (مسقط)

**0.8.43** · قائمة التقييمات الطولية وعدد المقيّمين:

- **البيانات:** `loadReputation` تقرأ `adults` و`children` من `pricing_snapshot_json` عبر `snapshotCount` (أعداد صحيحة فقط)، و`nights = check_out_on - check_in_on`، واسم الوحدة عبر left join على `units`.
- **الحساب:** `reviewers` هو عدد الضيوف المختلفين (`guestKeyOf`)، و`travellers` عدد التقييمات لكل نوع من `TRAVELLER_TYPES`، من كل الصفوف حتى 300.
- **النوع:** `travellerTypeOf` في `review-rubric.ts`: أطفال تعني family، وبالغ واحد solo، وبالغان pair («شخصان»، لا «زوجان»)، وأكثر group.
- **الواجهة:** `ReputationView` فيها `.reputation-card__guest` و`.reputation-card__main`، وأزرار `.reputation__travellers` بـ aria-pressed. `.reputation__list` صار عموداً واحداً.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.43-AR.md`](./docs/implementation/RELEASE-0.8.43-AR.md)

# CONTINUE — 2026-10-13 11:50 (مسقط)

**0.8.42** · بطاقة المالك أو مدير العقار وصفحة ملفه:

- **البيانات:** `loadHostSummary(organizationId)` (elevated) تعيد الحساب النشط، وعدد العقارات النشطة ووحداتها، ومتوسط `host_score` من تقييمات `guest_to_host` المنشورة والمُظهَرة. وتلفّها `loadHostSummarySafe` بمهلة 2.5 ثانية وتعيد null عند التأخر.
- **البطاقة:** `components/host-card.tsx`، وتُعرض في `PropertyDetailManager` بعد `</header>` حين `isPublic && hostSummary`. يُمرَّر اسم المالك الشخصي فقط إذا كان `showPublicOwnerName`.
- **الصفحات:** stays وproperties وunits تحمّل الملخص من `organizationId` الخاص بالعقار. صفحة الوحدة تنتظر نتيجة showcase، فإن تأخرت لا تظهر البطاقة.
- **الملف:** `profiles/hosts/[organizationId]` يحمّل الملخص والسمعة، و`searchStaysCatalogueFromNeon` و`searchPublicListingsFromNeon` مع `organizationId` (مرشّح جديد) و`limit: 100`، بمهلة 6 ثوانٍ لكل منهما.
- **مفتوح:** قسم «التقييم الذكي» القديم (من `stay_reviews`).

**تفاصيل:** [`docs/implementation/RELEASE-0.8.42-AR.md`](./docs/implementation/RELEASE-0.8.42-AR.md)

# CONTINUE — 2026-10-13 11:40 (مسقط)

**0.8.41** · تقييم الإقامة على صورتها ونافذة التعليقات:

- **المكوّن:** `StayPhotoRating` يعرض داخل `.property-360__hero-shot` زراً فيه `StayRatingBadge` بخيار `as="span"`، ويفتح نافذة عبر `createPortal`، بطبقة z-index 200 لأن رأس الموقع 100.
- **النافذة:** `ReputationView subject="unit" showAllReviews`.
- **موضوع `unit`:** شرطه `booking_reviews.unit_id`، واسمه من `units`. لا يقرأ `review_profiles` ولا يكتب فيها لأن قيد `subject_type` يقبل ثلاث قيم فقط، فيكون `stale` دائماً false. ويعيد المسار حتى 100 تقييم.
- **الصفحة:** `stays/[slug]/page.tsx` تحمّل `loadUnitRatings([detail.unitId ?? unit])` مع العقار، وتمرر `stayRating`. وعند وجود `stayRating` تُخفى `PropertyReviewScore` بجانب العنوان.
- **مفتوح:** قسم «التقييم الذكي» القديم (من `stay_reviews`) ما زال يعرض «0 مراجعة إقامة».

**تفاصيل:** [`docs/implementation/RELEASE-0.8.41-AR.md`](./docs/implementation/RELEASE-0.8.41-AR.md)

# CONTINUE — 2026-10-13 11:15 (مسقط)

**0.8.40** · التقييمات في صفحة البحث عن الإقامات:

- **الدرجة:** `loadUnitRatings(unitIds)` في `booking-reviews-neon.ts` تحسب المتوسط والعدد من `booking_reviews`. تشترط `guest_to_host` و`published` و`released`، وتعمل عبر `elevated`.
- **البحث:** `searchStaysCatalogueFromNeon` يرفق `rating` بكل وحدة بعد المعاملة، بمهلة 2.5 ثانية (`withTimeoutFallback`).
- **العرض:** `StayRatingBadge` في القائمة والشبكة والجدول. انتبه: `.listing-row__rating` اسم قديم لعقارات الإيجار، فالصف يستخدم `.listing-row__stay-rating`.
- **الترتيب:** `rating_desc` أُضيف إلى `BrowseSort` المشترك، ولا يستخدمه إلا بحث الإقامات.
- **على الموقع الحي:** «شقة A-01» تظهر بـ 8.6 «ممتاز» و«تقييم واحد»، بعد أن أكّد ضيف ST-FE61E6C8 استلام الوديعة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.40-AR.md`](./docs/implementation/RELEASE-0.8.40-AR.md)

# CONTINUE — 2026-10-13 10:15 (مسقط)

**0.8.39** · أدوات تقييم الضيف الذكية:

- **التقييم:** `GUEST_RUBRIC` صار فيه:
  - `management`، أي «المالك أو شركة إدارة العقار»، مع البندين الجديدين `host_conduct` و`host_clarity`؛
  - `staff_team` الجديد، بالبنود الاختيارية `staff` و`staff_help` و`staff_knowledge` و`staff_presence`؛
  - الأوزان 0.35 و0.3 و0.2 و0.15.
- **الوسوم:** `GUEST_REVIEW_TAGS` تُرسل في `tags`، وتمر إلى `analyzeReview` دون تخزين في عمود مستقل.
- **النموذج `ReviewForm`:**
  - تعبئة سريعة، وتقدّم، ودرجتان حيّتان، ووسوم، وتنبيه للبنود المنخفضة؛
  - مع `referenceCode`: تلخيص قابل للتعديل (`draftReviewSummary`) و`NoteTranslateBar` مع `guestReviewNoteService`.
- **المسار:** `POST /api/public/stays/guest/review/assist` عام، ويشترط `assertGuestReviewOpen`. لذلك يظهر ضمن مسارات الضيف العامة في اختبار route-policy، وهو قرار CSRF المعلّق.
- **مفتوح:** تجربة الملخص والتصحيح بالذكاء الاصطناعي على الإنتاج، لأن الفحص المحلي كان بلا ذكاء اصطناعي.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.39-AR.md`](./docs/implementation/RELEASE-0.8.39-AR.md)

# CONTINUE — 2026-10-13 09:59 (مسقط)

**0.8.38** · صفحة حجز الإقامة اليومية بتصميم صفحة حجز الإيجار الدائم:

- `stays/[slug]/book/page.tsx` يستخدم `stays-book-shell stays-book-shell--wide-form` مثل `book/[unitId]`، مع سطر شارات `stays-book-shell__facts` يضم المواصفات والسعر والأوقات.
- حُذفت `.stay-book`.
- شريط خطوات `.stays-checkout--page` صار `grid-auto-flow: column`، فيتسع للخطوات الخمس في صفحة الإيجار.
- حُسم بند «stay-book split layout» من القائمة المعلّقة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.38-AR.md`](./docs/implementation/RELEASE-0.8.38-AR.md)

# CONTINUE — 2026-10-13 09:46 (مسقط)

**0.8.37** · ملاحظة على تحويل التأمين، ومساعد ذكي للملاحظات:

- **الملاحظة:** `RefundTransfer.note` يُحفظ في `metadata_json.transfer.note` بحدّ `REFUND_NOTE_MAX`، ويصل إلى:
  - الصف في الحسابات وصفحة العقار (`refundPaidNote`)؛
  - إشعار الضيف (`GuestDepositRefund.paidNote` في `refundNotices`)؛
  - البريد (`transferNote`).
- **المساعد:**
  - `assistNote` في `lib/note-translate-ai.ts` والمسار `POST /api/owner/notes/assist`؛
  - `NoteTranslateBar` يطلبه بعد 1.2 ثانية من التوقف عن الكتابة، ويعرض `.note-assist` بالترجمة والتصحيح والصياغة؛
  - يتوقف عند وجود ترجمة ملحقة أو بعد «إخفاء الاقتراحات».
- **مفتوح:** تجربة اقتراحات التصحيح والصياغة على الإنتاج، لأن المحرك المحلي ترجمة آلية فقط.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.37-AR.md`](./docs/implementation/RELEASE-0.8.37-AR.md)

# CONTINUE — 2026-10-13 08:57 (مسقط)

**0.8.36** · صفحات المالك والمستأجر والإقامات متوافقة مع الهاتف:

- **النمط `data-table--stack`** في `globals.css`: تحت 960px يصير كل صف بطاقة، وكل خلية تبدأ بـ `data-label`. والحاوية `.data-table-wrap:has(> .data-table--stack)` تفقد إطارها وتمريرها.
- **`PropertySectionRecords`:** `data-label` لكل خلية، وقواعد `psr-table` العريضة صارت داخل `@media (min-width: 961px)`.
- **`tenant-space.tsx`:** `Table` يضيف `data-label` من `head` بـ `cloneElement`، والحاوية `tenant-table-wrap` بدل `ops-panel` الذي كان يقصّ.
- **الإقامات:** `minmax(0, 1fr)` في `.stays-portal` و`.stays-portal__body` و`.stays-rates`، وشريط `.stays-nav` تحت 760px غير مثبّت وأقسامه شبكة من أربعة أعمدة.
- **التحقق:** الصفحات السبع بعرض الشاشة على 390px و768px، بجلستين محليتين على فرع Neon مؤقت حُذف بعد الفحص.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.36-AR.md`](./docs/implementation/RELEASE-0.8.36-AR.md)

# CONTINUE — 2026-10-13 06:57 (مسقط)

**0.8.35** · ظهور العقار بعد التأجير أو البيع، وبيانات العقار في الخطوة 3:

- **الكتالوج** (`searchPublicListingsFromNeon`): `takenClause` صار `not ownerHidTakenUnit` من `lib/listing-visibility-sql.ts`، فلا يُخفى إلا ما أخفاه المالك. والإيجار اليومي لا يُخفى أبداً.
- **القرار:** `listSaleDecisionUnits` و`decideUnitSale` في `lib/unit-sale-decision-neon.ts`، بالسؤالين `keep_selling` و`hide`. ويُحفظ في `stay_policies` بالرمز `listing_visibility:{unitId}` مع `takenRef`.
- **الحجز:** `assertUnitBookable(tx, unitId, mode)` يرفض المباع، ويسمح بالشراء لمؤجّرة أُبقيت للبيع.
- **الخطوة 3:**
  - `LeaseDepositCheckout` يأخذ `property` ويعرض «بيانات العقار»، و`contractUseForCategory` يحدد نوع الاستخدام الافتراضي؛
  - `ClientRequest` في `LeaseReservationWorkflow` يعرض طلب العميل للمالك.
- **مفتوح:**
  - التحقق من سؤال الإخفاء على الإنتاج؛
  - الفحص الفعلي لصفحات المالك والمستأجر بعد تسجيل الدخول، لأن الجلسة المحفوظة انتهت وحُذف ملفها.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.35-AR.md`](./docs/implementation/RELEASE-0.8.35-AR.md)

# CONTINUE — 2026-10-13 06:15 (مسقط)

**0.8.34** · توافق الشاشات مع كل الأجهزة:

- فُحصت الصفحات العامة فعلياً على سبعة عروض بـ `apps/web/scripts/responsive-audit.mjs`، وفُحص `globals.css` فحصاً ثابتاً.
- **الإصلاحات:**
  - `.property-discovery` صار `minmax(0, 1fr)`؛
  - جدول الإقامات لُفّ بـ `props-table-wrap props-table-desktop`؛
  - جدول المفوّضين لُفّ بـ `data-table-wrap`؛
  - `.input` و`.select` و`.textarea` صار لها `min-width: 0`؛
  - `.stays-checkout__modal-card` صار له حدّ ارتفاع.
- **مفتوح:** الفحص الفعلي لصفحات المالك والمستأجر بعد الدخول، عبر `responsive-audit.mjs login` ثم `run --state … --crawl /ar/owner,/ar/tenant,/ar/guest`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.34-AR.md`](./docs/implementation/RELEASE-0.8.34-AR.md)

# CONTINUE — 2026-10-12

**0.8.33** · التنقّل بين مراحل الحجز المكتملة عند المالك:

- في `LeaseReservationWorkflow` تحفظ الحالة `viewing` المرحلة المفتوحة. ولا تُقبل إلا مرحلة سابقة، أي `viewing < stage`.
- `CompletedStage` يعرض المرحلة للقراءة فقط، والمراحل القادمة `aria-disabled`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.33-AR.md`](./docs/implementation/RELEASE-0.8.33-AR.md)

# CONTINUE — 2026-10-12

**0.8.32** · الحجز في صفحة العقارات، وقرار البيع، وبيانات الطرف المتعاقد:

- **صفحة العقارات** (`searchPublicListingsFromNeon`):
  - `takenClause` يُخفي المباع، والمؤجّر إن لم يكن غرضه `sale`، والحجز المعتمد (`lifecycle.approval`)؛
  - `reserved_until` من الحجز `confirmed` يُعرض بـ `reservedUntilNote`.
- **قرار البيع:**
  - `listSaleDecisionUnits` و`decideUnitSale` في `lib/unit-sale-decision-neon.ts`؛
  - `POST /api/owner/units/{id}/sale-decision`؛
  - النوع `sale_decision` في `pending-approvals`؛
  - `UnitSaleDecisionPrompt` في صفحة العقار.
- **بيانات الطرف:**
  - `ReservationParty` في `lib/reservation-party.ts`: مخطط zod، و`reservationPartyError`، و`partyToLeaseTenant`؛
  - تُحفظ في `termsSnapshot.party`، ويتحقق منها `createLeaseBookingCheckout` مقابل `effectiveMinLeaseMonths`؛
  - الواجهة في الخطوة `party` من `LeaseDepositCheckout`؛
  - تُعرض بـ `ReservationPartyCard`، ويملأ `LeaseContractForm` مسبقاً عبر `initialTenant` و`termsSeed`.
- **الترجمة:** `translateName` في `lib/name-translate-ai.ts` و`POST /api/public/name-translate`.
- **أقل مدة:** `stay_policies` بالرمز `lease_min_term:{propertyId}`، و`LeaseMinTermCard` في صفحة الشروط.
- **مفتوح:** التحقق على قاعدة البيانات بعد النشر.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.32-AR.md`](./docs/implementation/RELEASE-0.8.32-AR.md)

# CONTINUE — 2026-10-12

**0.8.31** · خارطة موقع العقار ورمز QR في المستندات:

- **`loadPropertyLocation(tx, orgId, propertyId)`** (`lib/property-location-neon.ts`): `ST_Y`/`ST_X` من `addresses.location`، وإلا رابط «Google Maps:» من `property_profiles.notes`. يعيد `PropertyLocation { latitude, longitude, mapsUrl, qrSvg }` أو null.
- **`PropertyLocationMap`** (`components/property-location-map.tsx`): بلاطات OSM بالتكبير 16 حول الدبوس (5×3)، مع العلامة المائية ورمز QR. في `ContractArticle` (`doc.location`) وفي `StayBookingContract` (`booking.location`).
- **مفتوح:** التحقق على قاعدة البيانات بعد النشر؛ صفحة الضيف لحجز الإقامة و`/book/confirmed` بلا خارطة بعد.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.31-AR.md`](./docs/implementation/RELEASE-0.8.31-AR.md)

# CONTINUE — 2026-10-12

**0.8.30** · رحلة حجز الإيجار أو الشراء بعد الدفع:

- **النموذج:** `reservations.termsSnapshot.lifecycle` (`ReservationLifecycle` في `lib/lease-reservation-lifecycle.ts`). المرحلة تُحسب بـ `leaseJourneyPhase`، والدور بـ `phaseWaitsOn`. الحجز يبقى `confirmed` حتى توقيع المستأجر ثم `converted`.
- **المالك:** `reservationOwnerAction` في `lib/lease-reservation-lifecycle-neon.ts` (`approve`، `save_contract`، `review_document`، `issue_contract`، `record_handover`) عبر `POST /api/owner/bookings/{id}/lifecycle`. الملفات عبر `GET …/files/{file}`. الواجهة `LeaseReservationWorkflow`.
- **العقد بانتظار المستأجر:** `issueContract({ awaitCounterparty: true })` يعطي `partially_signed` و`approvalMode: 'awaiting_counterparty'`. والمستأجر يوقّع بـ `completeCounterpartySignatureInTx`.
- **العميل:** `LeaseJourneyCard` (`components/lease-journey.tsx`) والنصوص في `lib/lease-journey-screens.ts`. الرفع والتوقيع عبر `POST /api/public/bookings/deposits/{ref}/documents` و`…/contract-sign`.
- **مفتوح:** التحقق على قاعدة البيانات بعد النشر؛ إشعار العميل بتغيّر المرحلة؛ اختبارا السياسة الفاشلان سابقاً.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.30-AR.md`](./docs/implementation/RELEASE-0.8.30-AR.md)

# CONTINUE — 2026-10-12

**0.8.29** · صفحة حجز الموقع عند المالك:

- **`loadLeaseBookingForStaff(claims, reservationId)`** في `lib/public-lease-booking-neon.ts`: المنظمة نفسها، و`reservation.read`، و`ownerPartyScope`. تعيد بيانات الاتفاقية (`leaseBookingAgreementData` المشتركة مع `/book/sign`) ومعها `propertyId` والدفع.
- **`LeaseReservationDetail`** (`components/lease-reservation-detail.tsx`) في `/owner/bookings/[reservationId]`. والحجوزات الأخرى تبقى على `ReservationComplianceManager` عبر الـ API، مع رسالة بدل الانهيار.
- **مفتوح:** عرض صور الهوية للمالك؛ تحويل الحجز إلى عقد من الصفحة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.29-AR.md`](./docs/implementation/RELEASE-0.8.29-AR.md)

# CONTINUE — 2026-10-12

**0.8.28** · حجز الإيجار أو الشراء المدفوع عند المالك والمحاسبة:

- **الجرس:** النوع `lease_reservation` في `pending-approvals-*`: حجوزات `confirmed` فيها `termsSnapshot.depositPaidAt`، بصلاحية `reservation.manage`، مع `ownerPartyScope`. والتنبيه `paid_reservations` في `portal-overview.tsx`.
- **الحجوزات:** صفوف `reservation` في `loadBookings` (`property-records-neon.ts`) تقرأ `termsSnapshot`، والمرحلة `deposit_paid` ترفعها لأعلى القائمة.
- **المحاسبة:** `listReservationDepositAccountingRows` (`recordKind: 'reservation_deposit'`) داخل `loadStayIncomeRowsForViewer`، وتستثني ما له `depositJournalEntryId`. وفي حسابات العقار `kind: 'reservation_deposit'`.
- **مفتوح:** إشعار بريد أو واتساب للمالك؛ قيد يومية للعربون المدفوع من الموقع؛ صفحة `/owner/bookings/{id}` تعتمد على الـ API.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.28-AR.md`](./docs/implementation/RELEASE-0.8.28-AR.md)

# CONTINUE — 2026-10-12

**0.8.27** · اتفاقية الحجز بتصميم العقد المعتمد، ورقم لكل توقيع إلكتروني:

- **`ContractArticle`** (`components/contract-document-view.tsx`): المستند الرسمي وحده، بالمدخلات `contract: ContractArticleHead` و`doc` و`links: ContractArticleLinks`. تستعمله صفحة العقد (`ContractDocumentView`) وصفحة `/book/sign`.
- **اتفاقية الحجز:** `loadLeaseBookingAgreement` في `lib/public-lease-booking-neon.ts`، ثم `leaseBookingAgreement` في `lib/lease-booking-contract.ts` الذي يعيد `{ head, doc }`، ويضع `doc.reservation` الذي يغيّر خانات المبالغ والسجل ويُخفي الملاحق.
- **السلسلة الموحّدة:** `numberedSignatures` في `lib/contract-verify.ts` (عقود + `reservation.esign_completed`، والحد `RESERVATION_SERIES_FROM`). لا تُستدعى داخل `Promise.all` لأنها ترفع `app.platform_admin` مؤقتاً.
- **مفتوح:** التحقق على قاعدة البيانات بعد النشر؛ رمز QR لاتفاقية الحجز؛ توحيد `stay-booking-contract.tsx`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.27-AR.md`](./docs/implementation/RELEASE-0.8.27-AR.md)

# CONTINUE — 2026-10-12

**0.8.26** · مشاهد وترحيب لصفحتي الحجز:

- **`BookingStepScene`** (`components/stays/booking-step-scene.tsx`): مشهد 600×150 بأجزاء `stay-scene-parts` وحركات `stay-send__*`. الشاشة المكبَّرة تتغير حسب `kind`: `stay` أو `details` أو `terms` أو `review` أو `payment`.
- **الصياغة** في `lib/booking-step-greeting.ts`: `stayCheckoutGreeting` و`leaseCheckoutGreeting`، و`greetingName` الذي يتجاهل «مستخدم BHD» ويحوّل ABDUL إلى Abdul.
- **الربط:** `StayCheckout` (ليس في الوضع المضمَّن) و`LeaseDepositCheckout` تحت `.stays-checkout__steps`.
- **مفتوح:** صفحات ما بعد الدفع (`/stays/booking/confirmed` و`/book/confirmed` و`/book/sign`) بلا مشاهد بعد.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.26-AR.md`](./docs/implementation/RELEASE-0.8.26-AR.md)

# CONTINUE — 2026-10-12

**0.8.25** · موعد طلبات الضيف بشأن التأمين:

- **`claimsOpenFrom`** في `lib/stay-deposit-claims.ts`: فارغ (متاح فوراً) عند `executed` أو `rejected` أو `paidMinor > 0`، وإلا `addBusinessDays(requestedAt, CLAIM_WAIT_BUSINESS_DAYS = 10)`.
- **الخادم:** `guestDepositClaimAction` يرد بـ`claim_not_yet` قبل الموعد، ولا يقبل مبلغاً والاسترداد `requested`. و`addToDepositRefund` يرد بـ`refund_decide_first`. ومهلة `CLAIM_WINDOW_DAYS` تُحسب من `settledAtOf` فقط.
- **الضيف:** `StayDepositClaims` يظهر من لحظة طلب الاسترداد، والزر مخفي حتى الموعد مع `.stay-deposit-claims__wait`.
- **مفتوح:** الإجازات الرسمية غير محتسبة في أيام العمل.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.25-AR.md`](./docs/implementation/RELEASE-0.8.25-AR.md)

# CONTINUE — 2026-10-12

**0.8.24** · ملاحق العقد وخيارات الطباعة:

- **`ContractDetailView`:** يحمّل الملاحق المسجلة (`recordedAt`) بـ`loadContractAnnexFromNeon` ويمررها `annexDocuments` إلى `ContractDocumentView`.
- **`ContractDocumentView`:** شريط `.contract-annex-bar` بروابط `/{portal}/contracts/{id}/annex/{kind}`، ونسخة مخفية `ContractAnnexArticle` لكل ملحق بالمعرّف `contract-annex-{kind}`، وخاصية `parts` للأدوات.
- **`ContractDocumentToolbar`:** مع ملحق مسجَّل واحد على الأقل تظهر `.contract-print-picker`. الأجزاء المحددة تُنسخ إلى `.contract-print` (و`--bundle` لأكثر من جزء)، و`imagesReady` قبل `window.print()`.
- **مفتوح:** المشاركة والبريد وواتساب في صفحة العقد ترسل رابط العقد وحده.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.24-AR.md`](./docs/implementation/RELEASE-0.8.24-AR.md)

# CONTINUE — 2026-10-12

**0.8.23** · عرض موحّد للحجوزات والمعاينات:

- **`PortalMainSlot`:** قسم `bookings` لبوابتي المالك والمطوّر يمرر `listOverride={<PropertySectionRecords propertyId={null} section="bookings" />}` إلى `OperationsConsole`. يبقى الرأس و«حجز جديد» وطابور العربون، وتختفي المؤشرات وتبويبات الغرض والجدول العام.
- **البيانات:**
  - `GET /api/portal/property-records/all/bookings` ← `loadAllPropertyBookings`، ثم `loadBookings` بنطاق `BookingScope` (`propertyIds`، و`unitProperty`، و`propertyNames`).
  - كل صف يحمل `propertyId` و`propertyNameAr` و`propertyNameEn`.
- **`PropertySectionRecords`:** مع `propertyId` فارغ، يضاف عمود «العقار». والإجراءات تُرسل إلى `/api/owner/properties/{row.propertyId}/…`، ورابط العقد يفتح `/{portal}/properties/{row.propertyId}?section=contracts&focus=…`.
- **مفتوح:**
  - الحجوزات المؤقتة (holds) غير معروضة في الجدول الموحد، ولا يوجد منها شيء في الإنتاج.
  - بوابة المنصة ما زالت بالجدول العام.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.23-AR.md`](./docs/implementation/RELEASE-0.8.23-AR.md)

# CONTINUE — 2026-10-12

**0.8.22** · سرعة التحديث والتنقل:

- **`PortalRoutePrefetch`:** يبدأ بعد `SETTLE_MS` (2.5 ثانية)، وبعد `document.readyState === 'complete'`، وبعد `!hasOpsInflight()`. يمسح `.portal-nav a[href]` فقط، ويزرع أول 6 عقارات دون `/edit`.
- **المجمّعات `max: 8`:** `viewer.ts`، و`portal-ops-data.ts` (`withinViewerTenant`)، و`live-changes-neon.ts`، و`portal-overview-data.ts`. وما زال في التطبيق نحو 35 مجمّعاً منفصلاً، وتوحيدها خطوة لاحقة.
- **للقياس:**
  - `next build` و`next start` على فرع Neon، ثم Playwright يسجّل الطلبات مع `marks` (ظهور `.deposit-ledger__item`).
  - كل استعلام من جهاز القياس نحو 0.13 ثانية، وفي الإنتاج (Vercel `lhr1` وNeon `eu-west-2`) نحو 1–2 ملّي ثانية.
- **مفتوح:**
  - حوسبة Neon في الإنتاج: صار الحد الأدنى 0.5 وحدة (بالموافقة). أما منع التوقف بعد الخمول فيحتاج ترقية خطة Neon.
  - انتظار Nest في المحاسبة (حتى 1.2 ثانية).

**تفاصيل:** [`docs/implementation/RELEASE-0.8.22-AR.md`](./docs/implementation/RELEASE-0.8.22-AR.md)

# CONTINUE — 2026-10-12

**0.8.21** · صفوف مختصرة في «أمانات التأمين» وتنبيه التحويل:

- **`deposit-ledger.tsx`:**
  - `deposit-ledger__row`: الرقم والمبنى، ثم `deposit-ledger__facts` (تاريخ الطلب، والتأمين، والخصم، والمسترد من `settlementSplit`)، ثم الحالة، وزرا «تحويل التأمين» و«التفاصيل».
  - التفاصيل في `deposit-ledger__details`، وحالتها في `expanded[id]`. تُفتح افتراضياً عند `claimOpen` أو `focus`.
- **التنبيه:**
  - `loadDepositRefundQueue` يعيد `dueMinor` (المعتمد − `paid_minor`) و`currency`.
  - `PendingApprovalItem.amountMinor` و`currency` يُعرضان بالدالة `pendingApprovalAmount` في الجرس ولوحة البوابة.
  - العنوان «معاملة تحويل تأمين (الحسابات)».
- **مفتوح:** اختباران قديمان في `next-write-route-policy.test.ts` ينتظران قرار المالك. الأول: حماية CSRF لمسارات الضيف العامة أو استثناؤها. الثاني: إضافة `clientSafeErrorCode` لثلاثة مسارات مالك.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.21-AR.md`](./docs/implementation/RELEASE-0.8.21-AR.md)

# CONTINUE — 2026-10-12

**0.8.20** · تنسيق صفحة المحاسبة:

- **`deposit-ledger.tsx`:** رأس البطاقة (`deposit-ledger__ref` و`deposit-ledger__place`)، ثم `deposit-ledger__item-body`. فيه قسم `deposit-ledger__panel` «التسوية» (`DepositReconciliation`)، وقسم «تفاصيل الاسترداد» (`DepositRefundCell`) إن وُجد طلب، ثم `DepositClaimsAdmin` بالعرض كاملاً.
- **`globals.css`:**
  - البطاقات تأخذ لونها من `--tone` حسب ترتيبها.
  - داخل القسم يُخفى `.psr-refund__deposit` لأن المبلغ في «التسوية».
  - `.psr-refund__note` في إطار بخط جانبي.
  - `.ops-workspace--accounting .ops-stats` بطاقة مؤطرة في صفحة المحاسبة وحدها.
- لا تغيير في المنطق أو البيانات.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.20-AR.md`](./docs/implementation/RELEASE-0.8.20-AR.md)

# CONTINUE — 2026-10-12

**0.8.19** · حماية الضيف في التأمين والتقييم:

- **البيانات (0029، مطبَّق على الإنتاج):**
  - `stay_refunds`: `paid_minor` (المحوَّل حتى الآن)، و`transfer_recorded_at`، و`guest_receipt` (`confirmed`/`not_received`)، و`guest_receipt_at`.
  - `stay_deposit_claims`: `kind` (`not_received`/`deduction`/`other`)، و`status` (`open`/`accepted`/`rejected`/`escalated`/`resolved`)، والرد والتصعيد والقرار.
  - `platform_settings`: المفتاح `site_admin_contacts` = `{channel, emails, whatsapp}`.
- **النشر (`booking-reviews-neon.ts` → `depositSettled`):** `guest_to_host` يُنشر حين لا طلب `open`/`escalated`، ومعه:
  - لا تأمين، أو `rejected`،
  - أو `executed` مع (`guest_receipt` موجود أو مضت `RECEIPT_CONFIRM_HOURS` على `transfer_recorded_at`).
  - `host_to_guest` يُنشر فوراً، ويُبلَّغ الضيف بالبريد.
- **المشترك (`lib/stay-deposit-claims.ts`):** `depositReceiptState`، و`addBusinessDays` (الأحد–الخميس)، و`claimEscalationFrom` (3 أيام عمل من آخر تحويل، وبعد الرد أو 3 أيام على الطلب)، و`whatsappLink`، و`CLAIM_ERRORS`.
- **الخادم (`stay-deposit-claims-neon.ts`):**
  - `guestDepositClaimAction`، و`respondToDepositClaimOnNeon`، و`resolveDepositComplaint`، و`isSiteAdmin`، والإعدادات، و`loadOpenClaimQueue`/`loadOpenComplaintQueue` للتنبيهات.
  - `voidLastDepositTransfer` في `stay-deposit-refund-neon.ts`: يعيد الاسترداد `approved` وينقص آخر تحويل. والتحويل يدفع `amount − paid` ويصفّر الاستلام.
- **الواجهة:**
  - `StayDepositClaims` في صفحة إقامة الضيف.
  - `DepositClaimsAdmin` داخل «أمانات التأمين».
  - `/site-admin` (`SiteAdminPanel`، ومعه `InboxSettings`).
  - بندا التنبيه `deposit_claim` و`deposit_complaint`.
- **لاحقاً:** ربط برمجي بواجهة واتساب (الآن روابط `wa.me` من الضيف)، وتذكير للضيف قبل انتهاء الـ24 ساعة.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.19-AR.md`](./docs/implementation/RELEASE-0.8.19-AR.md)

# CONTINUE — 2026-10-12

**0.8.18** · أمانات التأمين في صفحة المحاسب:

- **القاعدة:** التأمين أمانة، لا دخل. يُعدّ مستلماً من `checked_in` بمبلغ `stay_profiles.deposit_minor`.
  - الاسترداد يُخرج من الأمانة.
  - المحتجز = التأمين − المُسترد بعد `executed`، أو التأمين كاملاً عند `rejected`. وهو وحده دخل للعقار.
- **المشترك (`lib/stay-deposit-refund.ts`):**
  - `depositHolding`: `deposit_held`، `awaiting_deposit_refund`، `awaiting_refund_transfer`، `deposit_settled`.
  - `retainedDepositMinor`، و`depositReceiptNumbers` (`DR-`/`DI-` + المرجع دون `ST-`).
- **الخادم:**
  - `lib/stay-deposit-ledger-neon.ts`: `loadDepositLedger` صف لكل إقامة، و`loadStayIncomeRowsForViewer` (دفعات الإقامة + سطور `deposit_retained`). و`refundFields` و`accountReader` انتقلا إليه.
  - `GET /api/owner/accounting/deposits`.
  - أحداث `deposit_refund` تحفظ `depositMinor` عند القرار. وعند `paid` تحفظ أيضاً `retainedMinor` و`receipts`، و`settledDepositMinor` في `DepositRefundView` يقرأها.
- **الواجهة:**
  - `DepositLedgerPanel` يُمرَّر إلى `OperationsConsole` عبر `beforeList` في `PortalMainSlot` للقسم `accounting`.
  - `DepositReconciliation` و`printDepositReceipt` مشتركان مع صفحة العقار.
  - حسابات العقار: سطور `deposit_received` (اتجاه `held`)، و`deposit_refund`، و`deposit_retained`.
- **الروابط:** «لدى المحاسب ←» و`pendingApprovalHref('refund_transfer')` يفتحان `/{portal}/accounting?focus=<bookingId>#deposits`.
- **لاحقاً:** تأمينات عقود الإيجار (الشيكات)، وقيد يومية للخصم في دليل الحسابات عند تفعيله.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.18-AR.md`](./docs/implementation/RELEASE-0.8.18-AR.md)

# CONTINUE — 2026-10-12

**0.8.17** · التقييم الإلزامي من الطرفين:

- **البيانات (0028):** `booking_reviews` فيه تقييم واحد لكل `(booking_id, direction)`، والاتجاه `guest_to_host` أو `host_to_guest`. ومعه `booking_review_photos` (صور data URL) و`review_profiles` (خلاصة الملف، والمفتاح `(subject_type, subject_key)`). مطبَّق على الإنتاج.
- **الدرجة (`lib/review-rubric.ts`):** `GUEST_RUBRIC` و`HOST_RUBRIC` بأوزان 0.4/0.3/0.3.
  - `scoreAnswers` يحوّل 1–5 إلى 10، و`blendScore` = البنود 0.8 + نص الذكاء الاصطناعي 0.2.
  - `needsComment` تحت 6.
- **الخادم (`lib/booking-reviews-neon.ts`):**
  - `submitGuestReview` (برقم الحجز، بعد `checked_out` أو `closed`) و`submitHostReview` (المنشأة والعقار ونطاق المالك).
  - `hasBookingReview` شرط في `insertGuestDepositRefundRequest` و`decideDepositRefundOnNeon`.
  - `loadReputation` و`refreshReviewProfile` (عبر `after()`)، و`loadBookingReviewFacts` لتبويب الحجوزات.
- **الإخفاء المتبادل:** `released` يعني أن الاتجاه المقابل موجود أو مضت `REVIEW_BLIND_DAYS` (14). العرض العام والصور لا يشملان إلا المنشور.
- **مفتاح الضيف:** `stay_bookings.user_id`، وإلا `'e' + sha256('bhd-r:guest:' + email)` (32 حرفاً).
- **الذكاء الاصطناعي (`lib/review-ai.ts`):** `analyzeReview` (12 ثانية) و`analyzeProfile` (20 ثانية)، ومحرك قواعد بديل. `aiChatJson` صار يقبل المهلة.
- **الواجهة:** `ReviewForm` و`ReputationView` و`StayGuestReview`، وصفحتا `/profiles/guests/[guestKey]` و`/profiles/hosts/[organizationId]`.
- **لاحقاً:** تقييم عقود الإيجار طويلة الأجل، وتقييد الموظف بعقارات محددة (من 0.8.16).

**تفاصيل:** [`docs/implementation/RELEASE-0.8.17-AR.md`](./docs/implementation/RELEASE-0.8.17-AR.md)

# CONTINUE — 2026-10-12

**0.8.16** · الفريق والصلاحيات واختيار المنشأة:

- **الفريق (`lib/team-neon.ts`):** `loadTeam` و`addTeamMember` و`updateTeamMember` و`removeTeamMember` في معاملة مرتفعة الصلاحية، مع تصفية صريحة بـ `organizationId`.
  - قفل صف المنشأة (`for update`) قبل فحص المقاعد (`entitlementsForPlan().representatives`).
  - الإزالة تجعل الحالة `archived`، والتعديل يزيد `users.sessionVersion` فيُعاد دخول العضو بصمت.
- **الصلاحيات الإضافية (`lib/team-shared.ts`):** `TEAM_CAPABILITIES` تُخزَّن في `memberships.permissions` كصلاحيات حقيقية فقط.
  - قواعد `assignableRoles` و`canManageMember` و`grantableCapabilities`.
  - `mergedPermissions` يُبقي ما لا يملك المعدِّل منحه.
- **المسارات:** `GET/POST /api/owner/team`، و`PATCH/DELETE /api/owner/team/[userId]`، و`GET/POST /api/auth/organization` للقائمة والتبديل.
- **الدخول:** `issueForUser(tx, userId, {preferred, strict})` و`chooseOrganization`.
  - الأولوية: ملف `bhd_r_org`، ثم منشأة مالك لها عقارات، ثم أحدث عضوية موظف.
  - `switchOrganizationSession` يُلغي صف الجلسة القديم لهذا الجهاز فقط.
- **الواجهة:** `TeamManager` يعرضه `PortalMainSlot` لقسم `team`، و`OrganizationSwitcher` داخل `bhd-app-switcher.tsx`.
- **قاعدة البيانات:** مُشغّل `live_changes` على `memberships` يستخدم `user_id`، وعلى `unit_media` يستخدم `unit_id` (مطبَّق على الإنتاج وفي `0027`).

**تفاصيل:** [`docs/implementation/RELEASE-0.8.16-AR.md`](./docs/implementation/RELEASE-0.8.16-AR.md)

# CONTINUE — 2026-10-12

**0.8.15** · تحويل التأمين من قسم الحسابات:

- **البيانات:** `loadRefundTransfers` في `lib/property-records-neon.ts` يضيف إلى قسم `accounting` صفوف `kind: 'deposit_refund'` (`direction: 'out'`) للاستردادات `approved` (الحالة `awaiting_refund_transfer`) و`executed` (الحالة `completed`). والحقول من `refundFields` المشترك مع `loadBookings`.
- **الواجهة (`property-section-records.tsx`):** `depositRefundAction` يعرض «تحويل التأمين» في `accounting` فقط (`viewer.canPayRefunds`)، و«لدى المحاسب ←» في `bookings` عبر `openRecord('accounting', id)`. والعمود `description` بتنسيق `detail` يعرض `DepositRefundCell` لصفوف الاسترداد.
- **الروابط:** `pendingApprovalHref` يرسل `refund_transfer` إلى `?section=accounting&focus=`.
- **الملخص:** المصروفات `kind === 'expense'` فقط، وبطاقة «تأمين بانتظار التحويل».

**تفاصيل:** [`docs/implementation/RELEASE-0.8.15-AR.md`](./docs/implementation/RELEASE-0.8.15-AR.md)

# CONTINUE — 2026-10-12

**0.8.14** · مساحة المستأجر وتنبيهاته عبر كل الملاك:

- **الربط (`lib/tenancy-neon.ts`):** `loadTenancyLinks(userId)` قراءة مرتفعة الصلاحية (`app.platform_admin`) تطابق `lower(users.email)` مع `lower(parties.email)` لطرف نشط له عقد أو إيجار أو حجز أو فاتورة كمستأجر، أو إقامة كضيف (حتى 12 رابطاً).
- **القراءة:** `withinTenant` بجلسة `roles ['tenant']` لكل منشأة. ودور قاعدة البيانات يتجاوز RLS، فكل استعلام جديد **يجب** أن يصفّي بـ `organizationId` وطرف المستأجر صراحةً.
- **البيانات:** `loadMyTenancy` (للمساحة والجرس) و`loadTenancySummary` (لشريط لوحة المالك، بمهلة 2.5 ثانية). والتنبيهات من `buildTenancyAlerts` في `lib/tenancy-shared.ts` (آمن للعميل).
- **المسار:** `GET /api/public/me/alerts` للجرس في `header-stay-alerts.tsx`.
- **المساحة:** `components/tenant-space.tsx` (`TenantSpace` يحمّل، و`TenantSpaceContent` يعرض). و`tenant/[...section]` يحوّل إلى `/tenant` أي قسم آخر لمن لا يملك دور `tenant`.
- **العقد عبر المنشآت:** `contractAccess` يجرّب `tenantClaimsForContract` أولاً، ويضع `crossOrganization` فيُخفى التوقيع.
- **البوابات:** `portalsForRoles` يضيف `tenant` دائماً، والمفتاح `.portal-space-switch` في `portal-header.tsx`، و`data-portal` على `.portal-layout` للهوية الزرقاء.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.14-AR.md`](./docs/implementation/RELEASE-0.8.14-AR.md)

# CONTINUE — 2026-10-12

**0.8.13** · ترجمة الملاحظات بالذكاء الاصطناعي:

- **المسار:** `POST /api/owner/notes/translate` (`{text, target: 'ar'|'en'}`، حتى 2000 حرف، 30 طلباً في الدقيقة) يستدعي `translateNote` في `lib/note-translate-ai.ts`: الذكاء الاصطناعي ثم `machineTranslate`.
- **الذكاء الاصطناعي المشترك:** `lib/ai-chat.ts` (`resolveAiEndpoint` و`aiChatJson`)، ويستخدمه `terms-ai.ts` أيضاً.
- **صيغة الملاحظة:** الأصل، ثم سطر `— English —` أو `— العربية —`، ثم الترجمة. الدوال في `lib/note-translation.ts` (آمنة للعميل)، و`noteOriginal` يعيد ما قبل السطر الفاصل.
- **المكوّنات:** `components/note-translate.tsx`:
  - `NoteTranslateBar` تحت حقل الملاحظة (يأخذ `value` و`onChange` و`max`).
  - `TranslatableNote` ترجمة للقراءة فقط.
- **الاتجاه:** `unicode-bidi: plaintext` على حقول الملاحظات وأماكن عرضها، فيأخذ كل سطر اتجاه لغته.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.13-AR.md`](./docs/implementation/RELEASE-0.8.13-AR.md)

# CONTINUE — 2026-10-12

**0.8.12** · جدول يتّسع للشاشة وطيّ القائمة الجانبية:

- **الجدول (`property-section-records.tsx`):**
  - كل خلية تحمل `psr-col--<format>` و`psr-key--<key>`، وعمود الإجراءات `psr-col--actions`، وهو `position: sticky` على `inset-inline-end`.
  - التنسيق `period` يعرض `fromOn` فوق `row.toOn`.
  - أنماط الجدول كلها تحت `.data-table.psr-table` لتتقدّم على أنماط `.data-table` العامة.
- **طيّ القائمة (`portal-nav.tsx`):**
  - الحالة `collapsed` والزر `.portal-sidebar__collapse`.
  - التفضيل في ملف تعريف الارتباط `bhd_r_nav`، والاسم معرّف في `lib/portal-nav-state.ts` لأن `PortalShell` (خادم) يقرؤه، ولا يصح استيراد ثابت من ملف `'use client'`.
  - العرض بـ `.portal-layout:has(> .portal-sidebar--collapsed)` داخل `@media (min-width: 961px)` فقط، فدرج الهاتف لا يتأثر.
- **اسم الرابط** صار داخل `span.portal-nav__label`، ويُخفى بصرياً فقط في وضع الشريط.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.12-AR.md`](./docs/implementation/RELEASE-0.8.12-AR.md)

# CONTINUE — 2026-10-12

**0.8.11** · مشهد «استرداد التأمين»:

- **المكوّن:** `components/stays/stay-refund-scene.tsx` (`StayRefundScene`). يأخذ `StayRefundMoment` ويرسم مشهداً لكل حالة (`open` و`requested` و`approved` و`paid` و`rejected`).
- **الأجزاء المشتركة:** في `stay-scene-parts.tsx`، ويستخدمها هذا المشهد ومشهد `StaySendPhone`.
- **الأصناف:** المشتركة `.stay-scene` و`.stay-scene__*`، والخاصة `.stay-refund__*` و`.stay-refund-scene--<state>`.
- **نصوص شاشات الاسترداد** في `refundScreen`: بصياغة «المالك أو من يمثّله».

**تفاصيل:** [`docs/implementation/RELEASE-0.8.11-AR.md`](./docs/implementation/RELEASE-0.8.11-AR.md)

# CONTINUE — 2026-10-12

**0.8.10** · مشهد «تقديم الطلب» (ضيف يرسل الطلب من هاتفه):

- **المكوّن:** `components/stays/stay-send-phone.tsx` (`StaySendPhone`). يُعرض عندما يحمل `StayGreeting` الحقل `send` (`StaySendMoment`).
- **أين يُملأ `send`:** في شاشتَي `submitted` داخل `stayGuestGreeting`: الحالة `request_pending` مع الترحيب، والحالة `payment_pending` مع الترحيب (`mode: 'instant'`).
- **المشهد لا يُعكس في RTL:** الصنف `.stay-scene` (كان `.stay-send__scene` حتى 0.8.11) مستقل عن `.stay-trip__scene`، لأن الأخير يُعكس في RTL. وأجزاء المشهد في `stay-scene-parts.tsx` منذ 0.8.11.
- **الشاشات الضيقة:** العناصر المهمة بين x=165 وx=470، فتبقى ظاهرة على الهاتف.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.10-AR.md`](./docs/implementation/RELEASE-0.8.10-AR.md)

# CONTINUE — 2026-10-12

**0.8.9** · بيانات تحويل إلزامية في طلب استرداد التأمين:

- **الطلب الجديد:** `RefundRequestPayout = RefundPayout & { phone }`.
  - `account` هو الحساب أو IBAN دائماً.
  - `method` هو الطريقة المفضّلة.
  - مع `bank` يكون `phone` للتواصل فقط.
  - الحفظ في `metadata_json.payout` لحدث `requested`.
- **الطلبات القديمة:** بلا `phone`. وما كان منها بطريقة `phone` يحمل الرقم في `account`. الدالة `guestPayoutValue` في `stay-deposit-refund-admin.tsx` تتعامل مع الحالتين.
- **الإلزام في الخادم** (`insertGuestDepositRefundRequest`):
  - `refund_account_invalid` و`refund_bank_required` و`refund_phone_invalid`.
  - المسار يعيد `refund_payout_required` إن غابت `payout`.
- **إصدار الموافقة:** `refund-terms-2026-10-12.2`.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.9-AR.md`](./docs/implementation/RELEASE-0.8.9-AR.md)

# CONTINUE — 2026-10-12

**0.8.8** · ملاحق العقد المستقلة وصور الاستلام والتسليم:

- **الملاحق:** `lib/contract-annex.ts` يعرّف الأنواع `check-in` و`check-out` و`deposit-refund`، بأرقام ثابتة A1–A3 (`annexReference`).
  - `lib/contract-annex-neon.ts` يحتوي `loadContractAnnexFromNeon(contractId, portal, kind)`، بصلاحيات العقد نفسها (`contractAccess` و`visibleContract` صارتا مُصدَّرتين).
  - يرجع null إن لم يُسجَّل الحدث بعد، فتعرض الصفحة 404.
  - العرض في `components/contract-annex-view.tsx` (`ContractAnnexDocumentView` خالص للمعاينة).
- **أجزاء مشتركة:** `components/contract-doc-parts.tsx` فيه `contractSerif` و`contractKit` و`DocLetterhead`، ويستخدمه العقد والملاحق.
- **الصور:** `photos[]` في بيانات سجل `checked_in` و`checked_out`: `{ source, takenAt, sha256, data }`.
  - `loadStayStamps` يزيل `data` بـ SQL.
  - `readHandoverPhoto` يقرأ صورة واحدة برقمها.
  - الحدود: `HANDOVER_PHOTOS_MAX = 6`، و`HANDOVER_PHOTO_MAX = 450_000` حرفاً.
- **التالي:** التوقيع على الملاحق: رمز OTP عبر واتساب، والتوقيع اليدوي، وصور البطاقة الفورية، والسيلفي. ثم ملاحق لعقود طويل الأجل.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.8-AR.md`](./docs/implementation/RELEASE-0.8.8-AR.md)

# CONTINUE — 2026-10-12

**0.8.7** · موافقة استرداد التأمين وإشعارات الضيف:

- **الموافقة:** `REFUND_CONSENT` و`REFUND_CONSENT_VERSION` في `lib/stay-deposit-refund.ts`.
  - المسار `api/public/stays/guest/deposit-refund` يرفض الطلب دون `consent: true` (`refund_consent_required`).
  - `insertGuestDepositRefundRequest` يحفظ `consent: { version, acceptedAt }` في بيانات حدث `requested`.
- **إشعارات الصفحة:** `refundNotices(refund, ar, { money, stamp })` تبني الإشعارات بمعرّفات ثابتة (`<kind>:<ISO>`).
  - `components/stays/stay-refund-notices.tsx` يعرضها فوق بطاقة الرحلة، مع «جديد» ونافذة منبثقة لما لم يُرَ.
  - المرئي محفوظ في `localStorage` (`bhd-refund-seen:<ref>`). و`useRef` يمنع التشغيل المزدوج للتأثير في وضع التطوير من إخفاء الجديد.
- **البريد:** `queueGuestRefundNotice` في `stay-deposit-refund-neon.ts` يضيف `notification.delivery.requested` إلى `outbox_events` عند القبول والرفض والتحويل.
- **التالي:** نشر `apps/worker` (Redis، و`SMTP_*`، و`EMAIL_FROM`). لا شيء نُشر من صندوق الصادر حتى الآن.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.7-AR.md`](./docs/implementation/RELEASE-0.8.7-AR.md)

# CONTINUE — 2026-10-12

**0.8.6** · فصل العقود وحالتها:

- **الأنواع:** `?kind=sale|purchase|daily|long_term` على `/contracts`.
  - `contractCategory` في `lib/contract-list-facets.ts`: `purchase` و`sale` من `contract.type`، و`daily` للإقامات، وغيرها `long_term`.
  - الخادم يضيف `category` في `loadContracts`، والملحق يرث نوع أصله. والعميل يرجع إلى `rowContractCategory(category, term)` إن غاب.
- **الحالة:** `contractState({ status, endsOn, linkedStatus, today })` تعطي `active`، أو `ended`، أو `cancelled`، أو `pending`.
  - `linkedStatus` من حالة حجز الإقامة أولاً (`source.stayBookingId`)، وإلا من حالة الإيجار.
  - سجل الإيجار المرافق للإقامة يبقى `active` بعد المغادرة.
- **الواجهة:**
  - `operations-console.tsx`: `contractsDefinition` (العنوان، وعمود الطرف، وعمود المدة لطويل الأجل فقط)، والصيغة `contract_state`. التصفية والعدّادات بـ `row.state`.
  - `portal-nav.tsx`: `contractsNavItem` بأربعة بنود، والتمييز بـ `searchParams.get('kind')`.
- **التالي:** نموذج «عقد شراء» (المالك مشترٍ) ليمتلئ قسم الشراء.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.6-AR.md`](./docs/implementation/RELEASE-0.8.6-AR.md)

# CONTINUE — 2026-10-12

**0.8.5** · ختم التوقيع، وQR بالشعار، ومعيار المستندات:

- **`--doc-serial: #c8102e`** في `.contract-doc`. يُستخدم في `.contract-doc__seal--serial b` و`.contract-doc__serial`، ولون `.verify-sign__serial` مطابق.
- **`contractQrSvg`** في `lib/contract-verify.ts`:
  - `errorCorrectionLevel: 'Q'`.
  - `withBrandMark` يضيف لوحة بيضاء ومسارات الشعار (`BRAND_MARK`) كـ `<svg>` داخلي بعرض 36% من الرمز.
- **المعيار:** `docs/product/DOCUMENTS-DESIGN-STANDARD-AR.md`، والقاعدة `.cursor/rules/documents-design.mdc`.
- **التالي:** توحيد `.stay-doc` (الإيصال وتأكيد الحجز)، والفاتورة العامة، وملخص عقد الحجز، على متغيّرات `--doc-*` وخطوط العقد.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.5-AR.md`](./docs/implementation/RELEASE-0.8.5-AR.md)

# CONTINUE — 2026-10-12

**0.8.4** · استرداد التأمين:

- **التخزين (دون ترحيل):**
  - الحالة في `stay_refunds` بالمفتاح `deposit:<bookingId>`: `requested` ← `approved` ← `executed`، أو `rejected`.
  - التفاصيل في `stay_booking_status_history` بـ `to_status='deposit_refund'` و`metadata_json.event`.
  - الإيصال في `metadata_json.receipt` (data URL)، ويُحذف من القراءة بـ `#- '{receipt}'`.
  - التحويل أو الرفض: `checked_out → closed`.
- **الخادم** في `lib/stay-deposit-refund-neon.ts`:
  - `insertGuestDepositRefundRequest`، و`decideDepositRefundOnNeon`، و`recordDepositRefundPayoutOnNeon`، و`readDepositRefundReceiptOnNeon`، و`loadDepositRefundQueue`.
  - الصلاحيات: القرار بـ `stay.booking.manage` أو `stay.refund.approve`، والتحويل بـ `payment.refund`.
- **العميل:**
  - `lib/stay-deposit-refund.ts`: `depositRefundStage` يعطي `awaiting_deposit_refund` أو `awaiting_refund_transfer`.
  - `stay-deposit-refund-admin.tsx`: الخلية والنماذج. `stay-deposit-refund-guest.tsx`: متتبّع الضيف ونموذجه.
  - الرحلة: `stayJourneyScreens(..., refund)` تعطي 5 شاشات، و`StayRefundMoment` في `stay-guest-greeting.ts`.
- **المسارات:**
  - `POST /api/public/stays/guest/deposit-refund`.
  - `records` بالإجراءين `refund_decide` و`refund_payout`.
  - `GET records/refund-receipt/[bookingId]`.
- **التالي:** إشعار الضيف بالقرار والتحويل، وقيد محاسبي للتحويل، ونقل الإيصالات إلى تخزين ملفات.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.4-AR.md`](./docs/implementation/RELEASE-0.8.4-AR.md)

# CONTINUE — 2026-10-12

**0.8.3** · قائمة العقود:

- **`loadContracts`** في `portal-ops-sections-neon.ts`:
  - يضيف للصف: `propertyNameAr/En`، و`unitNameAr/En`، و`unitCode`، و`tenantName`.
  - و`startsOn` و`endsOn` من اللقطة، وإلا من `leases`.
  - و`signedAt`: آخر `contract_signatures.signed_at`، وإلا `completedAt`.
  - و`term` و`usage` من `lib/contract-list-facets.ts`.
- **`operations-console.tsx`:**
  - أعمدة بالصيغ `term` و`usage` و`place`.
  - المرشحات في `matchesContractFilter` (نوع العقد، ونوع العقار، والسريان، ومن/إلى)، في المكوّن `.ops-filters`.
- **التالي:** حقل «نوع الاستخدام» على العقار (يحتاج ترحيلاً بموافقة)، وحقل عنوان إنجليزي، وPDF للعقد على الخادم.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.3-AR.md`](./docs/implementation/RELEASE-0.8.3-AR.md)

# CONTINUE — 2026-10-12

**0.8.2** · مشاهد صفحة الضيف:

- **`stay-trip.tsx`:**
  - `Car` بمقدّمة عند x≈111. الباب الخلفي `.stay-trip__boot` يدور حول زاويته العليا بـ 110°.
  - `OmanFlag` على سطح البيت، ويرفرف بالحركة `stay-trip-flag`.
- **`StayDeskMoment { signed, status }`:**
  - في الحقل `desk`.
  - قيد المراجعة في `request_pending`، ووُقّع في شاشة الاعتماد لطلبات الحجز.
  - يُرسم في `components/stays/stay-approval-desk.tsx`. المشهد لا يُعكس في العربية لأن فيه نصوصاً.
- **التالي:** حقل عنوان إنجليزي (يحتاج ترحيلاً)، وتوليد PDF للعقد على الخادم.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.2-AR.md`](./docs/implementation/RELEASE-0.8.2-AR.md)

# CONTINUE — 2026-10-12

**0.8.1** · توثيق الاستلام، وQR العقد، ورقم التوقيع:

- **الاستلام:**
  - `recordStayStampOnNeon` يحفظ في `metadata_json` لسجل الحالة: `noteKeys` و`customNote` و`important` و`recipient { name, phone, documentKind, document }`.
  - `loadStayStamps` يحذف `recipient.document` بـ `#-`، ويعيد `hasDocument`.
  - الصورة من `readHandoverDocument`، ومفردات الملاحظات والوثائق في `lib/stay-handover.ts`.
- **التحقق والأرقام:**
  - `lib/contract-verify.ts`:
    - `contractVerifyToken` (المعرّف + أول 10 خانات من sha256 للمعرّف وتاريخ الإنشاء، بلا مفتاح سري).
    - `signatureSerials`: `row_number` لكل منشأة وسنة.
  - صفحة `/[locale]/verify/[token]` تقرأ عبر `contract-verify-neon.ts`.
- **التالي:** حقل عنوان إنجليزي (يحتاج ترحيلاً)، وتوليد PDF للعقد على الخادم.

# CONTINUE — 2026-10-11

**0.8.0** · العقد بلغتين وصفحة الضيف:

- **العقد:**
  - `contractKit(ar)` في `contract-document-view.tsx` يوفّر `bi` و`row` و`para` و`order` (لغة الصفحة أولاً، والعربي يمين دائماً). `ltr()` يعيد `null` للفارغ، فيظهر خط الملء.
  - `doc.template` صار `{ ar, en }`: القالب الآخر بالمفتاح والإصدار نفسيهما، أو `DEFAULT_CONTRACT_TEMPLATES` من `lib/contract-default-templates.ts`.
  - التذييل خارج الجدول، و`position: fixed` في الطباعة، مع فاصل في `tfoot`. الصفحة مسمّاة `@page contract`.
- **صفحة الضيف:**
  - `StayTripMoment` بالأنواع `arrive` و`parked` و`depart`، في الحقل `trip`.
  - `components/stays/stay-trip.tsx` مشهد SVG للبيت والسيارة والأمتعة، والحركة بـ CSS عبر المتغيرين `--door` و`--wait`.
- **التالي:** حقل عنوان إنجليزي (يحتاج ترحيلاً)، وتوليد PDF للعقد على الخادم.

**تفاصيل:** [`docs/implementation/RELEASE-0.8.0-AR.md`](./docs/implementation/RELEASE-0.8.0-AR.md)

**0.7.9** · عقد فخم: `components/contract-document-view.tsx` (جديد، فُصل من `contract-detail-view.tsx`). ترويسة وتذييل في `thead`/`tfoot` يتكرران في كل صفحة مطبوعة، وإطار وعلامة مائية `position: fixed`. المحمِّل يجلب العقار مع العنوان و`property_profiles`، ومواصفات الوحدة، وهاتف الطرفين وبريدهما، وآخر 4 أرقام من `party_identity_documents`. الرقم الكامل مشفّر، فيظهر مخفياً أو خطاً للملء. التالي: توليد PDF للعقد على الخادم، وقراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.9-AR.md`](./docs/implementation/RELEASE-0.7.9-AR.md)

**0.7.8** · مشهد الطائرة: `flight` في `StayGreeting` (`landing` يوم الوصول وأثناء الإقامة وفي إعادة مرحلة الوصول، و`ready` يوم المغادرة أثناء الإقامة، و`takeoff` بعد المغادرة)، و`departure` بجانب `arrival`. `components/stays/stay-flight.tsx` يرسمه (CSS فقط، معكوس في RTL، ثابت مع تقليل الحركة). زر اللغة في صفحة الضيف (`Link` بـ `locale` مع `ref` و`welcome`). التالي: توليد PDF للعقد على الخادم، وقراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.8-AR.md`](./docs/implementation/RELEASE-0.7.8-AR.md)

**0.7.7** · عبارات صفحة الضيف: مراجعة لغوية ومرح في `lib/stay-guest-greeting.ts`؛ رسالة `review` تتفرع حسب `arrival` (`upcoming`/`today`/`due`)، فلا تقول «اشرب قهوتك» إن مضى تاريخ الوصول. `arCount` في صفحة الضيف للعدد والمعدود (بالغ/طفل). التالي: توليد PDF للعقد على الخادم، وقراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.7-AR.md`](./docs/implementation/RELEASE-0.7.7-AR.md)

**0.7.6** · العقد كوثيقة كاملة: `loadContractDetailFromNeon` يملأ `document` (`ContractDocument` في `lib/contract-document.ts`: القالب المنقّى، الترويسة، الشروط عبر `bookingTermsDocument`، أدلة التواقيع، الإقامة والاستلام، الملفات، الملاحق)؛ فحص الوصول مشترك (`contractAccess`/`visibleContract`) مع `readContractFile` ومسار `api/portal/contracts/[contractId]/files/[file]` (الهوية والصورة الشخصية لـ `stay.booking.manage` أو المستأجر نفسه). `ContractDocumentToolbar` يطبع `#contract-document` بنسخه إلى `.contract-print` مع `body.printing-contract`. التالي: توليد PDF على الخادم وإرفاقه بالبريد، وقراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.6-AR.md`](./docs/implementation/RELEASE-0.7.6-AR.md)

**0.7.5** · مراحل تفاعلية في صفحة الضيف: `stayJourneyScreens` (شاشة لكل مرحلة، `null` لغير المبلوغة) و`stayJourneyCurrent`/`stayJourneyInitialStep` في `lib/stay-guest-greeting.ts`؛ `components/stays/stay-journey.tsx` فيه `StayJourneyProvider` (مفتاحه الحالة + المرحلة الافتتاحية فيُعاد ضبطه مع المزامنة الحية) و`StayJourneySteps` (أزرار، المقفلة `disabled`) و`StayJourneyCard` (شريط «العودة إلى الآن» للمراحل السابقة). التالي: قراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.5-AR.md`](./docs/implementation/RELEASE-0.7.5-AR.md)

**0.7.4** · رسالة الضيف حسب المرحلة: `stayGuestGreeting` في `lib/stay-guest-greeting.ts` (مراحل `submitted` حين `request_pending`/`payment_pending` مع `welcome=1`، ثم `review`، `payment`، `payment_failed`، `confirmed`، `checked_in`، `checked_out` مع `rebook`، `ended`)؛ `friendlyGuestName` لتنسيق الأسماء الكبيرة. صفحة الضيف: العنوان في الصورة + بطاقة `.guest-stay-detail__greeting--{stage}` أول اللوحة. التالي: قراءة بوابة المستأجر من Neon  
**تفاصيل:** [`docs/implementation/RELEASE-0.7.4-AR.md`](./docs/implementation/RELEASE-0.7.4-AR.md)

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
