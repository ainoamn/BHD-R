'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let pageScrollLocks = 0;
let pageScrollOverflow = '';

/** Nested modals share one lock so closing the top one cannot leave the page unscrollable. */
function lockPageScroll() {
  if (pageScrollLocks === 0) {
    pageScrollOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  pageScrollLocks += 1;
}

function unlockPageScroll() {
  pageScrollLocks = Math.max(0, pageScrollLocks - 1);
  if (pageScrollLocks === 0) {
    document.body.style.overflow = pageScrollOverflow;
    pageScrollOverflow = '';
  }
}

/**
 * Renders a modal into `document.body` so animated or transformed ancestors (which become the
 * containing block for `position: fixed`) cannot pin it inside the page. Locks page scroll while
 * open and closes on Escape when `onClose` is given.
 */
export function ModalPortal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const [mounted, setMounted] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
    lockPageScroll();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unlockPageScroll();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return mounted ? createPortal(children, document.body) : null;
}
