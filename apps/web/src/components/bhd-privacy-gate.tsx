'use client';

import {
  applyAccountIsolation,
  ensureAuInUrl,
  isAccountRebindPending,
  isIdentityOrigin,
  markHostileProductCookie,
  paintPrivacyVeil,
  rememberProductCookieOwner,
  scrubCacheBustFromUrl,
  signalPrivacyVeilReady,
  tabMayClaimProductCookie,
} from '@/lib/identity/client';
import { loadBhdIdentity } from '@/lib/identity/bhd-browser';
import {
  boundWindowToken,
  captureAccountToken,
  readActiveAu,
  setActiveAu,
  tokenForAccount,
} from '@/lib/identity/window-session';
import { useEffect, useRef, useState } from 'react';

/** Boot-only gate. Focus reclaim lives in BhdSilentSso (quiet). */
export function BhdPrivacyGate() {
  const [productSub, setProductSub] = useState<string | null>(null);
  const [productEmail, setProductEmail] = useState<string | null>(null);
  const settledRef = useRef(false);

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
      signalPrivacyVeilReady();
      settledRef.current = true;
      return;
    }

    // After first settle, never re-splash / refresh from this gate.
    if (settledRef.current) return;

    let cancelled = false;

    async function gate() {
      if (cancelled || settledRef.current) return;
      try {
        const au = readActiveAu();
        if (au) {
          setActiveAu(au);
          ensureAuInUrl(au);
        }

        if (productSub && au && productSub === au) {
          rememberProductCookieOwner(au);
          scrubCacheBustFromUrl();
          ensureAuInUrl(au);
          signalPrivacyVeilReady();
          settledRef.current = true;
          return;
        }

        if (productSub && !au) {
          setActiveAu(productSub);
          rememberProductCookieOwner(productSub);
          ensureAuInUrl(productSub);
          scrubCacheBustFromUrl();
          signalPrivacyVeilReady();
          settledRef.current = true;
          return;
        }

        if (!productSub) return;

        if (au && productSub !== au) {
          markHostileProductCookie(productSub);
          paintPrivacyVeil();
        }

        if (isAccountRebindPending()) return;
        if (!tabMayClaimProductCookie()) return;

        const cached = (au && tokenForAccount(au)) || boundWindowToken();
        if (au && cached && productSub !== au) {
          await applyAccountIsolation(cached, {
            force: true,
            sub: au,
            silent: true,
            quiet: false,
          });
          settledRef.current = true;
          return;
        }

        const identity = await loadBhdIdentity();
        if (cancelled || !identity) return;

        const { ok, body } = await identity.me();
        if (cancelled) return;
        if (!ok || !body.user?.id) return;

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
          scrubCacheBustFromUrl();
          ensureAuInUrl(targetAu);
          signalPrivacyVeilReady();
          settledRef.current = true;
          return;
        }

        paintPrivacyVeil();
        const token = boundWindowToken() || (typeof body.token === 'string' ? body.token : '');
        await applyAccountIsolation(token, {
          force: true,
          sub: targetAu || identityId,
          silent: true,
          quiet: false,
        });
        settledRef.current = true;
      } catch {
        /* splash max timer still lifts */
      }
    }

    void gate();
    return () => {
      cancelled = true;
    };
  }, [productEmail, productSub]);

  return null;
}
