'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useHomeLiveSearch } from '@/components/home/home-live-search';
import { usePathname, useRouter } from '@/i18n/navigation';
import { omanLocations } from '@/lib/oman-locations';

function defaultCheckIn(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultCheckOut(checkIn: string): string {
  const d = new Date(`${checkIn}T12:00:00`);
  d.setDate(d.getDate() + 2);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(value: string, locale: string): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

function buildStaysHref(input: {
  destination: string;
  checkInOn: string;
  checkOutOn: string;
  adults: string;
  children: string;
}): string | null {
  if (!input.checkInOn || !input.checkOutOn) return null;
  if (input.checkOutOn <= input.checkInOn) return null;
  const params = new URLSearchParams();
  if (input.destination) params.set('destination', input.destination);
  params.set('checkInOn', input.checkInOn);
  params.set('checkOutOn', input.checkOutOn);
  params.set('adults', input.adults);
  params.set('children', input.children);
  return `/stays?${params.toString()}`;
}

export function StaySearchBar({
  locale,
  variant = 'hero',
  defaults = {},
}: {
  locale: string;
  variant?: 'hero' | 'compact' | 'inline';
  defaults?: {
    destination?: string;
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
  };
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const liveHome = useHomeLiveSearch();
  const guestsPanelId = useId();
  const guestsRef = useRef<HTMLDivElement>(null);
  const skipAutoRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialIn = defaults.checkInOn || defaultCheckIn();
  const [destination, setDestination] = useState(defaults.destination ?? '');
  const [checkInOn, setCheckInOn] = useState(initialIn);
  const [checkOutOn, setCheckOutOn] = useState(defaults.checkOutOn || defaultCheckOut(initialIn));
  const [adults, setAdults] = useState(defaults.adults ?? '2');
  const [children, setChildren] = useState(defaults.children ?? '0');
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guestsOpen) return;
    function onPointer(event: MouseEvent) {
      if (guestsRef.current && !guestsRef.current.contains(event.target as Node)) {
        setGuestsOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [guestsOpen]);

  function navigateToSearch(href: string) {
    const onStaysIndex =
      pathname === '/stays' || pathname.endsWith('/stays') || /\/stays\/?$/.test(pathname);
    if (onStaysIndex) router.replace(href);
    else router.push(href);
  }

  function runSearch(showErrors: boolean) {
    setError(null);
    if (!checkInOn || !checkOutOn) {
      if (showErrors) {
        setError(ar ? 'اختر تاريخ الوصول والمغادرة' : 'Select check-in and check-out dates');
      }
      return;
    }
    if (checkOutOn <= checkInOn) {
      if (showErrors) {
        setError(ar ? 'تاريخ المغادرة يجب أن يكون بعد الوصول' : 'Check-out must be after check-in');
      }
      return;
    }
    // Home hero: filter in place — never leave `/` for catalogue results.
    if (liveHome) {
      liveHome.setQuery({
        kind: 'stay',
        destination,
        checkInOn,
        checkOutOn,
        adults,
        children,
      });
      return;
    }
    const href = buildStaysHref({ destination, checkInOn, checkOutOn, adults, children });
    if (href) navigateToSearch(href);
  }

  // Live filter: any control change navigates after a short debounce.
  useEffect(() => {
    if (skipAutoRef.current) {
      skipAutoRef.current = false;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(false), 80);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field watchers
  }, [destination, checkInOn, checkOutOn, adults, children]);

  function guestSummary(): string {
    const a = Number.parseInt(adults, 10) || 1;
    const c = Number.parseInt(children, 10) || 0;
    if (ar) {
      const adultPart = a === 1 ? 'شخص بالغ واحد' : a === 2 ? 'شخصان بالغان' : `${a} بالغين`;
      const childPart = c === 0 ? 'بدون أطفال' : c === 1 ? 'طفل واحد' : `${c} أطفال`;
      return `${adultPart} · ${childPart}`;
    }
    return `${a} adult${a === 1 ? '' : 's'} · ${c} child${c === 1 ? '' : 'ren'}`;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    runSearch(true);
  }

  const dateSummary =
    checkInOn && checkOutOn
      ? `${formatDateLabel(checkInOn, locale)} — ${formatDateLabel(checkOutOn, locale)}`
      : ar
        ? 'تحديد التواريخ'
        : 'Select dates';

  return (
    <form
      className={`booking-bar booking-bar--${variant}`}
      onSubmit={submit}
      role="search"
      aria-label={ar ? 'ابحث عن إقامة يومية' : 'Search daily stays'}
    >
      <div className="booking-bar__segment booking-bar__segment--destination">
        <label className="booking-bar__label" htmlFor="booking-bar-dest">
          {ar ? 'المدينة' : 'City'}
        </label>
        <select
          id="booking-bar-dest"
          className="booking-bar__control"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
        >
          <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
          {omanLocations.map((gov) => (
            <option key={gov.en} value={gov.en}>
              {ar ? gov.ar : gov.en}
            </option>
          ))}
        </select>
      </div>

      <div className="booking-bar__segment booking-bar__segment--dates">
        <span className="booking-bar__label">{ar ? 'التواريخ' : 'Dates'}</span>
        <div className="booking-bar__dates" title={dateSummary}>
          <input
            className="booking-bar__date"
            type="date"
            aria-label={ar ? 'تاريخ الوصول' : 'Check-in'}
            value={checkInOn}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => {
              const next = event.target.value;
              setCheckInOn(next);
              if (checkOutOn <= next) setCheckOutOn(defaultCheckOut(next));
            }}
          />
          <span className="booking-bar__dates-sep" aria-hidden="true">
            —
          </span>
          <input
            className="booking-bar__date"
            type="date"
            aria-label={ar ? 'تاريخ المغادرة' : 'Check-out'}
            value={checkOutOn}
            min={checkInOn || new Date().toISOString().slice(0, 10)}
            onChange={(event) => setCheckOutOn(event.target.value)}
          />
        </div>
        <p className="booking-bar__dates-hint" aria-hidden="true">
          {dateSummary}
        </p>
      </div>

      <div className="booking-bar__segment booking-bar__segment--guests" ref={guestsRef}>
        <span className="booking-bar__label">{ar ? 'الضيوف' : 'Guests'}</span>
        <button
          type="button"
          className="booking-bar__guests-trigger"
          aria-expanded={guestsOpen}
          aria-controls={guestsPanelId}
          onClick={() => setGuestsOpen((open) => !open)}
        >
          {guestSummary()}
        </button>
        {guestsOpen ? (
          <div id={guestsPanelId} className="booking-bar__guests-panel" role="dialog">
            <div className="booking-bar__guests-row">
              <span>{ar ? 'بالغون' : 'Adults'}</span>
              <select
                className="select"
                value={adults}
                onChange={(event) => setAdults(event.target.value)}
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="booking-bar__guests-row">
              <span>{ar ? 'أطفال' : 'Children'}</span>
              <select
                className="select"
                value={children}
                onChange={(event) => setChildren(event.target.value)}
              >
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="button button--quiet booking-bar__guests-done"
              onClick={() => setGuestsOpen(false)}
            >
              {ar ? 'تم' : 'Done'}
            </button>
          </div>
        ) : null}
      </div>

      <button type="submit" className="button button--primary booking-bar__submit">
        {ar ? 'بحث' : 'Search'}
      </button>

      {error ? (
        <p className="booking-bar__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
