'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon, type IconName } from '@/components/pmh-icon';
import { formatMoney } from '@/lib/format';
import { domainStatusLabel } from '@/lib/ui-labels';
import type { PropertyRecordRow, PropertyRecordSection } from '@/lib/property-records-neon';

type Format =
  | 'text'
  | 'date'
  | 'money'
  | 'signedMoney'
  | 'balance'
  | 'status'
  | 'kind'
  | 'contractKind'
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
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
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
      { key: 'contractKind', ar: 'نوع العقد', en: 'Kind', format: 'contractKind' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المستأجر', en: 'Tenant' },
      { key: 'fromOn', ar: 'بداية الإيجار', en: 'Lease start', format: 'date' },
      { key: 'toOn', ar: 'نهاية الإيجار', en: 'Lease end', format: 'date' },
      { key: 'amountMinor', ar: 'الإيجار', en: 'Rent', format: 'money' },
      { key: 'signedOn', ar: 'تاريخ التوقيع', en: 'Signed on', format: 'date' },
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
      { key: 'reference', ar: 'العقد', en: 'Contract' },
      { key: 'unitCode', ar: 'الوحدة', en: 'Unit' },
      { key: 'party', ar: 'المستأجر', en: 'Tenant' },
      { key: 'fromOn', ar: 'من', en: 'From', format: 'date' },
      { key: 'toOn', ar: 'إلى', en: 'To', format: 'date' },
      { key: 'amountMinor', ar: 'الإيجار', en: 'Rent', format: 'money' },
      { key: 'depositMinor', ar: 'التأمين', en: 'Deposit', format: 'money' },
      { key: 'cancellationOn', ar: 'تاريخ الإلغاء', en: 'Cancelled on', format: 'date' },
      { key: 'status', ar: 'الحالة', en: 'Status', format: 'status' },
    ],
    href: (row, portal) => (row.contractId ? `/${portal}/contracts/${row.contractId}` : null),
  },
  sales: {
    titleAr: 'البيع',
    titleEn: 'Sales',
    icon: 'tag',
    emptyAr: 'لا توجد صفقات بيع لهذا العقار.',
    emptyEn: 'No sales deals for this property.',
    columns: [
      { key: 'reference', ar: 'المرجع', en: 'Reference' },
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

const READY = new Set([
  'active',
  'signed',
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
  'expired',
  'closed_lost',
  'rejected',
  'refunded',
]);

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
    case 'priority':
      return <>{label(value, ar)}</>;
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
  const [rows, setRows] = useState<PropertyRecordRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');

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
        const payload = (await response.json()) as { rows?: PropertyRecordRow[] };
        setRows(payload.rows ?? []);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [propertyId, section, reloadKey]);

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
        <button
          type="button"
          className="pmh-card__link psr-refresh"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={rows === null && !failed}
        >
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </header>

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
                {config.href ? <th aria-label={ar ? 'فتح' : 'Open'} /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const href = config.href?.(row, portal) ?? null;
                return (
                  <tr key={`${row.kind ?? section}-${row.id}`}>
                    {config.columns.map((column) => (
                      <td key={column.key}>
                        <Cell row={row} column={column} locale={locale} />
                      </td>
                    ))}
                    {config.href ? (
                      <td>
                        {href ? (
                          <Link className="pmh-card__link" href={href} prefetch={false}>
                            {ar ? 'فتح' : 'Open'}
                          </Link>
                        ) : null}
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
