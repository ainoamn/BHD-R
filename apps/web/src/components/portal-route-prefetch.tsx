'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { warmAllOpsSections, warmOpsSection } from '@/lib/portal-ops-client-cache';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * On first portal open: prefetch every sidebar route shell + warm every ops
 * payload into memory so later clicks feel already loaded (WAZEN-style).
 * Work is backgrounded and serialized enough to avoid Nest request storms.
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

    const prefetchAllShells = async () => {
      for (const href of hrefs) {
        if (cancelled) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await delay(80);
      }
    };

    const warmAllData = async () => {
      // One batch endpoint fills the in-memory ops cache for the whole portal.
      const applied = await warmAllOpsSections(portal);
      if (cancelled || applied > 0) return;

      // Fallback: section-by-section if batch fails (e.g. older deploy edge).
      for (const section of sections) {
        if (cancelled) return;
        await warmOpsSection(portal, section);
        await delay(120);
      }
    };

    const start = () => {
      void prefetchAllShells();
      void warmAllData();
    };

    let idleHandle: number | null = null;
    let usedIdleCallback = false;
    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(start, { timeout: 800 });
    } else {
      idleHandle = window.setTimeout(start, 200);
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
    };
  }, [portal, router]);

  return null;
}
