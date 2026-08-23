import { Card, CardContent, CardHeader, EmptyState } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/server-api';
import { formatMoney } from '@/lib/format';
import { requirePortal } from '@/lib/viewer';
import type { PortalOverview as OverviewData, PortalRole } from '@/lib/types';

export async function PortalOverview({ locale, portal }: { locale: string; portal: PortalRole }) {
  const t = await getTranslations();
  const viewer = await requirePortal(locale, portal);
  const overview = await apiFetch<OverviewData>(`/v1/${portal}/overview`).catch(() => ({
    occupancyPercent: null,
    collectedMinor: null,
    currency: 'OMR',
    openTickets: null,
    expiringContracts: null,
    recentActivity: [],
  }));
  const value = (input: number | null, suffix = '') => (input === null ? '—' : `${input}${suffix}`);
  return (
    <>
      <header className="portal-topbar">
        <div>
          <h1>{t(`Portal.${portal}`)}</h1>
          <p>{t('Portal.welcome', { name: viewer.displayName })}</p>
        </div>
        {portal === 'owner' || portal === 'developer' ? (
          <Link href={`/${portal}/properties/new`} className="button button--primary">
            ＋ {t('Portal.addProperty')}
          </Link>
        ) : null}
      </header>
      <div className="metric-grid">
        <Card className="metric">
          <p>{t('Portal.occupancy')}</p>
          <strong>{value(overview.occupancyPercent, '%')}</strong>
        </Card>
        <Card className="metric">
          <p>{t('Portal.collected')}</p>
          <strong>
            {overview.collectedMinor === null
              ? '—'
              : formatMoney(overview.collectedMinor, overview.currency, locale)}
          </strong>
        </Card>
        <Card className="metric">
          <p>{t('Portal.openTickets')}</p>
          <strong>{value(overview.openTickets)}</strong>
        </Card>
        <Card className="metric">
          <p>{t('Portal.expiringContracts')}</p>
          <strong>{value(overview.expiringContracts)}</strong>
        </Card>
      </div>
      <div className="portal-grid">
        <Card>
          <CardHeader>
            <h2>{t('Portal.overview')}</h2>
          </CardHeader>
          <CardContent>
            {overview.recentActivity.length ? (
              <ul className="data-list">
                {overview.recentActivity.map((item) => (
                  <li key={item.id}>
                    <span>{item.title}</span>
                    <time dateTime={item.occurredAt}>
                      {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
                        dateStyle: 'medium',
                      }).format(new Date(item.occurredAt))}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t('Portal.noData')} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2>{t('Common.actions')}</h2>
          </CardHeader>
          <CardContent>
            <div className="data-list">
              {portal === 'tenant' ? (
                <Link className="button button--primary" href="/tenant/maintenance/new">
                  {t('Maintenance.new')}
                </Link>
              ) : null}
              {portal === 'owner' || portal === 'developer' ? (
                <>
                  <Link className="button button--primary" href={`/${portal}/properties/new`}>
                    {t('Portal.addProperty')}
                  </Link>
                  <Link className="button button--quiet" href={`/${portal}/reports`}>
                    {t('Common.reports')}
                  </Link>
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
