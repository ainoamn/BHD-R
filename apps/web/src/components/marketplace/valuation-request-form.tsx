'use client';

import { useState, type FormEvent } from 'react';
import {
  MARKETPLACE_CITY_LABELS,
  type MarketplaceCity,
} from '@/lib/marketplace-directory';

const CITIES = Object.keys(MARKETPLACE_CITY_LABELS) as MarketplaceCity[];

export function ValuationRequestForm({ locale }: { locale: string }) {
  const ar = locale !== 'en';
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (String(data.get('website') ?? '').trim()) {
      setStatus('ok');
      setMessage(ar ? 'تم استلام طلبك.' : 'Your request was received.');
      form.reset();
      return;
    }

    setBusy(true);
    setStatus('idle');
    setMessage(null);
    try {
      const response = await fetch('/api/public/valuation-request', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: String(data.get('fullName') ?? '').trim(),
          email: String(data.get('email') ?? '').trim(),
          phone: String(data.get('phone') ?? '').trim() || undefined,
          city: String(data.get('city') ?? '').trim(),
          propertyType: String(data.get('propertyType') ?? '').trim(),
          notes: String(data.get('notes') ?? '').trim() || undefined,
          locale: ar ? 'ar' : 'en',
          consent: data.get('consent') === 'on',
          website: String(data.get('website') ?? ''),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        const code = body?.error?.code;
        throw new Error(code ?? 'request_failed');
      }
      setStatus('ok');
      setMessage(
        ar
          ? 'تم استلام طلب التثمين. سنتواصل معك قريباً ونربطك بمثّمن مناسب.'
          : 'Valuation request received. We will contact you shortly and match an appraiser.',
      );
      form.reset();
    } catch {
      setStatus('err');
      setMessage(
        ar
          ? 'تعذّر إرسال الطلب الآن. حاول مرة أخرى أو اتصل بنا مباشرة.'
          : 'Could not send the request right now. Please try again or contact us directly.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mkt-form" onSubmit={onSubmit} noValidate>
      <div className="mkt-form__grid">
        <div className="mkt-form__row">
          <label htmlFor="val-name">{ar ? 'الاسم الكامل' : 'Full name'}</label>
          <input id="val-name" name="fullName" required maxLength={160} autoComplete="name" />
        </div>
        <div className="mkt-form__row">
          <label htmlFor="val-phone">{ar ? 'الجوال' : 'Mobile'}</label>
          <input
            id="val-phone"
            name="phone"
            type="tel"
            required
            maxLength={40}
            autoComplete="tel"
            placeholder="+968 …"
            dir="ltr"
          />
        </div>
      </div>
      <div className="mkt-form__row">
        <label htmlFor="val-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label>
        <input
          id="val-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          dir="ltr"
        />
      </div>
      <div className="mkt-form__grid">
        <div className="mkt-form__row">
          <label htmlFor="val-city">{ar ? 'المدينة / المنطقة' : 'City / area'}</label>
          <select id="val-city" name="city" required defaultValue="muscat">
            {CITIES.map((id) => (
              <option key={id} value={id}>
                {ar ? MARKETPLACE_CITY_LABELS[id].ar : MARKETPLACE_CITY_LABELS[id].en}
              </option>
            ))}
          </select>
        </div>
        <div className="mkt-form__row">
          <label htmlFor="val-type">{ar ? 'نوع العقار' : 'Property type'}</label>
          <select id="val-type" name="propertyType" required defaultValue="villa">
            <option value="apartment">{ar ? 'شقة' : 'Apartment'}</option>
            <option value="villa">{ar ? 'فيلا' : 'Villa'}</option>
            <option value="land">{ar ? 'أرض' : 'Land'}</option>
            <option value="commercial">{ar ? 'تجاري' : 'Commercial'}</option>
            <option value="other">{ar ? 'أخرى' : 'Other'}</option>
          </select>
        </div>
      </div>
      <div className="mkt-form__row">
        <label htmlFor="val-notes">{ar ? 'تفاصيل إضافية' : 'Additional details'}</label>
        <textarea
          id="val-notes"
          name="notes"
          maxLength={2000}
          placeholder={
            ar
              ? 'الموقع التقريبي، المساحة، الغرض من التثمين…'
              : 'Approx. location, size, purpose of valuation…'
          }
        />
      </div>
      <label className="mkt-form__consent">
        <input type="checkbox" name="consent" required />
        <span>
          {ar
            ? 'أوافق على التواصل معي بخصوص طلب التثمين وعلى سياسة الخصوصية.'
            : 'I agree to be contacted about this valuation request and to the privacy policy.'}
        </span>
      </label>
      <div className="mkt-form__hp" aria-hidden="true">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {message ? (
        <p
          className={`mkt-form__status ${
            status === 'ok' ? 'mkt-form__status--ok' : 'mkt-form__status--err'
          }`}
          role="status"
        >
          {message}
        </p>
      ) : null}
      <button className="button button--gold" type="submit" disabled={busy}>
        {busy
          ? ar
            ? 'جارٍ الإرسال…'
            : 'Sending…'
          : ar
            ? 'اطلب تثمين العقار'
            : 'Request a valuation'}
      </button>
    </form>
  );
}
