'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from '@/components/pmh-icon';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { domainStatusLabel } from '@/lib/ui-labels';
import type {
  PropertyRecordRow,
  PropertyRecordSection,
  PropertyRecordUnit,
} from '@/lib/property-records-neon';

type Format =
  | 'text'
  | 'date'
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
  | 'priority';

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
  canSignContracts: boolean;
  canCreateLease: boolean;
  canCreateSale: boolean;
};

const NO_VIEWER: Viewer = {
  canManageBookings: false,
  canSignContracts: false,
  canCreateLease: false,
  canCreateSale: false,
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
  lease_payment: ['دفعة إيجار', 'Rent payment'],
  expense: ['مصروف', 'Expense'],
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
      { key: 'fromOn', ar: 'من', en: 'From', format: 'date' },
      { key: 'toOn', ar: 'إلى', en: 'To', format: 'date' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'money' },
      { key: 'termsAcceptedOn', ar: 'الشروط والأحكام', en: 'Terms', format: 'terms' },
      { key: 'status', ar: 'حالة الحجز', en: 'Status', format: 'status' },
      { key: 'contractReference', ar: 'العقد', en: 'Contract', format: 'contractLink' },
    ],
    href: (row, portal) =>
      row.kind === 'stay'
        ? `/${portal}/stays/bookings/${row.id}`
        : row.kind === 'reservation'
          ? `/${portal}/bookings/${row.id}`
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
      { key: 'fromOn', ar: 'من', en: 'From', format: 'date' },
      { key: 'toOn', ar: 'إلى', en: 'To', format: 'date' },
      { key: 'amountMinor', ar: 'القيمة', en: 'Amount', format: 'money' },
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
      { key: 'fromOn', ar: 'يبدأ من', en: 'From', format: 'date' },
      { key: 'toOn', ar: 'ينتهي في', en: 'To', format: 'date' },
      { key: 'amountMinor', ar: 'قيمة الإيجار', en: 'Rent', format: 'money' },
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
      { key: 'description', ar: 'البيان', en: 'Description' },
      { key: 'amountMinor', ar: 'المبلغ', en: 'Amount', format: 'signedMoney' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
  },
};

/** Sections whose rows carry workflow buttons. */
const ACTION_SECTIONS = new Set<PropertyRecordSection>(['bookings', 'contracts']);
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
]);
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
  invalid_dates: ['تاريخ النهاية يجب أن يكون بعد تاريخ البداية.', 'End date must be after start.'],
  invalid_body: ['تحقّق من الحقول المطلوبة.', 'Check the required fields.'],
  forbidden: ['لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not allowed to do this.'],
  unit_not_found: ['الوحدة غير موجودة في هذا العقار.', 'Unit not found on this property.'],
};

