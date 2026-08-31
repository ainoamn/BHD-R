'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { warmOpsSection } from '@/lib/portal-ops-client-cache';

/**
 * Idle prefetch — warm a very small route budget, one request at a time.
 * Nest is kept awake separately; route-shell prefetch must never wait for it.
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
    let idleHandle: number | null = null;
    let usedIdleCallback = false;
    let chainTimer: number | null = null;

    const runSerialized = async () => {
      // Prefetch only the first few shells (dashboard + common pages), one at a time.
      const shellBudget = hrefs.slice(0, 4);
      for (const [index, href] of shellBudget.entries()) {
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          chainTimer = window.setTimeout(() => {
            try {
              router.prefetch(href);
            } catch {
              /* ignore */
            }
            resolve();
          }, index === 0 ? 0 : 450);
        });
      }

      // Warm Neon-first sections so soft nav paints from memory.
      const neonFirst = new Set([
        'properties',
        'contacts',
        'approvals',
        'invoices',
        'expenses',
        'maintenance',
      ]);
      const opsBudget = sections.filter((s) => neonFirst.has(s)).slice(0, 6);
      for (const section of opsBudget) {
        if (cancelled) return;
        await warmOpsSection(portal, section);
        await new Promise((resolve) => {
          chainTimer = window.setTimeout(resolve, 350);
        });
      }
    };

    const start = () => {
      void runSerialized();
    };

    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(start, { timeout: 1_500 });
    } else {
      idleHandle = window.setTimeout(start, 500);
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
      if (chainTimer !== null) window.clearTimeout(chainTimer);
    };
  }, [portal, router]);

  return null;
}
