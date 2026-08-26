'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';

/**
 * WAZEN-style idle prefetch: warm portal section RSC payloads in the client router cache
 * so sidebar clicks feel like returning to an already-open view.
 */
export function PortalRoutePrefetch({ portal }: { portal: PortalRole }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hrefs = portalNavHrefs(portal);
    let cancelled = false;
    const timers: number[] = [];
    let idleHandle: number | null = null;
    let usedIdleCallback = false;

    const run = () => {
      hrefs.forEach((href, index) => {
        timers.push(
          window.setTimeout(() => {
            if (cancelled) return;
            try {
              router.prefetch(href);
            } catch {
              /* ignore */
            }
          }, 180 + index * 120),
        );
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(() => run(), { timeout: 2_500 });
    } else {
      idleHandle = window.setTimeout(run, 600);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        if (usedIdleCallback && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleHandle);
        } else {
          window.clearTimeout(idleHandle);
        }
      }
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [portal, router]);

  return null;
}
