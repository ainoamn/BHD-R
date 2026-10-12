/**
 * Annexes of a stay lease: the check-in record, the check-out record and the deposit refund.
 * Each is its own document, printed on its own, and an integral part of the contract.
 * Numbers are fixed per kind so an annex keeps its reference whatever is recorded first.
 */
import type { TermsLetterhead } from '@/lib/booking-terms';
import type { HandoverPhoto } from '@/lib/stay-handover';
import type { DepositRefundStatus, RefundPayoutMethod } from '@/lib/stay-deposit-refund';

export const CONTRACT_ANNEXES = ['check-in', 'check-out', 'deposit-refund'] as const;
export type ContractAnnexKind = (typeof CONTRACT_ANNEXES)[number];

type Pair = readonly [string, string];

export const ANNEX_META: Record<ContractAnnexKind, { number: number; title: Pair; lead: Pair }> = {
  'check-in': {
    number: 1,
    title: ['محضر استلام العين المؤجرة', 'Premises Check-in Record'],
    lead: [
      'يثبت هذا المحضر تسليم العين المؤجرة إلى الطرف الثاني وحالتها عند الاستلام.',
      'This record confirms the handover of the premises to the second party and their condition at check-in.',
    ],
  },
  'check-out': {
    number: 2,
    title: ['محضر إعادة العين المؤجرة', 'Premises Check-out Record'],
    lead: [
      'يثبت هذا المحضر إعادة العين المؤجرة إلى الطرف الأول وحالتها عند المغادرة.',
      'This record confirms the return of the premises to the first party and their condition at check-out.',
    ],
  },
  'deposit-refund': {
    number: 3,
    title: ['مستند استرداد مبلغ التأمين', 'Security Deposit Refund Record'],
    lead: [
      'يثبت هذا المستند طلب استرداد مبلغ التأمين وقرار الطرف الأول فيه وتحويل المبلغ المعتمد.',
      'This record covers the deposit refund request, the first party’s decision and the transfer of the approved amount.',
    ],
  },
};

export function isContractAnnexKind(value: unknown): value is ContractAnnexKind {
  return CONTRACT_ANNEXES.includes(value as ContractAnnexKind);
}

/** Stable annex number printed on the document, e.g. CTR-2026-000001-A1. */
export function annexReference(contractReference: string, kind: ContractAnnexKind): string {
  return `${contractReference}-A${ANNEX_META[kind].number}`;
}

/** One annex as listed on the contract: recorded or still to come. */
export type ContractAnnexLink = {
  kind: ContractAnnexKind;
  reference: string;
  recordedAt: string | null;
};

/** The three annexes as listed on the contract, each with the time it was recorded (or null). */
export function contractAnnexLinks(
  contractReference: string,
  recorded: { checkIn: string | null; checkOut: string | null; depositRefund: string | null },
): ContractAnnexLink[] {
  const recordedAt: Record<ContractAnnexKind, string | null> = {
    'check-in': recorded.checkIn,
    'check-out': recorded.checkOut,
    'deposit-refund': recorded.depositRefund,
  };
  return CONTRACT_ANNEXES.map((kind) => ({
    kind,
    reference: annexReference(contractReference, kind),
    recordedAt: recordedAt[kind],
  }));
}

export type AnnexPhoto = HandoverPhoto & { src: string };

export type AnnexHandover = {
  at: string;
  recordedBy: string | null;
  noteKeys: string[];
  customNote: string | null;
  notes: string | null;
  important: boolean;
  recipient: {
    name: string | null;
    phone: string | null;
    documentKind: string | null;
    documentHref: string | null;
  } | null;
  photos: AnnexPhoto[];
};

export type AnnexRefund = {
  status: DepositRefundStatus;
  currency: string;
  depositMinor: string | null;
  amountMinor: string;
  requestedAt: string;
  requestedBy: 'guest' | 'host';
  consent: { version: string; acceptedAt: string } | null;
  guestNote: string | null;
  /** Full account only for refund approvers and accountants; otherwise masked. */
  guestPayout: {
    method: RefundPayoutMethod;
    account: string;
    bank: string | null;
    /** Transfer phone with a `phone` method, contact only with `bank`; null before 0.8.9. */
    phone: string | null;
  } | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  transfer: {
    at: string;
    method: RefundPayoutMethod;
    account: string;
    bank: string | null;
    holder: string | null;
    reference: string | null;
    recordedBy: string | null;
    receiptHref: string | null;
  } | null;
};

export type ContractAnnexDocument = {
  kind: ContractAnnexKind;
  reference: string;
  contract: {
    id: string;
    reference: string;
    createdAt: string;
    startsOn: string | null;
    endsOn: string | null;
  };
  letterhead: TermsLetterhead | null;
  ownerName: string;
  tenantName: string;
  tenantPhone: string | null;
  tenantEmail: string | null;
  property: { nameAr: string; nameEn: string } | null;
  unit: { code: string; nameAr: string; nameEn: string } | null;
  bookingReference: string | null;
  guestPageHref: string | null;
  recordedAt: string;
  handover: AnnexHandover | null;
  refund: AnnexRefund | null;
  /** SHA-256 over the recorded facts and each photo's fingerprint. */
  fingerprint: string;
};
