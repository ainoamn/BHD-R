import { EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { loadViewerPendingApprovals } from '@/lib/pending-approvals-neon';
import {
  EMPTY_PENDING_APPROVALS,
  pendingApprovalHref,
  pendingApprovalAmount,
  pendingApprovalTitle,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import { loadPortalOverview } from '@/lib/portal-overview-data';
import { loadTenancySummary } from '@/lib/tenancy-neon';
import { withTimeoutFallback } from '@/lib/with-timeout';
import { workflowEventLabel, workflowStatusLabel } from '@/lib/ui-labels';
import { requirePortal } from '@/lib/viewer';
import type { PortalOverview as OverviewData, PortalRole } from '@/lib/types';

function value(input: number | null | undefined, suffix = ''): string {
  if (input === null || input === undefined) return '—';
  return `${input}${suffix}`;
}

function alertCopy(
  code: string,
  count: number,
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  switch (code) {
    case 'open_tickets':
      return t('Portal.alertOpenTickets', { count });
    case 'expiring_leases':
      return t('Portal.alertExpiring', { count });
    case 'open_invoices':
      return t('Portal.alertInvoices', { count });
    case 'vacant_units':
      return t('Portal.alertVacant', { count });
    case 'stay_bookings':
      return t('Portal.alertStayBookings', { count });
    case 'contracts_approval':
      return t('Portal.alertContractsApproval', { count });
    case 'booking_requests':
      return t('Portal.alertBookingRequests', { count });
    case 'deposit_refunds':
      return t('Portal.alertDepositRefunds', { count });
    default:
      return `${code}: ${count}`;
  }
}

function alertHref(portal: PortalRole, code: string): string {
  switch (code) {
    case 'open_tickets':
      return `/${portal}/maintenance`;
    case 'expiring_leases':
      return `/${portal}/leasing`;
    case 'open_invoices':
      return `/${portal}/invoices`;
    case 'vacant_units':
      return `/${portal}/bookings`;
    case 'stay_bookings':
      return `/${portal}/bookings?tab=daily`;
    default:
      return `/${portal}`;
  }
}

function localizeWorkflowLabel(
  key: string | undefined,
  kind: 'event' | 'status',
  locale: string,
): string {
  if (!key) return '';
  return kind === 'event' ? workflowEventLabel(key, locale) : workflowStatusLabel(key, locale);
}

export async function PortalOverview({ locale, portal }: { locale: string; portal: PortalRole }) {
  const managesProperties = portal === 'owner' || portal === 'developer';
  // Data loads read the session themselves; start them alongside the access check.
  const dataPromise: Promise<[OverviewData, PendingApprovals]> = Promise.all([
    loadPortalOverview(portal),
    managesProperties ? loadViewerPendingApprovals() : Promise.resolve(EMPTY_PENDING_APPROVALS),
  ]);
  dataPromise.catch(() => undefined);
  const [t, viewer] = await Promise.all([getTranslations(), requirePortal(locale, portal)]);
  const [[overview, approvals], tenancy] = await Promise.all([
    dataPromise,
    managesProperties
      ? withTimeoutFallback(loadTenancySummary(viewer.id), 2_500, null, 'tenancy-summary')
      : null,
  ]);
  const ar = locale === 'ar';
  const firstContract = approvals.items.find((item) => item.kind === 'contract');
  const firstRefund = approvals.items.find(
    (item) =>
      item.kind === 'deposit_refund' ||
      item.kind === 'refund_transfer' ||
      item.kind === 'deposit_claim' ||
      item.kind === 'deposit_complaint',
  );
  const approvalAlerts: Array<{ code: string; count: number; href: string }> = [
    ...(approvals.contracts && firstContract
      ? [
          {
            code: 'contracts_approval',
            count: approvals.contracts,
            href:
              approvals.contracts === 1
                ? pendingApprovalHref(portal, firstContract)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
    ...(approvals.bookings
      ? [{ code: 'booking_requests', count: approvals.bookings, href: `/${portal}/bookings` }]
      : []),
    ...(approvals.refunds && firstRefund
      ? [
          {
            code: 'deposit_refunds',
            count: approvals.refunds,
            href:
              approvals.refunds === 1
                ? pendingApprovalHref(portal, firstRefund)
                : `/${portal}#pending-approvals`,
          },
        ]
      : []),
  ];
  const collected =
    overview.collected ??
    (overview.collectedMinor !== null && overview.collectedMinor !== undefined
      ? [{ amountMinor: overview.collectedMinor, currency: overview.currency ?? 'OMR' }]
      : []);
  const alerts = [...(overview.alerts ?? [])].sort((a, b) => {
    const rank = (severity: 'danger' | 'warning' | 'info') =>
      severity === 'danger' ? 0 : severity === 'warning' ? 1 : 2;
    return rank(a.severity) - rank(b.severity) || b.count - a.count;
  });
  const updatedLabel = overview.generatedAt
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(overview.generatedAt))
    : null;

  const metrics: Array<{
    key: string;
    label: string;
    value: string;
    href: string;
    tone: number;
  }> = [
    {
      key: 'occupancy',
      label: t('Portal.occupancy'),
      value: value(overview.occupancyPercent, '%'),
      href: `/${portal}/reports`,
      tone: 1,
    },
    {
      key: 'properties',
      label: t('Portal.propertiesCount'),
      value: value(overview.properties ?? null),
      href: `/${portal}/properties`,
      tone: 2,
    },
    {
      key: 'units',
      label: t('Portal.unitsCount'),
      value: value(overview.units ?? null),
      href: `/${portal}/properties`,
      tone: 3,
    },
    {
      key: 'leases',
      label: t('Portal.activeLeases'),
      value: value(overview.activeLeases ?? null),
      href: portal === 'tenant' ? `/${portal}/leases` : `/${portal}/leasing`,
      tone: 4,
    },
    {
      key: 'vacant',
      label: t('Portal.vacantUnits'),
      value: value(overview.vacantUnits ?? null),
      href: `/${portal}/bookings`,
      tone: 5,
    },
    {
      key: 'tickets',
      label: t('Portal.openTickets'),
      value: value(overview.openTickets),
      href: `/${portal}/maintenance`,
      tone: 6,
    },
    {
      key: 'expiring',
      label: t('Portal.expiringContracts'),
      value: value(overview.expiringContracts),
      href: portal === 'tenant' ? `/${portal}/leases` : `/${portal}/leasing`,
      tone: 7,
    },
    {
      key: 'invoices',
      label: t('Portal.openInvoices'),
      value: value(overview.openInvoices ?? null),
      href: `/${portal}/invoices`,
      tone: 8,
    },
  ];

  return (
    <div className="dash-shell">
      <header className="dash-hero">
        <div className="dash-hero__copy">
          <p className="dash-hero__kicker">{t(`Portal.${portal}`)}</p>
          <h1>{t('Portal.welcome', { name: viewer.displayName })}</h1>
          <p className="dash-hero__lede">{t('Portal.dashboardIntro')}</p>
          {updatedLabel ? (
            <p className="dash-hero__meta">
              {t('Portal.updatedAt')}: {updatedLabel}
            </p>
          ) : null}
        </div>
        <div className="dash-hero__actions">
          {portal === 'owner' || portal === 'developer' ? (
            <Link href={`/${portal}/properties/new`} className="button button--primary" prefetch>
              ＋ {t('Portal.addProperty')}
            </Link>
          ) : null}
          {portal === 'tenant' ? (
            <Link href="/tenant/maintenance/new" className="button button--primary">
              {t('Maintenance.new')}
            </Link>
          ) : null}
          {(portal === 'owner' || portal === 'developer') && (
            <Link href={`/${portal}/stays/calendar`} className="button button--quiet" prefetch>
              {t('Portal.openCalendar')}
            </Link>
          )}
          <Link href={`/${portal}/reports`} className="button button--quiet">
            {t('Common.reports')}
          </Link>
        </div>
      </header>

      {tenancy ? (
        <Link href="/tenant" className="dash-tenancy" prefetch>
          <span className="dash-tenancy__copy">
            <strong>
              {ar
                ? 'لديك أيضاً حجوزات وعقود بصفتك مستأجراً أو ضيفاً'
                : 'You also have bookings and contracts as a tenant or guest'}
            </strong>
            <span>
              {[
                tenancy.bookings
                  ? ar
                    ? `${tenancy.bookings} حجز`
                    : `${tenancy.bookings} bookings`
                  : '',
                tenancy.contracts
                  ? ar
                    ? `${tenancy.contracts} عقد`
                    : `${tenancy.contracts} contracts`
                  : '',
                tenancy.leases
                  ? ar
                    ? `${tenancy.leases} إيجار ساري`
                    : `${tenancy.leases} active leases`
                  : '',
                tenancy.openInvoices
                  ? ar
                    ? `${tenancy.openInvoices} فاتورة مستحقة`
                    : `${tenancy.openInvoices} invoices due`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
          <em className="dash-tenancy__open">{ar ? 'مساحة المستأجر ←' : 'Tenant space →'}</em>
        </Link>
      ) : null}

      {approvals.total ? (
        <section
          id="pending-approvals"
          className="dash-approvals"
          aria-label={t('Portal.approvalsTitle')}
        >
          <div className="dash-section-head dash-section-head--compact">
            <h2>
              {t('Portal.approvalsTitle')}
              <span className="dash-approvals__count">{approvals.total}</span>
            </h2>
            <p className="dash-section-hint">{t('Portal.approvalsHint')}</p>
          </div>
          <ul className="dash-approvals__list">
            {approvals.items.slice(0, 6).map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Link href={pendingApprovalHref(portal, item)} prefetch>
                  <span className="dash-approvals__title">
                    {pendingApprovalTitle(item, locale === 'ar')}
                  </span>
                  <span className="dash-approvals__ref" dir="ltr">
                    {item.reference}
                  </span>
                  <span className="dash-approvals__meta">
                    {[
                      locale === 'ar'
                        ? item.propertyNameAr
                        : item.propertyNameEn || item.propertyNameAr,
                      item.unitCode,
                      item.party,
                      item.fromOn,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {pendingApprovalAmount(item, locale === 'ar' ? 'ar' : 'en') ? (
                    <strong className="dash-approvals__meta">
                      {pendingApprovalAmount(item, locale === 'ar' ? 'ar' : 'en')}
                    </strong>
                  ) : null}
                  <em className="dash-approvals__open">{t('Portal.approvalsOpen')}</em>
                </Link>
              </li>
            ))}
          </ul>
          {approvals.total > 6 ? (
            <p className="dash-section-hint">
              {t('Portal.approvalsMore', { count: approvals.total - 6 })}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="dash-metrics-block" aria-label={t('Portal.liveStats')}>
        <div className="dash-section-head dash-section-head--compact">
          <h2>{t('Portal.liveStats')}</h2>
          <p className="dash-section-hint">{t('Portal.metricsHint')}</p>
        </div>
        <div className="dash-metrics">
          {metrics.map((metric) => (
            <Link
              key={metric.key}
              href={metric.href}
              className={`dash-metric dash-metric--${metric.tone}`}
              prefetch
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="dash-alerts" aria-label={t('Portal.alertsTitle')}>
        <div className="dash-section-head dash-section-head--compact">
          <h2>{t('Portal.alertsTitle')}</h2>
          <p className="dash-section-hint">{t('Portal.alertsHint')}</p>
        </div>
        {alerts.length || approvalAlerts.length ? (
          <ul className="dash-alerts__list">
            {approvalAlerts.map((alert) => (
              <li key={alert.code} className="dash-alert dash-alert--approval">
                <Link href={alert.href} prefetch>
                  <strong>{alert.count}</strong>
                  <span>{alertCopy(alert.code, alert.count, t)}</span>
                </Link>
              </li>
            ))}
            {alerts.map((alert) => (
              <li key={alert.code} className={`dash-alert dash-alert--${alert.severity}`}>
                <Link href={alertHref(portal, alert.code)} prefetch>
                  <strong>{alert.count}</strong>
                  <span>{alertCopy(alert.code, alert.count, t)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-alerts__empty">{t('Portal.noAlerts')}</p>
        )}
      </section>

      <div className="dash-mid">
        <section className="dash-finance" aria-label={t('Portal.accountingPulse')}>
          <div className="dash-section-head dash-section-head--compact">
            <h2>{t('Portal.accountingPulse')}</h2>
            <Link href={`/${portal}/accounting`} className="button button--quiet button--tiny">
              {t('Common.accounting')}
            </Link>
          </div>
          <div className="dash-finance__card">
            <p>{t('Portal.collected')}</p>
            <strong className="metric-money-stack">
              {collected.length
                ? collected.map((amount) => (
                    <span key={amount.currency}>
                      {formatMoney(amount.amountMinor, amount.currency, locale)}
                    </span>
                  ))
                : '—'}
            </strong>
            <div className="dash-finance__links">
              <Link href={`/${portal}/invoices`}>{t('Common.invoices')}</Link>
              <Link href={`/${portal}/payments`}>{t('Common.payments')}</Link>
              <Link href={`/${portal}/expenses`}>{t('Common.expenses')}</Link>
            </div>
          </div>
        </section>

        {(portal === 'owner' || portal === 'developer' || portal === 'tenant') && (
          <nav className="dash-shortcuts" aria-label={t('Portal.quickNav')}>
            <div className="dash-section-head dash-section-head--compact">
              <h2>{t('Portal.quickNav')}</h2>
              <p className="dash-section-hint">{t('Portal.quickNavHint')}</p>
            </div>
            <div className="dash-shortcuts__grid">
              <Link href={portal === 'tenant' ? `/${portal}/leases` : `/${portal}/leasing`}>
                {t('Common.leasing')}
              </Link>
              <Link href={`/${portal}/contracts`}>{t('Common.contracts')}</Link>
              <Link href={`/${portal}/invoices`}>{t('Common.invoices')}</Link>
              {portal !== 'tenant' ? (
                <Link href={`/${portal}/bookings`}>{t('Common.bookings')}</Link>
              ) : (
                <Link href={`/${portal}/reservations`}>{t('Common.bookings')}</Link>
              )}
              <Link href={`/${portal}/maintenance`}>{t('Common.maintenance')}</Link>
              {portal !== 'tenant' ? (
                <>
                  <Link href={`/${portal}/stays/calendar`}>{t('Stays.calendar')}</Link>
                  <Link href={`/${portal}/bookings?tab=daily`}>{t('Portal.viewStayBookings')}</Link>
                  <Link href={`/${portal}/contacts`}>{t('Common.contacts')}</Link>
                </>
              ) : null}
            </div>
          </nav>
        )}
      </div>

      <div className="dash-grid">
        <section className="dash-panel">
          <div className="dash-section-head dash-section-head--compact">
            <h2>{t('Portal.recentActivity')}</h2>
          </div>
          {overview.recentActivity.length ? (
            <ul className="dash-activity">
              {overview.recentActivity.map((item) => {
                const href =
                  item.resourceType === 'stay_booking' &&
                  item.resourceId &&
                  (portal === 'owner' || portal === 'developer')
                    ? `/${portal}/stays/bookings/${item.resourceId}`
                    : null;
                const body = (
                  <>
                    <div>
                      <strong>{localizeWorkflowLabel(item.title, 'event', locale)}</strong>
                      {item.status ? (
                        <span className="dash-activity__status">
                          {localizeWorkflowLabel(item.status, 'status', locale)}
                        </span>
                      ) : null}
                    </div>
                    <time dateTime={item.occurredAt}>
                      {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(item.occurredAt))}
                    </time>
                  </>
                );
                return (
                  <li key={item.id}>
                    {href ? (
                      <Link href={href} className="dash-activity__link" prefetch>
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title={t('Portal.noData')} />
          )}
        </section>
        <section className="dash-panel">
          <div className="dash-section-head dash-section-head--compact">
            <h2>{t('Portal.quickActions')}</h2>
            <p className="dash-section-hint">{t('Portal.actionsHint')}</p>
          </div>
          <div className="dash-actions">
            {portal === 'owner' || portal === 'developer' ? (
              <>
                <Link
                  className="button button--primary"
                  href={`/${portal}/properties/new`}
                  prefetch
                >
                  {t('Portal.addProperty')}
                </Link>
                <Link className="button button--quiet" href={`/${portal}/bookings?tab=daily`}>
                  {t('Portal.viewStayBookings')}
                </Link>
                <Link className="button button--quiet" href={`/${portal}/properties`}>
                  {t('Common.properties')}
                </Link>
                <Link className="button button--quiet" href={`/${portal}/approvals`}>
                  {t('Common.approvals')}
                </Link>
                <Link className="button button--quiet" href={`/${portal}/team`}>
                  {t('Common.team')}
                </Link>
              </>
            ) : null}
            {portal === 'tenant' ? (
              <>
                <Link className="button button--primary" href="/tenant/maintenance/new">
                  {t('Maintenance.new')}
                </Link>
                <Link className="button button--quiet" href="/tenant/invoices">
                  {t('Common.invoices')}
                </Link>
              </>
            ) : null}
            {portal === 'platform' ? (
              <>
                <Link className="button button--quiet" href="/platform/organizations">
                  {t('Common.organizations')}
                </Link>
                <Link className="button button--quiet" href="/platform/users">
                  {t('Common.users')}
                </Link>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
