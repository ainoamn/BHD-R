/**
 * After the deposit refund: the guest confirms the transfer arrived (or says it did not), may
 * send the host a request or objection about the deposit, and when no satisfying answer comes,
 * escalates it to the site administration as a complaint. Shared by server and client.
 */

export const CLAIM_KINDS = [
  'not_received',
  'deduction',
  'other',
  'property_complaint',
  'appeal',
  'site_complaint',
] as const;
export type DepositClaimKind = (typeof CLAIM_KINDS)[number];
/** Kinds the guest picks for a regular request; `not_received` comes from the receipt question. */
export const GUEST_CLAIM_KINDS = ['deduction', 'not_received', 'other'] as const;
export const REGULAR_CLAIM_KINDS = ['not_received', 'deduction', 'other'] as const;
export type RegularClaimKind = (typeof REGULAR_CLAIM_KINDS)[number];
export const TRACK_CLAIM_KINDS = ['property_complaint', 'appeal', 'site_complaint'] as const;
export type TrackClaimKind = (typeof TRACK_CLAIM_KINDS)[number];

export type DepositClaimStatus =
  'open' | 'with_accountant' | 'accepted' | 'rejected' | 'escalated' | 'resolved';

/** Still in flight — guest cannot open another request until these close. */
export function claimIsActive(status: string): boolean {
  return status === 'open' || status === 'with_accountant' || status === 'escalated';
}

export function isRegularClaimKind(kind: string): kind is RegularClaimKind {
  return kind === 'not_received' || kind === 'deduction' || kind === 'other';
}

export function isTrackClaimKind(kind: string): kind is TrackClaimKind {
  return kind === 'property_complaint' || kind === 'appeal' || kind === 'site_complaint';
}

/** Property-management track: owner may accept or reject without the accountant. */
export function claimOwnerClosesDirectly(kind: string): boolean {
  return kind === 'property_complaint' || kind === 'appeal';
}

export const CLAIM_MESSAGE_MIN = 10;
export const CLAIM_MESSAGE_MAX = 1500;
export const CLAIM_NOTE_MIN = 3;
/** Hours the guest has to confirm a transfer; silence after that counts as received. */
export const RECEIPT_CONFIRM_HOURS = 24;
/**
 * Working days after an unanswered property complaint or appeal before it auto-escalates
 * to the site administration.
 */
export const PROPERTY_RESPONSE_BUSINESS_DAYS = 7;
/** @deprecated Prefer PROPERTY_RESPONSE_BUSINESS_DAYS — kept for older copy/tests. */
export const ESCALATION_BUSINESS_DAYS = PROPERTY_RESPONSE_BUSINESS_DAYS;
/** Days after the refund (or its rejection) during which the guest may send a claim. */
export const CLAIM_WINDOW_DAYS = 30;
/** Calendar days the site administration has to decide an escalated complaint. */
export const SITE_DECISION_DAYS = 30;
/** Working days the host has to settle a refund request: the two working weeks told to the guest. */
export const CLAIM_WAIT_BUSINESS_DAYS = 10;
/** Regular deposit requests/objections per stay (then property complaint → appeal → site). */
export const MAX_REGULAR_CLAIMS_PER_STAY = 2;
/** @deprecated Use MAX_REGULAR_CLAIMS_PER_STAY. */
export const MAX_CLAIMS_PER_STAY = MAX_REGULAR_CLAIMS_PER_STAY;

export type DepositReceiptState = 'pending' | 'confirmed' | 'auto' | 'not_received';

export function isGuestClaimKind(value: unknown): value is RegularClaimKind {
  return value === 'not_received' || value === 'deduction' || value === 'other';
}

export type GuestDepositNextStep =
  | { step: 'claim' }
  | { step: 'property_complaint' }
  | { step: 'appeal' }
  | { step: 'site_complaint' }
  | { step: 'none' };

/** What the guest may open next once nothing is active. */
export function guestDepositNextStep(
  claims: readonly { kind: string; status: string; createdAt: string }[],
): GuestDepositNextStep {
  if (claims.some((claim) => claimIsActive(claim.status))) return { step: 'none' };
  const regular = claims.filter((claim) => isRegularClaimKind(claim.kind));
  const property = claims.filter((claim) => claim.kind === 'property_complaint');
  const appeals = claims.filter((claim) => claim.kind === 'appeal');
  const site = claims.filter((claim) => claim.kind === 'site_complaint');
  if (regular.length < MAX_REGULAR_CLAIMS_PER_STAY) return { step: 'claim' };
  if (property.length === 0) return { step: 'property_complaint' };
  const propertyClosedByOwner = property.some(
    (claim) => claim.status === 'accepted' || claim.status === 'rejected',
  );
  const propertyDecidedBySite = property.some((claim) => claim.status === 'resolved');
  if (propertyDecidedBySite && appeals.length === 0) return { step: 'none' };
  if (propertyClosedByOwner && appeals.length === 0) return { step: 'appeal' };
  if (appeals.length === 0) return { step: 'none' };
  const appealClosedByOwner = appeals.some(
    (claim) => claim.status === 'accepted' || claim.status === 'rejected',
  );
  const appealDecidedBySite = appeals.some((claim) => claim.status === 'resolved');
  if (appealDecidedBySite || site.length > 0) return { step: 'none' };
  if (appealClosedByOwner) return { step: 'site_complaint' };
  return { step: 'none' };
}

