'use client';

import { useState, type ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { BadgeChips } from '@/components/badges/badge-chips';
import {
  FilterableTenantTable,
  type TenantTableColumn,
  type TenantTableRow,
} from '@/components/filterable-tenant-table';
import { ModalPortal } from '@/components/modal-portal';
import {
  ContractKindChip,
  contractKindChipLabel,
  contractKindTone,
} from '@/components/contract-kind-chip';
import { SoftPortalLink as Link } from '@/components/soft-portal-link';
import { TenantRequestLauncher } from '@/components/tenant-request-form';
import { TenantRequestsList } from '@/components/tenant-requests-list';
import {
  requestLeasesOf,
  TenantArrearsSummary,
  TenantStatements,
} from '@/components/tenant-statement';
import type { BadgeChip } from '@/lib/badges-shared';
import {
  stayPaymentKindLabel,
  stayPaymentMethodLabel,
  tenantDepositRefundPhase,
  tenantDepositRefundStatusLabel,
  tenantDepositRefundStatusTone,
  tenantPaymentCategoryLabel,
  tenantPaymentHoldStatus,
} from '@/lib/stay-booking-payment-labels';
import { displayStayCheckoutOn } from '@/lib/stay-period-times';
import {
  invoiceOutstandingMinor,
  reservationHref,
  stayHref,
  tenancyAlertLabel,
  tenancyContractGroups,
  tenancyLandlordName,
  tenancyUnitLabel,
  viewingHref,
  type MyTenancy,
  type TenancyContract,
  type TenancyDepositRefund,
} from '@/lib/tenancy-shared';
import { OPEN_TENANT_REQUEST } from '@/lib/tenant-requests-shared';
import { TENANT_SPACE_SECTIONS, type TenantSpaceView } from '@/lib/tenant-soft-nav';
import { domainStatusLabel, stayStatusLabel } from '@/lib/ui-labels';

export type { TenantSpaceView };
export { TENANT_SPACE_SECTIONS };

const OPEN_INVOICE = new Set(['issued', 'partially_paid', 'overdue']);

type Ctx = { ar: boolean; locale: 'ar' | 'en'; data: MyTenancy };

function formatDate(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', { dateStyle: 'medium' }).format(date);
}

function period(
  from: string | null,
  to: string | null,
  ar: boolean,
  stayType?: string | null,
): string {
  if (!from && !to) return '—';
  const displayTo = from && to && stayType ? displayStayCheckoutOn(stayType, from, to) : to;
  if (from && displayTo && from.slice(0, 10) === displayTo.slice(0, 10)) {
    return formatDate(from, ar);
  }
  return `${formatDate(from, ar)} ${ar ? '←' : '→'} ${formatDate(displayTo, ar)}`;
}

function clockTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : value.trim();
}

function dayWithTime(
  dateOn: string | null | undefined,
  time: string | null | undefined,
  ar: boolean,
): string {
  if (!dateOn) return '—';
  const day = formatDate(dateOn, ar);
  const clock = clockTime(time);
  return clock ? `${day} · ${clock}` : day;
}

function contractDisplayEndsOn(contract: TenancyContract): string | null {
  if (!contract.startsOn || !contract.endsOn) return contract.endsOn;
  return displayStayCheckoutOn(contract.stayType, contract.startsOn, contract.endsOn);
}

function money(amountMinor: string | null, currency: string | null, locale: string): string {
  return amountMinor && currency ? formatMoney(amountMinor, currency, locale) : '—';
}

type StatusTone = 'action' | 'good' | 'danger' | 'warn' | 'info' | 'quiet';

function Status({ label, tone }: { label: string; tone?: StatusTone | undefined }) {
  return <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>{label}</span>;
}

function alertTone(kind: string, action: boolean): string {
  if (action || kind.includes('overdue') || kind === 'deposit_dispute') return 'danger';
  if (kind.includes('sign') || kind.includes('payment') || kind.includes('pending'))
    return 'action';
  if (kind.includes('scheduled') || kind.includes('expiring')) return 'warn';
  if (kind.includes('due')) return 'info';
  return 'quiet';
}

type PreviewFact = { label: string; value: ReactNode };
type PreviewItem = {
  id: string;
  title: string;
  eyebrow?: string;
  summary?: string;
  /** Visible money on the title row (invoice total, payment amount, …). */
  amount?: string;
  status?: ReactNode;
  tone?: string;
  facts: PreviewFact[];
  /** Rich body for complex records (statements, request threads). */
  detail?: ReactNode;
  href?: string | null;
  hrefLabel?: string | null;
};

type MoneyBucket = { paid: bigint; overdue: bigint; due: bigint; deferred: bigint };

function emptyMoneyBucket(): MoneyBucket {
  return { paid: 0n, overdue: 0n, due: 0n, deferred: 0n };
}

function addMinor(map: Map<string, bigint>, currency: string, value: bigint) {
  if (!currency || value === 0n) return;
  map.set(currency, (map.get(currency) ?? 0n) + value);
}

