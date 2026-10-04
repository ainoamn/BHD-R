'use client';

import { useEffect } from 'react';

const WARM_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Keeps Nest (Render) from sleeping while a portal page is open.
 * Hits a same-origin warm route that never reads or writes session cookies.
 * BHD-SESSION-POLICY: no visibilitychange / focus / pointerdown listeners here.
 */
export function NestKeepAlive() {
  useEffect(() => {
    let cancelled = false;
    let pending = false;

    const ping = () => {
      if (cancelled || pending || document.visibilityState === 'hidden') return;
      pending = true;
      void fetch('/api/warm', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(6_000),
      })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };

    ping();
    const id = window.setInterval(ping, WARM_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
