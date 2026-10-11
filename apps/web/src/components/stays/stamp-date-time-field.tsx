'use client';

import { useEffect, useMemo, useState } from 'react';

type Period = 'am' | 'pm';
type Parts = { date: string; time: string; period: Period };

const MUSCAT_OFFSET_MS = 4 * 3_600_000;
const FUTURE_GRACE_MS = 15 * 60_000;

const pad = (value: number) => String(value).padStart(2, '0');

/** Arabic-Indic and Persian digits → ASCII, so either keyboard works. */
function asciiDigits(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Oman wall-clock parts for an instant. */
function muscatParts(ms: number): Parts {
  const d = new Date(ms + MUSCAT_OFFSET_MS);
  const hours = d.getUTCHours();
  return {
    date: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    time: `${pad(hours % 12 || 12)}:${pad(d.getUTCMinutes())}`,
    period: hours >= 12 ? 'pm' : 'am',
  };
}

export function maskDate(raw: string): string {
  const value = asciiDigits(raw).replace(/[-.\s\\]/g, '/');
  if (/^\d+$/.test(value) && value.length > 2) {
    const digits = value.slice(0, 8);
    return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
  }
  return value.replace(/[^\d/]/g, '').slice(0, 10);
}

export function maskTime(raw: string): string {
  const value = asciiDigits(raw).replace(/[.\s٫]/g, ':');
  if (/^\d{3,4}$/.test(value)) return `${value.slice(0, -2)}:${value.slice(-2)}`;
  return value.replace(/[^\d:]/g, '').slice(0, 5);
}

type Parsed =
  | { ok: true; value: string; utcMs: number; hours: number }
  | { ok: false; reason: 'date' | 'time' };

export function parseStampParts({ date, time, period }: Parts): Parsed {
  const dm = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!dm) return { ok: false, reason: 'date' };
  const day = Number(dm[1]);
  const month = Number(dm[2]);
  const year = dm[3]!.length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    probe.getUTCDate() !== day ||
    probe.getUTCMonth() !== month - 1 ||
    year < 2000
  ) {
    return { ok: false, reason: 'date' };
  }

  const tm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return { ok: false, reason: 'time' };
  let hours = Number(tm[1]);
  const minutes = Number(tm[2]);
  if (hours > 23 || minutes > 59) return { ok: false, reason: 'time' };
  // 1–12 follow the ص/م toggle; 0 and 13–23 are read as a 24-hour clock.
  if (hours >= 1 && hours <= 12) hours = (hours % 12) + (period === 'pm' ? 12 : 0);

  const value = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`;
  const utcMs = Date.UTC(year, month - 1, day, hours, minutes) - MUSCAT_OFFSET_MS;
  return { ok: true, value, utcMs, hours };
}

/**
 * Date + time typed by hand (day/month/year and h:mm with ص/م), read as Oman
 * time. Reports `YYYY-MM-DDTHH:MM` or null while the entry is incomplete or invalid.
 */
export function StampDateTimeField({
  id,
  label,
  locale,
  onChange,
}: {
  id: string;
  label: string;
  locale: 'ar' | 'en';
  onChange: (value: string | null) => void;
}) {
  const ar = locale === 'ar';
  const [parts, setParts] = useState<Parts>(() => muscatParts(Date.now()));
  const parsed = useMemo(() => parseStampParts(parts), [parts]);
  const future = parsed.ok && parsed.utcMs > Date.now() + FUTURE_GRACE_MS;
  const valid = parsed.ok && !future;

  useEffect(() => {
    onChange(valid && parsed.ok ? parsed.value : null);
  }, [valid, parsed, onChange]);

  const preview = parsed.ok
    ? new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Muscat',
      }).format(new Date(parsed.utcMs))
    : null;

  const error = !parsed.ok
    ? parsed.reason === 'date'
      ? ar
        ? 'اكتب التاريخ بصيغة يوم/شهر/سنة، مثل 11/10/2026.'
        : 'Type the date as day/month/year, e.g. 11/10/2026.'
      : ar
        ? 'اكتب الوقت بصيغة ساعة:دقيقة، مثل 3:07.'
        : 'Type the time as hour:minute, e.g. 3:07.'
    : future
      ? ar
        ? 'الوقت في المستقبل. سجّل الوقت الفعلي.'
        : 'That time is in the future. Record the actual time.'
      : null;

  const hours24 = parsed.ok ? parsed.hours : null;
  const twentyFour = /^(0|00|1[3-9]|2[0-3]):/.test(parts.time);

  const shortcuts: Array<{ key: string; label: string; ms: number }> = [
    { key: 'now', label: ar ? 'الآن' : 'Now', ms: Date.now() },
    { key: 'hour', label: ar ? 'قبل ساعة' : 'An hour ago', ms: Date.now() - 3_600_000 },
    { key: 'yesterday', label: ar ? 'أمس' : 'Yesterday', ms: Date.now() - 86_400_000 },
  ];

  return (
    <div
      className={`field stamp-dt${error ? ' field--missing' : ''}`}
      role="group"
      aria-labelledby={`${id}-label`}
    >
      <span id={`${id}-label`} className="stamp-dt__label">
        {label}
      </span>
      <div className="stamp-dt__row">
        <label className="stamp-dt__part stamp-dt__part--date">
          <span>{ar ? 'التاريخ' : 'Date'}</span>
          <input
            id={`${id}-date`}
            className="input"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder={ar ? 'يوم/شهر/سنة' : 'dd/mm/yyyy'}
            value={parts.date}
            onChange={(event) => setParts((p) => ({ ...p, date: maskDate(event.target.value) }))}
          />
        </label>
        <label className="stamp-dt__part stamp-dt__part--time">
          <span>{ar ? 'الوقت' : 'Time'}</span>
          <input
            id={`${id}-time`}
            className="input"
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder="3:07"
            value={parts.time}
            onChange={(event) => setParts((p) => ({ ...p, time: maskTime(event.target.value) }))}
          />
        </label>
        <div
          className="stamp-dt__period"
          role="radiogroup"
          aria-label={ar ? 'صباحاً أو مساءً' : 'AM or PM'}
        >
          {(['am', 'pm'] as const).map((period) => (
            <button
              key={period}
              type="button"
              role="radio"
              aria-checked={
                twentyFour
                  ? hours24 !== null && hours24 >= 12 === (period === 'pm')
                  : parts.period === period
              }
              disabled={twentyFour}
              onClick={() => setParts((p) => ({ ...p, period }))}
            >
              {period === 'am' ? (ar ? 'ص' : 'AM') : ar ? 'م' : 'PM'}
            </button>
          ))}
        </div>
      </div>
      <div className="stamp-dt__shortcuts">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.key}
            type="button"
            className="stamp-dt__chip"
            onClick={() => setParts(muscatParts(shortcut.ms))}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      {error ? (
        <small className="stamp-dt__error" role="alert">
          {error}
        </small>
      ) : preview ? (
        <small className="stamp-dt__preview">
          {ar ? 'سيُسجَّل: ' : 'Will record: '}
          <strong>{preview}</strong>
          {ar ? ' (بتوقيت مسقط)' : ' (Muscat time)'}
        </small>
      ) : null}
    </div>
  );
}
