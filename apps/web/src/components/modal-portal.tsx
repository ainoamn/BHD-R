'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return mounted ? createPortal(children, document.body) : null;
}
