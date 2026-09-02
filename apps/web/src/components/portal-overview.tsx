import { EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { loadPortalOverview } from '@/lib/portal-overview-data';
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
      return `/${portal}/stays/bookings`;
    default:
      return `/${portal}`;
  }
}

function localizeWorkflowLabel(
  key: string | undefined,
  kind: 'event' | 'status',
  t: Awaited<ReturnType<typeof getTranslations>>,
): string {
  if (!key) return '';
  const normalized = key.replace(/\./g, '_');
  const path =
    kind === 'event'
      ? (`Portal.workflowEvent_${normalized}` as Parameters<typeof t>[0])
      : (`Portal.workflowStatus_${normalized}` as Parameters<typeof t>[0]);
  const translated = t(path);
  return translated === path ? key : translated;
}

export async function PortalOverview({ locale, portal }: { locale: string; portal: PortalRole }) {
  const t = await getTranslations();
  const viewer = await requirePortal(locale, portal);
  const overview: OverviewData = await loadPortalOverview(portal, viewer);
  const collected =
    overview.collected ??
    (overview.collectedMinor !== null && overview.collectedMinor !== undefined
      ? [{ amountMinor: overview.collectedMinor, currency: overview.currency ?? 'OMR' }]
      : []);
  const alerts = overview.alerts ?? [];
  const updatedLabel = overview.generatedAt
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(overview.generatedAt))
    : null;

  return (
    <div className="dash-shell">
      <header className="dash-hero">
        <div className="dash-hero__copy">
          <p className="dash-hero__kicker">{t(`Portal.${portal}`)}</p>
          <h1>{t('Portal.welcome', { name: viewer.displayName })}</h1>
          <p>{t('Portal.dashboardIntro')}</p>
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
          <Link href={`/${portal}/reports`} className="button button--quiet">
            {t('Common.reports')}
          </Link>
        </div>
      </header>

      <section className="dash-alerts" aria-label={t('Portal.alertsTitle')}>
        <div className="dash-section-head">
          <h2>{t('Portal.alertsTitle')}</h2>
        </div>
        {alerts.length ? (
          <ul className="dash-alerts__list">
            {alerts.map((alert) => (
              <li key={alert.code} className={`dash-alert dash-alert--${alert.severity}`}>
                <Link href={alertHref(portal, alert.code)}>
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

      <section aria-label={t('Portal.liveStats')}>
        <div className="dash-section-head">
          <h2>{t('Portal.liveStats')}</h2>
        </div>
        <div className="dash-metrics">
          <article className="dash-metric dash-metric--1">
            <span>{t('Portal.occupancy')}</span>
            <strong>{value(overview.occupancyPercent, '%')}</strong>
          </article>
          <article className="dash-metric dash-metric--2">
            <span>{t('Portal.propertiesCount')}</span>
            <strong>{value(overview.properties ?? null)}</strong>
          </article>
          <article className="dash-metric dash-metric--3">
            <span>{t('Portal.unitsCount')}</span>
            <strong>{value(overview.units ?? null)}</strong>
          </article>
          <article className="dash-metric dash-metric--4">
            <span>{t('Portal.activeLeases')}</span>
            <strong>{value(overview.activeLeases ?? null)}</strong>
          </article>
          <article className="dash-metric dash-metric--5">
            <span>{t('Portal.vacantUnits')}</span>
            <strong>{value(overview.vacantUnits ?? null)}</strong>
          </article>
          <article className="dash-metric dash-metric--6">
            <span>{t('Portal.openTickets')}</span>
            <strong>{value(overview.openTickets)}</strong>
          </article>
          <article className="dash-metric dash-metric--7">
            <span>{t('Portal.expiringContracts')}</span>
            <strong>{value(overview.expiringContracts)}</strong>
          </article>
          <article className="dash-metric dash-metric--8">
            <span>{t('Portal.openInvoices')}</span>
            <strong>{value(overview.openInvoices ?? null)}</strong>
          </article>
        </div>
      </section>

      <section className="dash-finance" aria-label={t('Portal.accountingPulse')}>
        <div className="dash-section-head">
          <h2>{t('Portal.accountingPulse')}</h2>
          <Link href={`/${portal}/accounting`} className="button button--quiet">
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
        <nav className="dash-shortcuts" aria-label={t('Portal.quickActions')}>
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
            <Link href={`/${portal}/contacts`}>{t('Common.contacts')}</Link>
          ) : null}
        </nav>
      )}

      <div className="dash-grid">
        <section className="dash-panel">
          <div className="dash-section-head">
            <h2>{t('Portal.recentActivity')}</h2>
          </div>
          {overview.recentActivity.length ? (
            <ul className="dash-activity">
              {overview.recentActivity.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{localizeWorkflowLabel(item.title, 'event', t)}</strong>
                    {item.status ? (
                      <span className="dash-activity__status">
                        {localizeWorkflowLabel(item.status, 'status', t)}
                      </span>
                    ) : null}
                  </div>
                  <time dateTime={item.occurredAt}>
                    {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.occurredAt))}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('Portal.noData')} />
          )}
        </section>
        <section className="dash-panel">
          <div className="dash-section-head">
            <h2>{t('Portal.quickActions')}</h2>
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
                <Link className="button button--quiet" href={`/${portal}/stays/bookings`}>
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
