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
 * On first portal open: immediately warm every ops payload + prefetch shells
 * so sidebar navigation feels like in-page tabs (Qootk / WAZEN).
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
        await delay(60);
      }
    };

    const warmAllData = async () => {
      const applied = await warmAllOpsSections(portal);
      if (cancelled || applied > 0) return;
      for (const section of sections) {
        if (cancelled) return;
        await warmOpsSection(portal, section);
        await delay(80);
      }
    };

    // Start immediately — do not wait for idle (user may click within 1–2s).
    void warmAllData();
    void prefetchAllShells();

    return () => {
      cancelled = true;
    };
  }, [portal, router]);

  return null;
}
