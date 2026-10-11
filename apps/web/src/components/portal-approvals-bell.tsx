'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  pendingApprovalHref,
  pendingApprovalTitle,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';

/** Header bell of the owner/developer portal: contracts and booking requests awaiting approval. */
export function PortalApprovalsBell({
  portal,
  locale,
}: {
  portal: 'owner' | 'developer';
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PendingApprovals | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/portal/pending-approvals', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) setData((await response.json()) as PendingApprovals);
    } catch {
      /* keep the last known list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(PENDING_APPROVALS_CHANGED_EVENT, reload);
    window.addEventListener('bhd-r-ops-refresh', reload);
    return () => {
      window.removeEventListener(PENDING_APPROVALS_CHANGED_EVENT, reload);
      window.removeEventListener('bhd-r-ops-refresh', reload);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const total = data?.total ?? 0;
  const label = ar ? 'التنبيهات' : 'Notifications';

  return (
    <div className="header-stay-alerts portal-approvals-bell" ref={rootRef}>
      <button
        type="button"
        className="header-stay-alerts__bell"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="portal-approvals-panel"
        title={
          total ? (ar ? `${total} بانتظار اعتمادك` : `${total} awaiting your approval`) : label
        }
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
      >
        <span className="header-stay-alerts__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5v2.2c0 .7-.2 1.4-.6 2L4.4 15.2c-.5.7 0 1.8.9 1.8h13.4c.9 0 1.4-1.1.9-1.8l-1.5-2.5c-.4-.6-.6-1.3-.6-2V8.5A5.5 5.5 0 0 0 12 3Z" />
            <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
          </svg>
        </span>
        <span className="sr-only">
          {label}
          {total ? ` (${total})` : ''}
        </span>
        {total > 0 ? (
          <span className="header-stay-alerts__badge" aria-hidden="true">
            {total > 9 ? '9+' : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="portal-approvals-panel"
          className="header-stay-alerts__panel"
          role="dialog"
          aria-label={ar ? 'بانتظار اعتمادك' : 'Awaiting your approval'}
        >
          <div className="header-stay-alerts__head">
            <strong>{ar ? 'بانتظار اعتمادك' : 'Awaiting your approval'}</strong>
            {loading ? <span className="muted">{ar ? 'تحديث…' : 'Updating…'}</span> : null}
          </div>
          {!data?.items.length ? (
            <p className="muted header-stay-alerts__empty">
              {ar ? 'لا يوجد شيء بانتظار اعتمادك.' : 'Nothing is waiting for your approval.'}
            </p>
          ) : (
            <ul className="header-stay-alerts__list">
              {data.items.slice(0, 12).map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <Link
                    href={pendingApprovalHref(portal, item)}
                    className="header-stay-alerts__item portal-approvals-bell__item"
                    onClick={() => setOpen(false)}
                  >
                    <span className="header-stay-alerts__status is-action">
                      {pendingApprovalTitle(item, ar)}
                    </span>
                    <span className="header-stay-alerts__ref" dir="ltr">
                      {item.reference}
                    </span>
                    <span className="header-stay-alerts__meta">
                      {[
                        ar ? item.propertyNameAr : item.propertyNameEn || item.propertyNameAr,
                        item.unitCode,
                        item.party,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data && data.total > 12 ? (
            <p className="muted header-stay-alerts__empty">
              {ar ? `و${data.total - 12} أخرى.` : `And ${data.total - 12} more.`}
            </p>
          ) : null}
          <Link
            href={`/${portal}/bookings`}
            className="header-stay-alerts__all"
            onClick={() => setOpen(false)}
          >
            {ar ? 'فتح الحجوزات والمعاينات' : 'Open bookings & viewings'}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
