'use client';

import { usePathname } from '@/i18n/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { OperationsWorkspaceClient } from '@/components/operations-workspace-client';
import { OPS_WARM_DONE_EVENT } from '@/lib/portal-ops-client-cache';
import {
  isOperationsSection,
  opsSectionsForPortal,
  type OperationsSection,
} from '@/lib/portal-ops-types';
import type { PortalRole } from '@/lib/types';

/** Keep every ops console mounted after warm so sidebar hops never remount. */
const MAX_KEPT_PANELS = 24;
/** Soft-cache visited RSC pages (dashboard, stays, property detail, …). */
const MAX_CACHED_PAGES = 12;

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

function prunePageCache(
  cache: Record<string, ReactNode>,
  keepPath: string,
): Record<string, ReactNode> {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHED_PAGES) return cache;
  const next = { ...cache };
  for (const key of keys) {
    if (Object.keys(next).length <= MAX_CACHED_PAGES) break;
    if (key !== keepPath) delete next[key];
  }
  return next;
}

/**
 * Qootk / WAZEN-style soft nav: ops sections render inside the persistent portal
 * shell; non-ops pages stay cached so back/forward feels in-page.
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
  const [pageCache, setPageCache] = useState<Record<string, ReactNode>>({});
  const [pageDisplay, setPageDisplay] = useState<ReactNode>(children);
  const prevPathRef = useRef(pathname);
  const prevChildrenRef = useRef(children);
  const prevSectionRef = useRef(pathSection);

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
    const onWarmDone = (event: Event) => {
      const detail = (event as CustomEvent<{ portal: PortalRole }>).detail;
      if (!detail || detail.portal !== portal) return;
      const all = opsSectionsForPortal(portal);
      setVisited((current) => {
        const merged = [...current];
        for (const section of all) {
          if (!merged.includes(section)) merged.push(section);
        }
        return merged.slice(-MAX_KEPT_PANELS);
      });
    };
    window.addEventListener(OPS_WARM_DONE_EVENT, onWarmDone);
    return () => window.removeEventListener(OPS_WARM_DONE_EVENT, onWarmDone);
  }, [portal]);

  useEffect(() => {
    if (optimisticSection && pathSection === optimisticSection) {
      setOptimisticSection(null);
    }
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

  // Paint cached non-ops page immediately on return; refresh when RSC children arrive.
  useLayoutEffect(() => {
    if (section) return;
    const cached = pageCache[pathname];
    if (cached) setPageDisplay(cached);
  }, [pathname, section, pageCache]);

  useEffect(() => {
    if (section) return;
    setPageDisplay(children);
    setPageCache((prev) => prunePageCache({ ...prev, [pathname]: children }, pathname));
  }, [pathname, children, section]);

  // Retain previous non-ops page when navigating away (covers ops hops too).
  useLayoutEffect(() => {
    const previousPath = prevPathRef.current;
    const previousSection = prevSectionRef.current;
    const previousChildren = prevChildrenRef.current;

    if (previousPath !== pathname && !previousSection) {
      setPageCache((prev) =>
        prunePageCache({ ...prev, [previousPath]: previousChildren }, pathname),
      );
    }

    prevPathRef.current = pathname;
    prevChildrenRef.current = children;
    prevSectionRef.current = pathSection;
  }, [pathname, children, pathSection]);

  const renderedPanels =
    section && !visited.includes(section) ? [...visited, section].slice(-MAX_KEPT_PANELS) : visited;

  const inactiveCachedPaths = Object.keys(pageCache).filter((path) => path !== pathname);

  return (
    <>
      {inactiveCachedPaths.map((path) => (
        <div key={path} className="portal-persisted-page" hidden aria-hidden inert>
          {pageCache[path]}
        </div>
      ))}
      <div
        className="portal-persisted-page"
        hidden={section !== null}
        aria-hidden={section !== null || undefined}
        {...(section ? { inert: true } : {})}
      >
        {section ? children : pageDisplay}
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
