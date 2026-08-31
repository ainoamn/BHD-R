'use client';

import { usePathname, useRouter } from '@/i18n/navigation';
import { useEffect, useRef } from 'react';

/** Light public shells — no portal ops, no heavy media downloads. */
const MARKETING_SHELLS = [
  '/',
  '/properties',
  '/trust',
  '/privacy',
  '/terms',
  '/accessibility',
  '/portal',
] as const;

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
 * Same idea as the owner portal warm: on first public visit, prefetch marketing
 * route shells (+ a few listing detail URLs from a light catalogue JSON) so
 * header navigation feels already loaded without a data/bandwidth storm.
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
      for (const href of MARKETING_SHELLS) {
        if (cancelled) return;
        try {
          router.prefetch(href);
        } catch {
          /* ignore */
        }
        await delay(70);
      }
    };

    const warmListingDetails = async () => {
      try {
        const response = await fetch('/api/public/catalogue?limit=8', {
          credentials: 'same-origin',
          cache: 'force-cache',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(6_000),
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          data?: Array<{ id?: string; unitId?: string; propertyId?: string }>;
        };
        const rows = Array.isArray(body.data) ? body.data : [];
        for (const row of rows.slice(0, 6)) {
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
          await delay(90);
        }
      } catch {
        /* catalogue warm is best-effort */
      }
    };

    void prefetchShells();
    void warmListingDetails();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
