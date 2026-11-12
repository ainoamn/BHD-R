'use client';

import { useEffect, useState } from 'react';
import {
  claimProductSessionForActiveAu,
  ensureAuInUrl,
  identityMe,
} from '@/lib/identity/client';
import { keepUrlAuOverCookie, readActiveAu, setActiveAu } from '@/lib/identity/window-session';

export type TabAccountFace = {
  sub: string;
  email: string;
  name: string;
};

type MePayload = {
  email?: string;
  displayName?: string;
  currentSub?: string | null;
  accounts?: Array<{ sub: string; email?: string; name?: string }>;
};

/**
 * Single source of truth for the visible tab account.
 * Prefers a live product/cookie session; on book/pay journeys keeps ?au=
 * sticky when rebind fails so invite links never flip to the landlord cookie.
 */
export function useTabAccountFace(seed?: { email?: string | null; name?: string | null }) {
  const [face, setFace] = useState<TabAccountFace>(() => ({
    sub: '',
    email: seed?.email?.trim() || '',
    name: seed?.name?.trim() || '',
  }));

  useEffect(() => {
    let cancelled = false;

    const apply = (next: Partial<TabAccountFace>) => {
      if (cancelled) return;
      setFace((prev) => ({
        sub: (next.sub ?? prev.sub).trim(),
        email: (next.email ?? prev.email).trim(),
        name: (next.name ?? prev.name).trim(),
      }));
    };

    const faceFromAccounts = (
      sub: string,
      accounts: Array<{ sub?: string; id?: string; email?: string | null; name?: string | null }>,
      fallbackEmail?: string | null,
      fallbackName?: string | null,
    ): TabAccountFace => {
      const hit = accounts.find(
        (item) => (item.sub || item.id || '').trim() === sub,
      );
      return {
        sub,
        email: (hit?.email || fallbackEmail || '').trim(),
        name: (hit?.name || fallbackName || '').trim(),
      };
    };

    void (async () => {
      const au = readActiveAu();
      if (au) ensureAuInUrl(au);

      let me: MePayload | null = null;
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        me = response.ok ? ((await response.json()) as MePayload) : null;
      } catch {
        me = null;
      }
      if (cancelled) return;

      const cookieSub = (me?.currentSub || '').trim();
      const roster = me?.accounts ?? [];
      const stickyAu = keepUrlAuOverCookie();

      // ?au= disagrees with the live cookie session — rebind; on book/pay keep au.
      if (au && cookieSub && au !== cookieSub) {
        const claimed = await claimProductSessionForActiveAu().catch(() => ({ ok: false }));
        if (cancelled) return;
        if (claimed.ok) {
          try {
            const response = await fetch('/api/auth/me', {
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { accept: 'application/json' },
            });
            me = response.ok ? ((await response.json()) as MePayload) : me;
          } catch {
            /* keep prior */
          }
          const nextCookie = (me?.currentSub || '').trim();
          const nextRoster = me?.accounts ?? roster;
          if (nextCookie === au || !nextCookie) {
            apply(faceFromAccounts(au, nextRoster, me?.email, me?.displayName));
            return;
          }
          if (stickyAu) {
            // Cookie still wrong — show the URL account from the roster, do not steal au.
            apply(faceFromAccounts(au, nextRoster, seed?.email, seed?.name));
            ensureAuInUrl(au);
            return;
          }
          setActiveAu(nextCookie);
          ensureAuInUrl(nextCookie);
          apply(faceFromAccounts(nextCookie, nextRoster, me?.email, me?.displayName));
          return;
        }
        if (stickyAu) {
          apply(faceFromAccounts(au, roster, seed?.email, seed?.name));
          ensureAuInUrl(au);
          return;
        }
        setActiveAu(cookieSub);
        ensureAuInUrl(cookieSub);
        apply(faceFromAccounts(cookieSub, roster, me?.email, me?.displayName));
        return;
      }

      const sub = au || cookieSub;
      if (sub) {
        apply(
          faceFromAccounts(
            sub,
            roster,
            au && au === cookieSub ? me?.email : au ? seed?.email : me?.email,
            au && au === cookieSub ? me?.displayName : au ? seed?.name : me?.displayName,
          ),
        );
      } else if (me?.email) {
        apply({ sub: '', email: me.email, name: me.displayName || '' });
      }

      // Enrich name/phone picture fields from identity when this au has a bearer.
      try {
        const identity = await identityMe();
        if (cancelled || !identity) return;
        const identitySub = identity.user?.id?.trim() || '';
        const tabSub = readActiveAu() || identitySub;
        // Never overwrite an explicit ?au= with a different identity subject.
        if (identitySub && !readActiveAu()) {
          ensureAuInUrl(identitySub);
        }
        const accounts = identity.accounts ?? [];
        const hit = accounts.find((item) => (item.id || '').trim() === tabSub);
        if (hit?.email || hit?.name) {
          apply({
            sub: tabSub,
            ...(hit.email ? { email: hit.email } : {}),
            ...(hit.name ? { name: hit.name } : {}),
          });
        } else if (!readActiveAu() && identity.user?.email) {
          apply({
            sub: identitySub,
            email: identity.user.email,
            name: identity.user.name || '',
          });
        }
      } catch {
        /* ignore */
      }
    })();

    const onRebound = () => {
      if (cancelled) return;
      void fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
        .then(async (response) => (response.ok ? ((await response.json()) as MePayload) : null))
        .then((payload) => {
          if (!payload) return;
          const sub = readActiveAu() || payload.currentSub || '';
          if (!sub) {
            apply({ email: payload.email || '', name: payload.displayName || '' });
            return;
          }
          apply(
            faceFromAccounts(sub, payload.accounts ?? [], payload.email, payload.displayName),
          );
        })
        .catch(() => undefined);
    };
    window.addEventListener('bhd:account-rebound', onRebound);
    return () => {
      cancelled = true;
      window.removeEventListener('bhd:account-rebound', onRebound);
    };
  }, [seed?.email, seed?.name]);

  return face;
}
