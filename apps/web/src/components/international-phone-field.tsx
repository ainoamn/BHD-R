'use client';

import { useMemo, useState } from 'react';
import {
  countryByCode,
  isInternationalPhone,
  joinPhone,
  sortedCountries,
  splitPhone,
} from '@/lib/world-countries';

/** Countries that share a dialling code: the one to preselect when only the number is known. */
const PREFERRED_FOR_DIAL: Record<string, string> = {
  '1': 'US',
  '7': 'RU',
  '44': 'GB',
  '47': 'NO',
  '61': 'AU',
  '212': 'MA',
  '262': 'RE',
  '358': 'FI',
  '590': 'GP',
  '599': 'CW',
  '39': 'IT',
};

function countryForDial(dial: string): string {
  if (PREFERRED_FOR_DIAL[dial]) return PREFERRED_FOR_DIAL[dial];
  return sortedCountries('en').find((row) => row.dial === dial)?.code ?? 'OM';
}

function localDigitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
}

/**
 * Phone number for any country: a dialling-code picker plus the local number, emitted as E.164
 * (`+96891234567`). An empty local number emits an empty string.
 * Local part must be 8–9 digits to count as complete.
 */
export function InternationalPhoneField({
  id,
  label,
  value,
  onChange,
  locale,
  required,
  hint,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  locale: 'ar' | 'en';
  required?: boolean;
  hint?: string;
  /** Takes priority over the length / default hints when set. */
  error?: string | null;
  autoComplete?: string;
}) {
  const ar = locale === 'ar';
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const initial = splitPhone(value);
  const [country, setCountry] = useState(() => countryForDial(initial.dial));
  const dial = countryByCode(country)?.dial ?? '968';
  const local = !value
    ? ''
    : value.startsWith(`+${dial}`)
      ? value.slice(dial.length + 1)
      : splitPhone(value, dial).local;
  const localLen = local.replace(/\D/g, '').length;
  const started = localLen > 0;
  const complete = isInternationalPhone(value);
  const lengthHint = ar
    ? 'أدخل 8 أو 9 أرقام محلية (بدون رمز الدولة).'
    : 'Enter 8 or 9 local digits (without the country code).';
  const showLengthHint = started && !complete;
  const alertText = error || (showLengthHint ? lengthHint : null);

  return (
    <div className={`field intl-phone${alertText ? ' is-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="intl-phone__row" dir="ltr">
        <select
          className="select intl-phone__country"
          aria-label={ar ? 'رمز الدولة' : 'Country code'}
          value={country}
          onChange={(event) => {
            const next = event.target.value;
            setCountry(next);
            onChange(joinPhone(countryByCode(next)?.dial ?? dial, localDigitsOnly(local)));
          }}
        >
          {countries.map((row) => (
            <option key={row.code} value={row.code}>
              {`+${row.dial} · ${ar ? row.nameAr : row.nameEn}`}
            </option>
          ))}
        </select>
        <input
          id={id}
          className="input intl-phone__number"
          type="tel"
          inputMode="numeric"
          required={required}
          value={local}
          maxLength={9}
          autoComplete={autoComplete ?? 'off'}
          placeholder={dial === '968' ? '9xxxxxxx' : 'xxxxxxxx'}
          aria-invalid={alertText ? true : undefined}
          onChange={(event) => onChange(joinPhone(dial, localDigitsOnly(event.target.value)))}
        />
      </div>
      {alertText ? (
        <p className="field__error" role="alert">
          {alertText}
        </p>
      ) : hint ? (
        <p className="field__hint muted">{hint}</p>
      ) : (
        <p className="field__hint muted">{lengthHint}</p>
      )}
    </div>
  );
}
