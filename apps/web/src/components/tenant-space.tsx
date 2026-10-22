'use client';

import { EmptyState } from '@bhd-r/ui';
import {
  Children,
  cloneElement,
  isValidElement,
  useState,
  type ReactNode,
} from 'react';
import { formatMoney } from '@/lib/format';
import { BadgeChips } from '@/components/badges/badge-chips';
import { ModalPortal } from '@/components/modal-portal';
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
} from '@/lib/stay-booking-payment-labels';
import {
  invoiceOutstandingMinor,
  reservationHref,
  stayHref,
  tenancyAlertLabel,
  tenancyContractGroups,
  tenancyContractKindLabel,
  tenancyLandlordName,
  tenancyUnitLabel,
  viewingHref,
  type MyTenancy,
  type TenancyContract,
  type TenancyDepositRefund,
} from '@/lib/tenancy-shared';
import { OPEN_TENANT_REQUEST } from '@/lib/tenant-requests-shared';
import {
  TENANT_SPACE_SECTIONS,
  type TenantSpaceView,
} from '@/lib/tenant-soft-nav';
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

function period(from: string | null, to: string | null, ar: boolean): string {
  if (!from && !to) return '—';
  return `${formatDate(from, ar)} ${ar ? '←' : '→'} ${formatDate(to, ar)}`;
}

function money(amountMinor: string | null, currency: string | null, locale: string): string {
  return amountMinor && currency ? formatMoney(amountMinor, currency, locale) : '—';
}

