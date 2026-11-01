'use client';

import {
  applyAccountIsolation,
  clearHostileProductCookie,
  ensureAuInUrl,
  isAccountRebindPending,
  isIdentityOrigin,
  markHostileProductCookie,
  paintPrivacyVeil,
  productStartPath,
  rememberProductCookieOwner,
  scrubCacheBustFromUrl,
  signalPrivacyVeilReady,
  SILENT_SSO_GUARD_MS,
  tabMayClaimProductCookie,
  watchProductCookieOwner,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import {
  boundWindowToken,
  readActiveAu,
  setActiveAu,
  tokenForAccount,
} from '@/lib/identity/window-session';
import { useEffect, useRef, useTransition } from 'react';
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

async function releaseVeilWhenAligned(expectedSub: string) {
  const au = expectedSub.trim();
  if (!au) {
    signalPrivacyVeilReady();
    return;
  }
  for (let i = 0; i < 5; i += 1) {
    try {
      const local = await productMe();
      if (local.currentSub && local.currentSub === au) {
        rememberProductCookieOwner(au);
        clearHostileProductCookie();
        ensureAuInUrl(au);
        scrubCacheBustFromUrl();
        signalPrivacyVeilReady();
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80 + i * 60));
  }
  signalPrivacyVeilReady();
}

/**
 * Multi-window policy:
 * - First paint (boot): may splash + soft refresh once if cookie ≠ ?au=.
 * - Later focus/visibility: reclaim shared cookie quietly — never refresh or veil.
 */
export function BhdSilentSso() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const bootDoneRef = useRef(false);
  const reclaimingRef = useRef(false);

  useEffect(() => {
    const onRebound = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; refresh?: boolean }>).detail;
      const expected = (detail?.userId || readActiveAu() || '').trim();
      clearHostileProductCookie();
      if (detail?.refresh === false) {
        signalPrivacyVeilReady();
        return;
      }
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
      // Freeze live updates only — do not splash/refresh other windows.
      if (au && ownerSub !== au) markHostileProductCookie(ownerSub);
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
      signalPrivacyVeilReady();
      bootDoneRef.current = true;
      return;
    }

    let cancelled = false;
    let timer = 0;

    async function reconcile(reason: 'boot' | 'focus' | 'interval') {
      if (cancelled || document.hidden) return;
      if (reclaimingRef.current) return;
      if (reason !== 'boot' && isAccountRebindPending()) return;

      const quiet = bootDoneRef.current && reason !== 'boot';

      try {
        const au = readActiveAu();
        if (au) setActiveAu(au);

        const cachedToken = (au && tokenForAccount(au)) || boundWindowToken();
        const mePromise = productMe();

        if (au && cachedToken && tabMayClaimProductCookie()) {
          const localPeek = await Promise.race([
            mePromise,
            new Promise<{ authenticated?: boolean; currentSub?: string | null }>((resolve) =>
              window.setTimeout(() => resolve({}), quiet ? 200 : 280),
            ),
          ]);
          if (cancelled) return;
          if (localPeek.currentSub && localPeek.currentSub === au) {
            rememberProductCookieOwner(au);
            clearHostileProductCookie();
            scrubCacheBustFromUrl();
            ensureAuInUrl(au);
            signalPrivacyVeilReady();
            bootDoneRef.current = true;
            return;
          }
          if (!localPeek.currentSub || localPeek.currentSub !== au) {
            if (localPeek.currentSub) markHostileProductCookie(localPeek.currentSub);
            if (!quiet) paintPrivacyVeil();
            reclaimingRef.current = true;
            try {
              await applyAccountIsolation(cachedToken, {
                force: true,
                sub: au,
                silent: true,
                quiet,
              });
            } finally {
              reclaimingRef.current = false;
            }
            bootDoneRef.current = true;
            return;
          }
        }

        const local = await mePromise;
        if (cancelled) return;

        const productSub = local.currentSub || null;
        if (local.authenticated && productSub && au && productSub === au) {
          rememberProductCookieOwner(au);
          clearHostileProductCookie();
          scrubCacheBustFromUrl();
          ensureAuInUrl(au);
          signalPrivacyVeilReady();
          bootDoneRef.current = true;
          return;
        }

        if (!au && productSub) {
          setActiveAu(productSub);
          rememberProductCookieOwner(productSub);
          ensureAuInUrl(productSub);
          scrubCacheBustFromUrl();
          signalPrivacyVeilReady();
          bootDoneRef.current = true;
          return;
        }

        if (au && productSub && productSub !== au) {
          markHostileProductCookie(productSub);
          if (!quiet) paintPrivacyVeil();
        }

        if (au) ensureAuInUrl(au);

        if (!tabMayClaimProductCookie()) {
          if (quiet) signalPrivacyVeilReady();
          return;
        }

        const identity = await loadBhdIdentity();
        if (cancelled || !identity) return;
        const { ok, body } = await identity.me();
        if (cancelled || !ok || !body.user?.id) return;

        const identityId = body.user.id;
        const targetAu = au || identityId;

        if (
          local.authenticated &&
          productSub &&
          productSub === identityId &&
          productSub === targetAu
        ) {
          rememberProductCookieOwner(productSub);
          scrubCacheBustFromUrl();
          signalPrivacyVeilReady();
          bootDoneRef.current = true;
          return;
        }

        const guardKey = `bhd-sso:${targetAu || identityId}`;
        const last = Number(sessionStorage.getItem(guardKey) || '0');
        const splashOpen = document.documentElement.dataset.bhdSwitching === '1';
        if (quiet && last && Date.now() - last < SILENT_SSO_GUARD_MS) return;
        if (!quiet && !splashOpen && last && Date.now() - last < SILENT_SSO_GUARD_MS) return;
        sessionStorage.setItem(guardKey, String(Date.now()));

        if (!local.authenticated || !productSub) {
          if (quiet) return;
          const here = `${window.location.pathname}${window.location.search || ''}` || '/ar/portal';
          window.location.replace(identity.productStart(here) || productStartPath(here));
          return;
        }

        const token =
          (au && identityId !== au ? boundWindowToken() : '') ||
          boundWindowToken() ||
          (typeof body.token === 'string' ? body.token : '');
        reclaimingRef.current = true;
        try {
          await applyAccountIsolation(token, {
            force: true,
            sub: targetAu || identityId,
            silent: true,
            quiet,
          });
        } finally {
          reclaimingRef.current = false;
        }
        bootDoneRef.current = true;
      } catch {
        if (quiet) signalPrivacyVeilReady();
      }
    }

    void reconcile('boot');
    const onVis = () => {
      if (!document.hidden) void reconcile('focus');
    };
    document.addEventListener('visibilitychange', onVis);
    const onFocus = () => {
      void reconcile('focus');
    };
    window.addEventListener('focus', onFocus);
    timer = window.setInterval(() => {
      if (!document.hidden && tabMayClaimProductCookie()) void reconcile('interval');
    }, 90_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
