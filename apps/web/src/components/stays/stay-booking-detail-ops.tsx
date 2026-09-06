'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserMutation } from '@/lib/api';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';

const CANCELABLE = new Set(['request_pending', 'payment_pending', 'confirmed', 'pre_arrival']);
const NO_SHOWABLE = new Set(['confirmed', 'pre_arrival']);

export function StayBookingDetailOps({
  locale,
  portal,
  bookingId,
  unitId,
  status,
  checkInOn,
  checkOutOn,
  stayListingSlug,
  propertyId,
}: {
  locale: string;
  portal: 'owner' | 'developer';
  bookingId: string;
  unitId: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  stayListingSlug?: string | null;
  propertyId: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);

  const canCancel = CANCELABLE.has(currentStatus);
  const canNoShow = NO_SHOWABLE.has(currentStatus);
  const rejectLabel =
    currentStatus === 'request_pending'
      ? ar
        ? 'رفض الطلب'
        : 'Reject request'
      : ar
        ? 'إلغاء الحجز'
        : 'Cancel booking';

  async function runAction(action: 'cancel' | 'no-show') {
    const confirmMessage =
      action === 'cancel'
        ? ar
          ? currentStatus === 'request_pending'
            ? 'هل تريد رفض هذا الطلب؟ سيُلغى الحجز ويُحرَّر التاريخ.'
            : 'هل تريد إلغاء هذا الحجز وتحرير التواريخ؟'
          : currentStatus === 'request_pending'
            ? 'Reject this request and free the dates?'
            : 'Cancel this booking and free the dates?'
        : ar
          ? 'تأكيد عدم حضور الضيف؟'
          : 'Mark guest as no-show?';
    if (!window.confirm(confirmMessage)) return;

    setError(null);
    setBusy(true);
    try {
      const result = await browserMutation<{ id: string; status: string }>(
        `/v1/stays/bookings/${encodeURIComponent(bookingId)}/${action}`,
        { method: 'POST', body: '{}' },
      );
      setCurrentStatus(result.status);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ar
            ? 'فشل تحديث الحجز'
            : 'Failed to update booking',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stay-booking-ops" aria-label={ar ? 'مراجعة تشغيلية' : 'Ops review'}>
      <div className="stay-booking-ops__links">
        <Link className="button button--quiet" href={`/${portal}/properties/${propertyId}`}>
          {ar ? 'تفاصيل العقار في البوابة' : 'Property in portal'}
        </Link>
        <Link className="button button--quiet" href={`/${portal}/stays/calendar`}>
          {ar ? 'التقويم الكامل للإقامات' : 'Full stays calendar'}
        </Link>
        {stayListingSlug ? (
          <a
            className="button button--quiet"
            href={`/${locale === 'en' ? 'en' : 'ar'}/stays/${stayListingSlug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? 'صفحة العقار العامة' : 'Public stay page'}
          </a>
        ) : (
          <a
            className="button button--quiet"
            href={`/${locale === 'en' ? 'en' : 'ar'}/properties/${propertyId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? 'عرض العقار للعامة' : 'Public property page'}
          </a>
        )}
      </div>

      {(canCancel || canNoShow) && currentStatus !== 'cancelled' && currentStatus !== 'no_show' ? (
        <div className="stay-booking-ops__actions">
          {canCancel ? (
            <button
              type="button"
              className="button button--danger"
              disabled={busy || pending}
              onClick={() => void runAction('cancel')}
            >
              {busy ? (ar ? 'جارٍ…' : 'Working…') : rejectLabel}
            </button>
          ) : null}
          {canNoShow ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy || pending}
              onClick={() => void runAction('no-show')}
            >
              {ar ? 'عدم حضور' : 'No-show'}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="stay-booking-ops__calendar">
        <h2>{ar ? 'تقويم الوحدة حول هذا الحجز' : 'Unit calendar around this booking'}</h2>
        <p className="muted">
          {ar
            ? 'الأيام المحددة أدناه هي فترة هذا الحجز. راجع الحجوزات المجاورة قبل القبول أو الرفض.'
            : 'Highlighted dates are this booking. Review neighbors before accepting or rejecting.'}
        </p>
        <StayAvailabilityCalendar
          locale={locale}
          mode="ops"
          unitId={unitId}
          monthCount={2}
          size="large"
          selectedCheckIn={checkInOn}
          selectedCheckOut={checkOutOn}
        />
      </div>
    </section>
  );
}
