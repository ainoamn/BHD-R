'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import {
  readStayTripAlerts,
  rememberStayTripAlert,
  stayAlertNeedsAction,
  stayStatusLabel,
  type StayTripAlert,
} from '@/lib/stay-trip-alerts';

type MineResponse = { items?: StayTripAlertLike[] };
type StayTripAlertLike = {
  id: string;
  referenceCode: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  currency?: string;
  totalMinor?: string;
};

function mergeAlerts(local: StayTripAlert[], remote: StayTripAlertLike[]): StayTripAlert[] {
  const map = new Map<string, StayTripAlert>();
  for (const item of local) {
    map.set(item.referenceCode, item);
  }
  for (const item of remote) {
    map.set(item.referenceCode, {
      id: item.id,
      referenceCode: item.referenceCode,
      status: item.status,
      checkInOn: item.checkInOn,
      checkOutOn: item.checkOutOn,
      ...(item.currency ? { currency: item.currency } : {}),
      ...(item.totalMinor ? { totalMinor: item.totalMinor } : {}),
      updatedAt: new Date().toISOString(),
    });
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function HeaderStayAlerts({
  locale,
  signedIn,
}: {
  locale: string;
  signedIn: boolean;
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StayTripAlert[]>([]);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  function refreshLocal() {
    setItems((prev) => mergeAlerts(readStayTripAlerts(), prev));
  }

  useEffect(() => {
    setItems(readStayTripAlerts());
    const onStorage = () => setItems(readStayTripAlerts());
    window.addEventListener('storage', onStorage);
    window.addEventListener('bhd-r-stay-alerts', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('bhd-r-stay-alerts', onStorage);
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    startTransition(async () => {
      try {
        const response = await fetch('/api/public/stays/guest/mine', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as MineResponse;
        const remote = payload.items ?? [];
        for (const item of remote) {
          rememberStayTripAlert(item);
        }
        setItems(mergeAlerts(readStayTripAlerts(), remote));
      } catch {
        refreshLocal();
      }
    });
  }, [signedIn]);

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

  const actionable = useMemo(
    () => items.filter((item) => stayAlertNeedsAction(item.status)).length,
    [items],
  );

  return (
    <div className="header-stay-alerts" ref={rootRef}>
      <button
        type="button"
        className="header-stay-alerts__bell"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="header-stay-alerts-panel"
        onClick={() => setOpen((value) => !value)}
        title={ar ? 'الحجوزات والتنبيهات' : 'Bookings and alerts'}
      >
        <span className="header-stay-alerts__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5v2.2c0 .7-.2 1.4-.6 2L4.4 15.2c-.5.7 0 1.8.9 1.8h13.4c.9 0 1.4-1.1.9-1.8l-1.5-2.5c-.4-.6-.6-1.3-.6-2V8.5A5.5 5.5 0 0 0 12 3Z" />
            <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
          </svg>
        </span>
        <span className="sr-only">{ar ? 'الحجوزات والتنبيهات' : 'Bookings and alerts'}</span>
        {actionable > 0 ? (
          <span className="header-stay-alerts__badge" aria-hidden="true">
            {actionable > 9 ? '9+' : actionable}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="header-stay-alerts-panel"
          className="header-stay-alerts__panel"
          role="dialog"
          aria-label={ar ? 'تنبيهات الحجوزات' : 'Booking alerts'}
        >
          <div className="header-stay-alerts__head">
            <strong>{ar ? 'حجوزاتي وتنبيهاتها' : 'My bookings & alerts'}</strong>
            {pending ? <span className="muted">{ar ? 'تحديث…' : 'Updating…'}</span> : null}
          </div>
          {items.length === 0 ? (
            <p className="muted header-stay-alerts__empty">
              {ar
                ? 'لا حجوزات بعد. بعد الحجز ستظهر هنا حالة الدفع والتذكيرات.'
                : 'No bookings yet. After you book, payment status and reminders appear here.'}
            </p>
          ) : (
            <ul className="header-stay-alerts__list">
              {items.slice(0, 8).map((item) => (
                <li key={item.referenceCode}>
                  <Link
                    href={`/guest/stays?ref=${encodeURIComponent(item.referenceCode)}`}
                    className="header-stay-alerts__item"
                    onClick={() => setOpen(false)}
                  >
                    <span className="header-stay-alerts__ref" dir="ltr">
                      {item.referenceCode}
                    </span>
                    <span className="header-stay-alerts__meta">
                      {item.checkInOn} → {item.checkOutOn}
                    </span>
                    <span
                      className={
                        stayAlertNeedsAction(item.status)
                          ? 'header-stay-alerts__status is-action'
                          : 'header-stay-alerts__status'
                      }
                    >
                      {stayStatusLabel(item.status, ar)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/guest/stays"
            className="header-stay-alerts__all"
            onClick={() => setOpen(false)}
          >
            {ar ? 'فتح صفحة الرحلات' : 'Open trips page'}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
