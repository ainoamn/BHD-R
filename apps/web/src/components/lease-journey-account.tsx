'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Viewer } from '@/lib/types';
import { ensureAuInUrl } from '@/lib/identity/client';
import { readActiveAu } from '@/lib/identity/window-session';

const BhdAppSwitcher = dynamic(
  () => import('@/components/bhd-app-switcher').then((mod) => mod.BhdAppSwitcher),
  { ssr: false },
);

function shortAccountLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const local = trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed;
  return local.length > 14 ? `${local.slice(0, 12)}…` : local;
}

/**
 * Booking journey pages hide the site header — keep a compact account control so multi-tab
 * users can see and switch which ?au= this tab is bound to.
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

  const chip = shortAccountLabel(label) || (ar ? 'حسابي' : 'Account');

  return (
    <div className="guest-stay-detail__account" title={label}>
      <span className="guest-stay-detail__account-label">{chip}</span>
      <BhdAppSwitcher viewer={viewer} locale={locale} />
    </div>
  );
}
