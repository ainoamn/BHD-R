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

/**
 * Always-visible tab account: email (and name) for the active ?au=, plus the switcher.
 * Prefer identity Bearer over the shared product cookie so multi-account tabs stay honest.
 */
export function ActiveAccountChip({
  viewer,
  locale,
  compact = false,
  className,
}: {
  viewer: Viewer;
  locale: 'ar' | 'en';
  /** Shorter label for tight chrome (esign / portal). */
  compact?: boolean;
  className?: string;
}) {
  const ar = locale === 'ar';
  const [email, setEmail] = useState(() => viewer.email?.trim() || '');
  const [name, setName] = useState(() => viewer.displayName?.trim() || '');

  useEffect(() => {
    const au = readActiveAu();
    if (au) ensureAuInUrl(au);
    let cancelled = false;

    const apply = (nextEmail?: string | null, nextName?: string | null) => {
      const e = nextEmail?.trim() || '';
      const n = nextName?.trim() || '';
      if (e) setEmail(e);
      if (n) setName(n);
    };

    void identityMe()
      .then((payload) => {
        if (cancelled || !payload) return;
        const identitySub = payload.user?.id?.trim();
        if (identitySub) ensureAuInUrl(identitySub);
        const tabSub = readActiveAu() || identitySub || '';
        const fromRoster = payload.accounts?.find((item) => (item.id || '').trim() === tabSub);
        apply(
          fromRoster?.email || payload.user?.email,
          fromRoster?.name || payload.user?.name,
        );
      })
      .catch(() => undefined);

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
          apply(me.email, me.displayName);
          return;
        }
        const match = me.accounts?.find((item) => item.sub === tabSub);
        if (match) apply(match.email, match.name);
        else if (me.currentSub === tabSub) apply(me.email, me.displayName);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [viewer.displayName, viewer.email]);

  const primary = email || name || (ar ? 'حسابي' : 'Account');
  const showName = Boolean(name && email && name.toLowerCase() !== email.toLowerCase());
  const title = showName ? `${name} · ${email}` : primary;

  return (
    <div
      className={['active-account-chip', compact ? 'active-account-chip--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      <span className="active-account-chip__text">
        {showName && !compact ? (
          <>
            <strong className="active-account-chip__name">{name}</strong>
            <span className="active-account-chip__email" dir="ltr">
              {email}
            </span>
          </>
        ) : (
          <span className="active-account-chip__email" dir="ltr">
            {compact && email.includes('@') ? email.slice(0, email.indexOf('@') + 1) + '…' : primary}
          </span>
        )}
      </span>
      <BhdAppSwitcher viewer={viewer} locale={locale} />
    </div>
  );
}
