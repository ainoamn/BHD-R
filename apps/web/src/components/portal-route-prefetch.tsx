'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { warmOpsSection } from '@/lib/portal-ops-client-cache';

/**
 * WAZEN-style idle prefetch:
 * 1) warm portal section RSC shells in the client router cache
 * 2) warm ops JSON payloads into in-memory cache so clicks paint instantly
 */
export function PortalRoutePrefetch({ portal }: { portal: PortalRole }) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hrefs = portalNavHrefs(portal);
    const sections = opsSectionsForPortal(portal);
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
          }, 120 + index * 80),
        );
      });

      sections.forEach((section, index) => {
        timers.push(
          window.setTimeout(() => {
            if (cancelled) return;
            warmOpsSection(portal, section);
          }, 200 + index * 220),
        );
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(() => run(), { timeout: 1_800 });
    } else {
      idleHandle = window.setTimeout(run, 400);
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
