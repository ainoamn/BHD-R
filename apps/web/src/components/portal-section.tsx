import { Card, CardContent, CardHeader, EmptyState, StatusBadge } from '@bhd-r/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/server-api';
import { domainStatusLabel } from '@/lib/ui-labels';
import type { PortalRole } from '@/lib/types';
import { OperationsWorkspace, type OperationsSection } from './operations-workspace';
import { TenantCancelLeaseButton } from './tenant-cancel-lease-button';

interface Row {
  id: string;
  title?: string;
  name?: string;
  reference?: string;
  status?: string;
  amount?: string;
  endsOn?: string;
  updatedAt?: string;
}

const allowedSections: Record<PortalRole, string[]> = {
  platform: ['organizations', 'users', 'audit', 'reports', 'settings'],
  owner: [
    'properties',
    'contacts',
    'requests',
    'bookings',
    'leasing',
    'sales',
    'contracts',
    'invoices',
    'payments',
    'accounting',
    'expenses',
    'maintenance',
    'work-orders',
    'tasks',
    'legal',
    'approvals',
    'reports',
    'team',
    'api-keys',
  ],
  developer: [
    'properties',
    'contacts',
    'requests',
    'bookings',
    'leasing',
    'sales',
    'contracts',
    'invoices',
    'payments',
    'accounting',
    'expenses',
    'maintenance',
    'work-orders',
    'tasks',
    'legal',
    'approvals',
    'reports',
    'team',
    'api-keys',
  ],
  tenant: ['requests', 'contracts', 'leases', 'invoices', 'payments', 'maintenance'],
};

const operationalSections = new Set<OperationsSection>([
  'properties',
  'contacts',
  'requests',
  'bookings',
  'leasing',
  'sales',
  'contracts',
  'invoices',
  'payments',
  'accounting',
  'expenses',
  'maintenance',
  'work-orders',
  'tasks',
  'legal',
  'approvals',
  'reports',
  'team',
  'api-keys',
]);

const labelKeys: Record<string, string> = {
  properties: 'Common.properties',
  contacts: 'Common.contacts',
  contracts: 'Common.contracts',
  leases: 'Common.leasing',
  invoices: 'Common.invoices',
  payments: 'Common.payments',
  maintenance: 'Common.maintenance',
  reports: 'Common.reports',
  team: 'Common.team',
  'api-keys': 'Common.apiKeys',
  organizations: 'Common.organizations',
  users: 'Common.users',
  audit: 'Common.audit',
  settings: 'Common.settings',
};

export async function PortalSection({
  portal,
  segments,
}: {
  portal: PortalRole;
  segments: string[];
}) {
  const t = await getTranslations();
  const locale = await getLocale();
  const section = segments[0] ?? '';
  if (!allowedSections[portal].includes(section)) return <EmptyState title="404" />;

  if (portal !== 'platform' && operationalSections.has(section as OperationsSection)) {
    return <OperationsWorkspace portal={portal} section={section as OperationsSection} />;
  }

  const endpoint: Record<string, string> = {
    'platform:organizations': '/v1/platform/organizations',
    'platform:audit': '/v1/platform/audit',
    'platform:reports': '/v1/reports',
    'owner:properties': '/v1/owner/properties',
    'owner:contracts': '/v1/owner/leases',
    'owner:invoices': '/v1/owner/invoices',
    'owner:maintenance': '/v1/owner/maintenance',
    'owner:reports': '/v1/reports',
    'owner:team': '/v1/organizations/current/members',
    'developer:properties': '/v1/developer/projects',
    'developer:reports': '/v1/reports',
    'developer:team': '/v1/organizations/current/members',
    'tenant:contracts': '/v1/tenant/contracts',
    'tenant:leases': '/v1/tenant/leases',
    'tenant:invoices': '/v1/tenant/invoices',
    'tenant:maintenance': '/v1/tenant/maintenance',
  };
  const raw = await apiFetch<Row[] | { data: Row[] }>(
    endpoint[`${portal}:${section}`] ?? `/v1/${portal}/${section}`,
  ).catch(() => []);
  const payload = { data: Array.isArray(raw) ? raw : raw.data };
  return (
    <>
      <header className="portal-topbar">
        <div>
          <h1>{t(labelKeys[section] ?? 'Common.dashboard')}</h1>
          <p>{t(`Portal.${portal}`)}</p>
        </div>
        {section === 'properties' && portal !== 'tenant' ? (
          <Link className="button button--primary" href={`/${portal}/properties/new`} prefetch>
            ＋ {t('Portal.addProperty')}
          </Link>
        ) : null}
        {section === 'maintenance' && portal === 'tenant' ? (
          <Link className="button button--primary" href="/tenant/maintenance/new" prefetch>
            ＋ {t('Maintenance.new')}
          </Link>
        ) : null}
      </header>
      <Card>
        <CardHeader>
          <h2>{t(labelKeys[section] ?? 'Common.dashboard')}</h2>
        </CardHeader>
        <CardContent>
          {payload.data.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('Common.actions')}</th>
                    <th>{t('Common.status')}</th>
                    <th>{t('Common.currency')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.data.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.title ?? row.name ?? row.reference ?? row.id}
                        {portal === 'tenant' && section === 'leases' && row.status === 'active' ? (
                          <div style={{ marginTop: '0.35rem' }}>
                            <TenantCancelLeaseButton
                              leaseId={row.id}
                              {...(row.endsOn ? { endsOn: row.endsOn } : {})}
                              locale={locale}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {row.status ? (
                          <StatusBadge
                            status={
                              row.status === 'active' || row.status === 'paid'
                                ? 'positive'
                                : row.status === 'cancelled'
                                  ? 'negative'
                                  : 'neutral'
                            }
                            label={domainStatusLabel(row.status, locale)}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{row.amount ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('Portal.noData')} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
