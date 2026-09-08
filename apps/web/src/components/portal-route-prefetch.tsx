'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import {
  OPS_WARM_DONE_EVENT,
  warmAllOpsSections,
  warmOpsSection,
} from '@/lib/portal-ops-client-cache';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Background portal warm: serial RSC prefetch for every sidebar href + one
 * batch ops data warm. Starts almost immediately so early clicks hit cache.
 * Concurrency is serial (not a parallel storm) — see 0.2.97 hang history.
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
    let cancelled = false;

    const prefetchAllShells = async () => {
      // Brief pause so the first paint / active section fetch can start first.
      await delay(200);
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

    const warmPriorityThenAll = async () => {
      // Seed the highest-traffic panes first (no multi-second wait).
      const priority = sections.slice(0, 4);
      await Promise.all(priority.map((section) => warmOpsSection(portal, section)));
      if (cancelled) return;

      const applied = await warmAllOpsSections(portal);
      if (cancelled) return;

      if (applied === 0) {
        for (const section of sections) {
          if (cancelled) return;
          if (priority.includes(section)) continue;
          await warmOpsSection(portal, section);
          await delay(80);
        }
      }

      if (!cancelled) {
        window.dispatchEvent(
          new CustomEvent(OPS_WARM_DONE_EVENT, { detail: { portal } }),
        );
      }
    };

    void warmPriorityThenAll();
    void prefetchAllShells();

    return () => {
      cancelled = true;
    };
  }, [portal, router, staysEnabled]);

  return null;
}
