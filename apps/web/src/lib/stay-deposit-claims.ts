/**
 * After the deposit refund: the guest confirms the transfer arrived (or says it did not), may
 * send the host a request or objection about the deposit, and when no satisfying answer comes,
 * escalates it to the site administration as a complaint. Shared by server and client.
 */

export const CLAIM_KINDS = ['not_received', 'deduction', 'other'] as const;
export type DepositClaimKind = (typeof CLAIM_KINDS)[number];
/** Kinds the guest picks in the form; `not_received` comes from the receipt question. */
export const GUEST_CLAIM_KINDS = ['deduction', 'not_received', 'other'] as const;

export type DepositClaimStatus = 'open' | 'accepted' | 'rejected' | 'escalated' | 'resolved';

export const CLAIM_MESSAGE_MIN = 10;
export const CLAIM_MESSAGE_MAX = 1500;
export const CLAIM_NOTE_MIN = 3;
/** Hours the guest has to confirm a transfer; silence after that counts as received. */
export const RECEIPT_CONFIRM_HOURS = 24;
/** Working days after the refund before the guest may complain to the site administration. */
export const ESCALATION_BUSINESS_DAYS = 3;
/** Days after the refund (or its rejection) during which the guest may send a claim. */
export const CLAIM_WINDOW_DAYS = 30;
export const MAX_CLAIMS_PER_STAY = 5;

export type DepositReceiptState = 'pending' | 'confirmed' | 'auto' | 'not_received';

export function isGuestClaimKind(value: unknown): value is DepositClaimKind {
  return value === 'not_received' || value === 'deduction' || value === 'other';
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
 * When the guest may escalate a claim to the site administration: 3 working days after the
 * refund settled (the transfer, or the rejection), and only once the host answered the claim
 * or left it unanswered for 3 working days. Null when it cannot be escalated.
 */
export function claimEscalationFrom(
  claim: { status: DepositClaimStatus; createdAt: string; respondedAt: string | null },
  settledAt: string | null,
): string | null {
  if (claim.status === 'escalated' || claim.status === 'resolved') return null;
  const afterRefund = addBusinessDays(settledAt ?? claim.createdAt, ESCALATION_BUSINESS_DAYS);
  const afterHost = claim.respondedAt
    ? claim.respondedAt
    : addBusinessDays(claim.createdAt, ESCALATION_BUSINESS_DAYS);
  return afterRefund > afterHost ? afterRefund : afterHost;
}

export type DepositClaimView = {
  id: string;
  bookingId: string;
  kind: DepositClaimKind;
  status: DepositClaimStatus;
  amountMinor: string | null;
  currency: string;
  message: string;
  createdAt: string;
  response: {
    decision: 'accepted' | 'rejected';
    note: string | null;
    amountMinor: string | null;
    at: string;
    by: string | null;
  } | null;
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
  return ar ? 'طلب آخر بشأن التأمين' : 'Other deposit request';
}

export function claimStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'open':
      return ar ? 'بانتظار رد المالك' : 'Awaiting the host';
    case 'accepted':
      return ar ? 'قبِله المالك' : 'Accepted by the host';
    case 'rejected':
      return ar ? 'رفضه المالك' : 'Declined by the host';
    case 'escalated':
      return ar ? 'شكوى لدى إدارة الموقع' : 'Complaint with the site administration';
    case 'resolved':
      return ar ? 'بتّت فيه إدارة الموقع' : 'Decided by the site administration';
    default:
      return status;
  }
}

export function claimStatusTone(status: string): 'warn' | 'ready' | 'muted' | 'info' {
  if (status === 'open' || status === 'escalated') return 'warn';
  if (status === 'accepted') return 'ready';
  if (status === 'resolved') return 'info';
  return 'muted';
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
  receipt_not_open: {
    status: 409,
    ar: 'لا يوجد تحويل بانتظار تأكيد استلامك.',
    en: 'There is no transfer waiting for your confirmation.',
  },
  claim_open_exists: {
    status: 409,
    ar: 'لديك طلب مفتوح بانتظار رد المالك؛ تابعه أولاً.',
    en: 'You already have an open request waiting for the host.',
  },
  claim_limit: {
    status: 409,
    ar: 'بلغت الحد الأعلى لطلبات هذه الإقامة.',
    en: 'This stay has reached the request limit.',
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
    ar: `تُرفع الشكوى لإدارة الموقع بعد ${ESCALATION_BUSINESS_DAYS} أيام عمل من استرداد التأمين، وبعد رد المالك أو مرور ${ESCALATION_BUSINESS_DAYS} أيام عمل على طلبك.`,
    en: `Complaints open ${ESCALATION_BUSINESS_DAYS} working days after the refund, once the host answered or ${ESCALATION_BUSINESS_DAYS} working days passed.`,
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
