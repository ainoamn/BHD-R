'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
 */
export function LiveSync({ booking, reference }: { booking?: string; reference?: string }) {
  const router = useRouter();

  useEffect(() => {
    const query =
      booking && reference
        ? `?booking=${encodeURIComponent(booking)}&ref=${encodeURIComponent(reference)}`
        : '';
    let last: string | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const schedule = (ms: number) => {
      if (!cancelled) timer = window.setTimeout(() => void tick(), ms);
    };

    const announce = () => {
      markOpsCacheStale();
      window.dispatchEvent(new Event(LIVE_CHANGE_EVENT));
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      router.refresh();
    };

    async function tick() {
      if (document.hidden) return schedule(POLL_MS);
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
        if (last !== null && v !== last && !cancelled) announce();
        last = v;
      } catch {
        /* network hiccup: try again on the next beat */
      }
      schedule(POLL_MS);
    }

    schedule(500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [booking, reference, router]);

  return null;
}
