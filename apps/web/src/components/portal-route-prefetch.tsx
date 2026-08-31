'use client';

import { useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';
import type { PortalRole } from '@/lib/types';
import { portalNavHrefs } from '@/lib/portal-nav-paths';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { warmOpsSection } from '@/lib/portal-ops-client-cache';

/**
 * Idle prefetch — serialized and delayed so Nest cold-start is not flooded
 * (parallel prefetch of ~20 RSC + ops sections caused 20–160s hangs).
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
      // Prefer a short Nest warm; never block if it fails.
      try {
        await fetch('/api/warm', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(4_000),
        });
      } catch {
        /* ignore — continue with light prefetch */
      }
      if (cancelled) return;

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
          }, index === 0 ? 400 : 700);
        });
      }

      // Warm at most 2 ops JSON payloads (Neon-friendly sections first).
      const opsBudget = sections.filter((s) => s === 'properties' || s === 'contacts').slice(0, 2);
      for (const section of opsBudget) {
        if (cancelled) return;
        await warmOpsSection(portal, section);
        await new Promise((resolve) => {
          chainTimer = window.setTimeout(resolve, 500);
        });
      }
    };

    const start = () => {
      void runSerialized();
    };

    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true;
      idleHandle = window.requestIdleCallback(start, { timeout: 3_500 });
    } else {
      idleHandle = window.setTimeout(start, 900);
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