function formatMoneyMap(
  map: Map<string, bigint>,
  locale: string,
  zeroCurrency: string | null,
): string {
  const parts = [...map.entries()]
    .filter(([, value]) => value !== 0n)
    .map(([currency, value]) => formatMoney(value.toString(), currency, locale));
  if (parts.length) return parts.join(' · ');
  return zeroCurrency ? formatMoney('0', zeroCurrency, locale) : '—';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Paid / overdue / due now / deferred across lease statements (+ open invoices not in the ledger). */
function tenantFinanceMoney(data: MyTenancy, locale: string) {
  const today = todayIsoDate();
  const soon = plusDaysIso(today, 14);
  const byCurrency = new Map<string, MoneyBucket>();
  const bucket = (currency: string) => {
    let row = byCurrency.get(currency);
    if (!row) {
      row = emptyMoneyBucket();
      byCurrency.set(currency, row);
    }
    return row;
  };

  for (const item of data.statements) {
    const row = bucket(item.currency);
    const statement = item.statement;
    row.paid += BigInt(statement.paidMinor || '0');
    row.overdue += BigInt(statement.arrears.totalMinor || '0');
    for (const line of statement.lines) {
      if (line.outsideTotal) continue;
      const left = BigInt(line.amountMinor || '0') - BigInt(line.paidMinor || '0');
      if (left <= 0n) continue;
      if (
        line.status === 'overdue' ||
        line.status === 'bounced' ||
        (line.dueOn < today &&
          line.status !== 'paid' &&
          line.status !== 'collecting' &&
          line.status !== 'stopped')
      ) {
        continue;
      }
      if (line.status === 'upcoming' || line.dueOn > soon) {
        row.deferred += left;
      } else if (
        line.status === 'due_soon' ||
        line.status === 'due' ||
        line.status === 'partially_paid' ||
        line.status === 'collecting'
      ) {
        row.due += left;
      }
    }
    for (const invoice of statement.otherInvoices) {
      if (!OPEN_INVOICE.has(invoice.status)) continue;
      const left = BigInt(invoice.totalMinor || '0') - BigInt(invoice.paidMinor || '0');
      if (left <= 0n) continue;
      if (invoice.status === 'overdue' || invoice.dueOn < today) continue;
      if (invoice.dueOn > soon) row.deferred += left;
      else row.due += left;
    }
  }

  const covered = new Set(
    data.statements.flatMap((item) => [
      ...item.statement.otherInvoices.map((invoice) => invoice.id),
      ...item.statement.lines
        .map((line) => line.invoiceId)
        .filter((id): id is string => Boolean(id)),
    ]),
  );
  for (const invoice of data.invoices) {
    if (covered.has(invoice.id)) continue;
    const row = bucket(invoice.currency);
    const paid = BigInt(invoice.paidMinor || '0');
    const total = BigInt(invoice.totalMinor || '0');
    const left = total - paid;
    row.paid += paid > total ? total : paid;
    if (left <= 0n) continue;
    if (
      invoice.status === 'overdue' ||
      (OPEN_INVOICE.has(invoice.status) && invoice.dueOn < today)
    ) {
      row.overdue += left;
    } else if (OPEN_INVOICE.has(invoice.status) && invoice.dueOn > soon) {
      row.deferred += left;
    } else if (OPEN_INVOICE.has(invoice.status)) {
      row.due += left;
    }
  }

  const paid = new Map<string, bigint>();
  const overdue = new Map<string, bigint>();
  const due = new Map<string, bigint>();
  const deferred = new Map<string, bigint>();
  for (const [currency, row] of byCurrency) {
    addMinor(paid, currency, row.paid);
    addMinor(overdue, currency, row.overdue);
    addMinor(due, currency, row.due);
    addMinor(deferred, currency, row.deferred);
  }
  const zeroCurrency =
    data.statements[0]?.currency ??
    data.invoices[0]?.currency ??
    data.payments[0]?.currency ??
    null;
  const has = (map: Map<string, bigint>) => [...map.values()].some((value) => value !== 0n);
  return {
    paid: formatMoneyMap(paid, locale, zeroCurrency),
    overdue: formatMoneyMap(overdue, locale, zeroCurrency),
    due: formatMoneyMap(due, locale, zeroCurrency),
    deferred: formatMoneyMap(deferred, locale, zeroCurrency),
    hasOverdue: has(overdue),
    hasDue: has(due),
    hasDeferred: has(deferred),
  };
}

/** Rent paid vs deposit held/refunded — for the tenant payments summary. */
function tenantPaymentMoney(data: MyTenancy, locale: string) {
  const rentPaid = new Map<string, bigint>();
  const depositHeld = new Map<string, bigint>();
  const depositRefunded = new Map<string, bigint>();

  for (const payment of data.payments) {
    const amount = BigInt(payment.amountMinor || '0');
    const refundedRaw = BigInt(payment.refundedMinor || '0');
    const refunded = refundedRaw > amount ? amount : refundedRaw;
    const net = amount > refunded ? amount - refunded : 0n;
    if (payment.stayKind === 'deposit') {
      addMinor(depositHeld, payment.currency, net);
      addMinor(depositRefunded, payment.currency, refunded);
    } else {
      addMinor(rentPaid, payment.currency, net);
    }
  }

  // Long-term lease security deposits (outside contract total) still held.
  for (const item of data.statements) {
    for (const line of item.statement.lines) {
      if (line.kind !== 'deposit') continue;
      const paid = BigInt(line.paidMinor || '0');
      if (paid <= 0n) continue;
      addMinor(depositHeld, item.currency, paid);
    }
  }

  const zeroCurrency =
    data.payments[0]?.currency ??
    data.statements[0]?.currency ??
    data.invoices[0]?.currency ??
    null;
  const has = (map: Map<string, bigint>) => [...map.values()].some((value) => value !== 0n);
  return {
    rentPaid: formatMoneyMap(rentPaid, locale, zeroCurrency),
    depositHeld: formatMoneyMap(depositHeld, locale, zeroCurrency),
    depositRefunded: formatMoneyMap(depositRefunded, locale, zeroCurrency),
    hasRentPaid: has(rentPaid),
    hasDepositHeld: has(depositHeld),
    hasDepositRefunded: has(depositRefunded),
  };
}

function takeRows<T>(rows: T[], limit?: number): T[] {
  return limit != null ? rows.slice(0, limit) : rows;
}

/** Title row + «استعراض» modal — keeps the home wide and light on every screen. */
function PreviewList({ items, ar, empty }: { items: PreviewItem[]; ar: boolean; empty: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;
  if (!items.length) {
    return (
      <div className="tenant-home__empty" role="status">
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <>
      <ul className="tenant-preview-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`tenant-preview-row${item.tone ? ` tenant-preview-row--${item.tone}` : ''}`}
          >
            <div className="tenant-preview-row__main">
              {item.eyebrow ? (
                <span className="tenant-preview-row__eyebrow">{item.eyebrow}</span>
              ) : null}
              <div className="tenant-preview-row__headline">
                <strong className="tenant-preview-row__title">{item.title}</strong>
                {item.amount ? (
                  <strong className="tenant-preview-row__amount" dir="ltr">
                    {item.amount}
                  </strong>
                ) : null}
              </div>
              {item.summary ? (
                <span className="tenant-preview-row__summary">{item.summary}</span>
              ) : null}
            </div>
            <div className="tenant-preview-row__side">
              {item.status}
              {item.href ? (
                <Link href={item.href} className="button button--quiet button--sm">
                  {item.hrefLabel ?? (ar ? 'فتح' : 'Open')}
                </Link>
              ) : null}
              <button
                type="button"
                className="button button--quiet button--sm"
                onClick={() => setOpenId(item.id)}
              >
                {ar ? 'تفاصيل' : 'Details'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {open ? (
        <ModalPortal onClose={() => setOpenId(null)}>
          <div
            className="ops-modal ops-modal--create tenant-detail-modal"
            role="presentation"
            onClick={() => setOpenId(null)}
          >
            <div
              className="ops-modal__card tenant-detail-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby={`tenant-detail-${open.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="ops-modal__head">
                <div>
                  {open.eyebrow ? <p className="tenant-kicker">{open.eyebrow}</p> : null}
                  <h2 id={`tenant-detail-${open.id}`}>{open.title}</h2>
                </div>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setOpenId(null)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </header>
              <div className="tenant-detail-modal__body">
                {open.status ? (
                  <div className="tenant-detail-modal__status">{open.status}</div>
                ) : null}
                {open.facts.length ? (
                  <dl className="tenant-detail-modal__facts">
                    {open.facts.map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {open.detail ? (
                  <div className="tenant-detail-modal__detail">{open.detail}</div>
                ) : null}
                {open.href ? (
                  <div className="tenant-detail-modal__footer">
                    <Link href={open.href} className="button button--primary">
                      {open.hrefLabel ?? (ar ? 'فتح' : 'Open')}
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}

function contractLifecycleLabel(
  contract: TenancyContract,
  ar: boolean,
): {
  label: string;
  tone: 'action' | 'good' | 'warn' | 'quiet' | 'info' | undefined;
} {
  const awaitingMe =
    ['sent', 'partially_signed'].includes(contract.status) && !contract.tenantSigned;
  if (awaitingMe) {
    return {
      label: ar ? 'بانتظار توقيعك' : 'Awaiting your signature',
      tone: 'action',
    };
  }
  if (contract.status === 'terminated' || contract.status === 'void') {
    return { label: ar ? 'ملغى' : 'Cancelled', tone: 'quiet' };
  }

  const stay = contract.stayBookingStatus;
  if (stay) {
    switch (stay) {
      case 'no_show':
        return { label: ar ? 'تخلف عن الحضور' : 'No-show', tone: 'warn' };
      case 'cancelled':
      case 'expired':
      case 'payment_failed':
        return { label: ar ? 'ملغى' : 'Cancelled', tone: 'quiet' };
      case 'checked_out':
      case 'closed':
        return { label: ar ? 'منتهٍ' : 'Ended', tone: 'info' };
      case 'checked_in':
        return { label: ar ? 'ساري' : 'Active', tone: 'good' };
      case 'confirmed':
      case 'paid':
      case 'pre_arrival':
        return { label: ar ? 'ساري' : 'Active', tone: 'good' };
      case 'payment_pending':
      case 'request_pending':
        return { label: stayStatusLabel(stay, ar), tone: 'action' };
      default:
        return { label: stayStatusLabel(stay, ar), tone: 'info' };
    }
  }

  if (contract.status === 'signed') {
    return { label: ar ? 'ساري' : 'Active', tone: 'good' };
  }
  return { label: domainStatusLabel(contract.status, ar), tone: 'info' };
}

function contractStatusCell(contract: TenancyContract, ar: boolean) {
  const { label, tone } = contractLifecycleLabel(contract, ar);
  return <Status label={label} tone={tone} />;
}

function ContractsTable({ ar, locale, data }: Ctx) {
  const groups = tenancyContractGroups(data.contracts);
  const columns: TenantTableColumn[] = [
    { key: 'reference', label: ar ? 'العقد' : 'Contract' },
    { key: 'unit', label: ar ? 'الوحدة' : 'Unit' },
    { key: 'landlord', label: ar ? 'المالك' : 'Landlord' },
    { key: 'startsOn', label: ar ? 'البداية' : 'Starts', kind: 'date' },
    { key: 'endsOn', label: ar ? 'النهاية' : 'Ends', kind: 'date' },
    { key: 'status', label: ar ? 'الحالة' : 'Status', kind: 'text' },
    { key: 'amount', label: ar ? 'القيمة' : 'Value' },
    { key: 'action', label: '', kind: 'none' },
  ];
  const rows: TenantTableRow[] = groups.map(({ root: contract, attachments }) => {
    const endsOn = contractDisplayEndsOn(contract);
    const daily = Boolean(contract.stayReference || contract.stayType);
    const status = contractLifecycleLabel(contract, ar);
    return {
      id: contract.id,
      values: {
        reference: contract.reference,
        unit: tenancyUnitLabel(contract, ar),
        landlord: tenancyLandlordName(contract.landlord, ar),
        startsOn: contract.startsOn?.slice(0, 10) ?? '',
        endsOn: endsOn?.slice(0, 10) ?? '',
        status: status.label,
        amount: money(contract.amountMinor, contract.currency, locale),
        action: '',
      },
      cells: [
        <span key="ref" className="tenant-table__ref">
          <span className="tenant-table__ref-head">
            <ContractKindChip kind={contract.kind} ar={ar} />
            <bdi>{contract.reference}</bdi>
          </span>
          {attachments.length ? (
            <small className="tenant-table__sub">
              {ar ? `${attachments.length} مرفق` : `${attachments.length} attached`}
              {' · '}
              {attachments
                .map((item) => contractKindChipLabel(item.kind, ar))
                .filter((label, index, all) => all.indexOf(label) === index)
                .join(' · ')}
            </small>
          ) : null}
        </span>,
        <span key="unit">
          {tenancyUnitLabel(contract, ar)}
          {contract.stayReference ? (
            <small className="tenant-table__sub">
              {ar ? 'إقامة يومية' : 'Daily stay'} · <bdi>{contract.stayReference}</bdi>
            </small>
          ) : null}
        </span>,
        tenancyLandlordName(contract.landlord, ar),
        dayWithTime(contract.startsOn, daily ? contract.checkInTime : null, ar),
        dayWithTime(endsOn, daily ? contract.checkOutTime : null, ar),
        contractStatusCell(contract, ar),
        money(contract.amountMinor, contract.currency, locale),
        <Link
          key="open"
          className="button button--quiet button--sm"
          href={`/tenant/contracts/${contract.id}`}
        >
          {ar ? 'عرض' : 'View'}
        </Link>,
      ],
    };
  });
  return (
    <FilterableTenantTable
      columns={columns}
      rows={rows}
      ar={ar}
      empty={ar ? 'لا عقود بعد.' : 'No contracts yet.'}
      defaultSortKey="startsOn"
    />
  );
}

function LeasesTable({ ar, locale, data }: Ctx) {
  const columns: TenantTableColumn[] = [
    { key: 'unit', label: ar ? 'الوحدة' : 'Unit' },
    { key: 'landlord', label: ar ? 'المالك' : 'Landlord' },
    { key: 'type', label: ar ? 'النوع' : 'Type' },
    { key: 'startsOn', label: ar ? 'البداية' : 'Starts', kind: 'date' },
    { key: 'endsOn', label: ar ? 'النهاية' : 'Ends', kind: 'date' },
    { key: 'rent', label: ar ? 'الإيجار' : 'Rent' },
    { key: 'status', label: ar ? 'الحالة' : 'Status' },
    { key: 'action', label: '', kind: 'none' },
  ];
  const rows: TenantTableRow[] = data.leases.map((lease) => ({
    id: lease.id,
    values: {
      unit: tenancyUnitLabel(lease, ar),
      landlord: tenancyLandlordName(lease.landlord, ar),
      type: lease.fromStay ? (ar ? 'إقامة يومية' : 'Daily stay') : ar ? 'إيجار' : 'Lease',
      startsOn: lease.startsOn?.slice(0, 10) ?? '',
      endsOn: lease.endsOn?.slice(0, 10) ?? '',
      rent: money(lease.rentMinor, lease.currency, locale),
      status: domainStatusLabel(lease.status, ar),
      action: '',
    },
    cells: [
      tenancyUnitLabel(lease, ar),
      tenancyLandlordName(lease.landlord, ar),
      lease.fromStay ? (ar ? 'إقامة يومية' : 'Daily stay') : ar ? 'إيجار' : 'Lease',
      formatDate(lease.startsOn, ar),
      formatDate(lease.endsOn, ar),
      money(lease.rentMinor, lease.currency, locale),
      <Status
        key="status"
        label={domainStatusLabel(lease.status, ar)}
        tone={
          lease.status === 'active'
            ? 'good'
            : lease.status === 'cancel_requested' || lease.status === 'clearance_pending'
              ? 'warn'
              : lease.status === 'cancelled' || lease.status === 'terminated'
                ? 'quiet'
                : lease.status === 'ended'
                  ? 'info'
                  : undefined
        }
      />,
      lease.contractId ? (
        <Link key="open" className="ops-action" href={`/tenant/contracts/${lease.contractId}`}>
          {ar ? 'العقد' : 'Contract'}
        </Link>
      ) : (
        '—'
      ),
    ],
  }));
  return (
    <FilterableTenantTable
      columns={columns}
      rows={rows}
      ar={ar}
      empty={ar ? 'لا إيجارات.' : 'No leases.'}
      defaultSortKey="startsOn"
    />
  );
}

function depositRefundStatusCell(refund: TenancyDepositRefund | null | undefined, ar: boolean) {
  if (!refund) return null;
  const phase = tenantDepositRefundPhase(refund);
  return (
    <Status
      label={tenantDepositRefundStatusLabel(phase, ar)}
      tone={tenantDepositRefundStatusTone(phase)}
    />
  );
}

function InvoicesTable({ ar, locale, data, openOnly = false }: Ctx & { openOnly?: boolean }) {
  const source = openOnly
    ? data.invoices.filter((invoice) => OPEN_INVOICE.has(invoice.status))
    : data.invoices;
  const columns: TenantTableColumn[] = [
    { key: 'number', label: ar ? 'الفاتورة' : 'Invoice' },
    { key: 'landlord', label: ar ? 'المالك' : 'Landlord' },
    { key: 'issuedOn', label: ar ? 'الإصدار' : 'Issued', kind: 'date' },
    { key: 'dueOn', label: ar ? 'الاستحقاق' : 'Due', kind: 'date' },
    { key: 'total', label: ar ? 'الإجمالي' : 'Total' },
    { key: 'outstanding', label: ar ? 'المتبقي' : 'Outstanding' },
    { key: 'status', label: ar ? 'الحالة' : 'Status' },
    { key: 'action', label: '', kind: 'none' },
  ];
  const rows: TenantTableRow[] = source.map((invoice) => {
    const refundStatus = depositRefundStatusCell(invoice.depositRefund, ar);
    const statusLabel = invoice.depositRefund
      ? tenantDepositRefundStatusLabel(tenantDepositRefundPhase(invoice.depositRefund), ar)
      : domainStatusLabel(invoice.status, ar);
    return {
      id: invoice.id,
      values: {
        number: invoice.number,
        landlord: tenancyLandlordName(invoice.landlord, ar),
        issuedOn: invoice.issuedOn?.slice(0, 10) ?? '',
        dueOn: invoice.dueOn?.slice(0, 10) ?? '',
        total: money(invoice.totalMinor, invoice.currency, locale),
        outstanding: money(invoiceOutstandingMinor(invoice), invoice.currency, locale),
        status: statusLabel,
        action: '',
      },
      cells: [
        <span key="num" className="tenant-table__ref">
          <bdi>{invoice.number}</bdi>
          {invoice.stayReference ? (
            <small className="tenant-table__sub">{ar ? 'إقامة يومية' : 'Daily stay'}</small>
          ) : null}
        </span>,
        tenancyLandlordName(invoice.landlord, ar),
        formatDate(invoice.issuedOn, ar),
        formatDate(invoice.dueOn, ar),
        money(invoice.totalMinor, invoice.currency, locale),
        money(invoiceOutstandingMinor(invoice), invoice.currency, locale),
        refundStatus ?? (
          <Status
            key="status"
            label={domainStatusLabel(invoice.status, ar)}
            tone={
              invoice.status === 'overdue' || invoice.status === 'partially_paid'
                ? invoice.status === 'overdue'
                  ? 'danger'
                  : 'action'
                : invoice.status === 'paid'
                  ? 'good'
                  : undefined
            }
          />
        ),
        <span key="docs" className="tenant-doc-links">
          {invoice.receiptHref ? (
            <Link className="tenant-doc-link tenant-doc-link--receipt" href={invoice.receiptHref}>
              {ar ? 'إيصال القبض' : 'Receipt'}
            </Link>
          ) : OPEN_INVOICE.has(invoice.status) ? (
            <span className="tenant-doc-link tenant-doc-link--invoice">
              {ar ? 'الفاتورة' : 'Invoice'}
            </span>
          ) : null}
          {invoice.depositRefund?.transferReceiptHref ? (
            <a
              className="tenant-doc-link tenant-doc-link--receipt"
              href={invoice.depositRefund.transferReceiptHref}
              target="_blank"
              rel="noreferrer"
            >
              {ar ? 'إيصال التحويل' : 'Transfer slip'}
            </a>
          ) : null}
          {invoice.depositRefund?.refundDocHref ? (
            <Link
              className="tenant-doc-link tenant-doc-link--receipt"
              href={invoice.depositRefund.refundDocHref}
            >
              {ar ? 'مستند عكس المعاملة' : 'Reverse document'}
            </Link>
          ) : null}
        </span>,
      ],
    };
  });
  return (
    <FilterableTenantTable
      columns={columns}
      rows={rows}
      ar={ar}
      empty={
        openOnly ? (ar ? 'لا فواتير مستحقة.' : 'Nothing due.') : ar ? 'لا فواتير.' : 'No invoices.'
      }
      defaultSortKey="dueOn"
    />
  );
}

function PaymentsTable({ ar, locale, data }: Ctx) {
  const columns: TenantTableColumn[] = [
    { key: 'receivedAt', label: ar ? 'التاريخ' : 'Date', kind: 'date' },
    { key: 'reference', label: ar ? 'المرجع' : 'Reference' },
    { key: 'landlord', label: ar ? 'المالك' : 'Landlord' },
    { key: 'amount', label: ar ? 'المبلغ' : 'Amount' },
    { key: 'refunded', label: ar ? 'المسترد' : 'Refunded' },
    { key: 'method', label: ar ? 'الطريقة' : 'Method' },
    { key: 'status', label: ar ? 'الحالة' : 'Status' },
    { key: 'action', label: '', kind: 'none' },
  ];
  const rows: TenantTableRow[] = data.payments.map((payment) => {
    const hold = tenantPaymentHoldStatus(payment, ar);
    const amount = BigInt(payment.amountMinor || '0');
    const refundedRaw = BigInt(payment.refundedMinor || '0');
    const refunded = refundedRaw > amount ? amount : refundedRaw;
    const held = amount > refunded ? amount - refunded : 0n;
    const method = payment.stayReference
      ? stayPaymentMethodLabel(payment.method, ar)
      : payment.method || '—';
    return {
      id: payment.id,
      values: {
        receivedAt: payment.receivedAt?.slice(0, 10) ?? '',
        reference: payment.invoiceNumber ?? '',
        landlord: tenancyLandlordName(payment.landlord, ar),
        amount: money(
          payment.stayKind === 'deposit' ? held.toString() : payment.amountMinor,
          payment.currency,
          locale,
        ),
        refunded: refunded > 0n ? money(refunded.toString(), payment.currency, locale) : '',
        method,
        status: hold.label,
        action: '',
      },
      cells: [
        formatDate(payment.receivedAt, ar),
        <span key="ref" className="tenant-table__ref">
          <bdi>{payment.invoiceNumber}</bdi>
          <small className="tenant-table__sub">
            {tenantPaymentCategoryLabel(payment.stayKind, ar)}
            {payment.stayKind ? ` · ${stayPaymentKindLabel(payment.stayKind, ar)}` : ''}
          </small>
        </span>,
        tenancyLandlordName(payment.landlord, ar),
        money(
          payment.stayKind === 'deposit' ? held.toString() : payment.amountMinor,
          payment.currency,
          locale,
        ),
        refunded > 0n ? money(refunded.toString(), payment.currency, locale) : '—',
        method,
        <Status key="hold" label={hold.label} tone={hold.tone} />,
        <span key="docs" className="tenant-doc-links">
          {payment.receiptHref ? (
            <Link className="tenant-doc-link tenant-doc-link--receipt" href={payment.receiptHref}>
              {ar ? 'إيصال القبض' : 'Receipt'}
            </Link>
          ) : null}
          {payment.depositRefund?.transferReceiptHref ? (
            <a
              className="tenant-doc-link tenant-doc-link--receipt"
              href={payment.depositRefund.transferReceiptHref}
              target="_blank"
              rel="noreferrer"
            >
              {ar ? 'إيصال التحويل' : 'Transfer slip'}
            </a>
          ) : null}
          {payment.depositRefund?.refundDocHref ? (
            <Link
              className="tenant-doc-link tenant-doc-link--receipt"
              href={payment.depositRefund.refundDocHref}
            >
              {ar ? 'مستند عكس المعاملة' : 'Reverse document'}
            </Link>
          ) : null}
        </span>,
      ],
    };
  });
  return (
    <FilterableTenantTable
      columns={columns}
      rows={rows}
      ar={ar}
      empty={ar ? 'لا مدفوعات.' : 'No payments.'}
      defaultSortKey="receivedAt"
    />
  );
}

function BookingsTable({ ar, locale, data }: Ctx) {
  const items = bookingPreviewItems(data, ar, locale);
  const columns: TenantTableColumn[] = [
    { key: 'kind', label: ar ? 'النوع' : 'Type' },
    { key: 'title', label: ar ? 'العنوان' : 'Title' },
    { key: 'summary', label: ar ? 'التفاصيل' : 'Details' },
    { key: 'status', label: ar ? 'الحالة' : 'Status' },
    { key: 'action', label: '', kind: 'none' },
  ];
  const rows: TenantTableRow[] = items.map((item) => ({
    id: item.id,
    values: {
      kind: item.eyebrow ?? '',
      title: item.title,
      summary: item.summary ?? '',
      status: typeof item.status === 'string' ? item.status : (item.eyebrow ?? ''),
      action: '',
    },
    cells: [
      item.eyebrow ?? '—',
      item.title,
      item.summary ?? '—',
      item.status ?? '—',
      item.href ? (
        <Link key="open" className="button button--quiet button--sm" href={item.href}>
          {item.hrefLabel ?? (ar ? 'فتح' : 'Open')}
        </Link>
      ) : (
        '—'
      ),
    ],
  }));
  // Fix status values from facts for search
  for (let i = 0; i < items.length; i += 1) {
    const statusFact = items[i]!.facts.find((fact) =>
      ar ? fact.label === 'الحالة' : fact.label === 'Status',
    );
    if (statusFact && typeof statusFact.value === 'string') {
      rows[i]!.values.status = statusFact.value;
    }
  }
  return (
    <FilterableTenantTable
      columns={columns}
      rows={rows}
      ar={ar}
      empty={ar ? 'لا حجوزات بعد.' : 'No bookings yet.'}
    />
  );
}

/** New vs renewal framing for attention cells (same look as عقودي chips). */
function alertContractFrame(
  alert: MyTenancy['alerts'][number],
  data: MyTenancy,
): { tone: 'contract-new' | 'contract-renewal'; kind: string | null } | null {
  if (alert.kind === 'contract_sign') {
    const related = data.contracts.find((contract) => contract.id === alert.id);
    const kind = related?.kind ?? 'initial';
    return {
      tone: contractKindTone(kind) === 'renewal' ? 'contract-renewal' : 'contract-new',
      kind,
    };
  }
  // Ending lease → renewal path (orange). New booking awaiting contract → new path (blue).
  if (alert.kind === 'lease_expiring') {
    return { tone: 'contract-renewal', kind: 'renewal' };
  }
  if (alert.kind === 'reservation_review' || alert.kind === 'reservation_payment') {
    return { tone: 'contract-new', kind: 'initial' };
  }
  return null;
}

function AlertsList({ ar, locale, data }: Ctx) {
  const items: PreviewItem[] = data.alerts.map((alert) => {
    const meta = [
      alert.date ? formatDate(alert.date, ar) : '',
      alert.amountMinor && alert.currency
        ? formatMoney(alert.amountMinor, alert.currency, locale)
        : '',
    ].filter(Boolean);
    const frame = alertContractFrame(alert, data);
    const eyebrow = frame ? contractKindChipLabel(frame.kind, ar) : ar ? 'تنبيه' : 'Alert';
    return {
      id: `alert:${alert.kind}:${alert.id}`,
      title: tenancyAlertLabel(alert.kind, ar),
      eyebrow,
      summary: [alert.reference, ...meta].filter(Boolean).join(' · '),
      tone: frame?.tone ?? alertTone(alert.kind, alert.action),
      status: (
        <span className="tenant-preview-row__status-stack">
          {frame ? <ContractKindChip kind={frame.kind} ar={ar} /> : null}
          {alert.action ? (
            <Status label={ar ? 'يتطلب إجراءً' : 'Action needed'} tone="action" />
          ) : null}
        </span>
      ),
      facts: [
        { label: ar ? 'المرجع' : 'Reference', value: <bdi>{alert.reference}</bdi> },
        ...(alert.date
          ? [{ label: ar ? 'التاريخ' : 'Date', value: formatDate(alert.date, ar) }]
          : []),
        ...(alert.amountMinor && alert.currency
          ? [
              {
                label: ar ? 'المبلغ' : 'Amount',
                value: formatMoney(alert.amountMinor, alert.currency, locale),
              },
            ]
          : []),
      ],
      href: alert.href,
      hrefLabel: ar ? 'متابعة' : 'Continue',
    };
  });
  return (
    <PreviewList
      items={items}
      ar={ar}
      empty={ar ? 'لا شيء يحتاج انتباهك الآن.' : 'Nothing needs your attention right now.'}
    />
  );
}

function bookingPreviewItems(
  data: MyTenancy,
  ar: boolean,
  locale: string,
  limit?: number,
): PreviewItem[] {
  const viewings = takeRows(data.viewings, limit).map((viewing) => {
    const place =
      (ar
        ? viewing.propertyNameAr || viewing.propertyNameEn
        : viewing.propertyNameEn || viewing.propertyNameAr) ?? tenancyUnitLabel(viewing, ar);
    const when = viewing.scheduledAt || viewing.preferredAt || viewing.createdAt;
    const href = viewingHref(viewing);
    return {
      id: `viewing:${viewing.id}`,
      title: place,
      eyebrow: ar ? 'معاينة' : 'Viewing',
      summary: `${tenancyUnitLabel(viewing, ar)} · ${formatDate(when, ar)}`,
      status: <Status label={domainStatusLabel(viewing.status, ar)} tone="info" />,
      facts: [
        { label: ar ? 'المرجع' : 'Reference', value: <bdi>{viewing.reference}</bdi> },
        { label: ar ? 'الوحدة' : 'Unit', value: tenancyUnitLabel(viewing, ar) },
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(viewing.landlord, ar) },
        {
          label: viewing.scheduledAt ? (ar ? 'الموعد' : 'Appointment') : ar ? 'الطلب' : 'Requested',
          value: formatDate(when, ar),
        },
        { label: ar ? 'الحالة' : 'Status', value: domainStatusLabel(viewing.status, ar) },
      ],
      href,
      ...(href ? { hrefLabel: ar ? 'بطاقة الزيارة' : 'Visit pass' } : {}),
    } satisfies PreviewItem;
  });
  const stays = takeRows(data.stays, limit).map((stay) => {
    const title =
      (ar ? stay.titleAr || stay.titleEn : stay.titleEn || stay.titleAr) ?? stay.referenceCode;
    return {
      id: `stay:${stay.id}`,
      title,
      eyebrow: ar ? 'إقامة يومية' : 'Daily stay',
      summary: period(stay.checkInOn, stay.checkOutOn, ar, stay.stayType),
      status: (
        <Status
          label={stayStatusLabel(stay.status, ar)}
          tone={
            ['payment_pending', 'payment_failed'].includes(stay.status)
              ? 'action'
              : ['confirmed', 'pre_arrival', 'checked_in'].includes(stay.status)
                ? 'good'
                : undefined
          }
        />
      ),
      facts: [
        { label: ar ? 'المرجع' : 'Reference', value: <bdi>{stay.referenceCode}</bdi> },
        {
          label: ar ? 'الفترة' : 'Dates',
          value: period(stay.checkInOn, stay.checkOutOn, ar, stay.stayType),
        },
        {
          label: ar ? 'المبلغ' : 'Amount',
          value: money(stay.totalMinor, stay.currency, locale),
        },
        { label: ar ? 'الحالة' : 'Status', value: stayStatusLabel(stay.status, ar) },
      ],
      href: stayHref(stay),
      hrefLabel: ar ? 'فتح الحجز' : 'Open booking',
    } satisfies PreviewItem;
  });
  const reservations = takeRows(data.reservations, limit).map((reservation) => {
    const href = reservationHref(reservation);
    const awaitingPay = reservation.status === 'pending' && reservation.awaitingPayment;
    return {
      id: `reservation:${reservation.id}`,
      title: tenancyUnitLabel(reservation, ar),
      eyebrow:
        reservation.mode === 'sale'
          ? ar
            ? 'حجز شراء'
            : 'Purchase booking'
          : ar
            ? 'حجز إيجار'
            : 'Rent booking',
      summary: `${tenancyLandlordName(reservation.landlord, ar)} · ${formatDate(reservation.expiresAt, ar)}`,
      status: (
        <Status
          label={
            awaitingPay
              ? ar
                ? 'بانتظار دفع الضمان'
                : 'Deposit payment due'
              : domainStatusLabel(reservation.status, ar)
          }
          tone={awaitingPay || reservation.handover ? 'action' : 'info'}
        />
      ),
      facts: [
        {
          label: ar ? 'المرجع' : 'Reference',
          value: <bdi>{reservation.referenceCode ?? reservation.id.slice(0, 8)}</bdi>,
        },
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(reservation.landlord, ar) },
        { label: ar ? 'صالح حتى' : 'Valid until', value: formatDate(reservation.expiresAt, ar) },
        {
          label: ar ? 'العربون' : 'Deposit',
          value: money(reservation.depositMinor, reservation.currency, locale),
        },
        {
          label: ar ? 'الحالة' : 'Status',
          value: domainStatusLabel(reservation.status, ar),
        },
      ],
      href,
      ...(href ? { hrefLabel: ar ? 'فتح مراحل الحجز' : 'Open booking journey' } : {}),
    } satisfies PreviewItem;
  });
  return [...viewings, ...stays, ...reservations];
}

function contractPreviewItems(
  data: MyTenancy,
  ar: boolean,
  locale: string,
  limit?: number,
): PreviewItem[] {
  // Flat list so renewals show as their own cards (not buried under the parent).
  const sorted = data.contracts
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return takeRows(sorted, limit).map((contract) => {
    const endsOn = contractDisplayEndsOn(contract);
    const daily = Boolean(contract.stayReference || contract.stayType);
    const lifecycle = contractLifecycleLabel(contract, ar);
    const tone = contractKindTone(contract.kind);
    const rowTone =
      tone === 'renewal' ? 'contract-renewal' : tone === 'new' ? 'contract-new' : null;
    return {
      id: `contract:${contract.id}`,
      title: contract.reference,
      eyebrow: contract.stayReference
        ? ar
          ? 'عقد إقامة يومية'
          : 'Daily stay contract'
        : contractKindChipLabel(contract.kind, ar),
      summary: `${tenancyUnitLabel(contract, ar)} · ${period(contract.startsOn, endsOn, ar, contract.stayType)}`,
      amount: money(contract.amountMinor, contract.currency, locale),
      status: (
        <span className="tenant-preview-row__status-stack">
          <ContractKindChip kind={contract.kind} ar={ar} />
          {contractStatusCell(contract, ar)}
        </span>
      ),
      ...(rowTone ? { tone: rowTone } : {}),
      facts: [
        {
          label: ar ? 'نوع العقد' : 'Contract type',
          value: contractKindChipLabel(contract.kind, ar),
        },
        { label: ar ? 'الوحدة' : 'Unit', value: tenancyUnitLabel(contract, ar) },
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(contract.landlord, ar) },
        {
          label: ar ? 'تاريخ البدء' : 'Starts',
          value: dayWithTime(contract.startsOn, daily ? contract.checkInTime : null, ar),
        },
        {
          label: ar ? 'تاريخ الانتهاء' : 'Ends',
          value: dayWithTime(endsOn, daily ? contract.checkOutTime : null, ar),
        },
        { label: ar ? 'الحالة' : 'Status', value: lifecycle.label },
        {
          label: ar ? 'القيمة' : 'Value',
          value: money(contract.amountMinor, contract.currency, locale),
        },
      ],
      href: `/tenant/contracts/${contract.id}`,
      hrefLabel: ar ? 'عرض العقد' : 'View contract',
    };
  });
}

function invoicePreviewItems(
  data: MyTenancy,
  ar: boolean,
  locale: string,
  options?: { openOnly?: boolean; limit?: number },
): PreviewItem[] {
  const rows = options?.openOnly
    ? data.invoices.filter((invoice) => OPEN_INVOICE.has(invoice.status))
    : data.invoices;
  return takeRows(rows, options?.limit).map((invoice) => {
    const href = invoice.receiptHref ?? null;
    const outstanding = invoiceOutstandingMinor(invoice);
    const showOutstanding = OPEN_INVOICE.has(invoice.status) && outstanding !== '0';
    return {
      id: `invoice:${invoice.id}`,
      title: invoice.number,
      eyebrow: invoice.stayReference
        ? ar
          ? 'فاتورة إقامة'
          : 'Stay invoice'
        : ar
          ? 'فاتورة'
          : 'Invoice',
      summary: `${tenancyLandlordName(invoice.landlord, ar)} · ${formatDate(invoice.dueOn, ar)}`,
      amount: money(showOutstanding ? outstanding : invoice.totalMinor, invoice.currency, locale),
      status: (
        <Status
          label={domainStatusLabel(invoice.status, ar)}
          tone={
            invoice.status === 'overdue'
              ? 'danger'
              : invoice.status === 'partially_paid'
                ? 'action'
                : invoice.status === 'paid'
                  ? 'good'
                  : undefined
          }
        />
      ),
      facts: [
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(invoice.landlord, ar) },
        { label: ar ? 'الإصدار' : 'Issued', value: formatDate(invoice.issuedOn, ar) },
        { label: ar ? 'الاستحقاق' : 'Due', value: formatDate(invoice.dueOn, ar) },
        {
          label: ar ? 'الإجمالي' : 'Total',
          value: money(invoice.totalMinor, invoice.currency, locale),
        },
        {
          label: ar ? 'المتبقي' : 'Outstanding',
          value: money(outstanding, invoice.currency, locale),
        },
      ],
      ...(href ? { href, hrefLabel: ar ? 'إيصال القبض' : 'Receipt' } : {}),
    } satisfies PreviewItem;
  });
}

function leasePreviewItems(data: MyTenancy, ar: boolean, locale: string): PreviewItem[] {
  return data.leases.map((lease) => ({
    id: `lease:${lease.id}`,
    title: tenancyUnitLabel(lease, ar),
    eyebrow: lease.fromStay ? (ar ? 'إقامة يومية' : 'Daily stay') : ar ? 'إيجار' : 'Lease',
    summary: `${tenancyLandlordName(lease.landlord, ar)} · ${period(lease.startsOn, lease.endsOn, ar)}`,
    status: (
      <Status
        label={domainStatusLabel(lease.status, ar)}
        tone={
          lease.status === 'active'
            ? 'good'
            : lease.status === 'cancel_requested' || lease.status === 'clearance_pending'
              ? 'warn'
              : lease.status === 'cancelled' || lease.status === 'terminated'
                ? 'quiet'
                : lease.status === 'ended'
                  ? 'info'
                  : undefined
        }
      />
    ),
    facts: [
      { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(lease.landlord, ar) },
      { label: ar ? 'المدة' : 'Term', value: period(lease.startsOn, lease.endsOn, ar) },
      { label: ar ? 'الإيجار' : 'Rent', value: money(lease.rentMinor, lease.currency, locale) },
      { label: ar ? 'الحالة' : 'Status', value: domainStatusLabel(lease.status, ar) },
    ],
    ...(lease.contractId
      ? {
          href: `/tenant/contracts/${lease.contractId}`,
          hrefLabel: ar ? 'عرض العقد' : 'View contract',
        }
      : {}),
  }));
}

function Section({
  title,
  hint,
  more,
  children,
  className,
}: {
  title: string;
  hint?: string;
  more?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`tenant-section${className ? ` ${className}` : ''}`}>
      <div className="tenant-section__head">
        <div className="tenant-section__titles">
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </div>
        {more ? (
          <Link href={more.href} className="tenant-section__more">
            {more.label}
          </Link>
        ) : null}
      </div>
      <div className="tenant-section__body">{children}</div>
    </section>
  );
}

const VIEW_COPY: Record<
  Exclude<TenantSpaceView, 'overview'>,
  { ar: [string, string]; en: [string, string] }
> = {
  bookings: {
    ar: [
      'حجوزاتي',
      'كل طلبات المعاينة والإقامات اليومية وحجوزات الإيجار أو الشراء في مكان واحد مرتّب.',
    ],
    en: [
      'My bookings',
      'All viewing requests, daily stays, and rent or purchase bookings in one clear place.',
    ],
  },
  contracts: {
    ar: ['عقودي', 'كل عقد أنت فيه الطرف المستأجر، مع حالة التوقيع.'],
    en: ['My contracts', 'Every contract where you are the tenant, with its signature status.'],
  },
  leases: {
    ar: ['إيجاراتي', 'الوحدات المؤجرة لك ومدد الإيجار.'],
    en: ['My leases', 'Units rented to you and their terms.'],
  },
  invoices: {
    ar: [
      'فواتيري وكشف حسابي',
      'لكل عقد: الأقساط والشيكات بحسب تاريخها كما في العقد، وما دفعته وما تأخر وما تبقى من قيمة العقد، ثم الفواتير الأخرى والمدفوعات.',
    ],
    en: [
      'My invoices & statement',
      'For each lease: installments and cheques by date as in the contract, what you paid, what is overdue and what remains, then other invoices and payments.',
    ],
  },
  payments: {
    ar: [
      'مدفوعاتي والفواتير',
      'المدفوع للإيجار ومبالغ الضمان المحجوزة والمستردّة، مع حالة كل دفعة: إيجار أو ضمان، ومحجوز أو تم الإرجاع.',
    ],
    en: [
      'My payments & invoices',
      'Rent paid and security deposits held or refunded, with each payment marked rent or deposit and held or returned.',
    ],
  },
  requests: {
    ar: [
      'طلباتي',
      'طلبات الصيانة وتأجيل الشيكات وإيقافها وإلغاء العقد أو تجديده وغيرها. يصل كل طلب إلى المالك مباشرة ويصلك رده هنا.',
    ],
    en: [
      'My requests',
      'Maintenance, postponing or stopping cheques, cancelling or renewing the lease and more. Each reaches the landlord directly; answers arrive here.',
    ],
  },
};

export function TenantSpaceContent({
  locale,
  view,
  data,
  failed,
  badges,
  displayName,
  ownerPortal,
}: {
  locale: 'ar' | 'en';
  view: TenantSpaceView;
  data: MyTenancy;
  failed: boolean;
  badges?: readonly BadgeChip[];
  displayName: string;
  ownerPortal: string | null;
}) {
  const ar = locale === 'ar';
  const ctx: Ctx = { ar, locale, data };

  const notice = failed ? (
    <p className="tenant-notice" role="status">
      {ar
        ? 'تعذّر تحميل بياناتك الآن. أعد تحميل الصفحة بعد لحظات.'
        : 'Your records could not be loaded right now. Reload in a moment.'}
    </p>
  ) : null;

  if (view !== 'overview') {
    const [title, hint] = ar ? VIEW_COPY[view].ar : VIEW_COPY[view].en;
    const requestLeases = requestLeasesOf(data.statements, ar);
    const longTermStatements = data.statements.filter((item) => !item.fromStay);
    return (
      <div className="dash-shell tenant-space tenant-home tenant-home--section">
        <header className="tenant-home__welcome">
          <div className="tenant-home__welcome-copy">
            <p className="tenant-kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</p>
            <h1>{title}</h1>
            <p>{hint}</p>
          </div>
          <div className="tenant-home__welcome-actions">
            {view === 'bookings' ? (
              <Link href="/properties" className="button button--primary">
                {ar ? 'تصفّح العقارات' : 'Browse properties'}
              </Link>
            ) : null}
            <Link href="/tenant" className="button button--quiet">
              {ar ? 'لوحة المستأجر' : 'Tenant dashboard'}
            </Link>
          </div>
        </header>
        {notice}
        {view === 'bookings' ? <BookingsTable ar={ar} locale={locale} data={data} /> : null}
        {view === 'contracts' ? <ContractsTable ar={ar} locale={locale} data={data} /> : null}
        {view === 'leases' ? <LeasesTable ar={ar} locale={locale} data={data} /> : null}
        {view === 'invoices' || view === 'payments' ? (
          <>
            {(() => {
              const moneyStats = tenantFinanceMoney(data, locale);
              const paymentMoney = tenantPaymentMoney(data, locale);
              const contractCount = tenancyContractGroups(data.contracts).length;
              const bookingCount =
                data.stays.length + data.reservations.length + data.viewings.length;
              const emptyKeys = new Set<string>();
              if (!moneyStats.hasOverdue) emptyKeys.add('overdue');
              if (!moneyStats.hasDue) emptyKeys.add('due');
              if (!moneyStats.hasDeferred) emptyKeys.add('deferred');
              if (!paymentMoney.hasRentPaid) emptyKeys.add('rentPaid');
              if (!paymentMoney.hasDepositHeld) emptyKeys.add('depositHeld');
              if (!paymentMoney.hasDepositRefunded) emptyKeys.add('depositRefunded');
              const chips: Array<{
                key: string;
                label: string;
                value: string | number;
                tone: StatusTone;
                href?: string;
              }> =
                view === 'payments'
                  ? [
                      {
                        key: 'rentPaid',
                        label: ar ? 'المدفوع للإيجار' : 'Rent paid',
                        value: paymentMoney.rentPaid,
                        tone: 'good',
                      },
                      {
                        key: 'depositHeld',
                        label: ar ? 'الضمان المحجوز' : 'Deposit held',
                        value: paymentMoney.depositHeld,
                        tone: paymentMoney.hasDepositHeld ? 'info' : 'quiet',
                      },
                      {
                        key: 'depositRefunded',
                        label: ar ? 'الضمان المسترد' : 'Deposit refunded',
                        value: paymentMoney.depositRefunded,
                        tone: paymentMoney.hasDepositRefunded ? 'good' : 'quiet',
                      },
                      {
                        key: 'overdue',
                        label: ar ? 'المتأخر' : 'Overdue',
                        value: moneyStats.overdue,
                        tone: moneyStats.hasOverdue ? 'danger' : 'quiet',
                      },
                      {
                        key: 'contracts',
                        label: ar ? 'العقود' : 'Contracts',
                        value: contractCount,
                        tone: 'info',
                        href: '/tenant/contracts',
                      },
                      {
                        key: 'bookings',
                        label: ar ? 'الحجوزات' : 'Bookings',
                        value: bookingCount,
                        tone: 'info',
                        href: '/tenant/reservations',
                      },
                    ]
                  : [
                      {
                        key: 'paid',
                        label: ar ? 'المدفوع' : 'Paid',
                        value: moneyStats.paid,
                        tone: 'good',
                      },
                      {
                        key: 'overdue',
                        label: ar ? 'المتأخر' : 'Overdue',
                        value: moneyStats.overdue,
                        tone: moneyStats.hasOverdue ? 'danger' : 'quiet',
                      },
                      {
                        key: 'due',
                        label: ar ? 'الواجب للدفع' : 'Due to pay',
                        value: moneyStats.due,
                        tone: moneyStats.hasDue ? 'action' : 'quiet',
                      },
                      {
                        key: 'deferred',
                        label: ar ? 'الآجلة' : 'Deferred',
                        value: moneyStats.deferred,
                        tone: moneyStats.hasDeferred ? 'info' : 'quiet',
                      },
                      {
                        key: 'contracts',
                        label: ar ? 'العقود' : 'Contracts',
                        value: contractCount,
                        tone: 'info',
                        href: '/tenant/contracts',
                      },
                      {
                        key: 'bookings',
                        label: ar ? 'الحجوزات' : 'Bookings',
                        value: bookingCount,
                        tone: 'info',
                        href: '/tenant/reservations',
                      },
                    ];
              return (
                <nav
                  className="tenant-home__nav tenant-home__nav--finance"
                  aria-label={ar ? 'ملخص مالي' : 'Finance summary'}
                >
                  {chips.map((chip) => {
                    const className = `tenant-home__chip tenant-home__chip--${chip.tone}${
                      chip.value === 0 || chip.value === '—' || emptyKeys.has(chip.key)
                        ? ' is-empty'
                        : ''
                    }`;
                    const body = (
                      <>
                        <span>{chip.label}</span>
                        <strong>{chip.value}</strong>
                      </>
                    );
                    return chip.href ? (
                      <Link key={chip.key} href={chip.href} className={className}>
                        {body}
                      </Link>
                    ) : (
                      <div key={chip.key} className={className}>
                        {body}
                      </div>
                    );
                  })}
                </nav>
              );
            })()}
            {longTermStatements.some((item) => item.statement.arrears.totalMinor !== '0') ? (
              <TenantArrearsSummary statements={longTermStatements} ar={ar} locale={locale} />
            ) : null}
            <Section title={ar ? 'كشف حساب العقود والشيكات' : 'Lease statements & cheques'}>
              <TenantStatements statements={longTermStatements} ar={ar} locale={locale} />
            </Section>
            <Section title={ar ? 'كل الفواتير الصادرة لك' : 'All invoices issued to you'}>
              <InvoicesTable ar={ar} locale={locale} data={data} />
            </Section>
            <Section title={ar ? 'المدفوعات المباشرة' : 'Direct payments'}>
              <PaymentsTable ar={ar} locale={locale} data={data} />
            </Section>
          </>
        ) : null}
        {view === 'requests' ? (
          <>
            <div className="tenant-space__toolbar">
              <TenantRequestLauncher
                locale={locale}
                leases={requestLeases}
                label={ar ? '＋ طلب جديد' : '＋ New request'}
                className="button button--primary"
              />
              <TenantRequestLauncher
                locale={locale}
                leases={requestLeases}
                type="maintenance"
                label={ar ? 'طلب صيانة' : 'Maintenance'}
                className="button button--quiet"
              />
              <TenantRequestLauncher
                locale={locale}
                leases={requestLeases}
                type="report_property"
                label={ar ? 'بلاغ عن العقار' : 'Report about the property'}
                className="button button--quiet"
              />
              <TenantRequestLauncher
                locale={locale}
                leases={requestLeases}
                type="report_staff"
                label={ar ? 'بلاغ عن موظف' : 'Report a staff member'}
                className="button button--quiet"
              />
            </div>
            {longTermStatements.some((item) => item.statement.arrears.totalMinor !== '0') ? (
              <TenantArrearsSummary statements={longTermStatements} ar={ar} locale={locale} />
            ) : null}
            {requestLeases.length ? null : (
              <p className="tenant-notice">
                {ar
                  ? 'تظهر إمكانية إرسال الطلبات عندما يكون لديك عقد إيجار أو إقامة يومية سارية.'
                  : 'You can send requests once you have an active lease or daily stay contract.'}
              </p>
            )}
            <TenantRequestsList requests={data.requests} locale={locale} />
          </>
        ) : null}
      </div>
    );
  }

  const liveLeases = data.leases.filter((lease) => !lease.fromStay && lease.status === 'active');
  const openInvoices = data.invoices.filter((invoice) => OPEN_INVOICE.has(invoice.status));
  const openRequests = data.requests.filter((request) => OPEN_TENANT_REQUEST.has(request.status));
  const metrics = [
    {
      key: 'bookings',
      label: ar ? 'حجوزاتي' : 'Bookings',
      value: data.stays.length + data.reservations.length + data.viewings.length,
      href: '/tenant/reservations',
      tone: 'info' as const,
    },
    {
      key: 'contracts',
      label: ar ? 'عقودي' : 'Contracts',
      value: tenancyContractGroups(data.contracts).length,
      href: '/tenant/contracts',
      tone: 'info' as const,
    },
    {
      key: 'leases',
      label: ar ? 'إيجارات سارية' : 'Active leases',
      value: liveLeases.length,
      href: '/tenant/leases',
      tone: 'good' as const,
    },
    {
      key: 'invoices',
      label: ar ? 'فواتير مستحقة' : 'Invoices due',
      value: openInvoices.length,
      href: '/tenant/invoices',
      tone: openInvoices.length ? ('danger' as const) : ('quiet' as const),
    },
    {
      key: 'requests',
      label: ar ? 'طلبات مفتوحة' : 'Open requests',
      value: openRequests.length,
      href: '/tenant/requests',
      tone: openRequests.length ? ('action' as const) : ('quiet' as const),
    },
  ];
  const alertCount = data.alerts.length;
  const spotlightLease = liveLeases[0] ?? null;

  const bookingItems = bookingPreviewItems(data, ar, locale, 4);
  const contractItems = contractPreviewItems(data, ar, locale, 4);
  const invoiceItems = invoicePreviewItems(data, ar, locale, { openOnly: true, limit: 4 });
  const leaseItems = takeRows(leasePreviewItems(data, ar, locale), 3);

  return (
    <div className="dash-shell tenant-space tenant-home">
      <header className="tenant-home__welcome">
        <div className="tenant-home__welcome-copy">
          <p className="tenant-kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</p>
          <h1>{ar ? `أهلاً، ${displayName}` : `Hello, ${displayName}`}</h1>
          <p>
            {ar
              ? 'ملخص واضح لحجوزاتك وعقودك وفواتيرك — التفاصيل بضغطة.'
              : 'A clear summary of bookings, contracts, and invoices — details one tap away.'}
          </p>
          <BadgeChips
            badges={badges}
            locale={locale}
            size={14}
            max={4}
            className="tenant-home__badges"
          />
        </div>
        <div className="tenant-home__welcome-actions">
          <Link href="/properties" className="button button--primary">
            {ar ? 'تصفّح العقارات' : 'Browse properties'}
          </Link>
          {data.statements.some((item) => !item.fromStay) ? (
            <Link href="/tenant/invoices" className="button button--quiet">
              {ar ? 'كشف حسابي' : 'My statement'}
            </Link>
          ) : null}
          {data.statements.some((item) =>
            ['active', 'cancel_requested', 'renewal_pending'].includes(item.status),
          ) ? (
            <Link href="/tenant/requests" className="button button--quiet">
              {ar ? 'طلباتي' : 'My requests'}
            </Link>
          ) : null}
          {ownerPortal ? (
            <Link href={`/${ownerPortal}`} className="button button--quiet">
              {ar ? 'مساحة المالك' : 'Owner space'}
            </Link>
          ) : null}
        </div>
      </header>
      {notice}

      {alertCount ? (
        <section
          className="tenant-home__panel tenant-home__panel--alerts has-items"
          aria-label={ar ? 'يحتاج انتباهك' : 'Needs attention'}
        >
          <div className="tenant-section__head">
            <div className="tenant-section__titles">
              <h2>{ar ? 'يحتاج انتباهك' : 'Needs your attention'}</h2>
              <p>
                {ar
                  ? 'الأهم أولاً — افتح التفاصيل عند الحاجة.'
                  : 'Most urgent first — open details when you need them.'}
              </p>
            </div>
            <span className="tenant-home__count">{alertCount}</span>
          </div>
          <AlertsList {...ctx} />
        </section>
      ) : null}

      <nav className="tenant-home__nav" aria-label={ar ? 'ملخص سريع' : 'Quick summary'}>
        {metrics.map((metric) => (
          <Link
            key={metric.key}
            href={metric.href}
            className={`tenant-home__chip tenant-home__chip--${metric.tone}${
              metric.value === 0 ? ' is-empty' : ''
            }`}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </Link>
        ))}
      </nav>

      {spotlightLease ? (
        <section
          className="tenant-home__spotlight"
          aria-label={ar ? 'إيجارك الحالي' : 'Current lease'}
        >
          <div className="tenant-home__spotlight-copy">
            <p className="tenant-kicker">{ar ? 'إيجارك الحالي' : 'Current lease'}</p>
            <h2>{tenancyUnitLabel(spotlightLease, ar)}</h2>
            <p>
              {tenancyLandlordName(spotlightLease.landlord, ar)}
              {' · '}
              {period(spotlightLease.startsOn, spotlightLease.endsOn, ar)}
            </p>
            <p className="tenant-home__spotlight-rent" dir="ltr">
              {money(spotlightLease.rentMinor, spotlightLease.currency, locale)}
              {ar ? ' / شهرياً' : ' / month'}
            </p>
          </div>
          <div className="tenant-home__spotlight-actions">
            <Status label={ar ? 'ساري' : 'Active'} tone="good" />
            {spotlightLease.contractId ? (
              <Link
                href={`/tenant/contracts/${spotlightLease.contractId}`}
                className="button button--primary button--sm"
              >
                {ar ? 'عرض العقد' : 'View contract'}
              </Link>
            ) : null}
            <Link href="/tenant/leases" className="button button--quiet button--sm">
              {ar ? 'كل الإيجارات' : 'All leases'}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="tenant-home__board">
        <Section
          className="tenant-home__card tenant-home__span"
          title={ar ? 'حجوزاتي' : 'My bookings'}
          hint={
            ar
              ? 'معاينات وإقامات وحجوزات الإيجار أو الشراء.'
              : 'Viewings, stays, and rent or purchase bookings.'
          }
          more={{ href: '/tenant/reservations', label: ar ? 'الكل' : 'All' }}
        >
          <PreviewList
            items={bookingItems}
            ar={ar}
            empty={ar ? 'لا حجوزات بعد.' : 'No bookings yet.'}
          />
        </Section>

        <Section
          className="tenant-home__card"
          title={ar ? 'عقودي' : 'My contracts'}
          more={{ href: '/tenant/contracts', label: ar ? 'الكل' : 'All' }}
        >
          <PreviewList
            items={contractItems}
            ar={ar}
            empty={ar ? 'لا عقود بعد.' : 'No contracts yet.'}
          />
        </Section>

        <Section
          className="tenant-home__card"
          title={ar ? 'فواتير مستحقة' : 'Invoices due'}
          more={{ href: '/tenant/invoices', label: ar ? 'الكل' : 'All' }}
        >
          <PreviewList
            items={invoiceItems}
            ar={ar}
            empty={ar ? 'لا فواتير مستحقة.' : 'Nothing due.'}
          />
        </Section>

        {leaseItems.length ? (
          <Section
            className="tenant-home__card tenant-home__span"
            title={ar ? 'إيجاراتي' : 'My leases'}
            more={{ href: '/tenant/leases', label: ar ? 'الكل' : 'All' }}
          >
            <PreviewList
              items={leaseItems}
              ar={ar}
              empty={ar ? 'لا إيجارات بعد.' : 'No leases yet.'}
            />
          </Section>
        ) : null}
      </div>
    </div>
  );
}
