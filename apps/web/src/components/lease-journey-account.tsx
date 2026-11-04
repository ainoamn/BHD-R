'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Viewer } from '@/lib/types';
import { ensureAuInUrl, readActiveAu } from '@/lib/identity/client';

const BhdAppSwitcher = dynamic(
  () => import('@/components/bhd-app-switcher').then((mod) => mod.BhdAppSwitcher),
  { ssr: false },
);

/**
 * Booking journey pages hide the site header — keep a compact account chip so multi-tab
 * users can see which ?au= this tab is bound to.
 */
export function LeaseJourneyAccount({
  viewer,
  locale,
}: {
  viewer: Viewer;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [label, setLabel] = useState(
    () => viewer.email?.trim() || viewer.displayName?.trim() || (ar ? 'حسابي' : 'Account'),
  );

  useEffect(() => {
    ensureAuInUrl(readActiveAu() || undefined);
    let cancelled = false;
    fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          email?: string;
          displayName?: string;
          currentSub?: string | null;
          accounts?: Array<{ sub: string; email?: string; name?: string }>;
        };
      })
      .then((me) => {
        if (cancelled || !me) return;
        if (me.currentSub) ensureAuInUrl(me.currentSub);
        const active = me.accounts?.find((item) => item.sub === me.currentSub);
        const next =
          active?.email?.trim() ||
          active?.name?.trim() ||
          me.email?.trim() ||
          me.displayName?.trim();
        if (next) setLabel(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="guest-stay-detail__account">
      <span className="guest-stay-detail__account-label" title={label}>
        {label}
      </span>
      <BhdAppSwitcher viewer={viewer} locale={locale} />
    </div>
  );
}