/** Rows are `<tr>` of `<td>` in `head` order; each cell gets its header as `data-label` for phone cards. */
function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const rows = Children.map(children, (row) =>
    isValidElement<{ children?: ReactNode }>(row)
      ? cloneElement(
          row,
          undefined,
          Children.map(row.props.children, (cell, index) =>
            isValidElement<{ 'data-label'?: string }>(cell) && head[index]
              ? cloneElement(cell, { 'data-label': head[index] })
              : cell,
          ),
        )
      : row,
  );
  return (
    <div className="data-table-wrap tenant-table-wrap">
      <table className="data-table data-table--stack tenant-table">
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

type StatusTone = 'action' | 'good' | 'danger' | 'warn' | 'info' | 'quiet';

function Status({ label, tone }: { label: string; tone?: StatusTone | undefined }) {
  return <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>{label}</span>;
}

function alertTone(kind: string, action: boolean): string {
  if (action || kind.includes('overdue') || kind === 'deposit_dispute') return 'danger';
  if (kind.includes('sign') || kind.includes('payment') || kind.includes('pending')) return 'action';
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
  status?: ReactNode;
  tone?: string;
  facts: PreviewFact[];
  /** Rich body for complex records (statements, request threads). */
  detail?: ReactNode;
  href?: string | null;
  hrefLabel?: string | null;
};

function takeRows<T>(rows: T[], limit?: number): T[] {
  return limit != null ? rows.slice(0, limit) : rows;
}

/** Title row + «استعراض» modal — keeps the home wide and light on every screen. */
function PreviewList({
  items,
  ar,
  empty,
}: {
  items: PreviewItem[];
  ar: boolean;
  empty: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;
  if (!items.length) {
    return <p className="tenant-home__calm">{empty}</p>;
  }
  return (
    <>
      <ul className="tenant-preview-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`tenant-preview-row${item.tone ? ` tenant-preview-row--${item.tone}` : ''}`}
          >
            <div className="tenant-preview-row__copy">
              {item.eyebrow ? (
                <span className="tenant-preview-row__eyebrow">{item.eyebrow}</span>
              ) : null}
              <strong className="tenant-preview-row__title">{item.title}</strong>
              {item.summary ? (
                <span className="tenant-preview-row__summary">{item.summary}</span>
              ) : null}
            </div>
            <div className="tenant-preview-row__side">
              {item.status}
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setOpenId(item.id)}
              >
                {ar ? 'استعراض' : 'Review'}
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
                {open.detail ? <div className="tenant-detail-modal__detail">{open.detail}</div> : null}
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

function contractStatusCell(contract: TenancyContract, ar: boolean) {
  const awaitingMe =
    ['sent', 'partially_signed'].includes(contract.status) && !contract.tenantSigned;
  const cancelled = contract.status === 'terminated' || contract.status === 'void';
  return (
    <Status
      label={
        awaitingMe
          ? ar
            ? 'بانتظار توقيعك'
            : 'Awaiting your signature'
          : cancelled
            ? ar
              ? 'ملغى'
              : 'Cancelled'
            : domainStatusLabel(contract.status, ar)
      }
      tone={
        awaitingMe
          ? 'action'
          : cancelled
            ? 'quiet'
            : contract.status === 'signed'
              ? 'good'
              : 'info'
      }
    />
  );
}

function ContractsTable({ ar, locale, data }: Ctx) {
  const groups = tenancyContractGroups(data.contracts);
  if (!groups.length) return <EmptyState title={ar ? 'لا عقود بعد' : 'No contracts yet'} />;
  return (
    <ul className="tenant-contract-list">
      {groups.map(({ root: contract, attachments }) => (
        <li key={contract.id} className="tenant-contract-card">
          <div className="tenant-contract-card__main">
            <div className="tenant-contract-card__head">
              <bdi className="tenant-contract-card__ref">{contract.reference}</bdi>
              {contractStatusCell(contract, ar)}
            </div>
            <dl className="tenant-contract-card__meta">
              <div>
                <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
                <dd>
                  {tenancyUnitLabel(contract, ar)}
                  {contract.stayReference ? (
                    <small className="tenant-table__sub">
                      {ar ? 'إقامة يومية' : 'Daily stay'} · <bdi>{contract.stayReference}</bdi>
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'المالك' : 'Landlord'}</dt>
                <dd>{tenancyLandlordName(contract.landlord, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'المدة' : 'Term'}</dt>
                <dd>{period(contract.startsOn, contract.endsOn, ar)}</dd>
              </div>
              <div>
                <dt>{ar ? 'القيمة' : 'Value'}</dt>
                <dd>{money(contract.amountMinor, contract.currency, locale)}</dd>
              </div>
            </dl>
            {attachments.length ? (
              <details className="tenant-contract-attach">
                <summary>
                  {ar ? `المرفقات (${attachments.length})` : `Attached (${attachments.length})`}
                </summary>
                <ul>
                  {attachments.map((item) => (
                    <li key={item.id}>
                      <Link href={`/tenant/contracts/${item.id}`}>
                        <bdi>{item.reference}</bdi>
                      </Link>
                      <span>
                        {tenancyContractKindLabel(item.kind, ar)} ·{' '}
                        {domainStatusLabel(item.status, ar)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <Link className="button button--secondary" href={`/tenant/contracts/${contract.id}`}>
            {ar ? 'عرض العقد' : 'View contract'}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LeasesTable({ ar, locale, data }: Ctx) {
  if (!data.leases.length) return <EmptyState title={ar ? 'لا إيجارات' : 'No leases'} />;
  return (
    <Table
      head={
        ar
          ? ['الوحدة', 'المالك', 'النوع', 'المدة', 'الإيجار', 'الحالة', '']
          : ['Unit', 'Landlord', 'Type', 'Term', 'Rent', 'Status', '']
      }
    >
      {data.leases.map((lease) => (
        <tr key={lease.id}>
          <td>{tenancyUnitLabel(lease, ar)}</td>
          <td>{tenancyLandlordName(lease.landlord, ar)}</td>
          <td>{lease.fromStay ? (ar ? 'إقامة يومية' : 'Daily stay') : ar ? 'إيجار' : 'Lease'}</td>
          <td>{period(lease.startsOn, lease.endsOn, ar)}</td>
          <td>{money(lease.rentMinor, lease.currency, locale)}</td>
          <td>
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
          </td>
          <td>
            {lease.contractId ? (
              <Link className="ops-action" href={`/tenant/contracts/${lease.contractId}`}>
                {ar ? 'العقد' : 'Contract'}
              </Link>
            ) : null}
          </td>
        </tr>
      ))}
    </Table>
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
  const rows = openOnly
    ? data.invoices.filter((invoice) => OPEN_INVOICE.has(invoice.status))
    : data.invoices;
  if (!rows.length) {
    return (
      <EmptyState
        title={
          openOnly ? (ar ? 'لا فواتير مستحقة' : 'Nothing due') : ar ? 'لا فواتير' : 'No invoices'
        }
      />
    );
  }
  return (
    <Table
      head={
        ar
          ? ['الفاتورة', 'المالك', 'تاريخ الإصدار', 'الاستحقاق', 'الإجمالي', 'المتبقي', 'الحالة', '']
          : ['Invoice', 'Landlord', 'Issued', 'Due', 'Total', 'Outstanding', 'Status', '']
      }
    >
      {rows.map((invoice) => {
        const refundStatus = depositRefundStatusCell(invoice.depositRefund, ar);
        return (
          <tr key={invoice.id}>
            <td className="tenant-table__ref">
              <bdi>{invoice.number}</bdi>
              {invoice.stayReference ? (
                <small className="tenant-table__sub">
                  {ar ? 'إقامة يومية' : 'Daily stay'}
                </small>
              ) : null}
            </td>
            <td>{tenancyLandlordName(invoice.landlord, ar)}</td>
            <td>{formatDate(invoice.issuedOn, ar)}</td>
            <td>{formatDate(invoice.dueOn, ar)}</td>
            <td>{money(invoice.totalMinor, invoice.currency, locale)}</td>
            <td>{money(invoiceOutstandingMinor(invoice), invoice.currency, locale)}</td>
            <td>
              {refundStatus ?? (
                <Status
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
              )}
            </td>
            <td>
              <span className="tenant-doc-links">
                {invoice.receiptHref ? (
                  <Link
                    className="tenant-doc-link tenant-doc-link--receipt"
                    href={invoice.receiptHref}
                  >
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
              </span>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function PaymentsTable({ ar, locale, data }: Ctx) {
  if (!data.payments.length) return <EmptyState title={ar ? 'لا مدفوعات' : 'No payments'} />;
  return (
    <Table
      head={
        ar
          ? ['التاريخ', 'المرجع', 'المالك', 'المبلغ', 'المسترد', 'الطريقة', 'الحالة', '']
          : ['Date', 'Reference', 'Landlord', 'Amount', 'Refunded', 'Method', 'Status', '']
      }
    >
      {data.payments.map((payment) => {
        const refundStatus =
          payment.stayKind === 'deposit'
            ? depositRefundStatusCell(payment.depositRefund, ar)
            : null;
        return (
          <tr key={payment.id}>
            <td>{formatDate(payment.receivedAt, ar)}</td>
            <td className="tenant-table__ref">
              <bdi>{payment.invoiceNumber}</bdi>
              {payment.stayKind ? (
                <small className="tenant-table__sub">
                  {stayPaymentKindLabel(payment.stayKind, ar)}
                </small>
              ) : null}
            </td>
            <td>{tenancyLandlordName(payment.landlord, ar)}</td>
            <td>{money(payment.amountMinor, payment.currency, locale)}</td>
            <td>
              {payment.refundedMinor !== '0'
                ? money(payment.refundedMinor, payment.currency, locale)
                : '—'}
            </td>
            <td>
              {payment.stayReference
                ? stayPaymentMethodLabel(payment.method, ar)
                : payment.method}
            </td>
            <td>
              {refundStatus ?? (
                <Status
                  label={domainStatusLabel(payment.status, ar)}
                  tone={payment.status === 'succeeded' ? 'good' : undefined}
                />
              )}
            </td>
            <td>
              <span className="tenant-doc-links">
                {payment.receiptHref ? (
                  <Link
                    className="tenant-doc-link tenant-doc-link--receipt"
                    href={payment.receiptHref}
                  >
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
              </span>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function AlertsList({ ar, locale, data }: Ctx) {
  const items: PreviewItem[] = data.alerts.map((alert) => {
    const meta = [
      alert.date ? formatDate(alert.date, ar) : '',
      alert.amountMinor && alert.currency
        ? formatMoney(alert.amountMinor, alert.currency, locale)
        : '',
    ].filter(Boolean);
    return {
      id: `alert:${alert.kind}:${alert.id}`,
      title: tenancyAlertLabel(alert.kind, ar),
      eyebrow: ar ? 'تنبيه' : 'Alert',
      summary: [alert.reference, ...meta].filter(Boolean).join(' · '),
      tone: alertTone(alert.kind, alert.action),
      status: alert.action ? (
        <Status label={ar ? 'يتطلب إجراءً' : 'Action needed'} tone="action" />
      ) : undefined,
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
      summary: period(stay.checkInOn, stay.checkOutOn, ar),
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
        { label: ar ? 'الفترة' : 'Dates', value: period(stay.checkInOn, stay.checkOutOn, ar) },
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
        reservation.mode === 'sale' ? (ar ? 'حجز شراء' : 'Purchase booking') : ar ? 'حجز إيجار' : 'Rent booking',
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
      ...(href ? { hrefLabel: ar ? 'متابعة الحجز' : 'Continue' } : {}),
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
  return takeRows(tenancyContractGroups(data.contracts), limit).map(
    ({ root: contract, attachments }) => ({
      id: `contract:${contract.id}`,
      title: contract.reference,
      eyebrow: contract.stayReference
        ? ar
          ? 'عقد إقامة يومية'
          : 'Daily stay contract'
        : ar
          ? 'عقد إيجار'
          : 'Lease contract',
      summary: `${tenancyUnitLabel(contract, ar)} · ${period(contract.startsOn, contract.endsOn, ar)}`,
      status: contractStatusCell(contract, ar),
      facts: [
        { label: ar ? 'الوحدة' : 'Unit', value: tenancyUnitLabel(contract, ar) },
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(contract.landlord, ar) },
        { label: ar ? 'المدة' : 'Term', value: period(contract.startsOn, contract.endsOn, ar) },
        {
          label: ar ? 'القيمة' : 'Value',
          value: money(contract.amountMinor, contract.currency, locale),
        },
        ...(attachments.length
          ? [
              {
                label: ar ? 'المرفقات' : 'Attachments',
                value: String(attachments.length),
              },
            ]
          : []),
      ],
      href: `/tenant/contracts/${contract.id}`,
      hrefLabel: ar ? 'عرض العقد' : 'View contract',
    }),
  );
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
          value: money(invoiceOutstandingMinor(invoice), invoice.currency, locale),
        },
      ],
      ...(href
        ? { href, hrefLabel: ar ? 'إيصال القبض' : 'Receipt' }
        : {}),
    } satisfies PreviewItem;
  });
}

function leasePreviewItems(data: MyTenancy, ar: boolean, locale: string): PreviewItem[] {
  return data.leases.map((lease) => ({
    id: `lease:${lease.id}`,
    title: tenancyUnitLabel(lease, ar),
    eyebrow: lease.fromStay
      ? ar
        ? 'إقامة يومية'
        : 'Daily stay'
      : ar
        ? 'إيجار'
        : 'Lease',
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

function paymentPreviewItems(data: MyTenancy, ar: boolean, locale: string): PreviewItem[] {
  return data.payments.map((payment) => {
    const href = payment.receiptHref ?? null;
    return {
      id: `payment:${payment.id}`,
      title: payment.invoiceNumber || payment.id.slice(0, 8),
      eyebrow: payment.stayKind
        ? stayPaymentKindLabel(payment.stayKind, ar)
        : ar
          ? 'دفعة'
          : 'Payment',
      summary: `${tenancyLandlordName(payment.landlord, ar)} · ${formatDate(payment.receivedAt, ar)}`,
      status: (
        <Status
          label={domainStatusLabel(payment.status, ar)}
          tone={payment.status === 'succeeded' ? 'good' : undefined}
        />
      ),
      facts: [
        { label: ar ? 'المالك' : 'Landlord', value: tenancyLandlordName(payment.landlord, ar) },
        { label: ar ? 'التاريخ' : 'Date', value: formatDate(payment.receivedAt, ar) },
        {
          label: ar ? 'المبلغ' : 'Amount',
          value: money(payment.amountMinor, payment.currency, locale),
        },
        {
          label: ar ? 'المسترد' : 'Refunded',
          value:
            payment.refundedMinor !== '0'
              ? money(payment.refundedMinor, payment.currency, locale)
              : '—',
        },
        {
          label: ar ? 'الطريقة' : 'Method',
          value: payment.stayReference
            ? stayPaymentMethodLabel(payment.method, ar)
            : payment.method,
        },
      ],
      ...(href ? { href, hrefLabel: ar ? 'إيصال القبض' : 'Receipt' } : {}),
    } satisfies PreviewItem;
  });
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
      'كشف أقساط العقود والشيكات والمتأخرات، مع إيصالات القبض والفواتير، ثم المدفوعات المباشرة.',
    ],
    en: [
      'My payments & invoices',
      'Lease installments, cheques and arrears with receipts and invoices, then direct payments.',
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
        {view === 'bookings' ? (
          <PreviewList
            items={bookingPreviewItems(data, ar, locale)}
            ar={ar}
            empty={ar ? 'لا حجوزات بعد.' : 'No bookings yet.'}
          />
        ) : null}
        {view === 'contracts' ? (
          <PreviewList
            items={contractPreviewItems(data, ar, locale)}
            ar={ar}
            empty={ar ? 'لا عقود بعد.' : 'No contracts yet.'}
          />
        ) : null}
        {view === 'leases' ? (
          <PreviewList
            items={leasePreviewItems(data, ar, locale)}
            ar={ar}
            empty={ar ? 'لا إيجارات.' : 'No leases.'}
          />
        ) : null}
        {view === 'invoices' || view === 'payments' ? (
          <>
            {longTermStatements.some((item) => item.statement.arrears.totalMinor !== '0') ? (
              <TenantArrearsSummary statements={longTermStatements} ar={ar} locale={locale} />
            ) : null}
            <Section title={ar ? 'كشف حساب العقود والشيكات' : 'Lease statements & cheques'}>
              <TenantStatements statements={longTermStatements} ar={ar} locale={locale} />
            </Section>
            <Section title={ar ? 'كل الفواتير الصادرة لك' : 'All invoices issued to you'}>
              <PreviewList
                items={invoicePreviewItems(data, ar, locale)}
                ar={ar}
                empty={ar ? 'لا فواتير.' : 'No invoices.'}
              />
            </Section>
            <Section title={ar ? 'المدفوعات المباشرة' : 'Direct payments'}>
              <PreviewList
                items={paymentPreviewItems(data, ar, locale)}
                ar={ar}
                empty={ar ? 'لا مدفوعات.' : 'No payments.'}
              />
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

  const bookingItems = bookingPreviewItems(data, ar, locale, 4);
  const contractItems = contractPreviewItems(data, ar, locale, 4);
  const invoiceItems = invoicePreviewItems(data, ar, locale, { openOnly: true, limit: 4 });

  return (
    <div className="dash-shell tenant-space tenant-home">
      <header className="tenant-home__welcome">
        <div className="tenant-home__welcome-copy">
          <p className="tenant-kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</p>
          <h1>{ar ? `أهلاً، ${displayName}` : `Hello, ${displayName}`}</h1>
          <p>
            {ar
              ? 'عناوين واضحة، والتفاصيل بضغطة «استعراض».'
              : 'Clear titles — open details with Review.'}
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

      <section
        className={`tenant-home__panel${alertCount ? ' has-items' : ''}`}
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
          {alertCount ? <span className="tenant-home__count">{alertCount}</span> : null}
        </div>
        <AlertsList {...ctx} />
      </section>

      <Section
        title={ar ? 'حجوزاتي' : 'My bookings'}
        hint={ar ? 'معاينات وإقامات وحجوزات — عناوين فقط.' : 'Viewings, stays, and bookings as titles.'}
        more={{ href: '/tenant/reservations', label: ar ? 'الكل' : 'All' }}
      >
        <PreviewList
          items={bookingItems}
          ar={ar}
          empty={ar ? 'لا حجوزات بعد.' : 'No bookings yet.'}
        />
      </Section>

      <div className="tenant-home__split">
        <Section
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
          title={ar ? 'فواتير مستحقة' : 'Invoices due'}
          more={{ href: '/tenant/invoices', label: ar ? 'الكل' : 'All' }}
        >
          <PreviewList
            items={invoiceItems}
            ar={ar}
            empty={ar ? 'لا فواتير مستحقة.' : 'Nothing due.'}
          />
        </Section>
      </div>
    </div>
  );
}
