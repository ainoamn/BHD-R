'use client';

import { EmptyState } from '@bhd-r/ui';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { formatMoney } from '@/lib/format';
import { BadgeChips } from '@/components/badges/badge-chips';
import { SoftPortalLink as Link } from '@/components/soft-portal-link';
import { TenantBookingsBoard } from '@/components/tenant-bookings-board';
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
  tenancyAlertLabel,
  tenancyContractGroups,
  tenancyContractKindLabel,
  tenancyLandlordName,
  tenancyUnitLabel,
  type MyTenancy,
  type TenancyContract,
  type TenancyDepositRefund,
} from '@/lib/tenancy-shared';
import { OPEN_TENANT_REQUEST } from '@/lib/tenant-requests-shared';
import {
  TENANT_SPACE_SECTIONS,
  type TenantSpaceView,
} from '@/lib/tenant-soft-nav';
import { domainStatusLabel } from '@/lib/ui-labels';

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

function Status({
  label,
  tone,
}: {
  label: string;
  tone?: 'action' | 'good' | 'danger' | undefined;
}) {
  return <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>{label}</span>;
}

function contractStatusCell(contract: TenancyContract, ar: boolean) {
  const awaitingMe =
    ['sent', 'partially_signed'].includes(contract.status) && !contract.tenantSigned;
  return (
    <Status
      label={
        awaitingMe
          ? ar
            ? 'بانتظار توقيعك'
            : 'Awaiting your signature'
          : domainStatusLabel(contract.status, ar)
      }
      tone={awaitingMe ? 'action' : contract.status === 'signed' ? 'good' : undefined}
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
              tone={lease.status === 'active' ? 'good' : undefined}
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
              {invoice.receiptHref ? (
                <Link className="tenant-doc-link tenant-doc-link--receipt" href={invoice.receiptHref}>
                  {ar ? 'إيصال القبض' : 'Receipt'}
                </Link>
              ) : OPEN_INVOICE.has(invoice.status) ? (
                <span className="tenant-doc-link tenant-doc-link--invoice">
                  {ar ? 'الفاتورة' : 'Invoice'}
                </span>
              ) : null}
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
              {payment.receiptHref ? (
                <Link className="tenant-doc-link tenant-doc-link--receipt" href={payment.receiptHref}>
                  {ar ? 'إيصال القبض' : 'Receipt'}
                </Link>
              ) : null}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function AlertsList({ ar, locale, data }: Ctx) {
  if (!data.alerts.length) {
    return (
      <p className="dash-alerts__empty">
        {ar ? 'لا شيء يحتاج انتباهك الآن.' : 'Nothing needs your attention right now.'}
      </p>
    );
  }
  return (
    <ul className="tenant-alerts">
      {data.alerts.map((alert) => (
        <li key={`${alert.kind}:${alert.id}`}>
          <Link
            href={alert.href}
            className={`tenant-alert${alert.action ? ' tenant-alert--action' : ''}`}
          >
            <strong>{tenancyAlertLabel(alert.kind, ar)}</strong>
            <bdi className="tenant-alert__ref">{alert.reference}</bdi>
            <span className="tenant-alert__meta">
              {[
                alert.date ? formatDate(alert.date, ar) : '',
                alert.amountMinor && alert.currency
                  ? formatMoney(alert.amountMinor, alert.currency, locale)
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  hint,
  more,
  children,
}: {
  title: string;
  hint?: string;
  more?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="tenant-section">
      <div className="dash-section-head dash-section-head--compact">
        <h2>{title}</h2>
        {more ? (
          <Link href={more.href} className="button button--quiet button--tiny">
            {more.label}
          </Link>
        ) : hint ? (
          <p className="dash-section-hint">{hint}</p>
        ) : null}
      </div>
      {children}
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
    if (view === 'bookings') {
      return (
        <div className="dash-shell tenant-space tenant-space--bookings">
          <header className="tenant-bookings-hero">
            <div className="tenant-bookings-hero__copy">
              <span className="tenant-kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</span>
              <h1>{title}</h1>
              <p>{hint}</p>
            </div>
            <div className="tenant-bookings-hero__actions">
              <Link href="/properties" className="button button--primary">
                {ar ? 'تصفّح العقارات' : 'Browse properties'}
              </Link>
              <Link href="/tenant" className="button button--quiet">
                {ar ? 'لوحة المستأجر' : 'Tenant dashboard'}
              </Link>
            </div>
          </header>
          {notice}
          <TenantBookingsBoard
            locale={locale}
            data={{
              viewings: data.viewings,
              stays: data.stays,
              reservations: data.reservations,
            }}
          />
        </div>
      );
    }
    return (
      <div className="dash-shell tenant-space tenant-space--lists">
        <header className="portal-topbar">
          <div>
            <span className="tenant-kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</span>
            <h1>{title}</h1>
            <p>{hint}</p>
          </div>
          <Link href="/tenant" className="button button--quiet">
            {ar ? 'لوحة المستأجر' : 'Tenant dashboard'}
          </Link>
        </header>
        {notice}
        {view === 'contracts' ? (
          <ContractsTable {...ctx} />
        ) : view === 'leases' ? (
          <LeasesTable {...ctx} />
        ) : view === 'invoices' || view === 'payments' ? (
          <>
            {data.statements.some(
              (item) => !item.fromStay && item.statement.arrears.totalMinor !== '0',
            ) ? (
              <TenantArrearsSummary
                statements={data.statements.filter((item) => !item.fromStay)}
                ar={ar}
                locale={locale}
              />
            ) : null}
            <Section title={ar ? 'كشف حساب العقود والشيكات' : 'Lease statements & cheques'}>
              <TenantStatements
                statements={data.statements.filter((item) => !item.fromStay)}
                ar={ar}
                locale={locale}
              />
            </Section>
            <Section title={ar ? 'كل الفواتير الصادرة لك' : 'All invoices issued to you'}>
              <InvoicesTable {...ctx} />
            </Section>
            <Section title={ar ? 'المدفوعات المباشرة' : 'Direct payments'}>
              <PaymentsTable {...ctx} />
            </Section>
          </>
        ) : view === 'requests' ? (
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
            {data.statements.some(
              (item) => !item.fromStay && item.statement.arrears.totalMinor !== '0',
            ) ? (
              <TenantArrearsSummary
                statements={data.statements.filter((item) => !item.fromStay)}
                ar={ar}
                locale={locale}
              />
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
    },
    {
      key: 'contracts',
      label: ar ? 'عقودي' : 'Contracts',
      value: tenancyContractGroups(data.contracts).length,
      href: '/tenant/contracts',
    },
    {
      key: 'leases',
      label: ar ? 'إيجارات سارية' : 'Active leases',
      value: liveLeases.length,
      href: '/tenant/leases',
    },
    {
      key: 'invoices',
      label: ar ? 'فواتير مستحقة' : 'Invoices due',
      value: openInvoices.length,
      href: '/tenant/invoices',
    },
    {
      key: 'requests',
      label: ar ? 'طلبات مفتوحة' : 'Open requests',
      value: openRequests.length,
      href: '/tenant/requests',
    },
  ];

  return (
    <div className="dash-shell tenant-space">
      <header className="dash-hero">
        <div className="dash-hero__copy">
          <p className="dash-hero__kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</p>
          <h1>{ar ? `أهلاً ${displayName}` : `Welcome, ${displayName}`}</h1>
          <BadgeChips
            badges={badges}
            locale={locale}
            size={20}
            max={6}
            labelled
            className="property-360__badges"
          />
          <p className="dash-hero__lede">
            {ar
              ? 'كل ما استأجرته أو حجزته لدى الملاك على المنصة: الحجوزات والعقود والإيجارات والفواتير. أما عقاراتك التي تؤجّرها أنت ففي مساحة المالك.'
              : 'Everything you rent or booked from landlords on the platform: bookings, contracts, leases and invoices. Properties you let out yourself live in the owner space.'}
          </p>
        </div>
        <div className="dash-hero__actions">
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

      <section className="dash-alerts" aria-label={ar ? 'يحتاج انتباهك' : 'Needs attention'}>
        <div className="dash-section-head dash-section-head--compact">
          <h2>{ar ? 'يحتاج انتباهك' : 'Needs your attention'}</h2>
          <p className="dash-section-hint">
            {ar
              ? 'توقيع وسداد وحجوزات تنتظرك، الأهم أولاً.'
              : 'Signatures, payments and bookings waiting on you, most urgent first.'}
          </p>
        </div>
        <AlertsList {...ctx} />
      </section>

      <section className="dash-metrics-block" aria-label={ar ? 'ملخص' : 'Summary'}>
        <div className="dash-metrics">
          {metrics.map((metric, index) => (
            <Link
              key={metric.key}
              href={metric.href}
              className={`dash-metric dash-metric--${index + 1}`}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </Link>
          ))}
        </div>
      </section>

      <Section
        title={ar ? 'حجوزاتي' : 'My bookings'}
        more={{ href: '/tenant/reservations', label: ar ? 'كل الحجوزات' : 'All bookings' }}
      >
        {data.viewings.length || data.stays.length || data.reservations.length ? (
          <TenantBookingsBoard
            locale={locale}
            compact
            data={{
              viewings: data.viewings.slice(0, 4),
              stays: data.stays.slice(0, 4),
              reservations: data.reservations.slice(0, 4),
            }}
          />
        ) : (
          <EmptyState title={ar ? 'لا حجوزات بعد' : 'No bookings yet'} />
        )}
      </Section>
      <Section
        title={ar ? 'عقودي' : 'My contracts'}
        more={{ href: '/tenant/contracts', label: ar ? 'كل العقود' : 'All contracts' }}
      >
        <ContractsTable
          {...ctx}
          data={{
            ...data,
            contracts: tenancyContractGroups(data.contracts)
              .slice(0, 5)
              .flatMap(({ root, attachments }) => [root, ...attachments]),
          }}
        />
      </Section>
      <Section
        title={ar ? 'فواتير مستحقة' : 'Invoices due'}
        more={{ href: '/tenant/invoices', label: ar ? 'كل الفواتير' : 'All invoices' }}
      >
        <InvoicesTable {...ctx} openOnly />
      </Section>
    </div>
  );
}
