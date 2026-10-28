'use client';

import { useEffect, useState } from 'react';
import { usePathname } from '@/i18n/navigation';

/** Fired after soft portal navigation that updates the URL via `history.pushState`. */
export const SOFT_PORTAL_NAV_EVENT = 'bhd-r-soft-portal-nav';

/** Strip the locale prefix so paths match next-intl's `usePathname()`. */
export function localeStrippedPath(pathname: string): string {
  const stripped = pathname.replace(/^\/(ar|en)(?=\/|$)/, '');
  return stripped || '/';
}

/**
 * Soft-switch without a Next App Router navigation: keeps layout hosts mounted, then
 * notifies listeners so `useSoftPortalPathname` can repaint the active section.
 */
export function pushSoftPortalUrl(href: string): void {
  const url = new URL(href, window.location.origin);
  const next = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next !== current) {
    window.history.pushState(null, '', next);
  }
  window.dispatchEvent(new Event(SOFT_PORTAL_NAV_EVENT));
}

/** Soft redirect that replaces the current history entry (no back-button loop). */
export function replaceSoftPortalUrl(href: string): void {
  const url = new URL(href, window.location.origin);
  const next = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next !== current) {
    window.history.replaceState(null, '', next);
  }
  window.dispatchEvent(new Event(SOFT_PORTAL_NAV_EVENT));
}

/**
 * Pathname for soft portal panes. Next's `usePathname` can lag behind `pushState`;
 * this re-reads `window.location` on soft-nav and back/forward.
 */
export function useSoftPortalPathname(): string {
  const nextPath = usePathname();
  const [livePath, setLivePath] = useState(nextPath);

  useEffect(() => {
    setLivePath(nextPath);
  }, [nextPath]);

  useEffect(() => {
    const sync = () => {
      setLivePath(localeStrippedPath(window.location.pathname));
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener(SOFT_PORTAL_NAV_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(SOFT_PORTAL_NAV_EVENT, sync);
    };
  }, []);

  return livePath || nextPath;
}
