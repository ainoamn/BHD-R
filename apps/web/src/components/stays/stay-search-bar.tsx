'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';

const GOVERNORATES = [
  'Muscat',
  'Dhofar',
  'Musandam',
  'Al Buraimi',
  'Ad Dakhiliyah',
  'North Al Batinah',
  'South Al Batinah',
  'North Ash Sharqiyah',
  'South Ash Sharqiyah',
  'Al Dhahirah',
  'Al Wusta',
] as const;

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
  const guestsPanelId = useId();
  const guestsRef = useRef<HTMLDivElement>(null);

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

  function guestSummary(): string {
    const a = Number.parseInt(adults, 10) || 1;
    const c = Number.parseInt(children, 10) || 0;
    if (ar) {
      const adultPart =
        a === 1 ? 'شخص بالغ واحد' : a === 2 ? 'شخصان بالغان' : `${a} بالغين`;
      const childPart = c === 0 ? 'بدون أطفال' : c === 1 ? 'طفل واحد' : `${c} أطفال`;
      return `${adultPart} · ${childPart}`;
    }
    return `${a} adult${a === 1 ? '' : 's'} · ${c} child${c === 1 ? '' : 'ren'}`;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!checkInOn || !checkOutOn) {
      setError(ar ? 'اختر تاريخ الوصول والمغادرة' : 'Select check-in and check-out dates');
      return;
    }
    if (checkOutOn <= checkInOn) {
      setError(ar ? 'تاريخ المغادرة يجب أن يكون بعد الوصول' : 'Check-out must be after check-in');
      return;
    }
    const params = new URLSearchParams();
    if (destination) params.set('destination', destination);
    params.set('checkInOn', checkInOn);
    params.set('checkOutOn', checkOutOn);
    params.set('adults', adults);
    params.set('children', children);
    router.push(`/stays?${params.toString()}`);
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
          {ar ? 'الوجهة' : 'Destination'}
        </label>
        <select
          id="booking-bar-dest"
          className="booking-bar__control"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
        >
          <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
          {GOVERNORATES.map((name) => (
            <option key={name} value={name}>
              {name}
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
