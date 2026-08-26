'use client';

import { usePathname } from '@/i18n/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

/**
 * WAZEN-style lightweight top progress bar for route changes.
 * Avoids a full-screen branded overlay that feels like the app is freezing.
 * Only appears if navigation takes longer than SHOW_AFTER_MS.
 */
function NavigationProgressInner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const pendingRef = useRef(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SHOW_AFTER_MS = 120;

  const clearTimers = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const start = () => {
    clearTimers();
    pendingRef.current = true;
    setProgress(8);
    showTimerRef.current = setTimeout(() => {
      if (!pendingRef.current) return;
      setVisible(true);
      tickRef.current = setInterval(() => {
        setProgress((current) => {
          if (current >= 90) return current;
          const step = current < 40 ? 12 : current < 70 ? 5 : 1.5;
          return Math.min(90, current + step);
        });
      }, 160);
    }, SHOW_AFTER_MS);
  };

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.hasAttribute('data-no-progress')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      start();
    };

    const onPopState = () => start();

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      clearTimers();
    };
  }, []);

  useEffect(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setProgress(100);
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
      hideTimerRef.current = null;
    }, 180);
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="nav-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
      <i style={{ width: `${progress}%` }} />
    </div>
  );
}

/** Soft route-change indicator (top bar only — not a blocking overlay). */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
