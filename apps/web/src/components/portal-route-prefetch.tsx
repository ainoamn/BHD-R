'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { OPS_WARM_DONE_EVENT, warmOpsSection } from '@/lib/portal-ops-client-cache';

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
}: {
  portal: PortalRole;
  staysEnabled?: boolean;
}) {
  const router = useRouter();
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
    const scan = () => {
      document.querySelectorAll<HTMLAnchorElement>('.portal-layout a[href]').forEach((anchor) => {
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
    const shell = document.querySelector('.portal-layout');
    if (shell)
      observer.observe(shell, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href'],
      });
    later(drain, 200);

    const sections = opsSectionsForPortal(portal);
    let index = 0;
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
      const payload = await warmOpsSection(portal, section);
      if (cancelled) return;
      if (section === 'properties' && payload) {
        for (const record of payload.records) {
          if (typeof record.id !== 'string') continue;
          const path = `/${portal}/properties/${encodeURIComponent(record.id)}`;
          enqueue(path);
          if (portal === 'owner') enqueue(`${path}/edit`);
        }
      }
      later(() => {
        void warmNext();
      }, 100);
    };
    later(() => {
      void warmNext();
    }, 200);
    const refreshQueue = () => {
      if (document.visibilityState === 'hidden') return;
      for (const href of portalNavHrefs(portal, staysEnabled)) enqueue(href);
      scan();
    };
    const interval = window.setInterval(refreshQueue, 60_000);
    document.addEventListener('visibilitychange', refreshQueue);
    return () => {
      cancelled = true;
      observer.disconnect();
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshQueue);
    };
  }, [portal, router, staysEnabled]);
  return null;
}
