'use client';

import { useRef, useState, type FormEvent } from 'react';
import { browserPublicMutation } from '@/lib/api';

function formText(form: FormData, name: string): string {
  const entry = form.get(name);
  return typeof entry === 'string' ? entry.trim() : '';
}

export function PublicViewingForm({ unitId, locale }: { unitId: string; locale: string }) {
  const submissionId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ar = locale === 'ar';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const preferredAt = formText(form, 'preferredAt');
    submissionId.current ??= crypto.randomUUID();
    try {
      const result = await browserPublicMutation<{ reference?: string }>(
        `/v1/public/units/${encodeURIComponent(unitId)}/viewing-requests`,
        {
          submissionId: submissionId.current,
          unitId,
          displayName: formText(form, 'displayName'),
          email: formText(form, 'email'),
          phone: formText(form, 'phone') || undefined,
          preferredAt: preferredAt ? new Date(preferredAt).toISOString() : undefined,
          notes: formText(form, 'notes') || undefined,
          locale: ar ? 'ar' : 'en',
          consent: form.get('consent') === 'on',
          website: formText(form, 'website') || undefined,
        },
      );
      setReference(result.reference ?? 'accepted');
      event.currentTarget.reset();
    } catch {
      setError(
        ar
          ? 'تعذّر إرسال الطلب. قد تكون الوحدة لم تعد متاحة؛ يرجى المحاولة لاحقاً.'
          : 'The request could not be sent. The unit may no longer be available; please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (reference)
    return (
      <div className="viewing-success" role="status">
        <strong>{ar ? 'تم استلام طلبك' : 'Your request was received'}</strong>
        <p>
          {ar
            ? 'سيتواصل معك فريق إدارة العقار لتأكيد الموعد.'
            : 'The property team will contact you to confirm the appointment.'}
        </p>
        {reference !== 'accepted' ? (
          <small>
            {ar ? 'المرجع' : 'Reference'}: {reference}
          </small>
        ) : null}
      </div>
    );

  return (
    <form className="viewing-form" onSubmit={(event) => void submit(event)}>
      <h3>{ar ? 'اطلب معاينة العقار' : 'Request a viewing'}</h3>
      <div className="field">
        <label htmlFor="viewing-name">{ar ? 'الاسم الكامل' : 'Full name'}</label>
        <input id="viewing-name" className="input" name="displayName" minLength={2} required />
      </div>
      <div className="field">
        <label htmlFor="viewing-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label>
        <input id="viewing-email" className="input" name="email" type="email" required />
      </div>
      <div className="field">
        <label htmlFor="viewing-phone">{ar ? 'رقم الهاتف' : 'Phone'}</label>
        <input id="viewing-phone" className="input" name="phone" type="tel" minLength={6} />
      </div>
      <div className="field">
        <label htmlFor="viewing-time">{ar ? 'الوقت المفضل' : 'Preferred time'}</label>
        <input id="viewing-time" className="input" name="preferredAt" type="datetime-local" />
      </div>
      <div className="field">
        <label htmlFor="viewing-notes">{ar ? 'ملاحظات' : 'Notes'}</label>
        <textarea id="viewing-notes" className="textarea" name="notes" maxLength={2000} />
      </div>
      <div className="public-honeypot" aria-hidden="true">
        <label htmlFor="viewing-website">Website</label>
        <input id="viewing-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="checkbox-row">
        <input name="consent" type="checkbox" required />
        <span>
          {ar
            ? 'أوافق على استخدام بياناتي للتواصل معي بخصوص هذا العقار.'
            : 'I agree to the use of my details to contact me about this property.'}
        </span>
      </label>
      <button className="button button--primary" type="submit" disabled={busy}>
        {busy
          ? ar
            ? 'جارٍ الإرسال…'
            : 'Sending…'
          : ar
            ? 'إرسال طلب المعاينة'
            : 'Send viewing request'}
      </button>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
