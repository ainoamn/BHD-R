'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import {
  opsSectionsForPortal,
  OPS_WARM_ORDER,
  type OperationsSection,
} from '@/lib/portal-ops-types';
import {
  getOpsCache,
  hasOpsInflight,
  OPS_WARM_DONE_EVENT,
  warmAllOpsSections,
  warmOpsSection,
} from '@/lib/portal-ops-client-cache';
import { warmTenantSpace } from '@/lib/tenant-space-client-cache';

const PROPERTY_SEED_LIMIT = 6;
/** Background work waits this long after the page finished loading its own data. */
const SETTLE_MS = 400;

/** Only authenticated, same-portal page links are eligible for background work. */
export function portalPrefetchHref(
  href: string,
  origin: string,
  portal: PortalRole,
): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return null;
    const path = url.pathname.replace(/^\/(ar|en)(?=\/)/, '');
    if (path !== `/${portal}` && !path.startsWith(`/${portal}/`)) return null;
    return path + url.search;
  } catch {
    return null;
  }
}

/** Restartable warm-up: sidebar, forms and discovered record links share a paced queue. */
export function PortalRoutePrefetch({
  portal,
  staysEnabled = false,
  sections: allowed,
}: {
  portal: PortalRole;
  staysEnabled?: boolean;
  /** Sections this viewer may open; the others would only answer 403. */
  sections: readonly OperationsSection[];
}) {
  const router = useRouter();
  const allowedKey = allowed.join(',');
  useEffect(() => {
    let cancelled = false;
    const queue: string[] = [];
    const queued = new Set<string>();
    const fresh = new Set<string>();
    const timers = new Set<number>();
    const later = (callback: () => void, ms: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
    };
    const enqueue = (href: string) => {
      const path = portalPrefetchHref(href, window.location.origin, portal);
      if (!path || queued.has(path) || fresh.has(path)) return;
      queued.add(path);
      queue.push(path);
    };
    // Sidebar links only: record, edit and create links are heavy server renders that used to
    // compete with the visible page's own data on every refresh.
    const scan = () => {
      document.querySelectorAll<HTMLAnchorElement>('.portal-nav a[href]').forEach((anchor) => {
        if (anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
        enqueue(anchor.href);
      });
    };
    const drain = () => {
      if (cancelled) return;
      if (document.visibilityState !== 'hidden') {
        const href = queue.shift();
        if (href) {
          queued.delete(href);
          fresh.add(href);
          try {
            router.prefetch(href, {
              onInvalidate: () => {
                fresh.delete(href);
              },
            });
          } catch {
            fresh.delete(href);
          }
        }
      }
      // router.prefetch returns void; this paces scheduling, not network completion.
      later(drain, 250);
    };
    for (const href of portalNavHrefs(portal, staysEnabled)) enqueue(href);
    scan();
    let scanPending = false;
    const observer = new MutationObserver(() => {
      if (scanPending) return;
      scanPending = true;
      later(() => {
        scanPending = false;
        scan();
      }, 200);
    });
    const nav = document.querySelector('.portal-nav');
    if (nav)
      observer.observe(nav, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href'],
      });

    const permitted = new Set(allowedKey.split(','));
    const sections = OPS_WARM_ORDER.filter(
      (section) => opsSectionsForPortal(portal).includes(section) && permitted.has(section),
    );
    let index = 0;
    const seedProperties = (payload: Awaited<ReturnType<typeof warmOpsSection>> | null) => {
      if (!payload) return;
      for (const record of payload.records.slice(0, PROPERTY_SEED_LIMIT)) {
        if (typeof record.id !== 'string') continue;
        enqueue(`/${portal}/properties/${encodeURIComponent(record.id)}`);
      }
    };
    const warmNext = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') {
        later(() => {
          void warmNext();
        }, 1000);
        return;
      }
      const section = sections[index++];
      if (!section) {
        window.dispatchEvent(new CustomEvent(OPS_WARM_DONE_EVENT, { detail: { portal } }));
        return;
      }
      // Batch warm usually filled the cache; only hit sections still cold.
      if (getOpsCache(portal, section)) {
        if (section === 'properties') seedProperties(getOpsCache(portal, section));
        later(() => {
          void warmNext();
        }, 40);
        return;
      }
      const payload = await warmOpsSection(portal, section);
      if (cancelled) return;
      if (section === 'properties') seedProperties(payload);
      later(() => {
        void warmNext();
      }, 120);
    };
    // Start only once the visible page has its data, so a refresh never waits behind warm-up.
    const begin = () => {
      if (cancelled) return;
      if (document.readyState !== 'complete' || hasOpsInflight()) {
        later(begin, 200);
        return;
      }
      later(drain, 0);
      if (portal === 'tenant') {
        void warmTenantSpace();
      } else {
        // One round-trip fills most section caches; cold leftovers follow in warmNext.
        void warmAllOpsSections(portal).finally(() => {
          if (cancelled) return;
          seedProperties(getOpsCache(portal, 'properties'));
          void warmNext();
        });
      }
    };
    later(begin, SETTLE_MS);
    const refreshQueue = () => {
      if (document.visibilityState === 'hidden') return;
      for (const href of portalNavHrefs(portal, staysEnabled)) enqueue(href);
      scan();
    };
    // BHD-SESSION-POLICY: no network work triggered by visibilitychange / focus on tab return.
    const interval = window.setInterval(refreshQueue, 60_000);
    return () => {
      cancelled = true;
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [allowedKey, portal, router, staysEnabled]);
  return null;
}
