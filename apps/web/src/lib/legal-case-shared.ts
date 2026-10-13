/**
 * Legal case workspace shared by the owner team and the case's external lawyer: stages, update
 * kinds, attachment limits and the shapes the case page and its routes exchange.
 */

export const LEGAL_STAGES = [
  'assessment',
  'notice',
  'filed',
  'hearing',
  'judgment',
  'enforcement',
  'settled',
  'closed',
  'cancelled',
] as const;
export type LegalStage = (typeof LEGAL_STAGES)[number];

export const LEGAL_STAGE_LABELS: Record<LegalStage, { ar: string; en: string }> = {
  assessment: { ar: 'تقييم', en: 'Assessment' },
  notice: { ar: 'إنذار', en: 'Notice' },
  filed: { ar: 'مرفوعة', en: 'Filed' },
  hearing: { ar: 'جلسات', en: 'Hearings' },
  judgment: { ar: 'حكم', en: 'Judgment' },
  enforcement: { ar: 'تنفيذ', en: 'Enforcement' },
  settled: { ar: 'تسوية', en: 'Settled' },
  closed: { ar: 'مغلقة', en: 'Closed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
};

/** Timeline updates a lawyer or the team records on a case. */
export const LEGAL_UPDATE_TYPES = [
  'hearing',
  'filing',
  'memo',
  'decision',
  'judgment',
  'enforcement',
  'settlement',
  'payment',
  'deadline',
  'note',
] as const;
export type LegalUpdateType = (typeof LEGAL_UPDATE_TYPES)[number];

export const LEGAL_UPDATE_LABELS: Record<LegalUpdateType, { ar: string; en: string }> = {
  hearing: { ar: 'جلسة', en: 'Hearing' },
  filing: { ar: 'قيد / إيداع', en: 'Filing' },
  memo: { ar: 'مذكرة', en: 'Memorandum' },
  decision: { ar: 'قرار', en: 'Decision' },
  judgment: { ar: 'حكم', en: 'Judgment' },
  enforcement: { ar: 'إجراء تنفيذ', en: 'Enforcement step' },
  settlement: { ar: 'تسوية', en: 'Settlement' },
  payment: { ar: 'تحصيل مبلغ', en: 'Amount recovered' },
  deadline: { ar: 'موعد نهائي', en: 'Deadline' },
  note: { ar: 'ملاحظة', en: 'Note' },
};

/** Case fields whose changes are recorded on the timeline. */
export const LEGAL_CHANGE_FIELDS = [
  'status',
  'caseNumber',
  'court',
  'nextHearingAt',
  'claimAmountMinor',
  'recoveredAmountMinor',
  'lawyerPartyId',
] as const;
export type LegalChangeField = (typeof LEGAL_CHANGE_FIELDS)[number];

export const LEGAL_CHANGE_LABELS: Record<LegalChangeField, { ar: string; en: string }> = {
  status: { ar: 'المرحلة', en: 'Stage' },
  caseNumber: { ar: 'رقم القضية', en: 'Case number' },
  court: { ar: 'المحكمة', en: 'Court' },
  nextHearingAt: { ar: 'الجلسة القادمة', en: 'Next hearing' },
  claimAmountMinor: { ar: 'المبلغ المطالب به', en: 'Amount claimed' },
  recoveredAmountMinor: { ar: 'المبلغ المحصّل', en: 'Amount recovered' },
  lawyerPartyId: { ar: 'المحامي', en: 'Lawyer' },
};

export type LegalChange = { field: LegalChangeField; from: string | null; to: string | null };

export const LEGAL_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
/** Data-URL characters per file and per entry; the whole request stays under the 4.5 MB cap. */
export const LEGAL_FILE_MAX_CHARS = 1_600_000;
export const LEGAL_FILES_MAX_CHARS = 3_200_000;
export const LEGAL_FILES_MAX = 4;
export const LEGAL_MESSAGE_MAX = 4_000;

/** How often an open case page asks for new messages. */
export const LEGAL_POLL_MS = 15_000;

export type LegalCaseSummary = {
  id: string;
  reference: string;
  title: string;
  caseType: string;
  status: LegalStage;
  caseNumber: string | null;
  court: string | null;
  nextHearingAt: string | null;
  claimAmountMinor: string;
  recoveredAmountMinor: string;
  currency: string;
  lawyerName: string | null;
  counterpartyName: string | null;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  unitCode: string | null;
  /** Messages and updates from the other side since the viewer last opened the case. */
  unread: number;
  lastActivityAt: string;
};

export type LegalCaseFile = { id: string; name: string; mime: string; size: number };

export type LegalCaseEntry = {
  id: string;
  kind: 'message' | 'update' | 'change' | 'opened';
  /** Update type for `update`, else the stored event type. */
  type: string;
  title: string;
  notes: string | null;
  changes: LegalChange[];
  occurredAt: string;
  deadlineAt: string | null;
  authorName: string;
  /** Lawyer side or organization team. */
  authorSide: 'lawyer' | 'team';
  mine: boolean;
  files: LegalCaseFile[];
};

export type LegalCaseDetail = {
  id: string;
  reference: string;
  title: string;
  caseType: string;
  description: string | null;
  status: LegalStage;
  caseNumber: string | null;
  court: string | null;
  nextHearingAt: string | null;
  openedOn: string;
  closedOn: string | null;
  claimAmountMinor: string;
  recoveredAmountMinor: string;
  currency: string;
  minorUnit: number;
  property: { nameAr: string; nameEn: string | null } | null;
  unitCode: string | null;
  lease: {
    contractReference: string | null;
    status: string;
    startsOn: string;
    endsOn: string;
    rentMinor: string;
    currency: string;
  } | null;
  counterparty: { name: string; phone: string | null; email: string | null } | null;
  lawyer: { id: string; name: string } | null;
  entries: LegalCaseEntry[];
  /** The viewer may change the case facts and add updates and messages. */
  canEdit: boolean;
  /** Organization team with `legal.manage`: may also change the lawyer. */
  canManage: boolean;
  viewerSide: 'lawyer' | 'team';
  /** Lawyer parties to choose from, for `canManage` only. */
  lawyers: { id: string; name: string }[];
};

/** Muscat date (and time) for the case pages. */
export function legalDate(value: string | null, locale: 'ar' | 'en', withTime = false): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00+04:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    numberingSystem: 'latn',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

/** `datetime-local` value in Muscat time ⇄ ISO instant. */
export function toMuscatInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() + 4 * 3_600_000).toISOString().slice(0, 16);
}

export function fromMuscatInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value.length === 10 ? `${value}T09:00` : value}:00+04:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Organization amounts are stored in minor units: "1250.500" ⇄ "1250500" for 3 decimals. */
export function toMinor(value: string, minorUnit: number): string | null {
  const clean = value.trim().replace(/,/g, '');
  if (!clean) return '0';
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(clean);
  if (!match) return null;
  const fraction = (match[2] ?? '').slice(0, minorUnit).padEnd(minorUnit, '0');
  return (BigInt(match[1]!) * 10n ** BigInt(minorUnit) + BigInt(fraction || '0')).toString();
}

export function fromMinor(value: string, minorUnit: number): string {
  if (!/^\d+$/.test(value)) return '0';
  if (!minorUnit) return value;
  const padded = value.padStart(minorUnit + 1, '0');
  return `${padded.slice(0, -minorUnit)}.${padded.slice(-minorUnit)}`;
}
