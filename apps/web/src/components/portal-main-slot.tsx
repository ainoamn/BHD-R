'use client';

import { usePathname } from '@/i18n/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { PortalPageContext } from '@/components/portal-page';
import {
  isOperationsSection,
  opsSectionsForPortal,
  type OperationsSection,
} from '@/lib/portal-ops-types';
import type { PortalRole } from '@/lib/types';

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
          <OperationsWorkspaceClient
            portal={portal}
            section={panel}
            locale={locale}
            active={panel === section}
          />
        </div>
      ))}
    </PortalPageContext.Provider>
  );
}
