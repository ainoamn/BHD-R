'use client';

import dynamic from 'next/dynamic';
import { Link, usePathname } from '@/i18n/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DepositLedgerPanel } from '@/components/accounting/deposit-ledger';
import { LegalCasesBoard } from '@/components/legal-cases-board';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { PortalPageContext } from '@/components/portal-page';
import { TeamManager } from '@/components/team-manager';
import {
  isOperationsSection,
  opsSectionsForPortal,
  type OperationsSection,
} from '@/lib/portal-ops-types';
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
  const pathname = usePathname();
  const section = opsSectionFromPathname(pathname, portal);
  const [visited, setVisited] = useState<OperationsSection[]>(() => (section ? [section] : []));
  const [pages, setPages] = useState<Record<string, ReactNode>>({});
  const register = useCallback((path: string, content: ReactNode) => {
    setPages((current) => (current[path] === content ? current : { ...current, [path]: content }));
  }, []);

  useEffect(() => {
    if (!section) return;
    setVisited((current) => (current.includes(section) ? current : [...current, section]));
  }, [section]);

  const panels = section && !visited.includes(section) ? [...visited, section] : visited;
  return (
    <PortalPageContext.Provider value={register}>
      {/* Leave Next's router mounted exactly once; pages register their actual content. */}
      {children}
      {Object.entries(pages).map(([path, content]) => (
        <div
          key={path}
          className="portal-persisted-page"
          hidden={!!section || path !== pathname}
          inert={!!section || path !== pathname}
          aria-hidden={!!section || path !== pathname || undefined}
        >
          {content}
        </div>
      ))}
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
            <OperationsWorkspaceClient
              portal={portal}
              section={panel}
              locale={locale}
              active={panel === section}
              beforeList={
                <DepositLedgerPanel portal={portal} locale={locale} active={panel === section} />
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
