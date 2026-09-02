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
  confirmed: { ar: 'مؤكّد', en: 'Confirmed' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  pre_arrival: { ar: 'قبل الوصول', en: 'Pre-arrival' },
  checked_in: { ar: 'تم تسجيل الوصول', en: 'Checked in' },
  checked_out: { ar: 'تم المغادرة', en: 'Checked out' },
  closed: { ar: 'مكتمل', en: 'Completed' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  expired: { ar: 'منتهٍ', en: 'Expired' },
  no_show: { ar: 'لم يحضر', en: 'No-show' },
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
  active: { ar: 'ساري', en: 'Active' },
  inactive: { ar: 'غير نشط', en: 'Inactive' },
  draft: { ar: 'مسودة', en: 'Draft' },
  published: { ar: 'منشور', en: 'Published' },
  unpublished: { ar: 'غير منشور', en: 'Unpublished' },
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
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
  terminated: { ar: 'منتهٍ', en: 'Terminated' },
  vacant: { ar: 'شاغر', en: 'Vacant' },
  occupied: { ar: 'مشغول', en: 'Occupied' },
  available: { ar: 'متاح', en: 'Available' },
  blocked: { ar: 'مغلق', en: 'Blocked' },
  booked: { ar: 'محجوز', en: 'Booked' },
  hold: { ar: 'حجز مؤقت', en: 'Hold' },
  maintenance: { ar: 'صيانة', en: 'Maintenance' },
  lease: { ar: 'إيجار', en: 'Lease' },
  unavailable: { ar: 'غير متاح', en: 'Unavailable' },
};

const WORKFLOW_EVENTS: Record<string, { ar: string; en: string }> = {
  'stay.booking.requested': { ar: 'طلب حجز إقامة يومية', en: 'Daily stay booking requested' },
  'stay_booking.payment_confirmed': {
    ar: 'تأكيد دفع حجز إقامة',
    en: 'Stay booking payment confirmed',
  },
  'stay.booking.confirmed': { ar: 'تأكيد حجز إقامة', en: 'Stay booking confirmed' },
  'stay.checked_out': { ar: 'مغادرة ضيف إقامة', en: 'Stay guest checked out' },
  'stay.cancelled': { ar: 'إلغاء حجز إقامة', en: 'Stay booking cancelled' },
  'stay.no_show': { ar: 'عدم حضور ضيف', en: 'Stay guest no-show' },
  'reservation.created': { ar: 'إنشاء حجز معاينة/عربون', en: 'Reservation created' },
  'reservation.deposit_confirmed': { ar: 'تأكيد عربون حجز', en: 'Reservation deposit confirmed' },
  'hold.cancelled': { ar: 'إلغاء حجز مؤقت', en: 'Hold cancelled' },
  'lease.renewal_requested': { ar: 'طلب تجديد عقد', en: 'Lease renewal requested' },
  'lease.renewal_pending_clearance': {
    ar: 'تجديد بانتظار المخالصة',
    en: 'Lease renewal pending clearance',
  },
  'request.created': { ar: 'طلب جديد', en: 'New request' },
  'request.status_changed': { ar: 'تحديث حالة طلب', en: 'Request status updated' },
  'task.created': { ar: 'مهمة جديدة', en: 'New task' },
  'task.status_changed': { ar: 'تحديث حالة مهمة', en: 'Task status updated' },
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
  'resource.approval_decided': { ar: 'اعتماد مورد', en: 'Resource approval decided' },
  'property.ownership_transferred': {
    ar: 'نقل ملكية عقار',
    en: 'Property ownership transferred',
  },
  'journal.created': { ar: 'إنشاء قيد محاسبي', en: 'Journal created' },
  'journal.posted': { ar: 'ترحيل قيد محاسبي', en: 'Journal posted' },
  'journal.reversed': { ar: 'عكس قيد محاسبي', en: 'Journal reversed' },
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
  if (isAr(locale)) return cleaned;
  return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
