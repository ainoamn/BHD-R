'use client';

import { useState } from 'react';

export const GUEST_COUNT_MAX = 999;
const OPEN_FROM = 100;

type Band = { kind: 'exact'; value: number } | { kind: 'range'; from: number } | { kind: 'open' };

function bandKey(band: Band): string {
  if (band.kind === 'exact') return `n${band.value}`;
  if (band.kind === 'range') return `r${band.from}`;
  return 'open';
}

function bandFor(count: number): Band {
  if (count <= 9) return { kind: 'exact', value: Math.max(0, count) };
  if (count < OPEN_FROM) return { kind: 'range', from: Math.floor(count / 10) * 10 };
  return { kind: 'open' };
}

function parseBand(key: string): Band {
  if (key === 'open') return { kind: 'open' };
  if (key.startsWith('r')) return { kind: 'range', from: Number(key.slice(1)) };
  return { kind: 'exact', value: Number(key.slice(1)) };
}

/** Whole number within the guest range for the field (adults ≥ 1, children ≥ 0). */
export function isValidGuestCount(value: string, min: number): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const count = Number(value);
  return count >= min && count <= GUEST_COUNT_MAX;
}

export function GuestCountField({
  id,
  label,
  value,
  onChange,
  min,
  ar,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  min: 0 | 1;
  ar: boolean;
  className?: string;
}) {
  const [band, setBand] = useState<Band>(() => bandFor(Number(value) || min));
  const count = Number(value);
  const needsTotal = band.kind !== 'exact';
  const totalMin = band.kind === 'range' ? band.from : OPEN_FROM;
  const totalMax = band.kind === 'range' ? band.from + 9 : GUEST_COUNT_MAX;
  const totalOutOfBand =
    needsTotal &&
    value.trim() !== '' &&
    (!/^\d+$/.test(value) || count < totalMin || count > totalMax);

  function chooseBand(key: string) {
    const next = parseBand(key);
    setBand(next);
    if (next.kind === 'exact') {
      onChange(String(next.value));
    } else if (next.kind === 'range') {
      if (!(count >= next.from && count <= next.from + 9)) onChange(String(next.from));
    } else if (!(count >= OPEN_FROM)) {
      onChange('');
    }
  }

  const exact = Array.from({ length: 10 - min }, (_, index) => index + min);
  const ranges = [10, 20, 30, 40, 50, 60, 70, 80, 90];

  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      <select
        className="select"
        id={id}
        value={bandKey(band)}
        onChange={(event) => chooseBand(event.target.value)}
      >
        {exact.map((option) => (
          <option key={option} value={`n${option}`}>
            {option}
          </option>
        ))}
        {ranges.map((from) => (
          <option key={from} value={`r${from}`}>
            {ar ? `≥ ${from} و < ${from + 10}` : `≥ ${from} and < ${from + 10}`}
          </option>
        ))}
        <option value="open">
          {ar ? `≥ ${OPEN_FROM} (أدخل العدد)` : `≥ ${OPEN_FROM} (enter total)`}
        </option>
      </select>
      {needsTotal ? (
        <div className="guest-count-field__total">
          <label htmlFor={`${id}-total`}>
            {ar ? 'العدد الإجمالي' : 'Exact total'}
            <small>
              {band.kind === 'range'
                ? ar
                  ? ` (من ${totalMin} إلى ${totalMax})`
                  : ` (${totalMin}–${totalMax})`
                : ar
                  ? ` (${OPEN_FROM} أو أكثر — مطلوب)`
                  : ` (${OPEN_FROM}+ — required)`}
            </small>
          </label>
          <input
            className="input"
            id={`${id}-total`}
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={totalMin}
            max={totalMax}
            step={1}
            required
            placeholder={String(totalMin)}
            value={value}
            aria-invalid={totalOutOfBand || undefined}
            onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            onBlur={() => {
              if (isValidGuestCount(value, min)) setBand(bandFor(count));
            }}
          />
          {totalOutOfBand ? (
            <p className="field__error" role="alert">
              {ar
                ? `أدخل عدداً بين ${totalMin} و${totalMax}`
                : `Enter a number between ${totalMin} and ${totalMax}`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