/** When an unanswered property complaint / appeal must auto-escalate to the site. */
export function propertyTrackAutoEscalateFrom(createdAt: string): string {
  return addBusinessDays(createdAt, PROPERTY_RESPONSE_BUSINESS_DAYS);
}

/** Site-administration decision deadline (calendar days from escalation). */
export function siteDecisionDueFrom(escalatedAt: string): string {
  const start = Date.parse(escalatedAt);
  if (Number.isNaN(start)) return escalatedAt;
  return new Date(start + SITE_DECISION_DAYS * 86_400_000).toISOString();
}

/**
 * The guest's answer to the last transfer: waiting (with its deadline), confirmed, said not
 * received, or counted as received once the 24 hours passed in silence.
 */
export function depositReceiptState(
  input: {
    status: string | null | undefined;
    guestReceipt: string | null | undefined;
    transferRecordedAt: string | null | undefined;
  },
  now = Date.now(),
): { state: DepositReceiptState; deadline: string | null } | null {
  if (input.status !== 'executed') return null;
  if (input.guestReceipt === 'confirmed') return { state: 'confirmed', deadline: null };
  if (input.guestReceipt === 'not_received') return { state: 'not_received', deadline: null };
  const recorded = input.transferRecordedAt ? Date.parse(input.transferRecordedAt) : Number.NaN;
  if (Number.isNaN(recorded)) return { state: 'auto', deadline: null };
  const deadline = recorded + RECEIPT_CONFIRM_HOURS * 3_600_000;
  return now >= deadline
    ? { state: 'auto', deadline: new Date(deadline).toISOString() }
    : { state: 'pending', deadline: new Date(deadline).toISOString() };
}

const MUSCAT_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;

/** Adds working days in Oman (the weekend is Friday and Saturday), keeping the time of day. */
export function addBusinessDays(fromIso: string, days: number): string {
  const start = Date.parse(fromIso);
  if (Number.isNaN(start)) return fromIso;
  let local = start + MUSCAT_OFFSET_MS;
  let counted = 0;
  while (counted < days) {
    local += DAY_MS;
    const weekday = new Date(local).getUTCDay();
    if (weekday !== 5 && weekday !== 6) counted += 1;
  }
  return new Date(local - MUSCAT_OFFSET_MS).toISOString();
}

/**
 * When the guest may send the host a request or objection: at once when the deposit was
 * transferred (in part or in full) or the refund rejected; otherwise two working weeks after
 * the refund request. Null means open now.
 */
export function claimsOpenFrom(refund: {
  status: string;
  requestedAt: string | null;
  paidMinor: string | null;
}): string | null {
  if (refund.status === 'executed' || refund.status === 'rejected') return null;
  if (refund.paidMinor && /^\d+$/.test(refund.paidMinor) && BigInt(refund.paidMinor) > 0n) {
    return null;
  }
  return refund.requestedAt ? addBusinessDays(refund.requestedAt, CLAIM_WAIT_BUSINESS_DAYS) : null;
}

/**
 * Auto-escalation deadline for an unanswered property complaint or appeal (7 working days).
 * Regular requests do not escalate in place — the guest opens the next track step instead.
 */
export function claimEscalationFrom(
  claim: {
    status: DepositClaimStatus;
    createdAt: string;
    respondedAt: string | null;
    kind?: string;
  },
  _settledAt: string | null,
): string | null {
  if (claim.status === 'escalated' || claim.status === 'resolved') return null;
  if (claim.kind !== 'property_complaint' && claim.kind !== 'appeal') return null;
  if (claim.status !== 'open' || claim.respondedAt) return null;
  return propertyTrackAutoEscalateFrom(claim.createdAt);
}

