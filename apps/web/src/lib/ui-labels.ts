/** Shared bilingual UI labels for statuses, modes, and workflow activity. */

type LocaleLike = string | boolean;

function isAr(locale: LocaleLike): boolean {
  return locale === true || locale === 'ar';
}

function pick(ar: boolean, arabic: string, english: string): string {
  return ar ? arabic : english;
}

const STAY_STATUS: Record<string, { ar: string; en: string }> = {
  payment_pending: { ar: 'بانتظار الدفع', en: 'Awaiting payment' },
  request_pending: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval' },
  reschedule_pending: { ar: 'طلب تعديل التواريخ', en: 'Date change requested' },
  confirmed: { ar: 'مؤكّد', en: 'Confirmed' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  pre_arrival: { ar: 'قبل الوصول', en: 'Pre-arrival' },
  checked_in: { ar: 'تم تسجيل الوصول', en: 'Checked in' },
  checked_out: { ar: 'تم المغادرة', en: 'Checked out' },
  closed: { ar: 'مكتمل', en: 'Completed' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  expired: { ar: 'منتهٍ', en: 'Expired' },
  no_show: { ar: 'تخلف عن الحضور', en: 'No-show' },
  payment_failed: { ar: 'فشل الدفع', en: 'Payment failed' },
};

const BOOKING_MODE: Record<string, { ar: string; en: string }> = {
  instant: { ar: 'حجز فوري', en: 'Instant book' },
  request: { ar: 'طلب حجز', en: 'Request to book' },
};

const STAY_TYPE: Record<string, { ar: string; en: string }> = {
  overnight_stay: { ar: 'إقامة مع مبيت', en: 'Stay with overnight' },
  overnight_only: { ar: 'مبيت فقط', en: 'Overnight only' },
  day_use: { ar: 'إقامة بدون مبيت', en: 'Day use' },
};

const DOMAIN_STATUS: Record<string, { ar: string; en: string }> = {
  ...STAY_STATUS,
  awaiting_check_in: { ar: 'بانتظار الدخول', en: 'Awaiting check-in' },
  awaiting_check_out: { ar: 'بانتظار المغادرة', en: 'Awaiting check-out' },
  awaiting_deposit_refund: {
    ar: 'بانتظار قرار استرداد التأمين',
    en: 'Deposit refund decision due',
  },
  awaiting_refund_transfer: {
    ar: 'لدى المحاسب لتحويل التأمين',
    en: 'With the accountant for transfer',
  },
  deposit_paid: { ar: 'عربون مدفوع — جهّز العقد', en: 'Deposit paid — prepare the contract' },
  awaiting_terms_signature: {
    ar: 'بانتظار توقيع العميل على الشروط',
    en: 'Awaiting client terms signature',
  },
  awaiting_payment_review: {
    ar: 'أكّد استلام العربون',
    en: 'Confirm the deposit was received',
  },
  awaiting_owner_approval: { ar: 'عربون مدفوع — بانتظار اعتمادك', en: 'Paid — awaiting approval' },
  awaiting_contract_draft: {
    ar: 'معتمد — جهّز العقد والمستندات',
    en: 'Approved — prepare the contract',
  },
  awaiting_documents: { ar: 'بانتظار مستندات العميل', en: 'Awaiting client documents' },
  awaiting_documents_review: { ar: 'مستندات بانتظار مراجعتك', en: 'Documents to review' },
  awaiting_contract_approval: { ar: 'العقد جاهز لاعتمادك', en: 'Contract ready to approve' },
  awaiting_tenant_signature: {
    ar: 'العقد بانتظار توقيع العميل',
    en: 'Contract awaiting client signature',
  },
  awaiting_handover: { ar: 'عقد موقّع — بانتظار التسليم', en: 'Signed — awaiting handover' },
  handed_over: { ar: 'تم تسليم العقار', en: 'Handed over' },
  deposit_held: { ar: 'أمانة محتجزة', en: 'Held in trust' },
  deposit_settled: { ar: 'تم التحويل', en: 'Transferred' },
  deposit_income: { ar: 'دخل للعقار', en: 'Property income' },
  active: { ar: 'ساري', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  draft: { ar: 'مسودة', en: 'Draft' },
  published: { ar: 'منشور', en: 'Published' },
  unpublished: { ar: 'غير منشور', en: 'Unpublished' },
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  deposited: { ar: 'مودع للتحصيل', en: 'Deposited' },
  cleared: { ar: 'محصّل', en: 'Cleared' },
  bounced: { ar: 'مرتجع', en: 'Bounced' },
  approved: { ar: 'معتمد', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
  open: { ar: 'مفتوح', en: 'Open' },
  assigned: { ar: 'مُسند', en: 'Assigned' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  completed: { ar: 'مكتمل', en: 'Completed' },
  resolved: { ar: 'محلول', en: 'Resolved' },
  issued: { ar: 'صادرة', en: 'Issued' },
  partially_paid: { ar: 'مدفوعة جزئياً', en: 'Partially paid' },
  overdue: { ar: 'متأخرة', en: 'Overdue' },
  void: { ar: 'ملغاة', en: 'Void' },
  refunded: { ar: 'مسترد', en: 'Refunded' },
  partially_refunded: { ar: 'مسترد جزئياً', en: 'Partially refunded' },
  succeeded: { ar: 'ناجح', en: 'Succeeded' },
  failed: { ar: 'فشل', en: 'Failed' },
  scheduled: { ar: 'مجدول', en: 'Scheduled' },
  held: { ar: 'محجوز', en: 'Held' },
  converted: { ar: 'محوّل', en: 'Converted' },
  terminated: { ar: 'ملغى', en: 'Cancelled' },
  vacant: { ar: 'شاغر', en: 'Vacant' },
  occupied: { ar: 'مشغول', en: 'Occupied' },
  available: { ar: 'متاح', en: 'Available' },
  blocked: { ar: 'مغلق', en: 'Blocked' },
  booked: { ar: 'محجوز', en: 'Booked' },
  hold: { ar: 'حجز مؤقت', en: 'Hold' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  lease: { ar: 'إيجار', en: 'Lease' },
  unavailable: { ar: 'غير متاح', en: 'Unavailable' },
  sent: { ar: 'مُرسل للتوقيع', en: 'Sent for signature' },
  partially_signed: { ar: 'موقّع جزئياً', en: 'Partially signed' },
  signed: { ar: 'موقّع', en: 'Signed' },
  pending_start: { ar: 'بانتظار البدء', en: 'Pending start' },
  ended: { ar: 'منتهٍ', en: 'Ended' },
  cancel_requested: { ar: 'طلب إلغاء', en: 'Cancellation requested' },
  clearance_pending: { ar: 'بانتظار المخالصة', en: 'Clearance pending' },
  requested: { ar: 'مطلوب', en: 'Requested' },
  viewing_requested: { ar: 'طلب معاينة', en: 'Viewing requested' },
  viewing_scheduled: { ar: 'معاينة مجدولة', en: 'Viewing scheduled' },
  on_hold: { ar: 'معلّق', en: 'On hold' },
  lead: { ar: 'عميل محتمل', en: 'Lead' },
  qualified: { ar: 'مؤهَّل', en: 'Qualified' },
  viewing: { ar: 'معاينة', en: 'Viewing' },
  offer: { ar: 'عرض سعر', en: 'Offer' },
  negotiation: { ar: 'تفاوض', en: 'Negotiation' },
  reserved: { ar: 'محجوز', en: 'Reserved' },
  contracting: { ar: 'قيد التعاقد', en: 'Contracting' },
  closed_won: { ar: 'تم البيع', en: 'Sold' },
  closed_lost: { ar: 'لم يتم البيع', en: 'Lost' },
  posted: { ar: 'مُرحَّل', en: 'Posted' },
  approved_signed: { ar: 'معتمد وموقّع', en: 'Approved & signed' },
  pending_manager_approval: { ar: 'بانتظار اعتماد المدير', en: 'Awaiting manager approval' },
  rented: { ar: 'مؤجر', en: 'Rented' },
  upcoming_lease: { ar: 'مؤجر — يبدأ لاحقاً', en: 'Rented — starts later' },
  lease_completed: { ar: 'انتهت مدة الإيجار', en: 'Lease term ended' },
  listed: { ar: 'معروض للإعلان', en: 'Listed' },
  unlisted: { ar: 'غير معروض', en: 'Unlisted' },
  hidden: { ar: 'مخفي', en: 'Hidden' },
};

const WORKFLOW_EVENTS: Record<string, { ar: string; en: string }> = {
  'stay.booking.requested': { ar: 'طلب حجز إقامة يومية', en: 'Daily stay booking requested' },
  'stay_booking.payment_confirmed': {
    ar: 'تأكيد دفع حجز إقامة',
    en: 'Stay booking payment confirmed',
  },
  'stay_booking.esign_completed': {
    ar: 'توقيع إلكتروني مكتمل لحجز إقامة',
    en: 'Stay booking e-signature completed',
  },
  'stay.booking.confirmed': { ar: 'تأكيد حجز إقامة', en: 'Stay booking confirmed' },
  'contract.signed': { ar: 'اعتماد عقد وتوقيعه', en: 'Contract approved & signed' },
  'contract.approval_requested': {
    ar: 'عقد بانتظار اعتماد المدير',
    en: 'Contract awaiting manager approval',
  },
  'stay.checked_in': { ar: 'دخول ضيف إقامة', en: 'Stay guest checked in' },
  'stay.checked_out': { ar: 'مغادرة ضيف إقامة', en: 'Stay guest checked out' },
  'stay.cancelled': { ar: 'إلغاء حجز إقامة', en: 'Stay booking cancelled' },
  'stay.no_show': { ar: 'عدم حضور ضيف', en: 'Stay guest no-show' },
  'reservation.created': { ar: 'إنشاء حجز معاينة/عربون', en: 'Reservation created' },
  'reservation.deposit_confirmed': { ar: 'تأكيد عربون حجز', en: 'Reservation deposit confirmed' },
  'reservation.public_checkout_started': {
    ar: 'بدء حجز إيجار أو شراء من الموقع',
    en: 'Website rent or purchase booking started',
  },
  'reservation.deposit_paid': {
    ar: 'دفع عربون حجز إيجار أو شراء',
    en: 'Rent or purchase booking deposit paid',
  },
  'reservation.esign_completed': {
    ar: 'توقيع إلكتروني لاتفاقية حجز',
    en: 'Reservation agreement e-signed',
  },
  'reservation.esign_evidence': {
    ar: 'إثبات هوية لتوقيع اتفاقية حجز',
    en: 'Reservation e-signature identity evidence',
  },
  'reservation.payment_confirmed': {
    ar: 'تأكيد استلام العربون',
    en: 'Deposit receipt confirmed',
  },
  'reservation.booking_docs_returned': {
    ar: 'إرجاع مستندات الحجز للعميل للتعديل',
    en: 'Booking documents returned to the client for fixes',
  },
  'reservation.booking_doc_replaced': {
    ar: 'استبدال مستند حجز من العميل',
    en: 'Client replaced a booking document',
  },
  'reservation.requirements_added': {
    ar: 'إضافة مستندات مطلوبة للحجز',
    en: 'Required booking documents added',
  },
  'reservation.cheque_rejected': {
    ar: 'رفض شيك الحجز',
    en: 'Reservation cheque rejected',
  },
  'reservation.municipal_registration_saved': {
    ar: 'حفظ تسجيل البلدية',
    en: 'Municipal registration saved',
  },
  'reservation.owner_approved': { ar: 'اعتماد المالك للحجز', en: 'Booking approved by owner' },
  'reservation.contract_prepared': {
    ar: 'تجهيز بيانات العقد والمستندات المطلوبة',
    en: 'Contract details and required documents prepared',
  },
  'reservation.document_submitted': { ar: 'رفع العميل مستنداً', en: 'Client uploaded a document' },
  'reservation.document_approved': { ar: 'قبول مستند العميل', en: 'Client document accepted' },
  'reservation.document_rejected': { ar: 'رفض مستند العميل', en: 'Client document rejected' },
  'reservation.contract_issued': {
    ar: 'اعتماد العقد وإرساله لتوقيع العميل',
    en: 'Contract approved and sent to the client',
  },
  'reservation.converted': {
    ar: 'توقيع العميل على العقد — حجز محوّل إلى عقد',
    en: 'Client signed the contract — booking converted',
  },
  'reservation.handed_over': { ar: 'تسليم العقار للعميل', en: 'Premises handed over' },
  'reservation.handover_evidence': {
    ar: 'إثبات تسليم العقار',
    en: 'Handover evidence recorded',
  },
  'reservation.handover_selfie': {
    ar: 'صورة سيلفي للتسليم',
    en: 'Handover selfie',
  },
  'reservation.handover_selfie_taken': {
    ar: 'التقاط سيلفي التسليم',
    en: 'Handover selfie taken',
  },
  'reservation.handover_handler_selfie': {
    ar: 'سيلفي المسلِّم',
    en: 'Handover staff selfie',
  },
  'reservation.handover_handler_selfie_taken': {
    ar: 'التقاط سيلفي المسلِّم',
    en: 'Handover staff selfie taken',
  },
  'reservation.handover_defects': {
    ar: 'ملاحظات عيوب عند التسليم',
    en: 'Handover defects noted',
  },
  'reservation.handover_defects_reported': {
    ar: 'إبلاغ بعيوب بعد التسليم',
    en: 'Handover defects reported',
  },
  'reservation.contract_esign_evidence': {
    ar: 'إثبات توقيع عقد الحجز',
    en: 'Reservation contract e-sign evidence',
  },
  'reservation.documents_package_sent': {
    ar: 'إرسال حزمة مستندات الحجز',
    en: 'Reservation documents package sent',
  },
  'reservation.documents_auto_accepted': {
    ar: 'قبول مستندات الحجز تلقائياً',
    en: 'Reservation documents auto-accepted',
  },
  'reservation.document_file': {
    ar: 'ملف مستند للحجز',
    en: 'Reservation document file',
  },
  'reservation.document_verified': {
    ar: 'التحقق من مستند الحجز',
    en: 'Reservation document verified',
  },
  'reservation.cheque_submitted': {
    ar: 'تقديم شيك للحجز',
    en: 'Reservation cheque submitted',
  },
  'reservation.cheque_file': {
    ar: 'ملف شيك للحجز',
    en: 'Reservation cheque file',
  },
  'reservation.cheque_approved': {
    ar: 'اعتماد شيك الحجز',
    en: 'Reservation cheque approved',
  },
  'reservation.auto_contract_skipped': {
    ar: 'تخطي إنشاء العقد التلقائي',
    en: 'Auto contract creation skipped',
  },
  'reservation.restored': { ar: 'استعادة حجز', en: 'Reservation restored' },
  'reservation.cancelled': { ar: 'إلغاء حجز', en: 'Reservation cancelled' },
  'reservation.tenant_attested': {
    ar: 'إقرار المستأجر على الحجز',
    en: 'Tenant attested the reservation',
  },
  'leasing.report_issued': {
    ar: 'إصدار تقرير تأجير',
    en: 'Leasing report issued',
  },
  'unit.listing_kept': {
    ar: 'الإبقاء على عرض الوحدة',
    en: 'Unit listing kept',
  },
  'unit.listing_hidden': {
    ar: 'إخفاء عرض الوحدة',
    en: 'Unit listing hidden',
  },
  'stay.deposit_refund.receipt_confirmed': {
    ar: 'تأكيد استلام تحويل استرداد التأمين',
    en: 'Stay deposit refund receipt confirmed',
  },
  'contract.awaiting_counterparty': {
    ar: 'عقد بانتظار توقيع الطرف الثاني',
    en: 'Contract awaiting the other party',
  },
  'contract.counterparty_signed': {
    ar: 'توقيع الطرف الثاني على العقد',
    en: 'Other party signed the contract',
  },
  'hold.cancelled': { ar: 'إلغاء حجز مؤقت', en: 'Hold cancelled' },
  'lease.cancelled': { ar: 'إلغاء عقد إيجار', en: 'Lease cancelled' },
  'lease.renewal_requested': { ar: 'طلب تجديد عقد', en: 'Lease renewal requested' },
  'lease.renewal_pending_clearance': {
    ar: 'تجديد بانتظار المخالصة',
    en: 'Lease renewal pending clearance',
  },
  'contract.termination_issued': {
    ar: 'إصدار ملحق فسخ / إنهاء عقد',
    en: 'Contract termination issued',
  },
  'stay.deposit_claim.opened': {
    ar: 'فتح مطالبة تأمين إقامة',
    en: 'Stay deposit claim opened',
  },
  'stay.deposit_claim.accepted': {
    ar: 'قبول مطالبة تأمين إقامة',
    en: 'Stay deposit claim accepted',
  },
  'stay.deposit_claim.rejected': {
    ar: 'رفض مطالبة تأمين إقامة',
    en: 'Stay deposit claim rejected',
  },
  'stay.deposit_refund.requested': {
    ar: 'طلب استرداد تأمين إقامة',
    en: 'Stay deposit refund requested',
  },
  'stay.deposit_refund.approved': {
    ar: 'الموافقة على استرداد تأمين إقامة',
    en: 'Stay deposit refund approved',
  },
  'stay.deposit_refund.paid': {
    ar: 'تحويل استرداد تأمين إقامة',
    en: 'Stay deposit refund paid',
  },
  'stay.deposit_refund.receipt_not_received': {
    ar: 'الضيف لم يستلم تحويل التأمين',
    en: 'Stay deposit transfer not received',
  },
  'stay.deposit_refund.transfer_voided': {
    ar: 'إلغاء تحويل استرداد التأمين',
    en: 'Stay deposit transfer voided',
  },
  'stay.deposit_waived': { ar: 'إعفاء من تأمين إقامة', en: 'Stay deposit waived' },
  'stay.review.released': { ar: 'نشر تقييم إقامة', en: 'Stay review released' },
  'stay.booking.reschedule_approved': {
    ar: 'الموافقة على تعديل تواريخ إقامة',
    en: 'Stay date change approved',
  },
  'request.created': { ar: 'طلب جديد', en: 'New request' },
  'request.status_changed': { ar: 'تحديث حالة طلب', en: 'Request status updated' },
  'tenant_request.created': { ar: 'طلب مستأجر جديد', en: 'Tenant request created' },
  'tenant_request.replied': { ar: 'رد على طلب مستأجر', en: 'Tenant request replied' },
  'tenant_request.approve': { ar: 'اعتماد طلب مستأجر', en: 'Tenant request approved' },
  'tenant_request.complete': { ar: 'إكمال طلب مستأجر', en: 'Tenant request completed' },
  'tenant_request.photos': { ar: 'صور مرفقة بطلب مستأجر', en: 'Tenant request photos' },
  'tenant_request.media': { ar: 'مرفقات طلب مستأجر', en: 'Tenant request media' },
  'tenant_request.charge_paid': {
    ar: 'سداد رسوم طلب مستأجر',
    en: 'Tenant request charge paid',
  },
  'tenant_charge.created': { ar: 'رسوم على المستأجر', en: 'Tenant charge created' },
  'task.created': { ar: 'مهمة جديدة', en: 'New task' },
  'task.status': { ar: 'تغيير حالة مهمة', en: 'Task status changed' },
  'task.status_changed': { ar: 'تحديث حالة مهمة', en: 'Task status updated' },
  'task.reply': { ar: 'رد على مهمة', en: 'Task reply' },
  'task.file': { ar: 'مرفق مهمة', en: 'Task file' },
  'task.link': { ar: 'ربط مهمة', en: 'Task linked' },
  'task.reopen': { ar: 'إعادة فتح مهمة', en: 'Task reopened' },
  'task.reassigned': { ar: 'إعادة إسناد مهمة', en: 'Task reassigned' },
  'task.priority': { ar: 'تغيير أولوية مهمة', en: 'Task priority changed' },
  'task.dates': { ar: 'تحديث تواريخ مهمة', en: 'Task dates updated' },
  'task.tags': { ar: 'تحديث وسوم مهمة', en: 'Task tags updated' },
  'task.legal': { ar: 'إجراء قانوني على مهمة', en: 'Task legal action' },
  'task.roster': { ar: 'تحديث فريق المهمة', en: 'Task roster updated' },
  'party.updated': { ar: 'تحديث جهة اتصال', en: 'Contact updated' },
  'viewing.created': { ar: 'معاينة جديدة', en: 'New viewing' },
  'viewing.status_changed': { ar: 'تحديث حالة معاينة', en: 'Viewing status updated' },
  'sale.created': { ar: 'بيع جديد', en: 'New sale' },
  'sale.status_changed': { ar: 'تحديث حالة بيع', en: 'Sale status updated' },
  'work_order.created': { ar: 'أمر صيانة جديد', en: 'New work order' },
  'work_order.status_changed': { ar: 'تحديث أمر صيانة', en: 'Work order updated' },
  'work_order.approval_decided': { ar: 'اعتماد أمر صيانة', en: 'Work order approval decided' },
  'legal_case.created': { ar: 'قضية قانونية جديدة', en: 'Legal case created' },
  'legal_case.status_changed': { ar: 'تحديث قضية قانونية', en: 'Legal case updated' },
  'approval.decided': { ar: 'قرار اعتماد', en: 'Approval decided' },
  'approval.unlocked': { ar: 'فتح اعتماد', en: 'Approval unlocked' },
  'expense.created': { ar: 'مصروف جديد', en: 'Expense created' },
  'expense.approval_decided': { ar: 'اعتماد مصروف', en: 'Expense approval decided' },
  'expense.cancelled': { ar: 'إلغاء مصروف', en: 'Expense cancelled' },
  'resource.approval_decided': { ar: 'اعتماد مورد', en: 'Resource approval decided' },
  'property.ownership_transferred': {
    ar: 'نقل ملكية عقار',
    en: 'Property ownership transferred',
  },
  'journal.created': { ar: 'إنشاء قيد محاسبي', en: 'Journal created' },
  'journal.posted': { ar: 'ترحيل قيد محاسبي', en: 'Journal posted' },
  'journal.reversed': { ar: 'عكس قيد محاسبي', en: 'Journal reversed' },
  'journal.discarded': { ar: 'تجاهل قيد محاسبي', en: 'Journal discarded' },
  'journal.unposted': { ar: 'إلغاء ترحيل قيد محاسبي', en: 'Journal unposted' },
  'invoice.voided': { ar: 'إلغاء فاتورة', en: 'Invoice voided' },
  'account.created': { ar: 'إنشاء حساب محاسبي', en: 'Account created' },
  'settings.updated': { ar: 'تحديث إعدادات', en: 'Settings updated' },
};

function lookup(
  map: Record<string, { ar: string; en: string }>,
  key: string | null | undefined,
  locale: LocaleLike,
): string {
  if (!key) return '';
  const hit = map[key] ?? map[key.toLowerCase()];
  if (hit) return pick(isAr(locale), hit.ar, hit.en);
  return key;
}

/** Prefer this for stay booking statuses across portals and guest surfaces. */
export function stayStatusLabel(status: string, locale: LocaleLike): string {
  const hit = STAY_STATUS[status];
  if (hit) return pick(isAr(locale), hit.ar, hit.en);
  return lookup(DOMAIN_STATUS, status, locale);
}

export function stayBookingModeLabel(mode: string | null | undefined, locale: LocaleLike): string {
  if (!mode) return '—';
  return lookup(BOOKING_MODE, mode, locale);
}

export function stayTypeLabel(type: string | null | undefined, locale: LocaleLike): string {
  if (!type) return '—';
  return lookup(STAY_TYPE, type, locale);
}

/** Generic domain/row status for portal tables and ops badges. */
export function domainStatusLabel(status: string | null | undefined, locale: LocaleLike): string {
  if (!status) return '—';
  const hit = DOMAIN_STATUS[status] ?? DOMAIN_STATUS[status.toLowerCase()];
  if (hit) return pick(isAr(locale), hit.ar, hit.en);
  return humanizeKey(status, locale);
}

export function workflowEventLabel(
  eventType: string | null | undefined,
  locale: LocaleLike,
): string {
  if (!eventType) return '';
  const hit = WORKFLOW_EVENTS[eventType];
  if (hit) return pick(isAr(locale), hit.ar, hit.en);
  return humanizeKey(eventType, locale);
}

export function workflowStatusLabel(status: string | null | undefined, locale: LocaleLike): string {
  return domainStatusLabel(status, locale);
}

export function apiReachabilityLabel(online: boolean, locale: LocaleLike): string {
  return online
    ? pick(isAr(locale), 'متصل', 'Online')
    : pick(isAr(locale), 'غير متصل / مقيّد', 'Offline / gated');
}

function humanizeKey(key: string, locale: LocaleLike): string {
  const cleaned = key.replace(/[._]/g, ' ').trim();
  if (!cleaned) return key;
  // Never leave raw English snake/dot keys in Arabic UI — show a clear placeholder.
  if (isAr(locale)) return `نشاط: ${cleaned}`;
  return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
