'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/format';

export function BookingCheckoutForm({
  unitId,
  locale,
  depositMinor,
  currency,
  title,
}: {
  unitId: string;
  locale: 'ar' | 'en';
  depositMinor: string;
  currency: string;
  title: string;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const start = await fetch('/api/public/bookings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ unitId }),
      });
      const startPayload = (await start.json().catch(() => null)) as {
        sessionReference?: string;
        error?: { code?: string; message?: string };
      } | null;
      if (!start.ok || !startPayload?.sessionReference) {
        throw new Error(
          startPayload?.error?.message ?? startPayload?.error?.code ?? 'booking_failed',
        );
      }

      const complete = await fetch('/api/public/bookings/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionReference: startPayload.sessionReference }),
      });
      const completePayload = (await complete.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (!complete.ok) {
        throw new Error(
          completePayload?.error?.message ?? completePayload?.error?.code ?? 'payment_failed',
        );
      }
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'payment_failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="notice" role="status">
        <strong>{ar ? 'تم تأكيد الحجز والدفع التجريبي' : 'Booking and sandbox payment confirmed'}</strong>
        <p>
          {ar
            ? 'سيظهر الحجز لدى إدارة العقار ضمن الحجوزات. يمكنك متابعة التفاصيل من بوابة المستأجر عند تفعيلها.'
            : 'The property team will see this booking under Bookings. Continue in the tenant portal when available.'}
        </p>
        <a className="button button--primary" href={`/${locale}/units/${unitId}`}>
          {ar ? 'العودة للعقار' : 'Back to listing'}
        </a>
      </div>
    );
  }

  return (
    <div className="booking-checkout">
      <h1>{ar ? 'دفع عربون الحجز' : 'Pay booking deposit'}</h1>
      <p>{title}</p>
      <p className="booking-checkout__amount" dir="ltr">
        {formatMoney(depositMinor, currency, locale)}
      </p>
      <p className="muted">
        {ar
          ? 'هذه شاشة دفع تجريبية (sandbox) — لا يُخصم مبلغ حقيقي. المبلغ يحدده المالك من إدارة العقار.'
          : 'Sandbox payment screen — no real charge. The owner sets this amount on the property manage page.'}
      </p>
      <button className="button button--primary" type="button" disabled={busy} onClick={() => void pay()}>
        {busy
          ? ar
            ? 'جارٍ الدفع…'
            : 'Paying…'
          : ar
            ? 'ادفع العربون الآن'
            : 'Pay deposit now'}
      </button>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
