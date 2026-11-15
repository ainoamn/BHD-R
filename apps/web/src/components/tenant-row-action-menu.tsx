'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SoftPortalLink as Link } from '@/components/soft-portal-link';

function closeMenus() {
  document.querySelectorAll('details.ops-action-menu[open]').forEach((el) => {
    el.removeAttribute('open');
  });
}

/** Three-dot row menu (same pattern as owner leasing actions). */
export function TenantRowActionMenu({
  ar,
  children,
}: {
  ar: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const placePanel = () => {
    const trigger = rootRef.current?.querySelector('summary');
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const pw = panel.offsetWidth || 220;
    const ph = panel.offsetHeight || 140;
    const rtl = document.documentElement.dir === 'rtl';
    let left = rtl ? rect.left : rect.right - pw;
    left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - pw - 8));
    let top = rect.bottom + 6;
    if (top + ph > window.innerHeight - 8 && rect.top - ph - 6 > 8) {
      top = rect.top - ph - 6;
    }
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  };

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    const onReposition = () => placePanel();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closeMenus();
    };
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  return (
    <details
      ref={rootRef}
      className="ops-action-menu"
      onClick={(event) => event.stopPropagation()}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        setOpen(isOpen);
        if (!isOpen) return;
        const current = event.currentTarget;
        document.querySelectorAll('details.ops-action-menu[open]').forEach((el) => {
          if (el !== current) el.removeAttribute('open');
        });
      }}
    >
      <summary
        className="ops-action-menu__trigger"
        aria-label={ar ? 'خيارات العقد' : 'Contract options'}
      >
        <span aria-hidden="true">⋯</span>
      </summary>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="ops-action-menu__panel ops-action-menu__panel--portal"
              role="menu"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </details>
  );
}

export function TenantRowActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="ops-action"
      href={href}
      role="menuitem"
      onClick={() => closeMenus()}
    >
      {children}
    </Link>
  );
}
