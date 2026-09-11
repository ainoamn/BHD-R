'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';

/**
 * Background warm for a seamless public experience:
 * paint the current page first, then prefetch the rest so header hops feel in-place.
 * Heavy catalogue routes start after a short idle — Neon reads are capped (0.4.81+).
 */
const MARKETING_SHELLS_FAST = ['/', '/trust'] as const;
const MARKETING_SHELLS_HEAVY = ['/properties', '/stays'] as const;

function isPortalChromePath(pathname: string): boolean {
  return /^\/(platform|owner|developer|tenant|login|forgot-password|reset-password|activate)(\/|$)/.test(
    pathname,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * On first public visit: prefetch marketing shells + a few listing detail URLs
 * so navigation feels like the same page (no full reload sensation).
 */
export function MarketingRoutePrefetch() {
  const pathname = usePathname();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (isPortalChromePath(pathname)) return;
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    const prefetchShells = async () => {
      for (const href of MARKETING_SHELLS_FAST) {
        if (cancelled) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await delay(50);
      }
      // Yield longer so the current page owns Neon before catalogue prefetches pile on.
      await delay(1200);
      for (const href of MARKETING_SHELLS_HEAVY) {
        if (cancelled) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await delay(400);
      }
    };

    const warmListingDetails = async () => {
      await delay(2500);
      try {
        const response = await fetch('/api/public/catalogue?limit=6', {
          credentials: 'same-origin',
          cache: 'force-cache',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          data?: Array<{ id?: string; unitId?: string; propertyId?: string }>;
        };
        const rows = Array.isArray(body.data) ? body.data : [];
        for (const row of rows.slice(0, 4)) {
          if (cancelled) return;
          const href = row.propertyId
            ? `/properties/${row.propertyId}`
            : row.unitId
              ? `/units/${row.unitId}`
              : null;
          if (!href) continue;
          try {
            router.prefetch(href);
          } catch {
            /* ignore */
          }
          await delay(250);
        }
      } catch {
        /* catalogue warm is best-effort */
      }
    };

    void prefetchShells();
    // On unit/property detail pages, don't compete with the gallery for bandwidth.
    if (!/^\/(units|properties)\//.test(pathname)) {
      void warmListingDetails();
    }

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
