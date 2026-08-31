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
    let pending = false;
    let lastPingAt = 0;

    const ping = () => {
      const now = Date.now();
      if (
        cancelled ||
        pending ||
        document.visibilityState === 'hidden' ||
        now - lastPingAt < 60_000
      )
        return;
      pending = true;
      lastPingAt = now;
      void fetch('/api/warm', {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(6_000),
      })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
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
