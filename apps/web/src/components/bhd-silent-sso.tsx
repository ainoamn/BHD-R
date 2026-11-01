'use client';

import {
  applyAccountIsolation,
  clearAccountRebindLock,
  clearHostileProductCookie,
  ensureAuInUrl,
  isAccountRebindPending,
  isIdentityOrigin,
  markHostileProductCookie,
  paintPrivacyVeil,
  productStartPath,
  rememberProductCookieOwner,
  scrubCacheBustFromUrl,
  SILENT_SSO_GUARD_MS,
  tabMayClaimProductCookie,
  watchProductCookieOwner,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import { boundWindowToken, readActiveAu, setActiveAu } from '@/lib/identity/window-session';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

async function productMe(): Promise<{ authenticated?: boolean; currentSub?: string | null }> {
  const response = await fetch('/api/auth/me', {
    cache: 'no-store',
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  return (await response.json().catch(() => ({}))) as {
    authenticated?: boolean;
    currentSub?: string | null;
  };
}

/** After silent rebind, wait until cookie matches this tab before lifting the veil. */
async function releaseVeilWhenAligned(expectedSub: string) {
  const au = expectedSub.trim();
  if (!au) {
    clearAccountRebindLock();
    return;
  }
  for (let i = 0; i < 8; i += 1) {
    try {
      const local = await productMe();
      if (local.currentSub && local.currentSub === au) {
        rememberProductCookieOwner(au);
        clearHostileProductCookie();
        clearAccountRebindLock();
        ensureAuInUrl(au);
        scrubCacheBustFromUrl();
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120 + i * 80));
  }
  // Still mismatched — keep veil; next focus/reconcile will retry.
  paintPrivacyVeil();
}

export function BhdSilentSso() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const onRebound = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      const expected = (detail?.userId || readActiveAu() || '').trim();
      clearHostileProductCookie();
      paintPrivacyVeil();
      startTransition(() => {
        try {
          router.refresh();
        } catch {
          /* no-op */
        }
        void releaseVeilWhenAligned(expected);
      });
    };
    window.addEventListener('bhd:account-rebound', onRebound);
    const stopWatch = watchProductCookieOwner((ownerSub) => {
      const au = readActiveAu();
      if (au && ownerSub !== au) {
        markHostileProductCookie(ownerSub);
        paintPrivacyVeil();
      }
    });
    return () => {
      window.removeEventListener('bhd:account-rebound', onRebound);
      stopWatch();
    };
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

        const local = await productMe();
        if (cancelled) return;

        const productSub = local.currentSub || null;
        if (local.authenticated && productSub && au && productSub === au) {
          rememberProductCookieOwner(au);
          clearAccountRebindLock();
          clearHostileProductCookie();
          scrubCacheBustFromUrl();
          ensureAuInUrl(au);
          return;
        }

        // Cookie is for another account — hide wrong paint immediately.
        if (au && productSub && productSub !== au) {
          markHostileProductCookie(productSub);
          paintPrivacyVeil();
        }

        if (au) ensureAuInUrl(au);

        // Background tabs must not steal the shared cookie (veil stays up).
        if (!tabMayClaimProductCookie()) return;

        const identity = await loadBhdIdentity();
        if (cancelled || !identity) return;
        const { ok, body } = await identity.me();
        if (cancelled || !ok || !body.user?.id) {
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
          rememberProductCookieOwner(productSub);
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
        /* keep veil if already painted */
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
