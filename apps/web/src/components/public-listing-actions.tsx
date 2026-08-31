'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { PublicListingShare } from '@/components/public-listing-share';

type ListingPurpose = 'rent' | 'sale' | 'both';
type Interest = 'rent' | 'sale';

export function PublicListingActions({
  unitId,
  locale,
  signedIn,
  depositMinor,
  currency,
  canBook,
  sharePath,
  shareTitle,
  shareDescription,
  listingPurpose = 'rent',
  rentMinor,
  salePriceMinor,
}: {
  unitId: string;
  locale: 'ar' | 'en';
  signedIn: boolean;
  depositMinor: string | null;
  currency: string;
  canBook: boolean;
  sharePath: string;
  shareTitle: string;
  shareDescription?: string | null;
  listingPurpose?: ListingPurpose;
  rentMinor?: string | null;
  salePriceMinor?: string | null;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsChoice = listingPurpose === 'both';
  const [interest, setInterest] = useState<Interest | null>(
    listingPurpose === 'sale' ? 'sale' : listingPurpose === 'rent' ? 'rent' : null,
  );

  const loginHref = `/${locale}/login?next=${encodeURIComponent(`/${locale}/units/${unitId}`)}`;
  const bookHref = `/${locale}/book/${unitId}`;

  const effectiveInterest: Interest | null = needsChoice ? interest : listingPurpose === 'sale' ? 'sale' : 'rent';
  const showRentActions = effectiveInterest === 'rent';
  const showSaleActions = effectiveInterest === 'sale';

  const dualPrices = useMemo(() => {
    const rent =
      rentMinor && rentMinor !== '0'
        ? formatMoney(rentMinor, currency, locale)
        : null;
    const sale =
      salePriceMinor && salePriceMinor !== '0'
        ? formatMoney(salePriceMinor, currency, locale)
        : null;
    return { rent, sale };
  }, [rentMinor, salePriceMinor, currency, locale]);

  async function requestViewing() {
    if (!signedIn) {
      router.push(loginHref);
      return;
    }
    if (needsChoice && !interest) {
      setError(ar ? 'اختر التأجير أو الشراء أولاً.' : 'Choose rent or purchase first.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/public/viewing-requests', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          unitId,
          locale,
          ...(effectiveInterest ? { interest: effectiveInterest } : {}),
        }),
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
      router.push(`/${locale}/login?next=${encodeURIComponent(bookHref)}`);
      return;
    }
    router.push(bookHref);
  }

  async function requestPurchase() {
    if (!signedIn) {
      router.push(loginHref);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/public/sale-interest', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
          'idempotency-key': crypto.randomUUID(),
        },
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
          ? `تم تسجيل اهتمام الشراء في نظام البيع${payload?.reference ? ` · ${payload.reference}` : ''}.`
          : `Purchase interest logged in sales${payload?.reference ? ` · ${payload.reference}` : ''}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="public-listing-actions">
      {needsChoice ? (
        <div className="public-listing-actions__interest" role="group" aria-label={ar ? 'اختر التأجير أو الشراء' : 'Choose rent or purchase'}>
          <p className="muted">{ar ? 'اختر التأجير أو الشراء' : 'Choose rent or purchase'}</p>
          <div className="public-listing-actions__interest-row">
            <button
              type="button"
              className={`button ${interest === 'rent' ? 'button--primary' : 'button--quiet'}`}
              disabled={busy}
              onClick={() => setInterest('rent')}
            >
              {ar ? 'أريد التأجير' : 'I want to rent'}
              {dualPrices.rent ? ` · ${dualPrices.rent}` : ''}
            </button>
            <button
              type="button"
              className={`button ${interest === 'sale' ? 'button--primary' : 'button--quiet'}`}
              disabled={busy}
              onClick={() => setInterest('sale')}
            >
              {ar ? 'أريد الشراء' : 'I want to buy'}
              {dualPrices.sale ? ` · ${dualPrices.sale}` : ''}
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="button button--primary property-360__summary-cta"
        disabled={busy || (needsChoice && !interest)}
        onClick={() => void requestViewing()}
      >
        {ar ? 'طلب معاينة' : 'Request viewing'}
      </button>

      {showRentActions ? (
        <>
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
        </>
      ) : null}

      {showSaleActions ? (
        <button
          type="button"
          className="button button--quiet property-360__summary-cta"
          disabled={busy}
          onClick={() => void requestPurchase()}
        >
          {ar ? 'طلب اهتمام بالشراء' : 'Express purchase interest'}
        </button>
      ) : null}

      {!signedIn ? (
        <p className="muted">
          {ar
            ? 'يلزم تسجيل الدخول لطلب المعاينة أو الحجز.'
            : 'Sign in is required to request a viewing or book.'}
        </p>
      ) : null}
      {message ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <PublicListingShare
        path={sharePath}
        title={shareTitle}
        description={shareDescription}
        locale={locale}
      />
    </div>
  );
}
