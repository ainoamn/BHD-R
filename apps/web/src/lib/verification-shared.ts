export const VERIFICATION_KINDS = ['personal', 'business'] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_PERIODS = ['monthly', 'yearly'] as const;
export type VerificationPeriod = (typeof VERIFICATION_PERIODS)[number];

export const PERSONAL_DOCUMENTS = ['civil_id', 'passport', 'residence_card'] as const;
export const BUSINESS_DOCUMENTS = ['commercial_registration'] as const;
export type VerificationDocumentType =
  (typeof PERSONAL_DOCUMENTS)[number] | (typeof BUSINESS_DOCUMENTS)[number];

export const DOCUMENT_SLOTS = ['front', 'back', 'selfie', 'registration'] as const;
export type DocumentSlot = (typeof DOCUMENT_SLOTS)[number];

export type VerificationStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'waived';

/** Minimum name-match score (0–100) to submit a request and to keep the mark afterwards. */
export const NAME_MATCH_THRESHOLD = 70;
/** Renewal opens this many days before the current period ends. */
export const RENEWAL_WINDOW_DAYS = 30;
/** Largest stored document, as a data URL. */
export const DOCUMENT_MAX_CHARS = 1_600_000;
export const AVATAR_MAX_INPUT_CHARS = 8_000_000;

export const KIND_LABELS: Record<VerificationKind, { ar: string; en: string }> = {
  personal: { ar: 'توثيق شخصي', en: 'Personal verification' },
  business: { ar: 'توثيق منشأة', en: 'Business verification' },
};

export const PERIOD_LABELS: Record<VerificationPeriod, { ar: string; en: string }> = {
  monthly: { ar: 'شهري', en: 'Monthly' },
  yearly: { ar: 'سنوي', en: 'Yearly' },
};

export const DOCUMENT_LABELS: Record<VerificationDocumentType, { ar: string; en: string }> = {
  civil_id: { ar: 'البطاقة الشخصية (المدنية)', en: 'Civil ID card' },
  passport: { ar: 'جواز السفر', en: 'Passport' },
  residence_card: { ar: 'بطاقة الإقامة', en: 'Residence card' },
  commercial_registration: { ar: 'السجل التجاري', en: 'Commercial registration' },
};

export const SLOT_LABELS: Record<DocumentSlot, { ar: string; en: string }> = {
  front: { ar: 'وجه المستند', en: 'Document front' },
  back: { ar: 'ظهر المستند', en: 'Document back' },
  selfie: { ar: 'صورة شخصية مع المستند', en: 'Selfie holding the document' },
  registration: { ar: 'شهادة السجل التجاري', en: 'Registration certificate' },
};

export const STATUS_LABELS: Record<VerificationStatus, { ar: string; en: string }> = {
  submitted: { ar: 'قيد المراجعة', en: 'Under review' },
  approved: { ar: 'موثّق', en: 'Verified' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

export const PAYMENT_LABELS: Record<PaymentStatus, { ar: string; en: string }> = {
  unpaid: { ar: 'بانتظار الدفع', en: 'Awaiting payment' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  waived: { ar: 'معفى', en: 'Waived' },
};

export type VerificationPlan = {
  id: string;
  kind: VerificationKind;
  period: VerificationPeriod;
  priceMinor: string;
  currency: string;
  active: boolean;
};

export type VerificationRecord = {
  id: string;
  serial: string;
  kind: VerificationKind;
  period: VerificationPeriod;
  organizationId: string | null;
  organizationName: string | null;
  feeMinor: string;
  currency: string;
  legalNameAr: string | null;
  legalNameEn: string | null;
  documentType: VerificationDocumentType;
  documentLast4: string | null;
  documentExpiresOn: string | null;
  nameMatchScore: number;
  status: VerificationStatus;
  paymentStatus: PaymentStatus;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  verifiedFrom: string | null;
  verifiedUntil: string | null;
  createdAt: string;
  slots: DocumentSlot[];
  renewalOf: string | null;
};

export type ReviewQueueItem = VerificationRecord & {
  userId: string;
  accountName: string;
  accountEmail: string;
  subjectName: string;
};

export type AccountVerificationState = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  personal: { verified: boolean; until: string | null; nameDrift: boolean };
  organizations: {
    id: string;
    name: string;
    canManage: boolean;
    logoUrl: string | null;
    verified: boolean;
    until: string | null;
  }[];
  plans: VerificationPlan[];
  history: VerificationRecord[];
};

export function verificationSerial(year: number, serialNo: number): string {
  return `VRF-${year}-${String(serialNo).padStart(6, '0')}`;
}

export function periodEnd(from: Date, period: VerificationPeriod): Date {
  const end = new Date(from);
  if (period === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  return end;
}

const STOP_WORDS = new Set(['بن', 'بنت', 'ابن', 'bin', 'bint', 'ibn', 'binti', 'mr', 'mrs', 'ms']);

/** Name tokens with Arabic letter variants, diacritics, tatweel and the article folded away. */
export function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^a-z0-9\u0621-\u064A\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/^ال(?=\S{2,})/, '').replace(/^al(?=\S{3,})/, ''))
    .filter((token) => token && !STOP_WORDS.has(token) && token !== 'al' && token !== 'ال');
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length]! / longest;
}

/**
 * How well an account's display name is backed by the legal name on a document, 0–100: the share
 * of the account's name parts found in the legal name, with the given name required to match.
 * Account names are usually shorter (given + family) than full legal names, never the reverse.
 */
export function nameMatchScore(legalName: string | null | undefined, accountName: string): number {
  const legal = nameTokens(legalName ?? '');
  const account = nameTokens(accountName);
  if (!legal.length || !account.length) return 0;
  const used = new Set<number>();
  let matched = 0;
  account.forEach((token) => {
    let best = -1;
    let bestScore = 0;
    legal.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = similarity(token, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0 && bestScore >= 0.8) {
      used.add(best);
      matched += 1;
    }
  });
  const joined = similarity(legal.join(''), account.join(''));
  let score = Math.round(Math.max(matched / account.length, joined) * 100);
  if (similarity(account[0]!, legal[0]!) < 0.8) score = Math.min(score, 50);
  if (account.length === 1 && legal.length > 1) score = Math.min(score, 60);
  return score;
}

export function bestNameMatch(
  legalNames: readonly (string | null | undefined)[],
  accountNames: readonly (string | null | undefined)[],
): number {
  let best = 0;
  for (const legal of legalNames) {
    for (const account of accountNames) {
      if (legal && account) best = Math.max(best, nameMatchScore(legal, account));
    }
  }
  return best;
}
