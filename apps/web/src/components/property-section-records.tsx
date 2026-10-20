'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { LeaseContractForm, type LeaseContractPayload } from '@/components/lease-contract-form';
import { LeaseTermsView, parseLeaseTerms, parseTenantDetails } from '@/components/lease-terms-view';
import { NoteTranslateBar } from '@/components/note-translate';
import { Icon, type IconName } from '@/components/pmh-icon';
import { DepositReconciliation } from '@/components/accounting/deposit-receipts';
import { BadgeChips } from '@/components/badges/badge-chips';
import { ApiError, browserNextMutation } from '@/lib/api';
import { badgeSubjectKey, type BadgeChip } from '@/lib/badges-shared';
import { formatMoney } from '@/lib/format';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';
import { reviewScoreTone } from '@/lib/review-rubric';
import { ReviewForm, hostReviewAssistant, type ReviewFormValue } from './reviews/review-form';
import { StayHandoverForm, type HandoverSubmit } from './stays/stay-handover-form';
import {
  DepositRefundCell,
  DepositRefundForm,
  type RefundFormMode,
  type RefundSubmit,
} from './stays/stay-deposit-refund-admin';
import { HANDOVER_PHOTOS_MAX, handoverDocumentKind } from '@/lib/stay-handover';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import { domainStatusLabel } from '@/lib/ui-labels';
import type {
  PropertyRecordRow,
  PropertyRecordSection,
  PropertyRecordTenant,
  PropertyRecordUnit,
} from '@/lib/property-records-neon';

type Format =
  | 'text'
  | 'date'
  | 'period'
  | 'money'
  | 'signedMoney'
  | 'balance'
  | 'status'
  | 'kind'
  | 'contractKind'
  | 'contractType'
  | 'contractLink'
  | 'source'
  | 'terms'
  | 'signatures'
  | 'stayLog'
  | 'refund'
  | 'detail'
  | 'priority'
  | 'property';

type Column = { key: string; ar: string; en: string; format?: Format };

type SectionConfig = {
  titleAr: string;
  titleEn: string;
  icon: IconName;
  emptyAr: string;
  emptyEn: string;
  columns: Column[];
  href?: (row: PropertyRecordRow, portal: string) => string | null;
};

type Viewer = {
  canManageBookings: boolean;
  canRecordStays?: boolean;
  canSignContracts: boolean;
  canCreateLease: boolean;
  canCreateSale: boolean;
  canDecideRefunds?: boolean;
  canPayRefunds?: boolean;
  canReviewGuests?: boolean;
  /** Owner/admin who schedules viewings. */
  canManageViewings?: boolean;
  /** Guard / viewing contact who scans visit passes. */
  canCheckInViewings?: boolean;
};

type StampKind = 'check_in' | 'check_out';

const NO_VIEWER: Viewer = {
  canManageBookings: false,
  canRecordStays: false,
  canSignContracts: false,
  canCreateLease: false,
  canCreateSale: false,
  canDecideRefunds: false,
  canPayRefunds: false,
  canReviewGuests: false,
  canManageViewings: false,
  canCheckInViewings: false,
};

type ContractOutcome = {
  contractReference?: string;
  routedToManager?: boolean;
  alreadyExisted?: boolean;
};

const LABELS: Record<string, [string, string]> = {
  stay: ['إقامة يومية', 'Daily stay'],
  reservation: ['حجز بعربون', 'Deposit booking'],
  viewing: ['معاينة', 'Viewing'],
  stay_payment: ['دفعة إقامة', 'Stay payment'],
  reservation_deposit: ['عربون حجز إيجار أو شراء', 'Rent or purchase booking deposit'],
  lease_payment: ['دفعة إيجار', 'Rent payment'],
  expense: ['مصروف', 'Expense'],
  deposit_refund: ['استرداد تأمين', 'Deposit refund'],
  deposit_received: ['تأمين مستلم (أمانة)', 'Deposit received (trust)'],
  deposit_retained: ['دخل من خصم التأمين', 'Kept from deposit'],
  initial: ['عقد أولي', 'Initial'],
  renewal: ['تجديد', 'Renewal'],
  amendment: ['ملحق تعديل', 'Amendment'],
  termination: ['إنهاء', 'Termination'],
  lease: ['عقد إيجار', 'Lease contract'],
  sale: ['عقد بيع', 'Sale contract'],
  low: ['منخفضة', 'Low'],
  normal: ['عادية', 'Normal'],
  high: ['عالية', 'High'],
  urgent: ['عاجلة', 'Urgent'],
};

