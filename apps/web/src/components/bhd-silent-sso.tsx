'use client';

import {
  applyAccountIsolation,
  clearAccountRebindLock,
  isAccountRebindPending,
  isIdentityOrigin,
  productStartPath,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import { useEffect } from 'react';

/**
 * When identity window ≠ product session: rebind via Bearer (never blind /start).
 */
export function BhdSilentSso() {
  useEffect(() => {
    const path = window.location.pathname;
    if (
      isIdentityOrigin() ||
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

    if (isAccountRebindPending()) return;

    let cancelled = false;

    void loadBhdIdentity().then(async (identity) => {
      if (cancelled || !identity) return;
      try {
        const { ok, body } = await identity.me();
        if (cancelled || !ok || !body.user?.id) {
          clearAccountRebindLock();
          return;
        }

        const localResponse = await fetch('/api/auth/me', {
          cache: 'no-store',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        const local = (await localResponse.json().catch(() => ({}))) as {
          authenticated?: boolean;
          currentSub?: string | null;
        };
        if (cancelled) return;

        const productSub = local.currentSub || null;
        if (local.authenticated && productSub === body.user.id) {
          clearAccountRebindLock();
          return;
        }

        const guardKey = `bhd-sso:${body.user.id}`;
        const last = Number(sessionStorage.getItem(guardKey) || '0');
        if (last && Date.now() - last < 15_000) return;
        sessionStorage.setItem(guardKey, String(Date.now()));

        if (!local.authenticated || !productSub) {
          const here = `${window.location.pathname}${window.location.search || ''}` || '/ar/portal';
          window.location.replace(identity.productStart(here) || productStartPath(here));
          return;
        }

        await applyAccountIsolation(body.token, { force: true });
      } catch {
        clearAccountRebindLock();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