export type DepositClaimView = {
  id: string;
  bookingId: string;
  /** Isolated request number for this cycle, e.g. DC-ST-72170FF9-01. */
  referenceCode: string;
  kind: DepositClaimKind;
  status: DepositClaimStatus;
  amountMinor: string | null;
  currency: string;
  message: string;
  createdAt: string;
  response: {
    decision: 'accepted' | 'rejected' | 'referred';
    /** Guest-visible note from owner or accountant. */
    note: string | null;
    amountMinor: string | null;
    at: string;
    by: string | null;
  } | null;
  /** Owner note to accountant — never returned to the guest client. */
  ownerInternalNote: string | null;
  /** Accountant note to owner — never returned to the guest client. */
  accountantInternalNote: string | null;
  referredAt: string | null;
  referredBy: string | null;
  escalation: { at: string; message: string | null } | null;
  resolution: {
    outcome: 'guest' | 'host';
    note: string | null;
    amountMinor: string | null;
    at: string;
    by: string | null;
  } | null;
  /** When the guest may escalate it to the site administration; null when not possible. */
  escalateFrom: string | null;
};

export function claimKindLabel(kind: string, ar: boolean): string {
  if (kind === 'not_received') return ar ? 'لم يصل المبلغ المحوَّل' : 'Transfer not received';
  if (kind === 'deduction') return ar ? 'اعتراض على الخصم أو الرفض' : 'Objection to the deduction';
  if (kind === 'property_complaint') {
    return ar ? 'شكوى لإدارة العقار' : 'Complaint to property management';
  }
  if (kind === 'appeal') return ar ? 'تظلُّم' : 'Appeal';
  if (kind === 'site_complaint') {
    return ar ? 'شكوى نهائية لإدارة الموقع' : 'Final complaint to site administration';
  }
  return ar ? 'طلب آخر بشأن التأمين' : 'Other deposit request';
}

export function claimStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'open':
      return ar ? 'وصل للمالك / الإدارة' : 'With the owner / management';
    case 'with_accountant':
      return ar ? 'أُحيل للمحاسب' : 'Referred to accounting';
    case 'accepted':
      return ar ? 'اعتُمد وأُغلق' : 'Approved & closed';
    case 'rejected':
      return ar ? 'رُفض وأُغلق' : 'Declined & closed';
    case 'escalated':
      return ar ? 'شكوى لدى إدارة الموقع' : 'Complaint with the site administration';
    case 'resolved':
      return ar ? 'بتّت فيه إدارة الموقع' : 'Decided by the site administration';
    default:
      return status;
  }
}

export function claimStatusTone(status: string): 'warn' | 'ready' | 'muted' | 'info' {
  if (status === 'open' || status === 'with_accountant' || status === 'escalated') return 'warn';
  if (status === 'accepted') return 'ready';
  if (status === 'resolved') return 'info';
  return 'muted';
}

