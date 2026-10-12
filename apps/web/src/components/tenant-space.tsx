import { EmptyState } from '@bhd-r/ui';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { loadMyTenancy } from '@/lib/tenancy-neon';
import {
  EMPTY_TENANCY,
  invoiceOutstandingMinor,
  reservationHref,
  stayHref,
  tenancyAlertLabel,
  tenancyLandlordName,
  tenancyUnitLabel,
  type MyTenancy,
} from '@/lib/tenancy-shared';
import { domainStatusLabel, stayStatusLabel } from '@/lib/ui-labels';
import { requirePortal } from '@/lib/viewer';

export type TenantSpaceView =
  'overview' | 'bookings' | 'contracts' | 'leases' | 'invoices' | 'payments';

export const TENANT_SPACE_SECTIONS: Record<string, TenantSpaceView> = {
  reservations: 'bookings',
  contracts: 'contracts',
  leases: 'leases',
  invoices: 'invoices',
  payments: 'payments',
};

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

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="ops-panel data-table-wrap">
      <table className="data-table tenant-table">
        <thead>
          <tr>
            {head.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Status({ label, tone }: { label: string; tone?: 'action' | 'good' | undefined }) {
  return <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>{label}</span>;
}

function StaysTable({ ar, locale, data }: Ctx) {
  if (!data.stays.length) return <EmptyState title={ar ? 'لا إقامات يومية' : 'No daily stays'} />;
  return (
    <Table
      head={
        ar
          ? ['المرجع', 'المكان', 'الفترة', 'المبلغ', 'الحالة', '']
          : ['Reference', 'Place', 'Dates', 'Amount', 'Status', '']
      }
    >
      {data.stays.map((stay) => (
        <tr key={stay.id}>
          <td className="tenant-table__ref">
            <bdi>{stay.referenceCode}</bdi>
          </td>
          <td>{(ar ? stay.titleAr || stay.titleEn : stay.titleEn || stay.titleAr) ?? '—'}</td>
          <td>{period(stay.checkInOn, stay.checkOutOn, ar)}</td>
          <td>{money(stay.totalMinor, stay.currency, locale)}</td>
          <td>
            <Status
              label={stayStatusLabel(stay.status, ar)}
              tone={
                ['payment_pending', 'payment_failed'].includes(stay.status) ? 'action' : undefined
              }
            />
          </td>
          <td>
            <Link className="ops-action" href={stayHref(stay)}>
              {ar ? 'فتح الحجز' : 'Open booking'}
            </Link>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function ReservationsTable({ ar, locale, data }: Ctx) {
  if (!data.reservations.length) {
    return <EmptyState title={ar ? 'لا حجوزات إيجار أو شراء' : 'No rent or purchase bookings'} />;
  }
  return (
    <Table
      head={
        ar
          ? ['المرجع', 'الوحدة', 'المالك', 'النوع', 'الضمان', 'صالح حتى', 'الحالة', '']
          : ['Reference', 'Unit', 'Landlord', 'Type', 'Deposit', 'Valid until', 'Status', '']
      }
    >
      {data.reservations.map((reservation) => {
        const href = reservationHref(reservation);
        return (
          <tr key={reservation.id}>
            <td className="tenant-table__ref">
              <bdi>{reservation.referenceCode ?? reservation.id.slice(0, 8)}</bdi>
            </td>
            <td>{tenancyUnitLabel(reservation, ar)}</td>
            <td>{tenancyLandlordName(reservation.landlord, ar)}</td>
            <td>
              {reservation.mode === 'sale' ? (ar ? 'شراء' : 'Purchase') : ar ? 'إيجار' : 'Rent'}
            </td>
            <td>{money(reservation.depositMinor, reservation.currency, locale)}</td>
            <td>{formatDate(reservation.expiresAt, ar)}</td>
            <td>
              <Status
                label={
                  reservation.status === 'pending' && reservation.awaitingPayment
                    ? ar
                      ? 'بانتظار دفع الضمان'
                      : 'Deposit payment due'
                    : domainStatusLabel(reservation.status, ar)
                }
                tone={
                  reservation.status === 'pending' && reservation.awaitingPayment
                    ? 'action'
                    : undefined
                }
              />
            </td>
            <td>
              {href ? (
                <Link className="ops-action" href={href}>
                  {ar ? 'متابعة الحجز' : 'Continue'}
                </Link>
              ) : null}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

function ContractsTable({ ar, locale, data }: Ctx) {
  if (!data.contracts.length) return <EmptyState title={ar ? 'لا عقود بعد' : 'No contracts yet'} />;
  return (
    <Table
      head={
        ar
          ? ['العقد', 'الوحدة', 'المالك', 'المدة', 'القيمة', 'الحالة', '']
          : ['Contract', 'Unit', 'Landlord', 'Term', 'Value', 'Status', '']
      }
    >
      {data.contracts.map((contract) => {
        const awaitingMe =
          ['sent', 'partially_signed'].includes(contract.status) && !contract.tenantSigned;
        return (
          <tr key={contract.id}>
            <td className="tenant-table__ref">
              <bdi>{contract.reference}</bdi>
            </td>
            <td>
              {tenancyUnitLabel(contract, ar)}
              {contract.stayReference ? (
                <small className="tenant-table__sub">
                  {ar ? 'إقامة يومية' : 'Daily stay'} · <bdi>{contract.stayReference}</bdi>
                </small>
              ) : null}
            </td>
            <td>{tenancyLandlordName(contract.landlord, ar)}</td>
            <td>{period(contract.startsOn, contract.endsOn, ar)}</td>
            <td>{money(contract.amountMinor, contract.currency, locale)}</td>
            <td>
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
            </td>
            <td>
              <Link className="ops-action" href={`/tenant/contracts/${contract.id}`}>
                {ar ? 'عرض العقد' : 'View contract'}
              </Link>
            </td>
          </tr>
        );
      })}
    </Table>
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
          ? ['الفاتورة', 'المالك', 'تاريخ الإصدار', 'الاستحقاق', 'الإجمالي', 'المتبقي', 'الحالة']
          : ['Invoice', 'Landlord', 'Issued', 'Due', 'Total', 'Outstanding', 'Status']
      }
    >
      {rows.map((invoice) => (
        <tr key={invoice.id}>
          <td className="tenant-table__ref">
            <bdi>{invoice.number}</bdi>
          </td>
          <td>{tenancyLandlordName(invoice.landlord, ar)}</td>
          <td>{formatDate(invoice.issuedOn, ar)}</td>
          <td>{formatDate(invoice.dueOn, ar)}</td>
          <td>{money(invoice.totalMinor, invoice.currency, locale)}</td>
          <td>{money(invoiceOutstandingMinor(invoice), invoice.currency, locale)}</td>
          <td>
            <Status
              label={domainStatusLabel(invoice.status, ar)}
              tone={
                invoice.status === 'overdue'
                  ? 'action'
                  : invoice.status === 'paid'
                    ? 'good'
                    : undefined
              }
            />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function PaymentsTable({ ar, locale, data }: Ctx) {
  if (!data.payments.length) return <EmptyState title={ar ? 'لا مدفوعات' : 'No payments'} />;
  return (
    <Table
      head={
        ar
          ? ['التاريخ', 'الفاتورة', 'المالك', 'المبلغ', 'المسترد', 'الطريقة', 'الحالة']
          : ['Date', 'Invoice', 'Landlord', 'Amount', 'Refunded', 'Method', 'Status']
      }
    >
      {data.payments.map((payment) => (
        <tr key={payment.id}>
          <td>{formatDate(payment.receivedAt, ar)}</td>
          <td className="tenant-table__ref">
            <bdi>{payment.invoiceNumber}</bdi>
          </td>
          <td>{tenancyLandlordName(payment.landlord, ar)}</td>
          <td>{money(payment.amountMinor, payment.currency, locale)}</td>
          <td>
            {payment.refundedMinor !== '0'
              ? money(payment.refundedMinor, payment.currency, locale)
              : '—'}
          </td>
          <td>{payment.method}</td>
          <td>
            <Status
              label={domainStatusLabel(payment.status, ar)}
              tone={payment.status === 'succeeded' ? 'good' : undefined}
            />
          </td>
        </tr>
      ))}
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
    ar: ['حجوزاتي', 'الإقامات اليومية وحجوزات الإيجار أو الشراء لدى كل الملاك.'],
    en: ['My bookings', 'Daily stays and rent or purchase bookings with every landlord.'],
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
    ar: ['فواتيري', 'الفواتير الصادرة لك وما تبقى منها.'],
    en: ['My invoices', 'Invoices issued to you and what remains due.'],
  },
  payments: {
    ar: ['مدفوعاتي', 'ما دفعته للملاك، وأي مبالغ مستردة.'],
    en: ['My payments', 'What you paid landlords, and any refunds.'],
  },
};

export async function TenantSpace({
  locale: rawLocale,
  view,
}: {
  locale: string;
  view: TenantSpaceView;
}) {
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const viewer = await requirePortal(locale, 'tenant');
  let failed = false;
  const data = await loadMyTenancy(viewer.id).catch((error: unknown) => {
    console.error('tenant space failed', error);
    failed = true;
    return EMPTY_TENANCY;
  });
  return (
    <TenantSpaceContent
      locale={locale}
      view={view}
      data={data}
      failed={failed}
      displayName={viewer.displayName}
      ownerPortal={
        viewer.portals.find((portal) => portal === 'owner' || portal === 'developer') ?? null
      }
    />
  );
}

export function TenantSpaceContent({
  locale,
  view,
  data,
  failed,
  displayName,
  ownerPortal,
}: {
  locale: 'ar' | 'en';
  view: TenantSpaceView;
  data: MyTenancy;
  failed: boolean;
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
    return (
      <div className="dash-shell tenant-space">
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
        {view === 'bookings' ? (
          <>
            <Section title={ar ? 'الإقامات اليومية' : 'Daily stays'}>
              <StaysTable {...ctx} />
            </Section>
            <Section title={ar ? 'حجوزات الإيجار والشراء' : 'Rent & purchase bookings'}>
              <ReservationsTable {...ctx} />
            </Section>
          </>
        ) : view === 'contracts' ? (
          <ContractsTable {...ctx} />
        ) : view === 'leases' ? (
          <LeasesTable {...ctx} />
        ) : view === 'invoices' ? (
          <InvoicesTable {...ctx} />
        ) : (
          <PaymentsTable {...ctx} />
        )}
      </div>
    );
  }

  const liveLeases = data.leases.filter((lease) => !lease.fromStay && lease.status === 'active');
  const openInvoices = data.invoices.filter((invoice) => OPEN_INVOICE.has(invoice.status));
  const metrics = [
    {
      key: 'bookings',
      label: ar ? 'حجوزاتي' : 'Bookings',
      value: data.stays.length + data.reservations.length,
      href: '/tenant/reservations',
    },
    {
      key: 'contracts',
      label: ar ? 'عقودي' : 'Contracts',
      value: data.contracts.length,
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
  ];

  return (
    <div className="dash-shell tenant-space">
      <header className="dash-hero">
        <div className="dash-hero__copy">
          <p className="dash-hero__kicker">{ar ? 'مساحة المستأجر' : 'Tenant space'}</p>
          <h1>{ar ? `أهلاً ${displayName}` : `Welcome, ${displayName}`}</h1>
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
        title={ar ? 'الإقامات اليومية' : 'Daily stays'}
        more={{ href: '/tenant/reservations', label: ar ? 'كل الحجوزات' : 'All bookings' }}
      >
        <StaysTable {...ctx} data={{ ...data, stays: data.stays.slice(0, 5) }} />
      </Section>
      {data.reservations.length ? (
        <Section title={ar ? 'حجوزات الإيجار والشراء' : 'Rent & purchase bookings'}>
          <ReservationsTable
            {...ctx}
            data={{ ...data, reservations: data.reservations.slice(0, 5) }}
          />
        </Section>
      ) : null}
      <Section
        title={ar ? 'عقودي' : 'My contracts'}
        more={{ href: '/tenant/contracts', label: ar ? 'كل العقود' : 'All contracts' }}
      >
        <ContractsTable {...ctx} data={{ ...data, contracts: data.contracts.slice(0, 5) }} />
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
