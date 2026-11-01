'use client';

import {
  applyAccountIsolation,
  clearAccountRebindLock,
  ensureAuInUrl,
  isAccountRebindPending,
  isIdentityOrigin,
  markHostileProductCookie,
  paintPrivacyVeil,
  rememberProductCookieOwner,
  scrubCacheBustFromUrl,
  tabMayClaimProductCookie,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import {
  boundWindowToken,
  captureAccountToken,
  readActiveAu,
  setActiveAu,
} from '@/lib/identity/window-session';
import { useEffect, useState } from 'react';

export function BhdPrivacyGate() {
  const [productSub, setProductSub] = useState<string | null>(null);
  const [productEmail, setProductEmail] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { currentSub?: string | null; email?: string | null } | null) => {
        if (!live || !payload) return;
        if (payload.currentSub) setProductSub(payload.currentSub);
        const email = payload.email?.trim();
        if (email) setProductEmail(email);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

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
      clearAccountRebindLock();
      return;
    }

    let cancelled = false;

    async function gate() {
      if (cancelled) return;
      try {
        const au = readActiveAu();
        if (au) {
          setActiveAu(au);
          ensureAuInUrl(au);
        }

        // Aligned — keep this tab's au; never overwrite URL au with cookie sub.
        if (productSub && au && productSub === au) {
          rememberProductCookieOwner(au);
          clearAccountRebindLock();
          scrubCacheBustFromUrl();
          ensureAuInUrl(au);
          return;
        }

        // No tab binding yet — adopt cookie account as this tab's au.
        if (productSub && !au) {
          setActiveAu(productSub);
          rememberProductCookieOwner(productSub);
          ensureAuInUrl(productSub);
          clearAccountRebindLock();
          scrubCacheBustFromUrl();
          return;
        }

        if (au && productSub && productSub !== au) {
          markHostileProductCookie(productSub);
          paintPrivacyVeil();
        }

        if (isAccountRebindPending()) {
          if (productSub && au && productSub === au) {
            rememberProductCookieOwner(au);
            clearAccountRebindLock();
            scrubCacheBustFromUrl();
          }
          return;
        }

        // Cookie belongs to another account — only the focused tab may reclaim it.
        if (!tabMayClaimProductCookie()) return;

        const identity = await loadBhdIdentity();
        if (cancelled || !identity) {
          if (productSub && au && productSub === au) {
            clearAccountRebindLock();
            scrubCacheBustFromUrl();
          }
          return;
        }

        const { ok, body } = await identity.me();
        if (cancelled) return;
        if (!ok || !body.user?.id) {
          return;
        }

        const identityId = body.user.id;
        const identityEmail = (body.user.email || '').trim().toLowerCase();
        const localEmail = (productEmail || '').trim().toLowerCase();
        if (typeof body.token === 'string') captureAccountToken(identityId, body.token);
        if (!au) setActiveAu(identityId);

        const targetAu = readActiveAu() || identityId;
        const matched =
          Boolean(productSub) &&
          productSub === identityId &&
          productSub === targetAu &&
          (!localEmail || !identityEmail || localEmail === identityEmail);

        if (matched) {
          rememberProductCookieOwner(targetAu);
          clearAccountRebindLock();
          scrubCacheBustFromUrl();
          ensureAuInUrl(targetAu);
          return;
        }

        paintPrivacyVeil();
        const token = boundWindowToken() || (typeof body.token === 'string' ? body.token : '');
        await applyAccountIsolation(token, {
          force: true,
          sub: targetAu || identityId,
          silent: true,
        });
      } catch {
        /* keep veil if already painted */
      }
    }

    void gate();
    return () => {
      cancelled = true;
    };
  }, [productEmail, productSub]);

  return null;
}