/** Sort claims newest first (createdAt descending). */
export function sortClaimsNewestFirst<T extends { createdAt: string }>(claims: readonly T[]): T[] {
  return [...claims].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type ComplaintChannel = 'email' | 'whatsapp';

/** Who handles guest complaints for the site, and how they are told about a new one. */
export type SiteAdminSettings = {
  channel: ComplaintChannel;
  emails: string[];
  whatsapp: string[];
};

export const SITE_ADMIN_LIMIT = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validAdminEmail(value: string): boolean {
  return value.length <= 160 && EMAIL.test(value);
}

/** International digits for wa.me; a local 8-digit Omani number gets 968. */
export function whatsappDigits(value: string): string | null {
  let digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = `968${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(number: string, text: string): string | null {
  const digits = whatsappDigits(number);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export const CLAIM_ERRORS: Record<string, { status: number; ar: string; en: string }> = {
  booking_not_found: { status: 404, ar: 'الحجز غير موجود.', en: 'Booking not found.' },
  claim_not_found: { status: 404, ar: 'الطلب غير موجود.', en: 'Request not found.' },
  forbidden: { status: 403, ar: 'لا تملك صلاحية هذا الإجراء.', en: 'Not allowed.' },
  refund_not_decided: {
    status: 409,
    ar: 'تُتاح الطلبات والاعتراضات بعد قرار المالك في استرداد التأمين.',
    en: 'Requests open once the host has decided on the deposit refund.',
  },
  claim_not_yet: {
    status: 409,
    ar: 'تُتاح الطلبات والاعتراضات بعد تحويل مبلغ التأمين، أو بعد أسبوعَي عمل من طلب الاسترداد.',
    en: 'Requests open once the deposit is transferred, or two working weeks after the refund request.',
  },
  refund_decide_first: {
    status: 409,
    ar: 'قرّر طلب استرداد التأمين أولاً، ثم أضف المبلغ للضيف.',
    en: 'Decide the deposit refund request first, then add the amount.',
  },
  receipt_not_open: {
    status: 409,
    ar: 'لا يوجد تحويل بانتظار تأكيد استلامك.',
    en: 'There is no transfer waiting for your confirmation.',
  },
  claim_open_exists: {
    status: 409,
    ar: 'لديك طلباً قيد المعالجة؛ انتظر إغلاقه قبل فتح طلب جديد برقم مستقل.',
    en: 'You already have a request in progress; wait until it closes before opening a new one.',
  },
  claim_not_with_owner: {
    status: 409,
    ar: 'هذا الطلب ليس بانتظار المالك حالياً.',
    en: 'This request is not awaiting the owner right now.',
  },
  claim_not_with_accountant: {
    status: 409,
    ar: 'هذا الطلب ليس بانتظار المحاسب حالياً.',
    en: 'This request is not awaiting the accountant right now.',
  },
  claim_limit: {
    status: 409,
    ar: `يحق لك طلبان أو اعتراضان فقط بشأن التأمين في هذه الإقامة؛ بعدهما تقدّم شكوى لإدارة العقار.`,
    en: `You may send only ${MAX_REGULAR_CLAIMS_PER_STAY} deposit requests on this stay; then open a property-management complaint.`,
  },
  track_not_ready: {
    status: 409,
    ar: 'هذه الخطوة غير متاحة بعد؛ أكمل الطلبات السابقة أو انتظر إغلاق الطلب الحالي.',
    en: 'This step is not available yet; finish earlier requests or wait for the open one to close.',
  },
  track_exists: {
    status: 409,
    ar: 'لديك شكوى أو تظلُّماً في هذه المرحلة مسبقاً.',
    en: 'You already have a complaint or appeal at this stage.',
  },
  claim_window_closed: {
    status: 409,
    ar: `انتهت مهلة تقديم الطلبات (${CLAIM_WINDOW_DAYS} يوماً بعد الاسترداد).`,
    en: `Requests close ${CLAIM_WINDOW_DAYS} days after the refund.`,
  },
  claim_message_required: {
    status: 400,
    ar: `اشرح طلبك في ${CLAIM_MESSAGE_MIN} أحرف على الأقل.`,
    en: `Explain your request in at least ${CLAIM_MESSAGE_MIN} characters.`,
  },
  claim_amount_invalid: {
    status: 400,
    ar: 'المبلغ المطلوب أكبر من المخصوم من التأمين أو غير صالح.',
    en: 'The amount is invalid or above what was kept from the deposit.',
  },
  claim_not_received_invalid: {
    status: 409,
    ar: 'لا يوجد تحويل مسجَّل لتقول إنه لم يصلك.',
    en: 'There is no recorded transfer to report as missing.',
  },
  claim_closed: {
    status: 409,
    ar: 'تم الرد على هذا الطلب مسبقاً؛ حُدّثت الصفحة.',
    en: 'This request was already answered.',
  },
  claim_note_required: {
    status: 400,
    ar: 'اكتب ردّك على الطلب (يظهر للضيف).',
    en: 'Write your answer (shown to the guest).',
  },
  escalation_not_yet: {
    status: 409,
    ar: `تُحال الشكوى أو التظلُّم تلقائياً لإدارة الموقع بعد ${PROPERTY_RESPONSE_BUSINESS_DAYS} أيام عمل دون رد من إدارة العقار.`,
    en: `A complaint or appeal auto-escalates to the site administration after ${PROPERTY_RESPONSE_BUSINESS_DAYS} working days without a property-management reply.`,
  },
  complaint_not_open: {
    status: 409,
    ar: 'هذه الشكوى ليست بانتظار قرار؛ حُدّثت القائمة.',
    en: 'This complaint is not awaiting a decision.',
  },
  settings_invalid: {
    status: 400,
    ar: 'تحقق من البريد وأرقام واتساب: بريد واحد صحيح على الأقل، ورقم واحد على الأقل إن اخترت واتساب.',
    en: 'Check the emails and WhatsApp numbers: at least one valid email, and one number for WhatsApp.',
  },
  rate_limited: { status: 429, ar: 'محاولات كثيرة — انتظر قليلاً.', en: 'Too many attempts.' },
  invalid_body: { status: 400, ar: 'البيانات غير صالحة.', en: 'Invalid request.' },
};

/** The JSON error body and status of a claim error code; unknown codes are a 500. */
export function claimErrorBody(code: string): {
  status: number;
  body: { error: { code: string; messageAr: string; message: string } };
} {
  const known = Object.hasOwn(CLAIM_ERRORS, code) ? CLAIM_ERRORS[code] : undefined;
  if (!known) {
    return {
      status: 500,
      body: {
        error: {
          code: 'request_failed',
          messageAr: 'تعذّر تنفيذ الطلب. أعد المحاولة.',
          message: 'Could not complete the request. Try again.',
        },
      },
    };
  }
  return {
    status: known.status,
    body: { error: { code, messageAr: known.ar, message: known.en } },
  };
}
