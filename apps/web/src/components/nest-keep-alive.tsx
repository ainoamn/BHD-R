'use client';

import { useEffect } from 'react';

const WARM_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Keeps Nest (Render) from sleeping while a portal session is open.
 * Hits a same-origin warm route so cold starts do not hit every navigation/save.
 */
export function NestKeepAlive() {
  useEffect(() => {
    let cancelled = false;

    const ping = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      void fetch('/api/warm', {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      }).catch(() => undefined);
    };

    ping();
    const id = window.setInterval(ping, WARM_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', ping);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', ping);
    };
  }, []);

  return null;
}
