/**
 * Deposit refund after check-out: the guest may ask for it, the host approves (or rejects with a
 * note), and the accountant records the transfer with its receipt. Shared by server and client.
 */
import { validHandoverPhone } from '@/lib/stay-handover';

export type DepositRefundStatus = 'requested' | 'approved' | 'rejected' | 'executed';

export const REFUND_PAYOUT_METHODS = ['bank', 'phone'] as const;
export type RefundPayoutMethod = (typeof REFUND_PAYOUT_METHODS)[number];

export const REFUND_NOTE_MAX = 1000;
/** Largest stored receipt (data URL characters, ~0.9 MB). */
export const REFUND_RECEIPT_MAX = 1_200_000;
export const REFUND_RECEIPT_DATA_URL =
  /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/;

/**
 * What the guest agrees to before asking for the deposit back. The version is stored with
 * the request, so a later wording change never rewrites what an earlier guest accepted.
 */
export const REFUND_CONSENT_VERSION = 'refund-terms-2026-10-12';
export const REFUND_CONSENT: { ar: readonly string[]; en: readonly string[] } = {
  ar: [
    'قد يستغرق طلب استرداد التأمين من يوم عمل واحد حتى أسبوعَي عمل، بحسب أولوية الطلبات السابقة.',
    'يراجع المالك الطلب فيقبله أو يرفضه، ثم يحوّل المحاسب المبلغ المعتمد إلى الحساب أو الهاتف الذي تحدده.',
    'سيصلك إشعار عند كل خطوة: قبول الطلب أو رفضه، وتحويل المبلغ.',
  ],
  en: [
    'A deposit refund may take from one working day up to two working weeks, depending on the priority of earlier requests.',
    'The host reviews the request and approves or declines it; the accountant then transfers the approved amount to the account or phone you give.',
    'You will be notified at every step: when the request is approved or declined, and when the money is transferred.',
  ],
};

/** Suggestions for the bank field; any other bank can be typed. */
export const OMAN_BANKS: readonly string[] = [
  'بنك مسقط · Bank Muscat',
  'البنك الوطني العماني · National Bank of Oman',
  'بنك ظفار · Bank Dhofar',
  'صحار الدولي · Sohar International',
  'البنك العربي العماني · Oman Arab Bank',
  'بنك إتش إس بي سي عمان · HSBC Oman',
  'البنك الأهلي · Ahli Bank',
  'بنك نزوى · Bank Nizwa',
  'العز الإسلامي · Alizz Islamic Bank',
  'بنك الإسكان العماني · Oman Housing Bank',
];

/** Where the money goes: a bank account (or IBAN) or a phone number linked to a bank. */
export type RefundPayout = {
  method: RefundPayoutMethod;
  account: string;
  bank: string | null;
  holder: string | null;
};

export type RefundTransfer = RefundPayout & {
  at: string;
  reference: string | null;
  recordedBy: string | null;
  hasReceipt: boolean;
};

/** Full refund record for the host and the accountant. */
export type DepositRefundView = {
  id: string;
  status: DepositRefundStatus;
  amountMinor: string;
  currency: string;
  requestedAt: string;
  requestedBy: 'guest' | 'host';
  /** The refund terms the guest accepted with the request (0.8.7 onward). */
  consent: { version: string; acceptedAt: string } | null;
  guestNote: string | null;
  guestPayout: RefundPayout | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  transfer: RefundTransfer | null;
};

/** What the guest sees: status, amount and dates; the receiving account only masked. */
export type GuestDepositRefund = {
  status: DepositRefundStatus;
  amountMinor: string;
  currency: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  paidTo: string | null;
};

/** Host-side stage of a checked-out stay that still holds a deposit. */
export type DepositRefundStage = 'awaiting_deposit_refund' | 'awaiting_refund_transfer';

export function isRefundPayoutMethod(value: unknown): value is RefundPayoutMethod {
  return value === 'bank' || value === 'phone';
}

/** Account numbers / IBANs: 4–34 letters or digits, spaces and dashes allowed. */
export function validPayoutAccount(method: RefundPayoutMethod, value: string): boolean {
  const trimmed = value.trim();
  if (method === 'phone') return validHandoverPhone(trimmed);
  const compact = trimmed.replace(/[\s-]/g, '');
  return /^[A-Za-z0-9 -]+$/.test(trimmed) && compact.length >= 4 && compact.length <= 34;
}

