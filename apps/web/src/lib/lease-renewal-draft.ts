import type {
  AdjustmentKind,
  AdjustmentRecurrence,
  AdjustmentScope,
  PaymentFrequency,
  PaymentMethod,
} from '@/lib/lease-terms';

export type RenewalAdjustmentDraft = {
  kind: AdjustmentKind;
  title: string;
  amount: string;
  recurrence: AdjustmentRecurrence;
  scope: AdjustmentScope;
  months: string;
};

export type RenewalChequeDraft = {
  bankName: string;
  chequeNumber: string;
  amount: string;
  dueOn: string;
};

export type LeaseRenewalDraft = {
  version: 1;
  templateVersionId: string;
  months: string;
  endsOn: string;
  rent: string;
  graceDays: string;
  graceAsDiscount: boolean;
  paymentMethod: PaymentMethod;
  paymentFrequency: PaymentFrequency;
  paymentDay: string;
  chequeBankName: string;
  adjustments: RenewalAdjustmentDraft[];
  cheques: RenewalChequeDraft[];
  additionalTerms: string;
  updatedAt: string;
};

const PREFIX = 'bhd-r.lease-renewal-draft.';
const PREFIX_V2 = 'bhd-r.lease-renewal-draft.v2.';

export function renewalDraftKey(leaseId: string): string {
  return `${PREFIX}${leaseId}`;
}

export function readRenewalDraft(leaseId: string): LeaseRenewalDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(renewalDraftKey(leaseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaseRenewalDraft;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeRenewalDraft(leaseId: string, draft: LeaseRenewalDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      renewalDraftKey(leaseId),
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearRenewalDraft(leaseId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(renewalDraftKey(leaseId));
    window.localStorage.removeItem(`${PREFIX_V2}${leaseId}`);
  } catch {
    /* ignore */
  }
}

export function hasRenewalDraft(leaseId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem(`${PREFIX_V2}${leaseId}`)) return true;
  } catch {
    /* ignore */
  }
  return Boolean(readRenewalDraft(leaseId));
}
