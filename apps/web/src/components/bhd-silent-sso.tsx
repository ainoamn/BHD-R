'use client';

import {
  applyAccountIsolation,
  clearHostileProductCookie,
  ensureAuInUrl,
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
import { invalidateTenantSpaceCache } from '@/lib/tenant-space-client-cache';
import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

async function productMe(): Promise<{ authenticated?: boolean; currentSub?: string | null }> {
  try {
    const response = await fetch('/api/auth/me', {
      cache: 'no-store',
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    return (await response.json().catch(() => ({}))) as {
      authenticated?: boolean;
      currentSub?: string | null;
    };
  } catch {
    return {};
  }
}

/**
 * Stable multi-window SSO:
 * - Never splash on normal browsing.
 * - Focus only reclaims the shared cookie quietly (no refresh).
 * - Boot may soft-refresh once if cookie ≠ ?au= (no branded veil).
 */
export function BhdSilentSso() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const bootDoneRef = useRef(false);
  const bootRefreshDoneRef = useRef(false);
  const reclaimingRef = useRef(false);

  useEffect(() => {
    const onRebound = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; refresh?: boolean }>).detail;
      clearHostileProductCookie();
      if (detail?.refresh === false) {
        signalPrivacyVeilReady();
        return;
      }
      // Soft RSC refresh only — no green veil (veil caused site-wide flicker).
      startTransition(() => {
        try {
          router.refresh();
        } catch {
          /* no-op */
        }
        signalPrivacyVeilReady();
      });
    };
    window.addEventListener('bhd:account-rebound', onRebound);
    const stopWatch = watchProductCookieOwner((ownerSub) => {
      const au = readActiveAu();
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
      path.includes('/payments/') ||
      /\/book\//.test(path)
    ) {
      signalPrivacyVeilReady();
      bootDoneRef.current = true;
      return;
    }

    let cancelled = false;
    let timer = 0;

    async function reclaimQuiet(sub: string, token: string) {
      if (reclaimingRef.current) return;
      reclaimingRef.current = true;
      try {
        await applyAccountIsolation(token, {
          force: true,
          sub,
          silent: true,
          quiet: true,
        });
        invalidateTenantSpaceCache();
      } finally {
        reclaimingRef.current = false;
      }
    }

    async function reconcile(reason: 'boot' | 'focus' | 'interval') {
      if (cancelled || document.hidden) return;
      if (reclaimingRef.current) return;

      const quiet = bootDoneRef.current || reason !== 'boot';

      try {
        const au = readActiveAu();
        if (au) setActiveAu(au);

        // Always await a real /me — never treat a timeout empty body as mismatch.
        const local = await productMe();
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

        if (au) ensureAuInUrl(au);

        const mismatched = Boolean(au && productSub && productSub !== au);
        if (mismatched) {
          markHostileProductCookie(productSub!);
        } else {
          // Only lift the cover when this tab already matches the cookie.
          signalPrivacyVeilReady();
        }

        if (!tabMayClaimProductCookie()) {
          bootDoneRef.current = true;
          return;
        }

        const cachedToken = (au && tokenForAccount(au)) || boundWindowToken();

        // Cookie belongs to another account — cover wrong SSR paint, then reclaim.
        if (mismatched && cachedToken) {
          if (!quiet) paintPrivacyVeil();
          await reclaimQuiet(au!, cachedToken);
          bootDoneRef.current = true;
          // First boot in this JS context: one soft refresh so SSR matches ?au=.
          if (!quiet && !bootRefreshDoneRef.current) {
            bootRefreshDoneRef.current = true;
            startTransition(() => {
              try {
                router.refresh();
              } catch {
                /* no-op */
              }
              signalPrivacyVeilReady();
            });
          } else {
            signalPrivacyVeilReady();
          }
          return;
        }

        if (au && !productSub && cachedToken) {
          if (!quiet) paintPrivacyVeil();
          await reclaimQuiet(au, cachedToken);
          bootDoneRef.current = true;
          signalPrivacyVeilReady();
          return;
        }

        if (quiet) {
          signalPrivacyVeilReady();
          bootDoneRef.current = true;
          return;
        }

        // Cold boot without a window token — identity handoff path (rare).
        const identity = await loadBhdIdentity();
        if (cancelled || !identity) {
          bootDoneRef.current = true;
          return;
        }
        const { ok, body } = await identity.me();
        if (cancelled || !ok || !body.user?.id) {
          bootDoneRef.current = true;
          return;
        }

        const identityId = body.user.id;
        const targetAu = au || identityId;

        if (productSub && productSub === identityId && productSub === targetAu) {
          rememberProductCookieOwner(productSub);
          scrubCacheBustFromUrl();
          bootDoneRef.current = true;
          return;
        }

        const guardKey = `bhd-sso:${targetAu || identityId}`;
        const last = Number(sessionStorage.getItem(guardKey) || '0');
        if (last && Date.now() - last < SILENT_SSO_GUARD_MS) {
          bootDoneRef.current = true;
          return;
        }
        sessionStorage.setItem(guardKey, String(Date.now()));

        if (!local.authenticated || !productSub) {
          const here = `${window.location.pathname}${window.location.search || ''}` || '/ar/portal';
          window.location.replace(identity.productStart(here) || productStartPath(here));
          return;
        }

        const token =
          (au && identityId !== au ? boundWindowToken() : '') ||
          boundWindowToken() ||
          (typeof body.token === 'string' ? body.token : '');
        if (token) {
          await reclaimQuiet(targetAu || identityId, token);
          if (!bootRefreshDoneRef.current) {
            bootRefreshDoneRef.current = true;
            startTransition(() => {
              try {
                router.refresh();
              } catch {
                /* no-op */
              }
            });
          }
        }
        bootDoneRef.current = true;
      } catch {
        signalPrivacyVeilReady();
        bootDoneRef.current = true;
      }
    }

    void reconcile('boot');
    const onVis = () => {
      if (!document.hidden) void reconcile('focus');
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    timer = window.setInterval(() => {
      if (!document.hidden && tabMayClaimProductCookie()) void reconcile('interval');
    }, 120_000);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.clearInterval(timer);
    };
  }, [router, startTransition]);

  return null;
}
