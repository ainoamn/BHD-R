'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  hasHostileProductCookie,
  markHostileProductCookie,
  productSessionMatchesTab,
  watchProductCookieOwner,
} from '@/lib/identity/client';
import { readActiveAu } from '@/lib/identity/window-session';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import { markOpsCacheStale } from '@/lib/portal-ops-client-cache';

const POLL_MS = 3_000;
/** When live sync is unavailable (migration missing, signed out), check again rarely. */
const BACKOFF_MS = 5 * 60_000;

/**
 * Keeps the open page in step with changes made from any account or device.
 * Polls a tiny change version; only when it moves does it refetch data
 * (server components via a soft refresh, client panels via events). Hidden
 * tabs skip polling, and nothing refreshes unless the data really changed
 * (BHD-SESSION-POLICY: no refresh on focus/visibility alone).
 *
 * Multi-account: never refresh while another tab owns the shared cookie and
 * this tab is bound to a different ?au= (stops instant cross-tab switch).
 */
export function LiveSync({ booking, reference }: { booking?: string; reference?: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  /** Survives effect restarts so `router.refresh()` cannot clear the last seen version. */
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    const query =
      booking && reference
        ? `?booking=${encodeURIComponent(booking)}&ref=${encodeURIComponent(reference)}`
        : '';
    let timer: number | undefined;
    let cancelled = false;

    const schedule = (ms: number) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), ms);
    };

    const announce = async () => {
      if (hasHostileProductCookie()) return;
      if (!(await productSessionMatchesTab())) return;
      markOpsCacheStale();
      window.dispatchEvent(new Event(LIVE_CHANGE_EVENT));
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      routerRef.current.refresh();
    };

    async function tick() {
      if (cancelled) return;
      if (document.hidden) return schedule(POLL_MS);
      if (hasHostileProductCookie()) return schedule(POLL_MS);
      try {
        const response = await fetch(`/api/live/pulse${query}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return schedule(BACKOFF_MS);
        const { v } = (await response.json()) as { v?: string | null };
        if (!v) return schedule(BACKOFF_MS);
        if (lastRef.current !== null && v !== lastRef.current && !cancelled) await announce();
        lastRef.current = v;
      } catch {
        /* network hiccup: try again on the next beat */
      }
      schedule(POLL_MS);
    }

    const onVisible = () => {
      // Do not pulse immediately on focus — cookie reclaim may still be in flight.
      // Next regular beat is enough; avoids refresh thrash across windows.
      if (!document.hidden) schedule(POLL_MS);
    };

    const stopWatch = watchProductCookieOwner((ownerSub) => {
      const au = readActiveAu();
      if (au && ownerSub !== au) markHostileProductCookie(ownerSub);
    });

    schedule(1_200);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      stopWatch();
    };
  }, [booking, reference]);

  return null;
}