function statusTone(status: string): string {
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

/** Switch the hub to the contracts tab and spotlight one contract. */
function openContract(contractId: string) {
  window.history.pushState(
    null,
    '',
    `${window.location.pathname}?section=contracts&focus=${encodeURIComponent(contractId)}`,
  );
  window.scrollTo({ top: 0 });
}

function Cell({
  row,
  column,
  locale,
}: {
  row: PropertyRecordRow;
  column: Column;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const value = row[column.key] ?? null;
  switch (column.format) {
    case 'status':
      return value ? (
        <span className={`pmh-badge pmh-badge--${statusTone(value)}`}>
          {domainStatusLabel(value, locale)}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    case 'kind':
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
      return (
        <a
          className="pmh-card__link"
          dir="ltr"
          href={`?section=contracts&focus=${encodeURIComponent(contractId)}`}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            openContract(contractId);
          }}
        >
          {value}
        </a>
      );
    }
    case 'terms':
      if (row.kind !== 'stay') return <span className="muted">—</span>;
      return value ? (
        <span className="pmh-badge pmh-badge--ready" title={value}>
          {ar ? 'وقّع المستأجر' : 'Signed by guest'}
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
          className={
            row.direction === 'out' ? 'psr-money psr-money--out' : 'psr-money psr-money--in'
          }
        >
          {row.direction === 'out' ? '−' : '+'} {formatMoney(value, row.currency, locale)}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    default:
      return value ? <>{value}</> : <span className="muted">—</span>;
  }
}

function ManualContractForm({
  kind,
  units,
  canSign,
  locale,
  busy,
  onSubmit,
  onCancel,
}: {
  kind: 'lease' | 'sale';
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
    unit
      ? minorToDecimal(kind === 'sale' ? unit.salePriceMinor : unit.rentMinor, unit.currency)
      : '';
  const [unitId, setUnitId] = useState(firstUnit?.id ?? '');
  const [amount, setAmount] = useState(defaultAmount(firstUnit));
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
      <h3>
        {kind === 'sale'
          ? ar
            ? 'عقد بيع يدوي'
            : 'Manual sale contract'
          : ar
            ? 'عقد تأجير يدوي'
            : 'Manual lease contract'}
      </h3>
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
          <label htmlFor="psr-party">
            {kind === 'sale'
              ? ar
                ? 'اسم المشتري'
                : 'Buyer name'
              : ar
                ? 'اسم المستأجر'
                : 'Tenant name'}
          </label>
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
        {kind === 'lease' ? (
          <>
            <div className="field">
              <label htmlFor="psr-from">{ar ? 'يبدأ من' : 'Starts on'}</label>
              <input
                id="psr-from"
                name="startsOn"
                type="date"
                className="input"
                required
                defaultValue={today}
              />
            </div>
            <div className="field">
              <label htmlFor="psr-to">{ar ? 'ينتهي في' : 'Ends on'}</label>
              <input id="psr-to" name="endsOn" type="date" className="input" required />
            </div>
          </>
        ) : (
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
        )}
        <div className="field">
          <label htmlFor="psr-amount">
            {kind === 'sale'
              ? ar
                ? `ثمن البيع (${unit?.currency ?? ''})`
                : `Sale price (${unit?.currency ?? ''})`
              : ar
                ? `قيمة الإيجار للمدة (${unit?.currency ?? ''})`
                : `Rent for the term (${unit?.currency ?? ''})`}
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
        {kind === 'lease' ? (
          <div className="field">
            <label htmlFor="psr-deposit">
              {ar ? `مبلغ التأمين (${unit?.currency ?? ''})` : `Deposit (${unit?.currency ?? ''})`}
            </label>
            <input
              id="psr-deposit"
              name="deposit"
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern="\d{1,12}(\.\d{1,3})?"
            />
          </div>
        ) : null}
        <div className="field span-2">
          <label htmlFor="psr-notes">{ar ? 'ملاحظات' : 'Notes'}</label>
          <textarea id="psr-notes" name="notes" className="textarea" rows={2} maxLength={2000} />
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
  propertyId: string;
  section: PropertyRecordSection;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const config = SECTIONS[section];
  const focusId = useSearchParams().get('focus');
  const [rows, setRows] = useState<PropertyRecordRow[] | null>(null);
  const [units, setUnits] = useState<PropertyRecordUnit[]>([]);
  const [viewer, setViewer] = useState<Viewer>(NO_VIEWER);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/portal/property-records/${encodeURIComponent(propertyId)}/${section}`,
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
          viewer?: Viewer;
        };
        setRows(payload.rows ?? []);
        setUnits(payload.units ?? []);
        setViewer(payload.viewer ?? NO_VIEWER);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
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

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      if (row.status) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (rows ?? []).filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
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
      const spent = all.filter((r) => r.direction === 'out' && r.status !== 'rejected');
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
      ];
    }
    return [];
  }, [rows, section, ar]);

  async function runAction(busyKey: string, body: Record<string, string>) {
    setBusyId(busyKey);
    setNotice(null);
    try {
      const result = await browserNextMutation<ContractOutcome>(
        `/api/owner/properties/${encodeURIComponent(propertyId)}/records`,
        { method: 'POST', body: JSON.stringify(body) },
      );
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
    const result = await runAction(id, { action: 'approve_booking', bookingId: id });
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
    const result = await runAction(id, { action: 'reject_booking', bookingId: id });
    if (!result) return;
    setNotice({
      tone: 'success',
      text: ar
        ? `تم رفض طلب الحجز ${row.reference}.`
        : `Booking request ${row.reference} rejected.`,
    });
    setReloadKey((key) => key + 1);
  }

  async function approveContract(row: PropertyRecordRow) {
    const question = ar
      ? `اعتماد العقد ${row.reference} وتوقيعه باسمك نيابة عن المالك؟`
      : `Approve contract ${row.reference} and sign it in your name for the owner?`;
    if (!window.confirm(question)) return;
    const id = row.id ?? '';
    const result = await runAction(id, { action: 'approve_contract', contractId: id });
    if (!result) return;
    setNotice({
      tone: 'success',
      text: ar
        ? `تم اعتماد العقد ${row.reference} وتوقيعه باسمك.`
        : `Contract ${row.reference} approved and signed.`,
    });
    setReloadKey((key) => key + 1);
  }

  async function createManual(kind: 'lease' | 'sale', payload: Record<string, string>) {
    const result = await runAction('form', {
      action: kind === 'sale' ? 'create_sale' : 'create_lease',
      ...payload,
    });
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

  const manualKind =
    section === 'leasing' && viewer.canCreateLease
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

      {manualKind && formOpen ? (
        <ManualContractForm
          kind={manualKind}
          units={units}
          canSign={viewer.canSignContracts}
          locale={locale}
          busy={busyId === 'form'}
          onSubmit={(payload) => void createManual(manualKind, payload)}
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
          <table className="data-table psr-table">
            <thead>
              <tr>
                {config.columns.map((column) => (
                  <th key={column.key}>{ar ? column.ar : column.en}</th>
                ))}
                {showActions ? <th>{ar ? 'الإجراءات' : 'Actions'}</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const href = config.href?.(row, portal) ?? null;
                return (
                  <tr
                    key={`${row.kind ?? section}-${row.id}`}
                    id={`psr-row-${row.id}`}
                    className={focusId === row.id ? 'psr-row--focus' : undefined}
                  >
                    {config.columns.map((column) => (
                      <td key={column.key}>
                        <Cell row={row} column={column} locale={locale} />
                      </td>
                    ))}
                    {showActions ? (
                      <td>
                        <div className="psr-actions">
                          {rowActions(row)}
                          {href ? (
                            <Link className="pmh-card__link" href={href} prefetch={false}>
                              {ar ? 'فتح' : 'Open'}
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
