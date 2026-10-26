'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { siteAdminSoftSectionFromPath } from '@/lib/site-admin-soft-nav';
import {
  siteConsoleSectionsFor,
  type SiteAdminAccess,
  type SiteConsoleSectionId,
} from '@/lib/site-admin-shared';

const SiteAdminOverview = dynamic(() =>
  import('@/components/site-admin/site-admin-overview').then((m) => m.SiteAdminOverview),
);
const PlatformDiagnosticsPanel = dynamic(() =>
  import('@/components/platform/platform-diagnostics-panel').then(
    (m) => m.PlatformDiagnosticsPanel,
  ),
);
const PlatformSecurityPanel = dynamic(() =>
  import('@/components/platform/platform-security-panel').then((m) => m.PlatformSecurityPanel),
);
const PlatformBillingPanel = dynamic(() =>
  import('@/components/platform/platform-billing-panel').then((m) => m.PlatformBillingPanel),
);
const PlansAdmin = dynamic(() =>
  import('@/components/site-admin/plans-admin').then((m) => m.PlansAdmin),
);
const UsersAdmin = dynamic(() =>
  import('@/components/site-admin/users-admin').then((m) => m.UsersAdmin),
);
const SiteAdminPanel = dynamic(() =>
  import('@/components/site-admin/site-admin-panel').then((m) => m.SiteAdminPanel),
);
const VerificationReview = dynamic(() =>
  import('@/components/site-admin/verification-review').then((m) => m.VerificationReview),
);
const DelegatesAdmin = dynamic(() =>
  import('@/components/site-admin/delegates-admin').then((m) => m.DelegatesAdmin),
);
const NotificationTemplatesStudio = dynamic(() =>
  import('@/components/notification-templates-studio').then((m) => m.NotificationTemplatesStudio),
);
const BadgesCenterBoard = dynamic(() =>
  import('@/components/badges/badges-center-board').then((m) => m.BadgesCenterBoard),
);
const OperationsWorkspaceClient = dynamic(() =>
  import('@/components/operations-workspace-client').then((m) => m.OperationsWorkspaceClient),
);
const LabResetDesk = dynamic(() =>
  import('@/components/lab-reset-desk').then((m) => m.LabResetDesk),
);
const PaymentGatewaysAdmin = dynamic(() =>
  import('@/components/site-admin/payment-gateways-admin').then((m) => m.PaymentGatewaysAdmin),
);
const SitePagesAdmin = dynamic(() =>
  import('@/components/site-admin/site-pages-admin').then((m) => m.SitePagesAdmin),
);
const MaintenanceAdmin = dynamic(() =>
  import('@/components/site-admin/maintenance-admin').then((m) => m.MaintenanceAdmin),
);
const GreetingsAdmin = dynamic(() =>
  import('@/components/site-admin/greetings-admin').then((m) => m.GreetingsAdmin),
);

function Panel({
  id,
  active,
  children,
}: {
  id: SiteConsoleSectionId;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="site-admin-panel"
      data-section={id}
      hidden={!active}
      inert={!active || undefined}
      aria-hidden={!active || undefined}
    >
      {children}
    </div>
  );
}

function renderSection(
  id: SiteConsoleSectionId,
  locale: 'ar' | 'en',
  access: SiteAdminAccess,
): ReactNode {
  switch (id) {
    case 'overview':
      return <SiteAdminOverview locale={locale} />;
    case 'diagnostics':
      return (
        <div className="site-admin--wide">
          <PlatformDiagnosticsPanel locale={locale} />
        </div>
      );
    case 'security':
      return (
        <div className="site-admin--wide">
          <PlatformSecurityPanel locale={locale} />
        </div>
      );
    case 'billing':
      return (
        <div className="site-admin--wide">
          <PlatformBillingPanel locale={locale} />
        </div>
      );
    case 'plans':
      return <PlansAdmin locale={locale} />;
    case 'users':
      return <UsersAdmin locale={locale} />;
    case 'complaints':
      return <SiteAdminPanel locale={locale} canEditInbox={access.root} />;
    case 'verification':
      return (
        <main className="account-page" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <VerificationReview locale={locale} />
        </main>
      );
    case 'delegates':
      return <DelegatesAdmin locale={locale} />;
    case 'notifications':
      return (
        <div className="site-admin--wide">
          <NotificationTemplatesStudio locale={locale} />
        </div>
      );
    case 'greetings':
      return (
        <div className="site-admin--wide">
          <GreetingsAdmin locale={locale} />
        </div>
      );
    case 'badges':
      return (
        <div className="site-admin--wide">
          <BadgesCenterBoard locale={locale} portal="admin" />
        </div>
      );
    case 'apiKeys':
      return (
        <div className="site-admin--wide">
          <OperationsWorkspaceClient portal="owner" section="api-keys" locale={locale} />
        </div>
      );
    case 'labReset':
      return (
        <div className="site-admin--wide">
          <LabResetDesk locale={locale} />
        </div>
      );
    case 'payments':
      return <PaymentGatewaysAdmin locale={locale} />;
    case 'pages':
      return <SitePagesAdmin locale={locale} />;
    case 'maintenance':
      return <MaintenanceAdmin locale={locale} />;
    default:
      return null;
  }
}

/**
 * Keeps admin sections mounted after first visit and preloads the rest on idle
 * so sidebar soft-nav paints in a fraction of a second.
 */
export function SiteAdminMainSlot({
  access,
  locale,
  children,
}: {
  access: SiteAdminAccess;
  locale: 'ar' | 'en';
  children: ReactNode;
}) {
  const pathname = useSoftPortalPathname();
  const section = siteAdminSoftSectionFromPath(pathname);
  const allowedKey = useMemo(
    () =>
      siteConsoleSectionsFor(access)
        .map((item) => item.id)
        .join(','),
    [access],
  );
  const allowed = useMemo(
    () => allowedKey.split(',').filter(Boolean) as SiteConsoleSectionId[],
    [allowedKey],
  );
  const [visited, setVisited] = useState<SiteConsoleSectionId[]>(() =>
    section && allowed.includes(section) ? [section] : [],
  );

  useEffect(() => {
    if (!section || !allowed.includes(section)) return;
    setVisited((current) => (current.includes(section) ? current : [...current, section]));
  }, [section, allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps -- allowedKey tracks allowed

  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      setVisited((current) => {
        const next = new Set(current);
        for (const id of allowed) next.add(id);
        return [...next];
      });
    };
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(warm, { timeout: 1_200 });
    } else {
      timeoutHandle = setTimeout(warm, 400);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
    };
  }, [allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const panels = visited.filter((id) => allowed.includes(id));
  const soft = Boolean(section && allowed.includes(section));

  return (
    <>
      <div hidden={soft} inert={soft || undefined} aria-hidden={soft || undefined}>
        {children}
      </div>
      {panels.map((id) => (
        <Panel key={id} id={id} active={soft && section === id}>
          {renderSection(id, locale, access)}
        </Panel>
      ))}
    </>
  );
}
