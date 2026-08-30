'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
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
  const [done, setDone] = useState<'confirmed' | 'hold_only' | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const csrf = await fetchBrowserCsrfToken();
      const idempotencyKey = crypto.randomUUID();
      const start = await fetch('/api/public/bookings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': csrf,
          'idempotency-key': idempotencyKey,
        },
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
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ sessionReference: startPayload.sessionReference }),
      });
      const completePayload = (await complete.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (complete.status === 403 && completePayload?.error?.code === 'sandbox_disabled') {
        // Production: hold/session created; real payment webhook path not enabled yet.
        setDone('hold_only');
        router.refresh();
        return;
      }
      if (!complete.ok) {
        throw new Error(
          completePayload?.error?.message ?? completePayload?.error?.code ?? 'payment_failed',
        );
      }
      setDone('confirmed');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'payment_failed');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'confirmed') {
    return (
      <div className="notice" role="status">
        <strong>
          {ar ? 'تم تأكيد الحجز والدفع التجريبي' : 'Booking and sandbox payment confirmed'}
        </strong>
        <p>
          {ar
            ? 'سيظهر الحجز لدى إدارة العقار ضمن الحجوزات. يمكنك متابعة التفاصيل من بوابة المستأجر عند تفعيلها.'
            : 'The property team will see this booking under Bookings. Continue in the tenant portal when available.'}
        </p>
        <Link className="button button--primary" href={`/units/${unitId}`} prefetch>
          {ar ? 'العودة للعقار' : 'Back to listing'}
        </Link>
      </div>
    );
  }

  if (done === 'hold_only') {
    return (
      <div className="notice" role="status">
        <strong>{ar ? 'تم تسجيل طلب الحجز' : 'Booking hold registered'}</strong>
        <p>
          {ar
            ? 'تم حجز الوحدة مؤقتاً. تأكيد العربون يتم عبر بوابة الدفع الرسمية (Webhook) — الدفع التجريبي معطّل على الإنتاج.'
            : 'The unit is held temporarily. Deposit confirmation requires the signed payment gateway webhook — sandbox completion is disabled in production.'}
        </p>
        <Link className="button button--primary" href={`/units/${unitId}`} prefetch>
          {ar ? 'العودة للعقار' : 'Back to listing'}
        </Link>
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
          ? 'في الإنتاج يُنشأ حجز مؤقت فقط؛ تأكيد العربون عبر بوابة دفع موقّعة. الدفع التجريبي متاح محلياً فقط.'
          : 'In production this creates a temporary hold only; deposit confirmation uses a signed payment gateway. Sandbox confirm is local-only.'}
      </p>
      <button
        className="button button--primary"
        type="button"
        disabled={busy}
        onClick={() => void pay()}
      >
        {busy
          ? ar
            ? 'جارٍ التسجيل…'
            : 'Submitting…'
          : ar
            ? 'متابعة الحجز'
            : 'Continue booking'}
      </button>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
