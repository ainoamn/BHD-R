'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/format';

export function PublicListingActions({
  unitId,
  locale,
  signedIn,
  depositMinor,
  currency,
  canBook,
}: {
  unitId: string;
  locale: 'ar' | 'en';
  signedIn: boolean;
  depositMinor: string | null;
  currency: string;
  canBook: boolean;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginHref = `/${locale}/login?next=${encodeURIComponent(`/${locale}/units/${unitId}`)}`;
  const bookHref = `/${locale}/book/${unitId}`;

  async function requestViewing() {
    if (!signedIn) {
      router.push(loginHref);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/public/viewing-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ unitId, locale }),
      });
      const payload = (await response.json().catch(() => null)) as {
        reference?: string;
        error?: { message?: string; code?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.error?.code ?? 'request_failed');
      }
      setMessage(
        ar
          ? `تم إرسال طلب المعاينة${payload?.reference ? ` · المرجع ${payload.reference}` : ''}.`
          : `Viewing request sent${payload?.reference ? ` · ref ${payload.reference}` : ''}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  function startBooking() {
    if (!signedIn) {
      router.push(
        `/${locale}/login?next=${encodeURIComponent(bookHref)}`,
      );
      return;
    }
    router.push(bookHref);
  }

  return (
    <div className="public-listing-actions">
      <button
        type="button"
        className="button button--primary property-360__summary-cta"
        disabled={busy}
        onClick={() => void requestViewing()}
      >
        {ar ? 'طلب معاينة' : 'Request viewing'}
      </button>
      <button
        type="button"
        className="button button--quiet property-360__summary-cta"
        disabled={busy || !canBook}
        onClick={() => startBooking()}
      >
        {ar ? 'احجز الآن' : 'Book now'}
      </button>
      {canBook && depositMinor ? (
        <p className="muted public-listing-actions__deposit">
          {ar ? 'عربون الحجز:' : 'Booking deposit:'}{' '}
          <strong dir="ltr">{formatMoney(depositMinor, currency, locale)}</strong>
        </p>
      ) : (
        <p className="muted public-listing-actions__deposit">
          {ar
            ? 'الحجز متاح بعد تحديد العربون من إدارة العقار.'
            : 'Booking opens once the owner sets a deposit.'}
        </p>
      )}
      {!signedIn ? (
        <p className="muted">
          {ar
            ? 'يلزم تسجيل الدخول لطلب المعاينة أو الحجز.'
            : 'Sign in is required to request a viewing or book.'}
        </p>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
