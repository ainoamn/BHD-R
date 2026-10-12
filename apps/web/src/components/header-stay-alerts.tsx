'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  readStayTripAlerts,
  rememberStayTripAlert,
  stayAlertNeedsAction,
  stayStatusLabel,
  type StayTripAlert,
} from '@/lib/stay-trip-alerts';
import {
  stayHref,
  tenancyAlertLabel,
  tenancyUnitLabel,
  type TenancyAlert,
  type TenancyContract,
  type TenancyStay,
} from '@/lib/tenancy-shared';
import { domainStatusLabel } from '@/lib/ui-labels';

type AlertsResponse = {
  alerts?: TenancyAlert[];
  stays?: TenancyStay[];
  contracts?: TenancyContract[];
};

function mergeAlerts(local: StayTripAlert[], remote: TenancyStay[]): StayTripAlert[] {
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
      currency: item.currency,
      totalMinor: item.totalMinor,
      updatedAt: map.get(item.referenceCode)?.updatedAt ?? new Date().toISOString(),
    });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.checkInOn.localeCompare(a.checkInOn) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function HeaderStayAlerts({ locale, signedIn }: { locale: string; signedIn: boolean }) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StayTripAlert[]>([]);
  const [alerts, setAlerts] = useState<TenancyAlert[]>([]);
  const [contracts, setContracts] = useState<TenancyContract[]>([]);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onStorage = () => setItems(mergeAlerts(readStayTripAlerts(), []));
    onStorage();
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
        const response = await fetch('/api/public/me/alerts', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return;
        const payload = (await response.json()) as AlertsResponse;
        const remote = payload.stays ?? [];
        for (const item of remote) {
          rememberStayTripAlert({
            id: item.id,
            referenceCode: item.referenceCode,
            status: item.status,
            checkInOn: item.checkInOn,
            checkOutOn: item.checkOutOn,
            currency: item.currency,
            totalMinor: item.totalMinor,
          });
        }
        setItems(mergeAlerts(readStayTripAlerts(), remote));
        setAlerts(payload.alerts ?? []);
        setContracts(payload.contracts ?? []);
      } catch {
        setItems(readStayTripAlerts());
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

  const actionable = useMemo(() => {
    const alerted = new Set(alerts.map((alert) => alert.reference));
    const staysNeedingAction = items.filter(
      (item) => stayAlertNeedsAction(item.status) && !alerted.has(item.referenceCode),
    ).length;
    return alerts.filter((alert) => alert.action).length + staysNeedingAction;
  }, [alerts, items]);

  const empty = !items.length && !alerts.length && !contracts.length;
  const arrow = ar ? '←' : '→';
  const dateFormat = new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', { dateStyle: 'medium' });
  const formatDate = (value: string | null) => {
    if (!value) return '';
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
  };

  return (
    <div className="header-stay-alerts" ref={rootRef}>
      <button
        type="button"
        className="header-stay-alerts__bell"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="header-stay-alerts-panel"
        onClick={() => setOpen((value) => !value)}
        title={ar ? 'حجوزاتي وعقودي وتنبيهاتها' : 'My bookings, contracts and alerts'}
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
          {ar ? 'حجوزاتي وعقودي وتنبيهاتها' : 'My bookings, contracts and alerts'}
        </span>
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
          aria-label={ar ? 'تنبيهاتي' : 'My alerts'}
        >
          <div className="header-stay-alerts__head">
            <strong>{ar ? 'حجوزاتي وعقودي' : 'My bookings & contracts'}</strong>
            {pending ? <span className="muted">{ar ? 'تحديث…' : 'Updating…'}</span> : null}
          </div>
          {empty ? (
            <p className="muted header-stay-alerts__empty">
              {ar
                ? 'لا حجوزات ولا عقود بعد. بعد الحجز أو التعاقد تظهر هنا حالة الدفع والتوقيع والتذكيرات.'
                : 'No bookings or contracts yet. After you book or sign, payment, signature and reminders appear here.'}
            </p>
          ) : (
            <div className="header-stay-alerts__body">
              {alerts.length ? (
                <section>
                  <h3 className="header-stay-alerts__section">
                    {ar ? 'يحتاج انتباهك' : 'Needs your attention'}
                  </h3>
                  <ul className="header-stay-alerts__list">
                    {alerts.slice(0, 6).map((alert) => (
                      <li key={`${alert.kind}:${alert.id}`}>
                        <Link
                          href={alert.href}
                          className="header-stay-alerts__item"
                          onClick={() => setOpen(false)}
                        >
                          <span
                            className={
                              alert.action
                                ? 'header-stay-alerts__status is-action'
                                : 'header-stay-alerts__status'
                            }
                          >
                            {tenancyAlertLabel(alert.kind, ar)}
                          </span>
                          <span className="header-stay-alerts__ref" dir="ltr">
                            {alert.reference}
                          </span>
                          <span className="header-stay-alerts__meta">
                            {[
                              formatDate(alert.date),
                              alert.amountMinor && alert.currency
                                ? formatMoney(alert.amountMinor, alert.currency, locale)
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {items.length ? (
                <section>
                  <h3 className="header-stay-alerts__section">
                    {ar ? 'الإقامات اليومية' : 'Daily stays'}
                  </h3>
                  <ul className="header-stay-alerts__list">
                    {items.slice(0, 5).map((item) => (
                      <li key={item.referenceCode}>
                        <Link
                          href={stayHref(item)}
                          className="header-stay-alerts__item"
                          onClick={() => setOpen(false)}
                        >
                          <span className="header-stay-alerts__ref" dir="ltr">
                            {item.referenceCode}
                          </span>
                          <span className="header-stay-alerts__meta">
                            {formatDate(item.checkInOn)} {arrow} {formatDate(item.checkOutOn)}
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
                </section>
              ) : null}

              {contracts.length ? (
                <section>
                  <h3 className="header-stay-alerts__section">{ar ? 'عقودي' : 'My contracts'}</h3>
                  <ul className="header-stay-alerts__list">
                    {contracts.slice(0, 4).map((contract) => (
                      <li key={contract.id}>
                        <Link
                          href={`/tenant/contracts/${contract.id}`}
                          className="header-stay-alerts__item"
                          onClick={() => setOpen(false)}
                        >
                          <span className="header-stay-alerts__ref" dir="ltr">
                            {contract.reference}
                          </span>
                          <span className="header-stay-alerts__meta">
                            {[
                              tenancyUnitLabel(contract, ar),
                              contract.startsOn && contract.endsOn
                                ? `${formatDate(contract.startsOn)} ${arrow} ${formatDate(contract.endsOn)}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          <span className="header-stay-alerts__status">
                            {domainStatusLabel(contract.status, ar)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
          <div className="header-stay-alerts__links">
            {signedIn ? (
              <Link
                href="/tenant"
                className="header-stay-alerts__all"
                onClick={() => setOpen(false)}
              >
                {ar
                  ? 'مساحة المستأجر: كل عقودي وفواتيري'
                  : 'Tenant space: all my contracts & invoices'}
              </Link>
            ) : null}
            <Link
              href="/guest/stays"
              className="header-stay-alerts__all header-stay-alerts__all--quiet"
              onClick={() => setOpen(false)}
            >
              {ar ? 'صفحة الرحلات' : 'Trips page'}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
