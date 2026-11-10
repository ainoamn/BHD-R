'use client';

import { useState } from 'react';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';

/** Resend the tenant invite email/WhatsApp for an owner-created booking. */
export function OwnerBookingInviteResend({
  reservationId,
  locale,
}: {
  reservationId: string;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const csrf = await fetchBrowserCsrfToken(true);
      const response = await fetch(
        `/api/owner/bookings/${encodeURIComponent(reservationId)}/invite-resend`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({ locale }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { emailed?: number; error?: { code?: string; message?: string; messageAr?: string } }
        | null;
      if (!response.ok) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'resend_failed',
          payload?.error?.messageAr ?? payload?.error?.message ?? 'resend_failed',
        );
      }
      setMessage(
        ar
          ? 'أُعيد إرسال الدعوة بالبريد وواتساب للمستأجر.'
          : 'Invite email and WhatsApp were resent to the tenant.',
      );
    } catch (err) {
      setError(humanizeBrowserError(err, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="owner-booking-invite-resend">
      <button
        type="button"
        className="button button--primary"
        disabled={busy}
        onClick={() => void resend()}
      >
        {busy
          ? ar
            ? 'جارٍ الإرسال…'
            : 'Sending…'
          : ar
            ? 'إعادة إرسال دعوة المستأجر'
            : 'Resend tenant invite'}
      </button>
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
    </div>
  );
}
