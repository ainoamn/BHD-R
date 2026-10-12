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
