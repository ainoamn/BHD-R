'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { Viewer } from '@/lib/types';
import { ensureAuInUrl, identityMe } from '@/lib/identity/client';
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
 * Booking journey pages hide the site header — compact account control for this tab's ?au=.
 * Must not read the shared product cookie label (other tabs steal that cookie).
 */
export function LeaseJourneyAccount({
  viewer,
  locale,
}: {
  viewer: Viewer;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [fullLabel, setFullLabel] = useState(() => (ar ? 'حسابي' : 'Account'));

  useEffect(() => {
    const au = readActiveAu();
    if (au) ensureAuInUrl(au);
    let cancelled = false;

    const applyLabel = (email?: string | null, name?: string | null) => {
      const next = email?.trim() || name?.trim();
      if (next) setFullLabel(next);
    };

    // Tab identity Bearer → correct account even when product cookie is the other tab.
    void identityMe()
      .then((payload) => {
        if (cancelled || !payload) return;
        const identitySub = payload.user?.id?.trim();
        if (identitySub) ensureAuInUrl(identitySub);
        const tabSub = readActiveAu() || identitySub || '';
        const fromRoster = payload.accounts?.find(
          (item) => (item.id || '').trim() === tabSub,
        );
        applyLabel(
          fromRoster?.email || payload.user?.email,
          fromRoster?.name || payload.user?.name,
        );
      })
      .catch(() => undefined);

    // Roster from product /me only to resolve email for ?au= — never adopt cookie currentSub.
    void fetch('/api/auth/me', {
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
        const tabSub = readActiveAu();
        if (!tabSub) {
          // No ?au= yet — only then fall back to cookie session label.
          applyLabel(me.email, me.displayName);
          return;
        }
        const match = me.accounts?.find((item) => item.sub === tabSub);
        if (match) applyLabel(match.email, match.name);
        else if (
          me.currentSub === tabSub &&
          (me.email?.trim() || me.displayName?.trim())
        ) {
          applyLabel(me.email, me.displayName);
        }
        // If cookie is another account, keep identityMe label — do not overwrite with viewer/cookie.
      })
      .catch(() => undefined);

    // SSR viewer only if it already matches this tab (avoids flashing the other account).
    const viewerEmail = viewer.email?.trim();
    if (!au && viewerEmail) applyLabel(viewerEmail, viewer.displayName);

    return () => {
      cancelled = true;
    };
  }, [viewer.displayName, viewer.email]);

  const short = shortAccountLabel(fullLabel) || (ar ? 'حسابي' : 'Account');

  return (
    <div className="guest-stay-detail__account" title={fullLabel}>
      <span className="guest-stay-detail__account-label">{short}</span>
      <BhdAppSwitcher viewer={viewer} locale={locale} />
    </div>
  );
}