const SECTIONS: Record<PropertyRecordSection, SectionConfig> = {
  bookings: {
    titleAr: 'الحجوزات والمعاينات',
    titleEn: 'Bookings & viewings',
    icon: 'calendar',
    emptyAr: 'لا توجد حجوزات أو معاينات لهذا العقار.',
    emptyEn: 'No bookings or viewings for this property.',
    columns: [
      { key: 'kind', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'العميل / الضيف', en: 'Client / guest' },
      { key: 'fromOn', ar: 'الفترة', en: 'Dates', format: 'period' },
      { key: 'checkedInAt', ar: 'الدخول والمغادرة', en: 'Check-in / out', format: 'stayLog' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'money' },
      { key: 'refundStatus', ar: 'استرداد التأمين', en: 'Deposit refund', format: 'refund' },
      { key: 'termsAcceptedOn', ar: 'الشروط والأحكام', en: 'Terms', format: 'terms' },
      { key: 'status', ar: 'حالة الحجز', en: 'Status', format: 'status' },
      { key: 'contractReference', ar: 'العقد', en: 'Contract', format: 'contractLink' },
    ],
    href: (row, portal) =>
      row.kind === 'stay'
        ? `/${portal}/stays/bookings/${row.id}`
        : row.kind === 'reservation'
          ? `/${portal}/bookings/${row.id}`
          : row.kind === 'viewing'
            ? `/${portal}/bookings/viewings/${row.id}`
            : null,
  },
  contracts: {
    titleAr: 'عقود العقار',
    titleEn: 'Property contracts',
    icon: 'file',
    emptyAr: 'لا توجد عقود لوحدات هذا العقار.',
    emptyEn: 'No contracts for this property’s units.',
    columns: [
      { key: 'reference', ar: 'رقم العقد', en: 'Contract no.' },
      { key: 'contractType', ar: 'نوع العقد', en: 'Type', format: 'contractType' },
      { key: 'sourceType', ar: 'المصدر', en: 'Source', format: 'source' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المستأجر / المشتري', en: 'Tenant / buyer' },
      { key: 'fromOn', ar: 'المدة', en: 'Term', format: 'period' },
      { key: 'amountMinor', ar: 'قيمة العقد', en: 'Contract value', format: 'money' },
      { key: 'ownerSignedBy', ar: 'التوقيعات', en: 'Signatures', format: 'signatures' },
      { key: 'signedOn', ar: 'تاريخ الاعتماد', en: 'Approved on', format: 'date' },
      { key: 'status', ar: 'حالة العقد', en: 'Contract status', format: 'status' },
      { key: 'leaseStatus', ar: 'حالة الإيجار', en: 'Lease status', format: 'status' },
    ],
    href: (row, portal) => `/${portal}/contracts/${row.id}`,
  },
  leasing: {
    titleAr: 'التأجير',
    titleEn: 'Leasing',
    icon: 'key',
    emptyAr: 'لا توجد عقود إيجار لوحدات هذا العقار.',
    emptyEn: 'No leases for this property’s units.',
    columns: [
      { key: 'contractReference', ar: 'رقم العقد', en: 'Contract', format: 'contractLink' },
      { key: 'sourceType', ar: 'المصدر', en: 'Source', format: 'source' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المستأجر', en: 'Tenant' },
      { key: 'fromOn', ar: 'المدة', en: 'Term', format: 'period' },
      { key: 'amountMinor', ar: 'قيمة الإيجار', en: 'Rent', format: 'money' },
      { key: 'contractTotalMinor', ar: 'إجمالي العقد', en: 'Contract total', format: 'money' },
      { key: 'depositMinor', ar: 'التأمين', en: 'Deposit', format: 'money' },
      { key: 'cancellationOn', ar: 'تاريخ الإلغاء', en: 'Cancelled on', format: 'date' },
      { key: 'status', ar: 'حالة التأجير', en: 'Status', format: 'status' },
    ],
  },
  sales: {
    titleAr: 'البيع',
    titleEn: 'Sales',
    icon: 'tag',
    emptyAr: 'لا توجد صفقات بيع لهذا العقار.',
    emptyEn: 'No sales deals for this property.',
    columns: [
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
      { key: 'contractReference', ar: 'العقد', en: 'Contract', format: 'contractLink' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المشتري', en: 'Buyer' },
      { key: 'sellerName', ar: 'البائع', en: 'Seller' },
      { key: 'amountMinor', ar: 'السعر المطلوب', en: 'Asking price', format: 'money' },
      { key: 'agreedMinor', ar: 'السعر المتفق / العرض', en: 'Agreed / offer', format: 'money' },
      { key: 'createdOn', ar: 'التاريخ', en: 'Date', format: 'date' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
  },
  maintenance: {
    titleAr: 'الصيانة',
    titleEn: 'Maintenance',
    icon: 'wrench',
    emptyAr: 'لا توجد طلبات صيانة لوحدات هذا العقار.',
    emptyEn: 'No maintenance requests for this property’s units.',
    columns: [
      { key: 'reference', ar: 'الطلب', en: 'Request' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'category', ar: 'الفئة', en: 'Category' },
      { key: 'priority', ar: 'الأولوية', en: 'Priority', format: 'priority' },
      { key: 'party', ar: 'مقدّم الطلب', en: 'Opened by' },
      { key: 'createdOn', ar: 'تاريخ الطلب', en: 'Opened on', format: 'date' },
      { key: 'resolvedOn', ar: 'تاريخ الحل', en: 'Resolved on', format: 'date' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
  },
  invoices: {
    titleAr: 'الفواتير',
    titleEn: 'Invoices',
    icon: 'receipt',
    emptyAr: 'لا توجد فواتير لعقود وحدات هذا العقار.',
    emptyEn: 'No invoices for this property’s leases.',
    columns: [
      { key: 'reference', ar: 'رقم الفاتورة', en: 'Invoice no.' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المستأجر', en: 'Tenant' },
      { key: 'fromOn', ar: 'تاريخ الإصدار', en: 'Issued', format: 'date' },
      { key: 'toOn', ar: 'تاريخ الاستحقاق', en: 'Due', format: 'date' },
      { key: 'amountMinor', ar: 'الإجمالي', en: 'Total', format: 'money' },
      { key: 'paidMinor', ar: 'المدفوع', en: 'Paid', format: 'money' },
      { key: 'balance', ar: 'المتبقي', en: 'Balance', format: 'balance' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
  },
  accounting: {
    titleAr: 'حسابات العقار',
    titleEn: 'Property accounts',
    icon: 'chart',
    emptyAr: 'لا توجد حركات مالية لهذا العقار.',
    emptyEn: 'No financial movements for this property.',
    columns: [
      { key: 'fromOn', ar: 'التاريخ', en: 'Date', format: 'date' },
      { key: 'kind', ar: 'النوع', en: 'Type', format: 'kind' },
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'الطرف', en: 'Party' },
      { key: 'description', ar: 'البيان', en: 'Description', format: 'detail' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'signedMoney' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
  },
};

const PROPERTY_COLUMN: Column = {
  key: 'propertyId',
  ar: 'العقار',
  en: 'Property',
  format: 'property',
};

/** Org-wide bookings board: fewer columns so cells never pile into each other. */
const BOOKINGS_ORG_COLUMNS: Column[] = [
  { key: 'kind', ar: 'النوع', en: 'Type', format: 'kind' },
  { key: 'reference', ar: 'المرجع', en: 'Reference' },
  PROPERTY_COLUMN,
  { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
  { key: 'party', ar: 'العميل / الضيف', en: 'Client / guest' },
  { key: 'fromOn', ar: 'الموعد / الفترة', en: 'When', format: 'period' },
  { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
];

/** Sections whose rows carry workflow buttons. */
const ACTION_SECTIONS = new Set<PropertyRecordSection>([
  'bookings',
  'contracts',
  'leasing',
  'accounting',
]);
const ACCEPTED_STAY = new Set(['confirmed', 'pre_arrival', 'checked_in', 'checked_out', 'closed']);

const READY = new Set([
  'active',
  'signed',
  'approved_signed',
  'rented',
  'upcoming_lease',
  'paid',
  'confirmed',
  'completed',
  'resolved',
  'closed_won',
  'succeeded',
  'checked_in',
  'checked_out',
  'closed',
  'converted',
  'approved',
  'posted',
  'awaiting_check_out',
  'deposit_settled',
  'deposit_income',
  'handed_over',
]);
const INFO = new Set([
  'awaiting_check_in',
  'deposit_held',
  'awaiting_terms_signature',
  'awaiting_documents',
  'awaiting_tenant_signature',
  'viewing_scheduled',
  'scheduled',
]);
const ATTENTION = new Set(['viewing_requested', 'requested', 'request_pending']);
const CHECK_IN_READY = new Set(['confirmed', 'pre_arrival']);
const STAY_DEPARTED = new Set(['checked_out', 'closed']);
const DANGER = new Set(['overdue', 'failed', 'payment_failed', 'no_show']);
const MUTED = new Set([
  'cancelled',
  'void',
  'terminated',
  'ended',
  'lease_completed',
  'expired',
  'closed_lost',
  'rejected',
  'refunded',
]);

const ERROR_TEXT: Record<string, [string, string]> = {
  dates_unavailable: [
    'التواريخ لم تعد متاحة: يوجد حجز مؤكد آخر على الوحدة في نفس الفترة.',
    'These dates are no longer free: another confirmed booking overlaps.',
  ],
  booking_not_approvable: [
    'لا يمكن اعتماد هذا الحجز بحالته الحالية.',
    'This booking cannot be approved in its current status.',
  ],
  contract_not_pending: [
    'هذا العقد ليس بانتظار الاعتماد.',
    'This contract is not awaiting approval.',
  ],
  lease_overlap: [
    'يوجد عقد إيجار آخر على هذه الوحدة في نفس الفترة.',
    'Another lease covers this unit for the same period.',
  ],
  invalid_amount: ['المبلغ غير صحيح.', 'Invalid amount.'],
  invalid_schedule: [
    'جدول الدفع غير مكتمل: تحقّق من التواريخ والمبالغ.',
    'The payment schedule is incomplete.',
  ],
  invalid_terms: [
    'تحقّق من النسب والمبالغ وبنود الإضافات والتأمين.',
    'Check rates, amounts, extra items and deposit lines.',
  ],
  duplicate_cheque_number: ['رقم شيك مكرر في العقد.', 'A cheque number is repeated.'],
  cheque_number_taken: [
    'أحد أرقام الشيكات مسجّل مسبقاً في النظام.',
    'One of the cheque numbers is already registered.',
  ],
  party_not_found: ['المستأجر المختار غير موجود.', 'The selected tenant was not found.'],
  invalid_dates: ['تاريخ النهاية يجب أن يكون بعد تاريخ البداية.', 'End date must be after start.'],
  invalid_body: ['تحقّق من الحقول المطلوبة.', 'Check the required fields.'],
  forbidden: ['لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not allowed to do this.'],
  unit_not_found: ['الوحدة غير موجودة في هذا العقار.', 'Unit not found on this property.'],
  stay_status_invalid: [
    'لا يمكن تسجيل ذلك بحالة الحجز الحالية. حدّث الصفحة.',
    'This cannot be recorded in the booking’s current status. Refresh the page.',
  ],
  stay_time_in_future: [
    'الوقت المدخل في المستقبل. أدخل وقت الدخول أو المغادرة الفعلي.',
    'That time is in the future. Enter the actual time.',
  ],
  stay_checkout_before_checkin: [
    'وقت المغادرة قبل وقت الدخول المسجّل.',
    'Check-out time is before the recorded check-in.',
  ],
  handover_document_required: [
    'صورة وثيقة المستلم مطلوبة لتسجيل الدخول.',
    'A photo of the recipient’s ID is required to check in.',
  ],
  handover_phone_invalid: ['رقم هاتف المستلم غير صحيح.', 'The recipient phone number is invalid.'],
  handover_photo_invalid: [
    'إحدى صور حالة الوحدة غير صالحة أو كبيرة جداً. احذفها وأعد التصوير.',
    'One of the unit photos is invalid or too large. Remove it and retake it.',
  ],
  handover_photos_too_many: [
    `الحد الأقصى ${HANDOVER_PHOTOS_MAX} صور لكل محضر.`,
    `At most ${HANDOVER_PHOTOS_MAX} photos per record.`,
  ],
  refund_not_open: [
    'استرداد التأمين متاح بعد تأكيد المغادرة فقط. حدّث الصفحة.',
    'Deposit refunds open after check-out only. Refresh the page.',
  ],
  refund_no_deposit: ['لا يوجد مبلغ تأمين لهذه الإقامة.', 'This stay has no security deposit.'],
  refund_already_decided: [
    'صدر قرار الاسترداد مسبقاً. حدّث الصفحة.',
    'The refund was already decided. Refresh the page.',
  ],
  refund_not_approved: [
    'الاسترداد غير معتمد للتحويل بعد. حدّث الصفحة.',
    'This refund is not approved for transfer. Refresh the page.',
  ],
  refund_note_required: ['اكتب سبب رفض الاسترداد.', 'Write the reason for the rejection.'],
  refund_account_invalid: [
    'رقم الحساب أو الهاتف المحوَّل إليه غير صحيح.',
    'The receiving account or phone number is invalid.',
  ],
  refund_receipt_required: [
    'إيصال التحويل مطلوب (صورة أو PDF).',
    'The transfer receipt (image or PDF) is required.',
  ],
  review_required: [
    'قيّم الضيف أولاً، ثم اعتمد استرداد التأمين أو ارفضه.',
    'Rate the guest first, then approve or reject the deposit refund.',
  ],
  review_exists: ['قيّمت هذا الضيف مسبقاً. حدّث الصفحة.', 'You already rated this guest.'],
  review_not_open: ['يُتاح تقييم الضيف بعد تسجيل مغادرته.', 'Guests can be rated after check-out.'],
  review_invalid: ['قيّم كل البنود المطلوبة.', 'Rate every required item.'],
  review_comment_required: [
    'التقييم أقل من 6: اكتب سبب ذلك بإيجاز.',
    'The score is below 6: briefly say why.',
  ],
  review_photo_invalid: [
    'إحدى الصور غير صالحة أو كبيرة جداً.',
    'One of the photos is invalid or too large.',
  ],
};

function formatStamp(value: string, locale: 'ar' | 'en'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/** Stay rows show where the guest stands (awaiting check-in / check-out) instead of the raw status. */
function displayStatus(row: PropertyRecordRow): string | null {
  if (row.kind === 'viewing' && row.status === 'requested') return 'viewing_requested';
  if (row.kind === 'viewing' && row.status === 'scheduled') return 'viewing_scheduled';
  return row.stage ?? row.status ?? null;
}

function statusTone(status: string): string {
  if (ATTENTION.has(status)) return 'warn';
  if (INFO.has(status)) return 'info';
  if (READY.has(status)) return 'ready';
  if (DANGER.has(status)) return 'danger';
  if (MUTED.has(status)) return 'muted';
  return 'warn';
}

function label(key: string | null, ar: boolean): string {
  if (!key) return '—';
  const pair = LABELS[key];
  return pair ? (ar ? pair[0] : pair[1]) : key;
}

function HostGuestReviewForm({
  propertyId,
  bookingId,
  ar,
  busy,
  error,
  subjectName,
  onSubmit,
  onCancel,
}: {
  propertyId: string;
  bookingId: string;
  ar: boolean;
  busy: boolean;
  error: string | null;
  subjectName: string | null;
  onSubmit: (value: ReviewFormValue) => void;
  onCancel: () => void;
}) {
  const assistant = useMemo(
    () => hostReviewAssistant(propertyId, bookingId),
    [propertyId, bookingId],
  );
  return (
    <ReviewForm
      direction="host_to_guest"
      ar={ar}
      idPrefix={`host-review-${bookingId}`}
      busy={busy}
      error={error}
      subjectName={subjectName}
      assistant={assistant}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function errorText(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) {
    const known = ERROR_TEXT[error.code];
    if (known) return ar ? known[0] : known[1];
    return error.message;
  }
  return ar ? 'تعذّر تنفيذ الإجراء.' : 'The action failed.';
}

const THREE_DECIMALS = new Set(['OMR', 'BHD', 'KWD']);

function minorToDecimal(value: string | null, currency: string): string {
  if (!value || !/^\d+$/.test(value)) return '';
  const digits = THREE_DECIMALS.has(currency) ? 3 : 2;
  const padded = value.padStart(digits + 1, '0');
  const whole = padded.slice(0, -digits);
  const fraction = padded.slice(-digits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function balanceMinor(row: PropertyRecordRow): string | null {
  if (!row.amountMinor) return null;
  return (BigInt(row.amountMinor) - BigInt(row.paidMinor ?? '0')).toString();
}

function totalsByCurrency(
  rows: PropertyRecordRow[],
  pick: (row: PropertyRecordRow) => string | null | undefined,
): Array<[string, bigint]> {
  const map = new Map<string, bigint>();
  for (const row of rows) {
    const value = pick(row);
    if (!row.currency || !value || !/^-?\d+$/.test(value)) continue;
    map.set(row.currency, (map.get(row.currency) ?? 0n) + BigInt(value));
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function moneyList(entries: Array<[string, bigint]>, locale: 'ar' | 'en'): string {
  if (!entries.length) return '—';
  return entries
    .map(([currency, amount]) => formatMoney(amount.toString(), currency, locale))
    .join(' · ');
}

/** Switch the hub to another tab and spotlight one of its rows. */
function openRecord(section: PropertyRecordSection, id: string) {
  window.history.pushState(
    null,
    '',
    `${window.location.pathname}?section=${section}&focus=${encodeURIComponent(id)}`,
  );
  window.scrollTo({ top: 0 });
}

function Cell({
  row,
  column,
  locale,
  badges,
  documentHref,
  receiptHref,
  contractHref,
}: {
  row: PropertyRecordRow;
  column: Column;
  locale: 'ar' | 'en';
  /** Current awards keyed by `badgeSubjectKey`. */
  badges: Record<string, BadgeChip[]>;
  /** Check-in ID photo; only for viewers who manage stay bookings. */
  documentHref: string | null;
  /** Deposit refund transfer receipt; only for refund approvers and accountants. */
  receiptHref: string | null;
  /** Contract row in its property's hub, when the list is not inside that hub. */
  contractHref: string | null;
}) {
  const ar = locale === 'ar';
  const value = row[column.key] ?? null;
  switch (column.format) {
    case 'property': {
      const name = ar ? row.propertyNameAr : row.propertyNameEn;
      return name ? (
        <span className="name-with-mark">
          <bdi>{name}</bdi>
          <BadgeChips
            badges={row.propertyId ? badges[badgeSubjectKey('property', row.propertyId)] : null}
            locale={locale}
            size={18}
          />
        </span>
      ) : (
        <span className="muted">—</span>
      );
    }
    case 'refund':
      return <DepositRefundCell row={row} locale={locale} receiptHref={receiptHref} />;
    case 'detail':
      if (row.kind === 'deposit_refund') {
        return <DepositRefundCell row={row} locale={locale} receiptHref={receiptHref} />;
      }
      if (row.kind === 'deposit_received') {
        const money = (minor: string | null | undefined) =>
          minor ? formatMoney(minor, row.currency ?? 'OMR', locale) : null;
        const refunded = money(row.refundedMinor);
        const kept = money(row.retainedMinor);
        return (
          <div className="deposit-recon">
            <p className="deposit-recon__trust">
              {ar
                ? 'أمانة لدى العقار، معزولة عن الإيرادات.'
                : 'Held in trust, kept apart from income.'}
            </p>
            {refunded || kept ? (
              <small className="muted">
                {[
                  refunded ? `${ar ? 'مُسترد' : 'Refunded'} ${refunded}` : null,
                  kept ? `${ar ? 'دخل للعقار' : 'Property income'} ${kept}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            ) : null}
          </div>
        );
      }
      if (row.kind === 'deposit_retained') {
        return <DepositReconciliation row={row} locale={locale} />;
      }
      if (row.kind === 'reservation_deposit') {
        const sale = value === 'purchase';
        return (
          <>
            {ar
              ? `عربون حجز ${sale ? 'شراء' : 'إيجار'} — أمانة حتى إعداد العقد`
              : `${sale ? 'Purchase' : 'Rent'} booking deposit — held until the contract`}
          </>
        );
      }
      return value ? <>{value}</> : <span className="muted">—</span>;
    case 'status': {
      const status = column.key === 'status' ? displayStatus(row) : value;
      return status ? (
        <span className={`pmh-badge pmh-badge--${statusTone(status)}`}>
          {domainStatusLabel(status, locale)}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    }
    case 'stayLog': {
      if (row.kind !== 'stay' || (!row.checkedInAt && !row.checkedOutAt)) {
        return <span className="muted">—</span>;
      }
      const documentKind = handoverDocumentKind(row.checkInDocumentKind);
      const entries = [
        {
          at: row.checkedInAt,
          notes: row.checkInNotes,
          important: row.checkInImportant === '1',
          label: ar ? 'دخول' : 'In',
          handover: row.checkInPhone || row.checkInDocument,
        },
        {
          at: row.checkedOutAt,
          notes: row.checkOutNotes,
          important: row.checkOutImportant === '1',
          label: ar ? 'مغادرة' : 'Out',
          handover: false,
        },
      ];
      return (
        <div className="psr-stay-log">
          {entries.map((entry) =>
            entry.at ? (
              <div key={entry.label}>
                <span className="psr-stay-log__label">{entry.label}</span>{' '}
                <span>{formatStamp(entry.at, locale)}</span>
                {entry.important ? (
                  <span className="psr-stay-log__important">
                    {ar ? 'مهم · Important' : 'Important · مهم'}
                  </span>
                ) : null}
                {entry.handover ? (
                  <span className="psr-stay-log__recipient">
                    {row.checkInRecipient ? <bdi>{row.checkInRecipient}</bdi> : null}
                    {row.checkInPhone ? (
                      <a href={`tel:${row.checkInPhone.replace(/[^\d+]/g, '')}`} dir="ltr">
                        {row.checkInPhone}
                      </a>
                    ) : null}
                    {row.checkInDocument && documentHref ? (
                      <a href={documentHref} target="_blank" rel="noreferrer">
                        🪪{' '}
                        {documentKind
                          ? ar
                            ? documentKind.ar
                            : documentKind.en
                          : ar
                            ? 'الوثيقة'
                            : 'ID'}
                      </a>
                    ) : null}
                  </span>
                ) : null}
                {entry.notes ? <small>{entry.notes}</small> : null}
              </div>
            ) : null,
          )}
        </div>
      );
    }
    case 'kind':
      if (value === 'reservation' && row.bookingMode === 'rent') {
        return <>{ar ? 'حجز إيجار بعربون' : 'Rent deposit booking'}</>;
      }
      if (value === 'reservation' && row.bookingMode === 'sale') {
        return <>{ar ? 'حجز شراء بعربون' : 'Purchase deposit booking'}</>;
      }
      return <>{label(value, ar)}</>;
    case 'contractKind':
    case 'contractType':
    case 'priority':
      return <>{label(value, ar)}</>;
    case 'source':
      if (value === 'stay_booking') {
        return (
          <>
            {ar ? 'من الحجز' : 'From booking'} <span dir="ltr">{row.sourceReference ?? ''}</span>
          </>
        );
      }
      if (value === 'manual') return <>{ar ? 'عقد يدوي' : 'Manual'}</>;
      return <span className="muted">—</span>;
    case 'contractLink': {
      const contractId = row.contractId;
      if (!contractId || !value) return <span className="muted">—</span>;
      if (contractHref) {
        return (
          <Link className="pmh-card__link" dir="ltr" href={contractHref} prefetch={false}>
            {value}
          </Link>
        );
      }
      return (
        <a
          className="pmh-card__link"
          dir="ltr"
          href={`?section=contracts&focus=${encodeURIComponent(contractId)}`}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            openRecord('contracts', contractId);
          }}
        >
          {value}
        </a>
      );
    }
    case 'terms':
      if (row.kind !== 'stay' && row.kind !== 'reservation') {
        return <span className="muted">—</span>;
      }
      return value ? (
        <span className="pmh-badge pmh-badge--ready" title={value}>
          {row.kind === 'reservation'
            ? ar
              ? 'وقّع العميل'
              : 'Signed by client'
            : ar
              ? 'وقّع المستأجر'
              : 'Signed by guest'}
        </span>
      ) : (
        <span className="muted">{ar ? 'لا يوجد توقيع' : 'Not signed'}</span>
      );
    case 'signatures': {
      const parts: string[] = [];
      if (row.counterpartySignature) {
        const who =
          row.contractType === 'sale' ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant';
        const how =
          row.counterpartySignature === 'booking_terms_acceptance'
            ? ar
              ? 'بقبول الشروط عند الحجز'
              : 'accepted terms when booking'
            : ar
              ? 'بتأكيد الحجز'
              : 'by confirmed booking';
        parts.push(`${who} (${how})`);
      }
      if (row.ownerSignedBy !== null && row.ownerSignedBy !== undefined) {
        parts.push(
          ar
            ? `المالك — وقّعه النظام باسم ${row.ownerSignedBy}`
            : `Owner — system-signed as ${row.ownerSignedBy}`,
        );
      }
      return parts.length ? (
        <span className="psr-signatures">{parts.join(' · ')}</span>
      ) : (
        <span className="muted">{ar ? 'لم يوقّع بعد' : 'Not signed yet'}</span>
      );
    }
    case 'date':
      return value ? <span dir="ltr">{value}</span> : <span className="muted">—</span>;
    case 'period':
      return value || row.toOn ? (
        <span className="psr-period">
          <span dir="ltr">{value ?? '—'}</span>
          <span dir="ltr">{row.toOn ?? '—'}</span>
        </span>
      ) : (
        <span className="muted">—</span>
      );
    case 'money':
      return value && row.currency ? (
        <span dir="ltr">{formatMoney(value, row.currency, locale)}</span>
      ) : (
        <span className="muted">—</span>
      );
    case 'balance': {
      const balance = balanceMinor(row);
      return balance && row.currency ? (
        <span dir="ltr">{formatMoney(balance, row.currency, locale)}</span>
      ) : (
        <span className="muted">—</span>
      );
    }
    case 'signedMoney':
      return value && row.currency ? (
        <span
          dir="ltr"
          className={`psr-money psr-money--${row.direction === 'out' ? 'out' : row.direction === 'held' ? 'held' : 'in'}`}
        >
          {row.direction === 'out' ? '− ' : row.direction === 'held' ? '' : '+ '}
          {formatMoney(value, row.currency, locale)}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    default: {
      const partyBadges =
        column.key === 'party' && row.partyId
          ? badges[badgeSubjectKey('tenant', row.partyId)]
          : null;
      if (column.key === 'party' && row.kind === 'stay') {
        return (
          <span className="psr-guest">
            {value ? <bdi>{value}</bdi> : <span className="muted">—</span>}
            <BadgeChips badges={partyBadges} locale={locale} size={18} />
            <GuestStanding row={row} locale={locale} />
          </span>
        );
      }
      if (value && partyBadges?.length) {
        return (
          <span className="name-with-mark">
            <bdi>{value}</bdi>
            <BadgeChips badges={partyBadges} locale={locale} size={18} />
          </span>
        );
      }
      return value ? <>{value}</> : <span className="muted">—</span>;
    }
  }
}

/** The guest's rating from hosts across the platform, to decide on a booking request. */
function GuestStanding({ row, locale }: { row: PropertyRecordRow; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  if (!row.guestKey) return null;
  const count = Number.parseInt(row.guestReviewCount ?? '0', 10) || 0;
  const score = row.guestScore ? Number.parseFloat(row.guestScore) : null;
  return (
    <a
      className={`psr-guest__standing psr-guest__standing--${
        score === null ? 'new' : reviewScoreTone(score)
      }`}
      href={`/${locale}/profiles/guests/${encodeURIComponent(row.guestKey)}`}
      target="_blank"
      rel="noreferrer"
      title={ar ? 'ملف الضيف وتقييمات المؤجرين له' : 'Guest profile and host reviews'}
    >
      {score !== null ? (
        <>
          <strong dir="ltr">{score.toFixed(1)}</strong>
          {ar
            ? ` · ${count === 1 ? 'تقييم واحد' : count === 2 ? 'تقييمان' : `${count} تقييمات`}`
            : ` · ${count} review${count === 1 ? '' : 's'}`}
        </>
      ) : ar ? (
        'ضيف جديد · بلا تقييمات'
      ) : (
        'New guest · no reviews'
      )}
    </a>
  );
}

function ManualSaleForm({
  units,
  canSign,
  locale,
  busy,
  onSubmit,
  onCancel,
}: {
  units: PropertyRecordUnit[];
  canSign: boolean;
  locale: 'ar' | 'en';
  busy: boolean;
  onSubmit: (payload: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const today = new Date().toISOString().slice(0, 10);
  const firstUnit = units[0];
  const defaultAmount = (unit: PropertyRecordUnit | undefined) =>
    unit ? minorToDecimal(unit.salePriceMinor, unit.currency) : '';
  const [unitId, setUnitId] = useState(firstUnit?.id ?? '');
  const [amount, setAmount] = useState(defaultAmount(firstUnit));
  const [notes, setNotes] = useState('');
  const unit = units.find((item) => item.id === unitId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (typeof value === 'string' && value.trim()) payload[key] = value.trim();
    }
    onSubmit(payload);
  }

  return (
    <form className="psr-form" onSubmit={submit}>
      <h3>{ar ? 'عقد بيع يدوي' : 'Manual sale contract'}</h3>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="psr-unit">{ar ? 'الوحدة' : 'Unit'}</label>
          <select
            id="psr-unit"
            name="unitId"
            className="select"
            required
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setAmount(defaultAmount(units.find((item) => item.id === event.target.value)));
            }}
          >
            {units.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="psr-party">{ar ? 'اسم المشتري' : 'Buyer name'}</label>
          <input
            id="psr-party"
            name="partyName"
            className="input"
            required
            minLength={2}
            maxLength={200}
          />
        </div>
        <div className="field">
          <label htmlFor="psr-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label>
          <input id="psr-email" name="partyEmail" type="email" className="input" dir="ltr" />
        </div>
        <div className="field">
          <label htmlFor="psr-phone">{ar ? 'رقم الهاتف' : 'Phone'}</label>
          <input
            id="psr-phone"
            name="partyPhone"
            type="tel"
            className="input"
            dir="ltr"
            maxLength={40}
          />
        </div>
        <div className="field">
          <label htmlFor="psr-signed">{ar ? 'تاريخ العقد' : 'Contract date'}</label>
          <input
            id="psr-signed"
            name="signedOn"
            type="date"
            className="input"
            required
            defaultValue={today}
          />
        </div>
        <div className="field">
          <label htmlFor="psr-amount">
            {ar ? `ثمن البيع (${unit?.currency ?? ''})` : `Sale price (${unit?.currency ?? ''})`}
          </label>
          <input
            id="psr-amount"
            name="amount"
            className="input"
            dir="ltr"
            inputMode="decimal"
            required
            pattern="\d{1,12}(\.\d{1,3})?"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="field span-2">
          <label htmlFor="psr-notes">{ar ? 'ملاحظات' : 'Notes'}</label>
          <textarea
            id="psr-notes"
            name="notes"
            className="textarea"
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <NoteTranslateBar
            value={notes}
            onChange={setNotes}
            locale={locale}
            max={2000}
            disabled={busy}
          />
        </div>
      </div>
      <p className="muted">
        {canSign
          ? ar
            ? 'سيُعتمد العقد فوراً ويوقّعه النظام باسمك نيابة عن المالك.'
            : 'The contract is approved at once and system-signed in your name for the owner.'
          : ar
            ? 'لا تملك صلاحية اعتماد العقود، لذلك سيُرسل العقد إلى المدير لاعتماده.'
            : 'You cannot approve contracts, so it will be sent to the manager for approval.'}
      </p>
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={busy || !units.length}>
          {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'إنشاء العقد' : 'Create contract'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

export function PropertySectionRecords({
  portal,
  propertyId,
  section,
  locale,
}: {
  portal: 'owner' | 'developer';
  /** null lists the bookings of every property the viewer may see. */
  propertyId: string | null;
  section: PropertyRecordSection;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const config = SECTIONS[section];
  const columns = useMemo(() => {
    if (propertyId) return config.columns;
    if (section === 'bookings') return BOOKINGS_ORG_COLUMNS;
    return config.columns.flatMap((column) =>
      column.key === 'reference' ? [column, PROPERTY_COLUMN] : [column],
    );
  }, [config, propertyId, section]);
  const propertyOf = (row: PropertyRecordRow) => propertyId ?? row.propertyId ?? '';
  const searchParams = useSearchParams();
  const focusId = searchParams.get('focus');
  const reviewRequested = searchParams.get('review') === '1';
  const [rows, setRows] = useState<PropertyRecordRow[] | null>(null);
  const [units, setUnits] = useState<PropertyRecordUnit[]>([]);
  const [tenants, setTenants] = useState<PropertyRecordTenant[]>([]);
  const [badges, setBadges] = useState<Record<string, BadgeChip[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer>(NO_VIEWER);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stampForm, setStampForm] = useState<{ rowId: string; kind: StampKind } | null>(null);
  const [refundForm, setRefundForm] = useState<{ rowId: string; mode: RefundFormMode } | null>(
    null,
  );
  const [reviewRowId, setReviewRowId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const silentReload = useRef(false);
  const reviewLinkOpened = useRef(false);
  const scrollToReview = useRef(false);
  const canRateGuests = viewer.canReviewGuests ?? viewer.canDecideRefunds ?? false;

  useEffect(() => {
    const onLiveChange = () => {
      silentReload.current = true;
      setReloadKey((key) => key + 1);
    };
    window.addEventListener(LIVE_CHANGE_EVENT, onLiveChange);
    return () => window.removeEventListener(LIVE_CHANGE_EVENT, onLiveChange);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const silent = silentReload.current;
    silentReload.current = false;
    if (!silent) {
      setRows(null);
      setFailed(false);
    }
    void (async () => {
      try {
        const response = await fetch(
          `/api/portal/property-records/${propertyId ? encodeURIComponent(propertyId) : 'all'}/${section}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`status_${response.status}`);
        const payload = (await response.json()) as {
          rows?: PropertyRecordRow[];
          units?: PropertyRecordUnit[];
          tenants?: PropertyRecordTenant[];
          badges?: Record<string, BadgeChip[]>;
          viewer?: Viewer;
        };
        setRows(payload.rows ?? []);
        setUnits(payload.units ?? []);
        setTenants(payload.tenants ?? []);
        setBadges(payload.badges ?? {});
        setViewer(payload.viewer ?? NO_VIEWER);
      } catch {
        if (!controller.signal.aborted && !silent) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [propertyId, section, reloadKey]);

  useEffect(() => {
    if (!focusId || !rows?.length) return;
    document
      .getElementById(`psr-row-${focusId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, rows]);

  useEffect(() => {
    if (!reviewRequested || !focusId || !canRateGuests || reviewLinkOpened.current) return;
    const row = rows?.find((candidate) => candidate.id === focusId);
    if (!row) return;
    reviewLinkOpened.current = true;
    if (row.kind === 'stay' && STAY_DEPARTED.has(row.status ?? '') && !row.hostReviewScore) {
      scrollToReview.current = true;
      setReviewRowId(focusId);
    }
  }, [reviewRequested, focusId, canRateGuests, rows]);

  useEffect(() => {
    if (!scrollToReview.current || !reviewRowId || !rows?.length) return;
    const form = document.getElementById(`psr-review-${reviewRowId}`);
    if (!form) return;
    scrollToReview.current = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [reviewRowId, rows]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      const status = displayStatus(row);
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (rows ?? []).filter((row) => {
      if (statusFilter && displayStatus(row) !== statusFilter) return false;
      if (!needle) return true;
      return Object.values(row).some((value) => value?.toLocaleLowerCase().includes(needle));
    });
  }, [rows, statusFilter, query]);

  const summary = useMemo(() => {
    const all = rows ?? [];
    if (section === 'invoices') {
      return [
        {
          label: ar ? 'إجمالي الفواتير' : 'Invoiced',
          value: totalsByCurrency(all, (r) => r.amountMinor),
        },
        { label: ar ? 'المحصّل' : 'Collected', value: totalsByCurrency(all, (r) => r.paidMinor) },
        {
          label: ar ? 'المتبقي' : 'Outstanding',
          value: totalsByCurrency(
            all.filter((r) => r.status !== 'void'),
            balanceMinor,
          ),
        },
      ];
    }
    if (section === 'accounting') {
      const income = all.filter((r) => r.direction === 'in');
      const spent = all.filter((r) => r.kind === 'expense' && r.status !== 'rejected');
      const refundsDue = all.filter((r) => r.status === 'awaiting_refund_transfer');
      const held = all.filter(
        (r) => r.kind === 'deposit_received' && r.depositStatus !== 'deposit_settled',
      );
      const net = totalsByCurrency(
        [
          ...income,
          ...spent.map((r) => ({ ...r, amountMinor: r.amountMinor ? `-${r.amountMinor}` : null })),
        ],
        (r) => r.amountMinor,
      );
      return [
        {
          label: ar ? 'الإيرادات' : 'Income',
          value: totalsByCurrency(income, (r) => r.amountMinor),
        },
        {
          label: ar ? 'المصروفات' : 'Expenses',
          value: totalsByCurrency(spent, (r) => r.amountMinor),
        },
        { label: ar ? 'الصافي' : 'Net', value: net },
        ...(held.length
          ? [
              {
                label: ar
                  ? `أمانات تأمين محتجزة (${held.length})`
                  : `Deposits held in trust (${held.length})`,
                value: totalsByCurrency(held, (r) => r.amountMinor),
              },
            ]
          : []),
        ...(refundsDue.length
          ? [
              {
                label: ar
                  ? `تأمين بانتظار التحويل (${refundsDue.length})`
                  : `Deposits to transfer (${refundsDue.length})`,
                value: totalsByCurrency(refundsDue, (r) => r.amountMinor),
              },
            ]
          : []),
      ];
    }
    return [];
  }, [rows, section, ar]);

  async function runAction(busyKey: string, body: Record<string, unknown>, target: string) {
    setBusyId(busyKey);
    setNotice(null);
    try {
      const result = await browserNextMutation<ContractOutcome>(
        `/api/owner/properties/${encodeURIComponent(target)}/records`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      return result;
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error, ar) });
      return null;
    } finally {
      setBusyId(null);
    }
  }

  function contractMessage(result: ContractOutcome, lead: string): string {
    const reference = result.contractReference ?? '';
    if (result.routedToManager) {
      return ar
        ? `${lead} العقد ${reference} أُرسل إلى المدير لاعتماده لأنك لا تملك صلاحية اعتماد العقود.`
        : `${lead} Contract ${reference} was sent to the manager for approval.`;
    }
    return ar
      ? `${lead} العقد ${reference} معتمد وموقّع آلياً باسمك، ويظهر الآن في العقود والتأجير.`
      : `${lead} Contract ${reference} is approved and system-signed in your name.`;
  }

  async function approveBooking(row: PropertyRecordRow) {
    const pending = row.status === 'request_pending';
    const question = ar
      ? pending
        ? `اعتماد الحجز ${row.reference}؟ سيُؤكَّد الحجز ويُنشأ عقد الإيجار للفترة ${row.fromOn} – ${row.toOn}.`
        : `إنشاء عقد الإيجار للحجز ${row.reference}؟`
      : pending
        ? `Approve booking ${row.reference}? It will be confirmed and a lease contract issued.`
        : `Issue the lease contract for booking ${row.reference}?`;
    if (!window.confirm(question)) return;
    const id = row.id ?? '';
    const result = await runAction(
      id,
      { action: 'approve_booking', bookingId: id },
      propertyOf(row),
    );
    if (!result) return;
    setNotice({
      tone: 'success',
      text: contractMessage(
        result,
        ar
          ? pending
            ? `تم اعتماد الحجز ${row.reference}.`
            : `تم إنشاء عقد الحجز ${row.reference}.`
          : pending
            ? `Booking ${row.reference} approved.`
            : `Contract issued for ${row.reference}.`,
      ),
    });
    setReloadKey((key) => key + 1);
  }

  async function rejectBooking(row: PropertyRecordRow) {
    const question = ar
      ? `رفض طلب الحجز ${row.reference}؟ سيُلغى الطلب وتُحرَّر التواريخ.`
      : `Reject booking request ${row.reference}? The dates will be freed.`;
    if (!window.confirm(question)) return;
    const id = row.id ?? '';
    const result = await runAction(
      id,
      { action: 'reject_booking', bookingId: id },
      propertyOf(row),
    );
    if (!result) return;
    setNotice({
      tone: 'success',
      text: ar
        ? `تم رفض طلب الحجز ${row.reference}.`
        : `Booking request ${row.reference} rejected.`,
    });
    setReloadKey((key) => key + 1);
  }

  async function submitStamp(row: PropertyRecordRow, kind: StampKind, value: HandoverSubmit) {
    const id = row.id ?? '';
    const { at, notes, noteKeys, important, recipient, photos } = value;
    const result = await runAction(
      id,
      {
        action: kind,
        bookingId: id,
        at,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(noteKeys.length ? { noteKeys } : {}),
        ...(important ? { important } : {}),
        ...(recipient ? { recipient } : {}),
        ...(photos.length ? { photos } : {}),
      },
      propertyOf(row),
    );
    if (!result) return;
    setStampForm(null);
    const when = formatStamp(`${at}:00+04:00`, locale);
    const rateNow = kind === 'check_out' && canRateGuests && !row.hostReviewScore;
    if (rateNow) {
      setReviewError(null);
      setRefundForm(null);
      scrollToReview.current = true;
      silentReload.current = true;
      setReviewRowId(id);
    }
    setNotice({
      tone: 'success',
      text:
        kind === 'check_in'
          ? ar
            ? `تم تسجيل دخول الضيف للحجز ${row.reference} (${when}). الحالة الآن: بانتظار المغادرة.`
            : `Guest checked in for ${row.reference} (${when}). Now awaiting check-out.`
          : rateNow
            ? ar
              ? `تم تسجيل مغادرة الضيف واستلام العقار للحجز ${row.reference} (${when}). قيّم الضيف الآن من النموذج أسفل الحجز — يصله تقييمك فوراً ويظهر في ملفه.`
              : `Guest checked out and property received for ${row.reference} (${when}). Rate the guest now in the form below the booking.`
            : ar
              ? `تم تسجيل مغادرة الضيف للحجز ${row.reference} (${when}).`
              : `Guest checked out for ${row.reference} (${when}).`,
    });
    setReloadKey((key) => key + 1);
  }

  async function submitRefund(row: PropertyRecordRow, value: RefundSubmit) {
    const id = row.id ?? '';
    const result = await runAction(id, { ...value, bookingId: id }, propertyOf(row));
    if (!result) return;
    setRefundForm(null);
    setNotice({
      tone: 'success',
      text:
        value.action === 'refund_payout'
          ? ar
            ? `تم تسجيل تحويل تأمين الحجز ${row.reference}: اكتمل الطلب وأُغلق الحجز. تراه الإدارة مكتملاً، ويرى الضيف أن المبلغ حُوّل.`
            : `Deposit transfer recorded for ${row.reference}: the request is complete and the booking closed.`
          : value.decision === 'approve'
            ? ar
              ? `تم اعتماد استرداد التأمين للحجز ${row.reference}، وانتقل الطلب إلى المحاسب ليحوّله من صفحة المحاسب. ما يُخصم من التأمين يصبح دخلاً للعقار بعد التحويل.`
              : `Deposit refund approved for ${row.reference}; the accountant transfers it from the Accounting page. Any deduction becomes property income after the transfer.`
            : ar
              ? `تم رفض استرداد التأمين للحجز ${row.reference} وأُغلق الحجز. يرى الضيف سبب الرفض.`
              : `Deposit refund rejected for ${row.reference}; the booking is closed.`,
    });
    setReloadKey((key) => key + 1);
  }

  async function submitGuestReview(row: PropertyRecordRow, value: ReviewFormValue) {
    const id = row.id ?? '';
    setBusyId(id);
    setNotice(null);
    setReviewError(null);
    try {
      const result = await browserNextMutation<{ review: { score: number } }>(
        `/api/owner/properties/${encodeURIComponent(propertyOf(row))}/guest-review`,
        { method: 'POST', body: JSON.stringify({ bookingId: id, ...value }) },
      );
      setReviewRowId(null);
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      const score = result.review.score.toFixed(1);
      setNotice({
        tone: 'success',
        text:
          row.stage === 'awaiting_deposit_refund'
            ? ar
              ? `تم حفظ تقييمك للضيف (${score} من 10). يمكنك الآن اعتماد استرداد التأمين أو رفضه. لن يرى الضيف تقييمك قبل تحويل التأمين وتأكيده استلامه.`
              : `Guest review saved (${score}/10). You can now approve or reject the deposit refund. The guest will not see it before the deposit is refunded and received.`
            : ar
              ? `تم حفظ تقييمك للضيف (${score} من 10). لن يراه الضيف قبل تحويل مبلغ التأمين وتأكيده استلامه.`
              : `Guest review saved (${score}/10). The guest will not see it before the deposit is refunded and received.`,
      });
      setReloadKey((key) => key + 1);
    } catch (error) {
      setReviewError(errorText(error, ar));
    } finally {
      setBusyId(null);
    }
  }

  async function approveContract(row: PropertyRecordRow) {
    const question = ar
      ? `اعتماد العقد ${row.reference} وتوقيعه باسمك نيابة عن المالك؟`
      : `Approve contract ${row.reference} and sign it in your name for the owner?`;
    if (!window.confirm(question)) return;
    const id = row.id ?? '';
    const result = await runAction(
      id,
      { action: 'approve_contract', contractId: id },
      propertyOf(row),
    );
    if (!result) return;
    setNotice({
      tone: 'success',
      text: ar
        ? `تم اعتماد العقد ${row.reference} وتوقيعه باسمك.`
        : `Contract ${row.reference} approved and signed.`,
    });
    setReloadKey((key) => key + 1);
  }

  async function createManual(
    kind: 'lease' | 'sale',
    payload: Record<string, string> | LeaseContractPayload,
  ) {
    if (!propertyId) return;
    const result = await runAction(
      'form',
      { action: kind === 'sale' ? 'create_sale' : 'create_lease', ...payload },
      propertyId,
    );
    if (!result) return;
    setFormOpen(false);
    setNotice({
      tone: 'success',
      text: contractMessage(result, ar ? 'تم إنشاء العقد.' : 'Contract created.'),
    });
    setReloadKey((key) => key + 1);
  }

  function rowActions(row: PropertyRecordRow) {
    const busy = busyId === row.id;
    const details =
      row.termsJson && row.id ? (
        <button
          type="button"
          className="button button--quiet psr-action"
          aria-expanded={expandedId === row.id}
          onClick={() => setExpandedId(expandedId === row.id ? null : (row.id ?? null))}
        >
          {expandedId === row.id
            ? ar
              ? 'إخفاء التفاصيل'
              : 'Hide details'
            : ar
              ? 'التفاصيل المالية'
              : 'Financial details'}
        </button>
      ) : null;
    const action = workflowAction(row, busy);
    return action || details ? (
      <>
        {action}
        {details}
      </>
    ) : null;
  }

  function stayStampAction(row: PropertyRecordRow, busy: boolean) {
    if (section !== 'bookings' || row.kind !== 'stay' || !viewer.canRecordStays) return null;
    const kind: StampKind | null = CHECK_IN_READY.has(row.status ?? '')
      ? 'check_in'
      : row.status === 'checked_in'
        ? 'check_out'
        : null;
    if (!kind || !row.id) return null;
    const open = stampForm?.rowId === row.id;
    return (
      <button
        type="button"
        className="button button--primary psr-action"
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          setNotice(null);
          setRefundForm(null);
          setStampForm(open ? null : { rowId: row.id ?? '', kind });
        }}
      >
        {kind === 'check_in'
          ? ar
            ? 'تسجيل الدخول'
            : 'Check in'
          : ar
            ? 'تسجيل المغادرة'
            : 'Check out'}
      </button>
    );
  }

  function workflowAction(row: PropertyRecordRow, busy: boolean) {
    const stamp = stayStampAction(row, busy);
    const approval = bookingApprovalAction(row, busy);
    const review = guestReviewAction(row, busy);
    const refund = depositRefundAction(row, busy);
    return stamp || approval || review || refund ? (
      <>
        {stamp}
        {approval}
        {review}
        {refund}
      </>
    ) : null;
  }

  /** After check-out the host rates the guest; required before the deposit refund decision. */
  function guestReviewAction(row: PropertyRecordRow, busy: boolean) {
    if (section !== 'bookings' || row.kind !== 'stay' || !row.id) return null;
    if (!STAY_DEPARTED.has(row.status ?? '')) return null;
    const guestNote = row.guestReviewed ? (
      <span className="psr-review-note">{ar ? 'قيّم الضيف إقامته ✓' : 'Guest reviewed ✓'}</span>
    ) : null;
    if (row.hostReviewScore) {
      return (
        <>
          <span className="psr-review-note psr-review-note--done">
            {ar ? 'تقييمك للضيف' : 'Your rating'}{' '}
            <strong dir="ltr">{Number.parseFloat(row.hostReviewScore).toFixed(1)}</strong>
          </span>
          {guestNote}
        </>
      );
    }
    if (!canRateGuests) return guestNote;
    const required = row.stage === 'awaiting_deposit_refund';
    const open = reviewRowId === row.id;
    return (
      <>
        <button
          type="button"
          className="button button--primary psr-action"
          disabled={busy}
          aria-expanded={open}
          onClick={() => {
            setNotice(null);
            setReviewError(null);
            setStampForm(null);
            setRefundForm(null);
            setReviewRowId(open ? null : (row.id ?? null));
          }}
        >
          {required
            ? ar
              ? 'قيّم الضيف (مطلوب قبل قرار التأمين)'
              : 'Rate the guest (before the deposit decision)'
            : ar
              ? 'قيّم الضيف'
              : 'Rate the guest'}
        </button>
        {guestNote}
      </>
    );
  }

  function depositRefundAction(row: PropertyRecordRow, busy: boolean) {
    if (!row.id) return null;
    const open = (mode: RefundFormMode) =>
      refundForm !== null && refundForm.rowId === row.id && refundForm.mode === mode;
    const toggle = (mode: RefundFormMode) => {
      setNotice(null);
      setStampForm(null);
      setRefundForm(open(mode) ? null : { rowId: row.id ?? '', mode });
    };
    if (section === 'accounting') {
      if (row.kind !== 'deposit_refund' || row.refundStatus !== 'approved') return null;
      return (
        <Link
          className={`button ${viewer.canPayRefunds ? 'button--primary' : 'button--quiet'} psr-action`}
          href={`/${portal}/accounting?focus=${encodeURIComponent(row.id)}#deposits`}
          prefetch={false}
        >
          {viewer.canPayRefunds
            ? ar
              ? 'التحويل من صفحة المحاسب ←'
              : 'Transfer from Accounting →'
            : ar
              ? 'لدى المحاسب ←'
              : 'With accountant →'}
        </Link>
      );
    }
    if (section !== 'bookings' || row.kind !== 'stay') return null;
    if (row.refundStatus === 'approved') {
      return (
        <Link
          className="button button--quiet psr-action"
          href={`/${portal}/accounting?focus=${encodeURIComponent(row.id)}#deposits`}
          prefetch={false}
        >
          {ar ? 'لدى المحاسب ←' : 'With accountant →'}
        </Link>
      );
    }
    if (row.stage === 'awaiting_deposit_refund' && viewer.canDecideRefunds && row.hostReviewScore) {
      return (
        <>
          <button
            type="button"
            className="button button--primary psr-action"
            disabled={busy}
            aria-expanded={open('approve')}
            onClick={() => toggle('approve')}
          >
            {ar ? 'اعتماد استرداد التأمين' : 'Approve deposit refund'}
          </button>
          <button
            type="button"
            className="button button--quiet psr-action"
            disabled={busy}
            aria-expanded={open('reject')}
            onClick={() => toggle('reject')}
          >
            {ar ? 'رفض الاسترداد' : 'Reject refund'}
          </button>
        </>
      );
    }
    return null;
  }

  function bookingApprovalAction(row: PropertyRecordRow, busy: boolean) {
    if (section === 'bookings' && row.kind === 'stay' && viewer.canManageBookings) {
      if (row.status === 'request_pending') {
        return (
          <>
            <button
              type="button"
              className="button button--primary psr-action"
              disabled={busy}
              onClick={() => void approveBooking(row)}
            >
              {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'اعتماد الحجز' : 'Approve'}
            </button>
            <button
              type="button"
              className="button button--quiet psr-action"
              disabled={busy}
              onClick={() => void rejectBooking(row)}
            >
              {ar ? 'رفض' : 'Reject'}
            </button>
          </>
        );
      }
      if (ACCEPTED_STAY.has(row.status ?? '') && !row.contractId) {
        return (
          <button
            type="button"
            className="button button--quiet psr-action"
            disabled={busy}
            onClick={() => void approveBooking(row)}
          >
            {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'إنشاء العقد' : 'Issue contract'}
          </button>
        );
      }
    }
    if (
      section === 'contracts' &&
      row.status === 'pending_manager_approval' &&
      viewer.canSignContracts
    ) {
      return (
        <button
          type="button"
          className="button button--primary psr-action"
          disabled={busy}
          onClick={() => void approveContract(row)}
        >
          {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'اعتماد العقد' : 'Approve contract'}
        </button>
      );
    }
    return null;
  }

  const manualKind = !propertyId
    ? null
    : section === 'leasing' && viewer.canCreateLease
      ? 'lease'
      : section === 'sales' && viewer.canCreateSale
        ? 'sale'
        : null;
  const showActions = ACTION_SECTIONS.has(section) || Boolean(config.href);

  return (
    <section className="pmh-card psr">
      <header className="pmh-card__head">
        <h2>
          <span className="pmh-card__icon">
            <Icon name={config.icon} />
          </span>
          {ar ? config.titleAr : config.titleEn}
          {rows ? <span className="pmh-badge">{rows.length}</span> : null}
        </h2>
        <div className="psr-head-actions">
          {manualKind && !formOpen ? (
            <button
              type="button"
              className="button button--primary psr-action"
              onClick={() => {
                setFormOpen(true);
                setNotice(null);
              }}
              disabled={rows === null}
            >
              {manualKind === 'sale'
                ? ar
                  ? '+ عقد بيع يدوي'
                  : '+ Manual sale contract'
                : ar
                  ? '+ عقد تأجير يدوي'
                  : '+ Manual lease contract'}
            </button>
          ) : null}
          <button
            type="button"
            className="pmh-card__link psr-refresh"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={rows === null && !failed}
          >
            {ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </header>

      {notice ? (
        <div
          className={notice.tone === 'success' ? 'notice notice--success' : 'notice notice--error'}
          role={notice.tone === 'success' ? 'status' : 'alert'}
        >
          {notice.text}
        </div>
      ) : null}

      {manualKind === 'lease' && formOpen ? (
        <LeaseContractForm
          units={units}
          tenants={tenants}
          canSign={viewer.canSignContracts}
          locale={locale}
          busy={busyId === 'form'}
          onSubmit={(payload) => void createManual('lease', payload)}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
      {manualKind === 'sale' && formOpen ? (
        <ManualSaleForm
          units={units}
          canSign={viewer.canSignContracts}
          locale={locale}
          busy={busyId === 'form'}
          onSubmit={(payload) => void createManual('sale', payload)}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {summary.length && rows?.length ? (
        <div className="psr-summary">
          {summary.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong dir="ltr">{moneyList(item.value, locale)}</strong>
            </article>
          ))}
        </div>
      ) : null}

      {rows?.length ? (
        <div className="psr-toolbar">
          <div
            className="psr-filters"
            role="group"
            aria-label={ar ? 'تصفية حسب الحالة' : 'Filter by status'}
          >
            <button
              type="button"
              className={statusFilter ? 'psr-chip' : 'psr-chip psr-chip--active'}
              aria-pressed={!statusFilter}
              onClick={() => setStatusFilter('')}
            >
              {ar ? 'الكل' : 'All'} <span>{rows.length}</span>
            </button>
            {statusCounts.map(([status, count]) => (
              <button
                key={status}
                type="button"
                className={statusFilter === status ? 'psr-chip psr-chip--active' : 'psr-chip'}
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
              >
                {domainStatusLabel(status, locale)} <span>{count}</span>
              </button>
            ))}
          </div>
          <input
            className="input psr-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? 'بحث بالاسم أو الرقم أو الوحدة…' : 'Search name, number or unit…'}
            aria-label={ar ? 'بحث' : 'Search'}
          />
        </div>
      ) : null}

      {rows === null && !failed ? (
        <p className="pmh-empty">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
      ) : failed ? (
        <div className="pmh-empty" role="alert">
          {ar ? 'تعذّر تحميل البيانات.' : 'Could not load the records.'}{' '}
          <button
            type="button"
            className="pmh-card__link"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      ) : !rows?.length ? (
        <p className="pmh-empty">{ar ? config.emptyAr : config.emptyEn}</p>
      ) : !visible.length ? (
        <p className="pmh-empty">{ar ? 'لا توجد سجلات مطابقة.' : 'No matching records.'}</p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table data-table--stack psr-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={`psr-col--${column.format ?? 'text'}`}>
                    {ar ? column.ar : column.en}
                  </th>
                ))}
                {showActions ? (
                  <th className="psr-col--actions">{ar ? 'الإجراءات' : 'Actions'}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const href = config.href?.(row, portal) ?? null;
                const terms = expandedId === row.id ? parseLeaseTerms(row.termsJson) : null;
                return (
                  <Fragment key={`${row.kind ?? section}-${row.id}`}>
                    <tr
                      id={`psr-row-${row.id}`}
                      className={focusId === row.id ? 'psr-row--focus' : undefined}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={`psr-col--${column.format ?? 'text'} psr-key--${column.key}`}
                          data-label={ar ? column.ar : column.en}
                        >
                          <Cell
                            row={row}
                            column={column}
                            locale={locale}
                            badges={badges}
                            documentHref={
                              viewer.canRecordStays && row.checkInDocument && row.id
                                ? `/api/owner/properties/${encodeURIComponent(propertyOf(row))}/records/handover/${row.id}`
                                : null
                            }
                            receiptHref={
                              (viewer.canDecideRefunds || viewer.canPayRefunds) &&
                              row.refundReceipt &&
                              (row.bookingId ?? row.id)
                                ? `/api/owner/properties/${encodeURIComponent(propertyOf(row))}/records/refund-receipt/${row.bookingId ?? row.id}`
                                : null
                            }
                            contractHref={
                              !propertyId && row.propertyId && row.contractId
                                ? `/${portal}/properties/${encodeURIComponent(row.propertyId)}?section=contracts&focus=${encodeURIComponent(row.contractId)}`
                                : null
                            }
                          />
                        </td>
                      ))}
                      {showActions ? (
                        <td className="psr-col--actions">
                          <div className="psr-actions">
                            {rowActions(row)}
                            {row.kind === 'viewing' &&
                            row.status === 'scheduled' &&
                            viewer.canCheckInViewings &&
                            !viewer.canManageViewings ? (
                              <Link
                                className="button button--primary psr-action"
                                href="/viewing-gate"
                                prefetch={false}
                              >
                                {ar ? 'مسح الباركود / إدخال الرمز' : 'Scan barcode / enter PIN'}
                              </Link>
                            ) : null}
                            {href &&
                            !(
                              row.kind === 'viewing' &&
                              !viewer.canManageViewings &&
                              viewer.canCheckInViewings
                            ) ? (
                              <Link
                                className={`pmh-card__link${row.kind === 'viewing' ? ' button button--primary psr-action' : ''}`}
                                href={href}
                                prefetch={false}
                              >
                                {row.kind === 'viewing'
                                  ? ar
                                    ? 'فتح المعاينة والرد'
                                    : 'Open & reply'
                                  : ar
                                    ? 'فتح'
                                    : 'Open'}
                              </Link>
                            ) : null}
                            {row.kind === 'viewing' &&
                            row.status === 'scheduled' &&
                            row.accessUsername &&
                            viewer.canCheckInViewings ? (
                              <span className="psr-viewing-creds muted" dir="ltr">
                                {ar ? 'المستخدم' : 'User'}: {row.accessUsername}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    {stampForm && stampForm.rowId === row.id ? (
                      <tr className="psr-details">
                        <td colSpan={columns.length + (showActions ? 1 : 0)}>
                          <StayHandoverForm
                            kind={stampForm.kind}
                            reference={row.reference ?? ''}
                            locale={locale}
                            busy={busyId === row.id}
                            guestPhone={row.guestPhone ?? null}
                            onSubmit={(value) => void submitStamp(row, stampForm.kind, value)}
                            onCancel={() => setStampForm(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {reviewRowId && reviewRowId === row.id ? (
                      <tr id={`psr-review-${row.id}`} className="psr-details">
                        <td colSpan={columns.length + (showActions ? 1 : 0)}>
                          <HostGuestReviewForm
                            propertyId={propertyOf(row)}
                            bookingId={row.id ?? ''}
                            ar={ar}
                            busy={busyId === row.id}
                            error={reviewError}
                            subjectName={row.party ?? null}
                            onSubmit={(value) => void submitGuestReview(row, value)}
                            onCancel={() => setReviewRowId(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {refundForm && refundForm.rowId === row.id ? (
                      <tr className="psr-details">
                        <td colSpan={columns.length + (showActions ? 1 : 0)}>
                          <DepositRefundForm
                            mode={refundForm.mode}
                            row={row}
                            locale={locale}
                            busy={busyId === row.id}
                            defaultAmount={minorToDecimal(
                              row.refundAmountMinor ?? row.depositMinor ?? null,
                              row.currency ?? 'OMR',
                            )}
                            onSubmit={(value) => void submitRefund(row, value)}
                            onCancel={() => setRefundForm(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                    {terms ? (
                      <tr className="psr-details">
                        <td colSpan={columns.length + (showActions ? 1 : 0)}>
                          <LeaseTermsView
                            terms={terms}
                            tenant={parseTenantDetails(row.tenantJson)}
                            locale={locale}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
