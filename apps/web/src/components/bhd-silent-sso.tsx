'use client';

import { useEffect, useRef } from 'react';
import { applyAccountIsolation, identityMe } from '@/lib/identity/client';

type ProductMe = {
  authenticated?: boolean;
  /** Identity subject bound to the product session (compare with identity user.id). */
  currentSub?: string | null;
  id?: string;
};

/**
 * BHD-ACCOUNT-SWITCHER §3 — opening this site via URL (not the app grid) follows
 * the active identity account silently. No login screen, no add=1, no forced
 * logout of other roster accounts.
 */
export function BhdSilentSso() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Avoid interrupting OAuth / guest public pages / logout loops.
    const path = window.location.pathname;
    if (
      path.includes('/api/auth/bhd/') ||
      path.includes('/login') ||
      path.includes('/auth/') ||
      path.includes('/viewing-pass') ||
      path.includes('/viewing-gate') ||
      path.includes('/handover') ||
      path.includes('/verify/') ||
      /\/book\//.test(path)
    ) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const identity = await identityMe();
      if (cancelled || !identity?.user?.id) return;

      let product: ProductMe | null = null;
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (response.ok) {
          product = (await response.json()) as ProductMe;
        } else if (response.status === 401) {
          product = { authenticated: false, currentSub: null };
        }
      } catch {
        return;
      }
      if (cancelled || !product) return;

      const activeSub = identity.user.id;
      const productSub = product.currentSub || null;
      const guardKey = `bhd-silent-sso:${activeSub}`;

      // Same active account already bound — nothing to do.
      if (product.authenticated && productSub === activeSub) {
        try {
          sessionStorage.removeItem(guardKey);
        } catch {
          /* ignore */
        }
        return;
      }

      // Product JWT exists but identity subject not resolved yet — wait; don't thrash.
      if (product.authenticated && !productSub) return;

      // Identity active + product missing or on another account → silent start.
      try {
        if (sessionStorage.getItem(guardKey) === '1') return;
        sessionStorage.setItem(guardKey, '1');
      } catch {
        /* private mode — still attempt once */
      }

      applyAccountIsolation(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
