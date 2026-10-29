'use client';

import {
  applyAccountIsolation,
  clearAccountRebindLock,
  isAccountRebindPending,
  isIdentityOrigin,
  productStartPath,
  scrubCacheBustFromUrl,
  SILENT_SSO_GUARD_MS,
  tabMayClaimProductCookie,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import { boundWindowToken, readActiveAu, setActiveAu } from '@/lib/identity/window-session';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function BhdSilentSso() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const onRebound = () => {
      startTransition(() => {
        try {
          router.refresh();
        } catch {
          /* no-op */
        }
      });
    };
    window.addEventListener('bhd:account-rebound', onRebound);
    return () => window.removeEventListener('bhd:account-rebound', onRebound);
  }, [router, startTransition]);

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

    let cancelled = false;
    let timer = 0;

    async function reconcile() {
      if (cancelled || isAccountRebindPending() || document.hidden) return;
      try {
        const au = readActiveAu();
        if (au) setActiveAu(au);

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
        if (local.authenticated && productSub && au && productSub === au) {
          clearAccountRebindLock();
          scrubCacheBustFromUrl();
          return;
        }

        // Background tabs must not steal the shared cookie.
        if (!tabMayClaimProductCookie()) return;

        const identity = await loadBhdIdentity();
        if (cancelled || !identity) return;
        const { ok, body } = await identity.me();
        if (cancelled || !ok || !body.user?.id) {
          clearAccountRebindLock();
          return;
        }

        const identityId = body.user.id;
        const targetAu = au || identityId;

        if (
          local.authenticated &&
          productSub &&
          productSub === identityId &&
          productSub === targetAu
        ) {
          clearAccountRebindLock();
          scrubCacheBustFromUrl();
          return;
        }

        const guardKey = `bhd-sso:${targetAu || identityId}`;
        const last = Number(sessionStorage.getItem(guardKey) || '0');
        if (last && Date.now() - last < SILENT_SSO_GUARD_MS) return;
        sessionStorage.setItem(guardKey, String(Date.now()));

        if (!local.authenticated || !productSub) {
          const here = `${window.location.pathname}${window.location.search || ''}` || '/ar/portal';
          window.location.replace(identity.productStart(here) || productStartPath(here));
          return;
        }

        const token =
          (au && identityId !== au ? boundWindowToken() : '') || boundWindowToken() || body.token;
        await applyAccountIsolation(token, {
          force: true,
          sub: targetAu || identityId,
          silent: true,
        });
      } catch {
        clearAccountRebindLock();
      }
    }

    void reconcile();
    const onVis = () => {
      if (!document.hidden) void reconcile();
    };
    document.addEventListener('visibilitychange', onVis);
    const onFocus = () => {
      void reconcile();
    };
    window.addEventListener('focus', onFocus);
    timer = window.setInterval(() => {
      if (!document.hidden && tabMayClaimProductCookie()) void reconcile();
    }, 60_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
