'use client';

import {
  ensureAuInUrl,
  isIdentityOrigin,
  markHostileProductCookie,
  rememberProductCookieOwner,
  scrubCacheBustFromUrl,
  signalPrivacyVeilReady,
} from '@/lib/identity/client';
import { readActiveAu, setActiveAu } from '@/lib/identity/window-session';
import { useEffect, useRef } from 'react';

/**
 * Lightweight boot helper only — does not rebind or splash.
 * Cookie reclaim / refresh lives solely in BhdSilentSso (avoids double flicker).
 * On cookie≠?au= mismatch: mark hostile and leave the veil up for SilentSso.
 */
export function BhdPrivacyGate() {
  const settledRef = useRef(false);

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

    if (settledRef.current) return;

    let cancelled = false;
    void fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { currentSub?: string | null } | null) => {
        if (cancelled || !payload) {
          signalPrivacyVeilReady();
          return;
        }
        const au = readActiveAu();
        const productSub = payload.currentSub || null;
        if (productSub && au && productSub === au) {
          rememberProductCookieOwner(au);
          ensureAuInUrl(au);
          scrubCacheBustFromUrl();
          signalPrivacyVeilReady();
        } else if (productSub && !au) {
          setActiveAu(productSub);
          rememberProductCookieOwner(productSub);
          ensureAuInUrl(productSub);
          signalPrivacyVeilReady();
        } else if (au && productSub && productSub !== au) {
          markHostileProductCookie(productSub);
          ensureAuInUrl(au);
          // Do not lift the veil — BhdSilentSso reclaims then signals ready.
        } else if (au) {
          ensureAuInUrl(au);
          signalPrivacyVeilReady();
        } else {
          signalPrivacyVeilReady();
        }
        settledRef.current = true;
      })
      .catch(() => {
        signalPrivacyVeilReady();
        settledRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
