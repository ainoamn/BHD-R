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
 * Warm ops data through one background batch. Ops UI lives in the persistent
 * shell, so prefetch only non-ops routes and avoid another RSC request storm.
 */
export function PortalRoutePrefetch({
  portal,
  staysEnabled = false,
}: {
  portal: PortalRole;
  staysEnabled?: boolean;
}) {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hrefs = portalNavHrefs(portal, staysEnabled);
    const sections = opsSectionsForPortal(portal);
    const sectionSet = new Set<string>(sections);
    let cancelled = false;

    const prefetchRouteShells = async () => {
      const routeBudget = hrefs.filter((href) => {
        const candidate = href.split('/').filter(Boolean).at(-1) ?? '';
        return !sectionSet.has(candidate);
      });
      for (const href of routeBudget) {
        if (cancelled) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await delay(120);
      }
    };

    const warmAllData = async () => {
      // Prioritize the section the user is looking at before background-warming the rest.
      if (sections.includes('properties')) {
        await warmOpsSection(portal, 'properties');
      }
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
    void prefetchRouteShells();

    return () => {
      cancelled = true;
    };
  }, [portal, router, staysEnabled]);

  return null;
}
