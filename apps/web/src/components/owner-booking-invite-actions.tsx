'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import { toMinorUnits } from '@/lib/format';
import { fromMinor } from '@/lib/legal-case-shared';
import { OwnerBookingInviteResend } from '@/components/owner-booking-invite-resend';

function majorFromMinor(minor: string | null | undefined, currency: string): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  const scale = currencyMinorUnits[currency as CurrencyCode] ?? 3;
  const raw = fromMinor(minor, scale);
  return raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/** Edit / cancel / resend controls for unpaid owner-invite bookings. */
export function OwnerBookingInviteActions({
  reservationId,
  locale,
  status,
  currency,
  mode,
  rentMinor,
  depositMinor,
  leaseStartsOn,
  handoverOn,
}: {
  reservationId: string;
  locale: 'ar' | 'en';
  status: string;
  currency: string;
  mode: 'rent' | 'sale';
  rentMinor: string | null;
  depositMinor: string;
  leaseStartsOn: string | null;
  handoverOn: string | null;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const currencyCode = (currency || 'OMR') as CurrencyCode;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rentMajor, setRentMajor] = useState(() => majorFromMinor(rentMinor, currencyCode));
  const [depositMajor, setDepositMajor] = useState(() =>
    majorFromMinor(depositMinor, currencyCode),
  );
  const [startsOn, setStartsOn] = useState(leaseStartsOn ?? '');
  const [handover, setHandover] = useState(handoverOn ?? '');

  const cancelled = status === 'cancelled' || status === 'expired';

  const title = useMemo(
    () =>
      cancelled
        ? ar
          ? 'الدعوة ملغاة — يمكن إعادة إرسالها بنفس البيانات'
          : 'Invite cancelled — you can resend with the same details'
        : ar
          ? 'دعوة يدوية — تعديل أو إلغاء أو إعادة إرسال'
          : 'Manual invite — edit, cancel, or resend',
    [ar, cancelled],
  );

  async function saveTerms() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let rentMinorNext: string | null = null;
      let depositMinorNext: string;
      try {
        if (mode === 'rent') {
          rentMinorNext = toMinorUnits(rentMajor.trim() || '0', currencyCode);
          if (!/^[1-9]\d*$/.test(rentMinorNext)) throw new Error('invalid_amount');
        }
        depositMinorNext = toMinorUnits(depositMajor.trim() || '0', currencyCode);
        if (!/^[1-9]\d*$/.test(depositMinorNext)) throw new Error('invalid_amount');
      } catch {
        throw new ApiError(400, 'invalid_amount', ar ? 'أدخل مبالغ صحيحة.' : 'Enter valid amounts.');
      }
      const csrf = await fetchBrowserCsrfToken(true);
      const response = await fetch(
        `/api/owner/bookings/${encodeURIComponent(reservationId)}/invite-update`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({
            ...(mode === 'rent' ? { rentMinor: rentMinorNext } : {}),
            depositMinor: depositMinorNext,
            leaseStartsOn: startsOn || null,
            handoverOn: handover || null,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; messageAr?: string } }
        | null;
      if (!response.ok) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'update_failed',
          payload?.error?.messageAr ?? payload?.error?.message ?? 'update_failed',
        );
      }
      setMessage(ar ? 'تم حفظ تعديلات الحجز.' : 'Booking terms saved.');
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(humanizeBrowserError(err, ar));
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite() {
    if (
      !window.confirm(
        ar
          ? 'إلغاء هذه الدعوة؟ يبقى السجل ملغى ويمكن إعادة إرساله لاحقاً.'
          : 'Cancel this invite? The record stays cancelled and can be resent later.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const csrf = await fetchBrowserCsrfToken(true);
      const response = await fetch(
        `/api/owner/bookings/${encodeURIComponent(reservationId)}/invite-cancel`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-csrf-token': csrf,
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string; messageAr?: string } }
        | null;
      if (!response.ok) {
        throw new ApiError(
          response.status,
          payload?.error?.code ?? 'cancel_failed',
          payload?.error?.messageAr ?? payload?.error?.message ?? 'cancel_failed',
        );
      }
      setMessage(ar ? 'أُلغيت الدعوة.' : 'Invite cancelled.');
      router.refresh();
    } catch (err) {
      setError(humanizeBrowserError(err, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notice notice--info owner-booking-invite-actions" role="status">
      <p>{title}</p>
      <div className="form-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => {
            setEditing((open) => !open);
            setError(null);
            setMessage(null);
          }}
        >
          {editing
            ? ar
              ? 'إغلاق التعديل'
              : 'Close edit'
            : ar
              ? 'تعديل الإيجار والتواريخ'
              : 'Edit rent & dates'}
        </button>
        {!cancelled ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void cancelInvite()}
          >
            {ar ? 'إلغاء الحجز' : 'Cancel booking'}
          </button>
        ) : null}
        <OwnerBookingInviteResend reservationId={reservationId} locale={locale} />
      </div>

      {editing ? (
        <div className="form-grid" style={{ marginTop: '0.75rem' }}>
          {mode === 'rent' ? (
            <label className="field">
              <span>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</span>
              <input
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={rentMajor}
                onChange={(event) => setRentMajor(event.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span>{ar ? 'مبلغ الضمان / العربون' : 'Deposit / booking fee'}</span>
            <input
              className="input"
              inputMode="decimal"
              dir="ltr"
              value={depositMajor}
              onChange={(event) => setDepositMajor(event.target.value)}
            />
          </label>
          {mode === 'rent' ? (
            <>
              <label className="field">
                <span>{ar ? 'تاريخ بداية العقد' : 'Lease start date'}</span>
                <input
                  className="input"
                  type="date"
                  dir="ltr"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </label>
              <label className="field">
                <span>{ar ? 'تاريخ الاستلام' : 'Handover date'}</span>
                <input
                  className="input"
                  type="date"
                  dir="ltr"
                  value={handover}
                  onChange={(event) => setHandover(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <div className="form-actions span-2">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void saveTerms()}
            >
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ التعديلات' : 'Save changes'}
            </button>
          </div>
        </div>
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
    </div>
  );
}
