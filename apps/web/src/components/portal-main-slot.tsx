'use client';

import dynamic from 'next/dynamic';
import { Link } from '@/i18n/navigation';
import { startTransition, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccountingHub } from '@/components/accounting/accounting-hub';
import { ApprovalsHub } from '@/components/approvals-hub';
import { ContactsBoard } from '@/components/contacts-board';
import { LegalCasesBoard } from '@/components/legal-cases-board';
import { WorkTasksBoard } from '@/components/work-tasks-board';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { PortalPageContext } from '@/components/portal-page';
import { TeamManager } from '@/components/team-manager';
import { TenantMaintenanceBoard } from '@/components/tenant-maintenance-board';
import { TenantSpaceHost } from '@/components/tenant-space-host';
import {
  isOperationsSection,
  opsSectionsForPortal,
  type OperationsSection,
} from '@/lib/portal-ops-types';
import { useSoftPortalPathname } from '@/lib/soft-portal-nav';
import { tenantSoftViewFromPath } from '@/lib/tenant-soft-nav';
import type { PortalRole } from '@/lib/types';

const PropertySectionRecords = dynamic(() =>
  import('@/components/property-section-records').then((mod) => mod.PropertySectionRecords),
);

export function opsSectionFromPathname(
  pathname: string,
  portal: PortalRole,
): OperationsSection | null {
  const root = `/${portal}`;
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return null;
  const rest = pathname.slice(root.length).replace(/^\//, '');
  if (!rest) return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length !== 1) return null;
  const candidate = parts[0]!;
  if (!isOperationsSection(candidate)) return null;
  return opsSectionsForPortal(portal).includes(candidate) ? candidate : null;
}

/**
 * Panels live in this shared layout, so switching only changes visibility.
 * A panel mounts on first visit; its data is already warm in the client cache.
 */
function SectionUnavailable({
  portal,
  locale,
  lawyer,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  lawyer: boolean;
}) {
  const ar = locale === 'ar';
  return (
    <section className="portal-denied" role="status">
      <h1>{ar ? 'هذا القسم غير متاح لحسابك' : 'This section is not available to your account'}</h1>
      <p>
        {lawyer
          ? ar
            ? 'حساب المحامي يطّلع على القضايا المسندة إليه فقط.'
            : 'A lawyer account sees only the cases assigned to it.'
          : ar
            ? 'صلاحيات حسابك لا تشمل هذا القسم. اطلب الصلاحية من مالك الحساب إن احتجتها.'
            : 'Your permissions do not include this section. Ask the account owner if you need it.'}
      </p>
      <Link className="button button--primary" href={lawyer ? `/${portal}/legal` : `/${portal}`}>
        {lawyer ? (ar ? 'فتح القضايا' : 'Open cases') : ar ? 'لوحة التحكم' : 'Dashboard'}
      </Link>
    </section>
  );
}

export function PortalMainSlot({
  portal,
  locale,
  sections,
  legalManage = false,
  lawyer = false,
  children,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  /** Sections this viewer may open; any other shows a notice instead of an empty workspace. */
  sections: readonly OperationsSection[];
  /** May open legal cases (`legal.manage`). */
  legalManage?: boolean;
  /** An external lawyer limited to their own cases. */
  lawyer?: boolean;
  children: ReactNode;
}) {
  const pathname = useSoftPortalPathname();
  const section = opsSectionFromPathname(pathname, portal);
  const tenantSoft = portal === 'tenant' ? tenantSoftViewFromPath(pathname) : null;
  const softPane = Boolean(section || tenantSoft);
  const [visited, setVisited] = useState<OperationsSection[]>(() => (section ? [section] : []));
  const [tenantHostMounted, setTenantHostMounted] = useState(() => Boolean(tenantSoft));
  const [pages, setPages] = useState<Record<string, ReactNode>>({});
  const register = useCallback((path: string, content: ReactNode) => {
    // Keep-alive copy for soft-nav back. Active route paints from live `children`
    // so LiveSync refresh does not remount the visible tree via setState.
    startTransition(() => {
      setPages((current) => ({ ...current, [path]: content }));
    });
  }, []);

  useEffect(() => {
    if (!section) return;
    setVisited((current) => (current.includes(section) ? current : [...current, section]));
  }, [section]);

  useEffect(() => {
    if (!tenantSoft) return;
    setTenantHostMounted(true);
  }, [tenantSoft]);

  const panels = section && !visited.includes(section) ? [...visited, section] : visited;
  return (
    <PortalPageContext.Provider value={register}>
      {/* Live RSC for the active route; hide only while soft panes own the main area. */}
      <div
        hidden={softPane}
        inert={softPane || undefined}
        aria-hidden={softPane || undefined}
      >
        {children}
      </div>
      {Object.entries(pages).map(([path, content]) => (
        <div
          key={path}
          className="portal-persisted-page"
          // Keep-alive mounts only — never paint. Live `children` owns the viewport.
          // (Previously inactive pages like the dashboard stayed visible under detail routes.)
          hidden
          inert
          aria-hidden
        >
          {content}
        </div>
      ))}
      {tenantHostMounted ? (
        <div
          className="portal-persisted-panel"
          hidden={!tenantSoft}
          inert={!tenantSoft}
          aria-hidden={!tenantSoft || undefined}
        >
          <TenantSpaceHost locale={locale} active={Boolean(tenantSoft)} />
        </div>
      ) : null}
      {panels.map((panel) => (
        <div
          key={panel}
          className="portal-persisted-panel"
          hidden={panel !== section}
          inert={panel !== section}
          aria-hidden={panel !== section || undefined}
        >
          {!sections.includes(panel) ? (
            <SectionUnavailable portal={portal} locale={locale} lawyer={lawyer} />
          ) : panel === 'team' ? (
            <TeamManager locale={locale} active={panel === section} />
          ) : panel === 'accounting' ? (
            <AccountingHub portal={portal} locale={locale} active={panel === section} />
          ) : panel === 'maintenance' && portal === 'owner' ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              beforeList={<TenantMaintenanceBoard locale={locale} active={panel === section} />}
            />
          ) : panel === 'tasks' && (portal === 'owner' || portal === 'developer') ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              allowCreate={false}
              listOverride={
                <WorkTasksBoard portal={portal} locale={locale} active={panel === section} />
              }
            />
          ) : panel === 'legal' && (portal === 'owner' || portal === 'developer') ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              allowCreate={legalManage}
              listOverride={
                <LegalCasesBoard
                  portal={portal}
                  locale={locale}
                  active={panel === section}
                  lawyer={lawyer}
                />
              }
            />
          ) : panel === 'contacts' && portal === 'owner' ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              listOverride={
                <ContactsBoard portal={portal} locale={locale} active={panel === section} />
              }
            />
          ) : panel === 'approvals' ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              allowCreate={false}
              listOverride={
                <ApprovalsHub portal={portal} locale={locale} active={panel === section} />
              }
            />
          ) : panel === 'bookings' && (portal === 'owner' || portal === 'developer') ? (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              listOverride={
                <PropertySectionRecords
                  portal={portal}
                  propertyId={null}
                  section="bookings"
                  locale={locale}
                />
              }
            />
          ) : (
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
            />
          )}
        </div>
      ))}
    </PortalPageContext.Provider>
  );
}
