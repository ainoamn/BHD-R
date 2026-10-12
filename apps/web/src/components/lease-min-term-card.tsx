'use client';

import { useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import { DEFAULT_MIN_LEASE_MONTHS, MAX_LEASE_MONTHS } from '@/lib/reservation-party';

/** Owner sets the shortest lease a customer may request when booking this property online. */
export function LeaseMinTermCard({
  locale,
  propertyId,
  initialMonths,
}: {
  locale: 'ar' | 'en';
  propertyId: string;
  initialMonths: number | null;
}) {
  const ar = locale === 'ar';
  const [value, setValue] = useState(initialMonths ? String(initialMonths) : '');
  const [saved, setSaved] = useState<number | null>(initialMonths);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(months: number | null) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserNextMutation<{ months: number | null }>(
        `/api/owner/properties/${encodeURIComponent(propertyId)}/min-term`,
        { method: 'PUT', body: JSON.stringify({ months }) },
      );
      setSaved(result.months);
      setValue(result.months ? String(result.months) : '');
      setMessage({ ok: true, text: ar ? 'تم الحفظ.' : 'Saved.' });
    } catch (caught) {
      setMessage({
        ok: false,
        text:
          caught instanceof ApiError && caught.code === 'forbidden'
            ? ar
              ? 'لا تملك صلاحية تعديل العقار.'
              : 'You cannot edit this property.'
            : ar
              ? 'تعذّر الحفظ — أعد المحاولة.'
              : 'Could not save — try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const months = Number(value);
    if (!Number.isInteger(months) || months < 1 || months > MAX_LEASE_MONTHS) {
      setMessage({
        ok: false,
        text: ar
          ? `أدخل عدد أشهر بين 1 و${MAX_LEASE_MONTHS}.`
          : `Enter between 1 and ${MAX_LEASE_MONTHS} months.`,
      });
      return;
    }
    void save(months);
  }

  return (
    <section className="min-term-card" aria-labelledby="min-term-title">
      <div>
        <h2 id="min-term-title">{ar ? 'أقل مدة لعقد الإيجار' : 'Minimum lease term'}</h2>
        <p className="muted">
          {ar
            ? `يختار المستأجر مدة العقد عند الحجز ولا يُقبل أقل من هذه المدة. الافتراضي سنة (${DEFAULT_MIN_LEASE_MONTHS} شهراً).`
            : `Tenants pick the contract term when booking and cannot go below this. Default is one year (${DEFAULT_MIN_LEASE_MONTHS} months).`}
        </p>
        <p className="min-term-card__current">
          {ar ? 'المعمول به الآن: ' : 'Currently: '}
          <strong>
            {saved ?? DEFAULT_MIN_LEASE_MONTHS} {ar ? 'شهراً' : 'months'}
          </strong>
          {saved ? null : ar ? ' (الافتراضي)' : ' (default)'}
        </p>
      </div>
      <div className="min-term-card__form">
        <label className="field">
          <span>{ar ? 'عدد الأشهر' : 'Months'}</span>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LEASE_MONTHS}
            dir="ltr"
            value={value}
            placeholder={String(DEFAULT_MIN_LEASE_MONTHS)}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button type="button" className="button button--primary" disabled={busy} onClick={submit}>
          {ar ? 'حفظ' : 'Save'}
        </button>
        {saved ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void save(null)}
          >
            {ar ? 'العودة للافتراضي' : 'Use default'}
          </button>
        ) : null}
      </div>
      {message ? (
        <p className={message.ok ? 'notice notice--success' : 'notice notice--error'} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