export function maskAccount(value: string): string {
  const compact = value.replace(/[\s-]/g, '');
  return compact.length <= 4 ? compact : `••••${compact.slice(-4)}`;
}

export function hasDeposit(depositMinor: string | null | undefined): boolean {
  return Boolean(depositMinor && /^\d+$/.test(depositMinor) && BigInt(depositMinor) > 0n);
}

/**
 * What a checked-out stay still waits for: the host's decision (with or without a guest
 * request), or the accountant's transfer. Null once settled or when there is no deposit.
 */
export function depositRefundStage(
  bookingStatus: string | null | undefined,
  depositMinor: string | null | undefined,
  refundStatus: DepositRefundStatus | null | undefined,
): DepositRefundStage | null {
  if (bookingStatus !== 'checked_out' || !hasDeposit(depositMinor)) return null;
  if (!refundStatus || refundStatus === 'requested') return 'awaiting_deposit_refund';
  if (refundStatus === 'approved') return 'awaiting_refund_transfer';
  return null;
}

export type RefundNoticeKind = 'requested' | 'approved' | 'rejected' | 'paid';

/** One step of the refund told to the guest; the id stays the same across reloads. */
export type RefundNotice = {
  id: string;
  kind: RefundNoticeKind;
  at: string;
  title: string;
  body: string;
};

/** The guest's notices, newest first: request received, host decision, transfer. */
export function refundNotices(
  refund: GuestDepositRefund,
  ar: boolean,
  format: { money: (minor: string) => string; stamp: (iso: string) => string },
): RefundNotice[] {
  const amount = format.money(refund.amountMinor);
  const notices: RefundNotice[] = [
    {
      id: `requested:${refund.requestedAt}`,
      kind: 'requested',
      at: format.stamp(refund.requestedAt),
      title: ar ? 'استلمنا طلب استرداد التأمين' : 'Deposit refund request received',
      body: ar
        ? 'قد يستغرق الطلب من يوم عمل واحد حتى أسبوعَي عمل بحسب أولوية الطلبات السابقة.'
        : 'It may take from one working day up to two working weeks, depending on earlier requests.',
    },
  ];
  if (refund.decidedAt && refund.status === 'rejected') {
    const reason = refund.decisionNote?.trim();
    notices.push({
      id: `rejected:${refund.decidedAt}`,
      kind: 'rejected',
      at: format.stamp(refund.decidedAt),
      title: ar ? 'رُفض طلب استرداد التأمين' : 'Deposit refund declined',
      body: reason
        ? ar
          ? `سبب الرفض: ${reason}`
          : `Reason: ${reason}`
        : ar
          ? 'لم يوافق المالك على استرداد مبلغ التأمين.'
          : 'The host did not approve the deposit refund.',
    });
  }
  if (refund.decidedAt && (refund.status === 'approved' || refund.status === 'executed')) {
    const note = refund.decisionNote?.trim();
    notices.push({
      id: `approved:${refund.decidedAt}`,
      kind: 'approved',
      at: format.stamp(refund.decidedAt),
      title: ar ? 'وافق المالك على استرداد التأمين' : 'Deposit refund approved',
      body: [
        ar
          ? `اعتُمد استرداد ${amount}، وسيصلك إشعار عند تحويل المبلغ.`
          : `${amount} was approved; you will be notified when it is transferred.`,
        note ? (ar ? `ملاحظة المالك: ${note}` : `Host note: ${note}`) : null,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  if (refund.paidAt && refund.status === 'executed') {
    notices.push({
      id: `paid:${refund.paidAt}`,
      kind: 'paid',
      at: format.stamp(refund.paidAt),
      title: ar ? 'تم تحويل مبلغ التأمين' : 'Deposit transferred',
      body: refund.paidTo
        ? ar
          ? `حُوّل ${amount} إلى ${refund.paidTo}.`
          : `${amount} was transferred to ${refund.paidTo}.`
        : ar
          ? `حُوّل ${amount}.`
          : `${amount} was transferred.`,
    });
  }
  return notices.reverse();
}

export function guestDepositRefund(view: DepositRefundView): GuestDepositRefund {
  const transfer = view.transfer;
  return {
    status: view.status,
    amountMinor: view.amountMinor,
    currency: view.currency,
    requestedAt: view.requestedAt,
    decidedAt: view.decidedAt,
    decisionNote: view.decisionNote,
    paidAt: transfer?.at ?? null,
    paidTo: transfer
      ? [transfer.bank, maskAccount(transfer.account)].filter(Boolean).join(' · ')
      : null,
  };
}
