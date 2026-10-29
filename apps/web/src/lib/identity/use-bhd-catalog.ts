'use client';

import { hopOrigins, type BhdApp } from '@/lib/bhd/apps';
import {
  applyCatalogPayload,
  BHD_CATALOG_EVENT,
  fetchIdentityCatalog,
  getCachedCatalogApps,
} from '@/lib/bhd/catalog';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import { useEffect, useState } from 'react';

function hintOrigin(origin: string) {
  if (!origin || typeof document === 'undefined') return;
  if (document.head.querySelector(`link[data-bhd-hop="${origin}"]`)) return;
  const pre = document.createElement('link');
  pre.rel = 'preconnect';
  pre.href = origin;
  pre.setAttribute('data-bhd-hop', origin);
  document.head.appendChild(pre);
}

/** Live app grid from identity (`/api/bhd/catalog` + `bhd-catalog` events). */
export function useBhdCatalog() {
  const [apps, setApps] = useState<BhdApp[]>(() => getCachedCatalogApps());

  useEffect(() => {
    let cancelled = false;

    const apply = (payload: unknown) => {
      const next = applyCatalogPayload(payload);
      if (!next.length || cancelled) return;
      setApps(next);
      hopOrigins(next).forEach(hintOrigin);
    };

    function onCatalog(event: Event) {
      apply((event as CustomEvent).detail);
    }

    window.addEventListener(BHD_CATALOG_EVENT, onCatalog);

    void (async () => {
      const identity = await loadBhdIdentity(2000);
      if (cancelled) return;
      if (identity?.catalog) {
        try {
          const body = await identity.catalog();
          apply(body);
          return;
        } catch {
          /* fall through */
        }
      }
      const loaded = await fetchIdentityCatalog();
      if (!cancelled) {
        setApps(loaded);
        hopOrigins(loaded).forEach(hintOrigin);
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener(BHD_CATALOG_EVENT, onCatalog);
    };
  }, []);

  return apps;
}
