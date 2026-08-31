'use client';

import { usePathname } from '@/i18n/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import {
  isOperationsSection,
  opsSectionsForPortal,
  type OperationsSection,
} from '@/lib/portal-ops-types';
import type { PortalRole } from '@/lib/types';

const MAX_KEPT_PANELS = 8;

/**
 * Resolve a top-level ops section from the portal pathname.
 * Detail routes (`/owner/properties/:id`) stay on normal page children.
 */
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

export const OPS_NAVIGATE_EVENT = 'bhd-r-ops-navigate';

/**
 * Qootk / WAZEN-style soft nav: ops sections render inside the persistent portal
 * shell so Next.js page swaps never blank the main pane.
 */
export function PortalMainSlot({
  portal,
  locale,
  children,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  children: ReactNode;
}) {
  const pathname = usePathname();
  const pathSection = opsSectionFromPathname(pathname, portal);
  const [optimisticSection, setOptimisticSection] = useState<OperationsSection | null>(null);
  const [visited, setVisited] = useState<OperationsSection[]>(() =>
    pathSection ? [pathSection] : [],
  );

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ portal: PortalRole; section: OperationsSection }>)
        .detail;
      if (!detail || detail.portal !== portal) return;
      setOptimisticSection(detail.section);
    };
    window.addEventListener(OPS_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(OPS_NAVIGATE_EVENT, onNavigate);
  }, [portal]);

  useEffect(() => {
    if (optimisticSection && pathSection === optimisticSection) {
      setOptimisticSection(null);
    }
    if (!pathSection && !optimisticSection) return;
    if (!pathSection && pathname === `/${portal}`) {
      setOptimisticSection(null);
    }
  }, [pathSection, optimisticSection, pathname, portal]);

  const section = optimisticSection ?? pathSection;

  useEffect(() => {
    if (!section) return;
    setVisited((current) => {
      if (current.at(-1) === section) return current;
      return [...current.filter((item) => item !== section), section].slice(-MAX_KEPT_PANELS);
    });
  }, [section]);

  // Render the optimistic target immediately, then keep the eight most recent
  // consoles mounted (but hidden/inert) so their filters and open forms survive.
  const renderedPanels =
    section && !visited.includes(section) ? [...visited, section].slice(-MAX_KEPT_PANELS) : visited;

  return (
    <>
      <div hidden={section !== null} {...(section ? { inert: true } : {})}>
        {children}
      </div>
      {renderedPanels.map((panel) => {
        const active = panel === section;
        return (
          <div
            key={panel}
            className="portal-persisted-panel"
            hidden={!active}
            aria-hidden={!active || undefined}
            {...(!active ? { inert: true } : {})}
          >
            <OperationsWorkspaceClient portal={portal} section={panel} locale={locale} />
          </div>
        );
      })}
    </>
  );
}
