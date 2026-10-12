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
