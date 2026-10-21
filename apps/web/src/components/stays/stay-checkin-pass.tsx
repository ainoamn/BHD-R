'use client';

import { useEffect, useState } from 'react';

type Pass = {
  state: 'pass';
  referenceCode: string;
  qrSvg: string;
  code: string;
  expiresAt: string;
  refreshAt: string;
};

type Arrived = { state: 'arrived'; referenceCode: string; status: string };
type NotReady = { state: 'not_ready'; referenceCode: string; status: string };
type TooEarly = { state: 'too_early'; referenceCode: string; status: string; opensAt: string };
type Expired = { state: 'expired'; referenceCode: string; status: string };

type PassBody = Pass | Arrived | NotReady | TooEarly | Expired;

const stamp = (iso: string, ar: boolean) =>
  new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * Guest arrival barcode: staff at the property scan it (or type the 6-digit code)
 * to confirm check-in — same idea as viewing gate / lease handover.
 */
export function StayCheckinPass({
  locale,
  referenceCode,
}: {
  locale: string;
  referenceCode: string;
}) {
  const ar = locale === 'ar';
  const [pass, setPass] = useState<Pass | null>(null);
  const [arrived, setArrived] = useState(false);
  const [tooEarly, setTooEarly] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [notReady, setNotReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/public/stays/bookings/${encodeURIComponent(referenceCode)}/checkin-pass?locale=${locale}`,
          { credentials: 'same-origin', cache: 'no-store' },
        );
        const body = (await response.json().catch(() => null)) as
          | (PassBody & { qrSvg?: string })
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('state' in body)) {
          setFailed(true);
        } else if (body.state === 'arrived') {
          setArrived(true);
          setPass(null);
          setTooEarly(null);
          setExpired(false);
          setNotReady(false);
          return;
        } else if (body.state === 'expired') {
          setExpired(true);
          setPass(null);
          setTooEarly(null);
          setNotReady(false);
          return;
        } else if (body.state === 'too_early') {
          setTooEarly(body.opensAt);
          setPass(null);
          setExpired(false);
          setNotReady(false);
          setFailed(false);
        } else if (body.state === 'not_ready') {
          setNotReady(true);
          setPass(null);
          setTooEarly(null);
          setExpired(false);
          setFailed(false);
        } else if (body.state === 'pass' && body.qrSvg && body.code && body.refreshAt) {
          setFailed(false);
          setTooEarly(null);
          setExpired(false);
          setNotReady(false);
          setPass((current) =>
            current?.refreshAt === body.refreshAt ? current : (body as Pass),
          );
        }
      } catch {
        if (!stopped) setFailed(true);
      }
      if (!stopped) timer = window.setTimeout(() => void load(), 5000);
    };
    void load();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [referenceCode, locale]);

  if (arrived) {
    return (
      <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
        <h2 id="stay-checkin-title">{ar ? 'تم تسجيل وصولك' : 'You are checked in'}</h2>
        <p className="notice notice--success" role="status">
          {ar
            ? 'سجّل العامل وصولك بنجاح. نتمنى لك إقامة طيبة.'
            : 'Staff recorded your arrival. Enjoy your stay.'}
        </p>
      </section>
    );
  }

  if (expired) {
    return (
      <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
        <h2 id="stay-checkin-title">{ar ? 'أُلغي الحجز' : 'Booking cancelled'}</h2>
        <p className="notice notice--error" role="alert">
          {ar
            ? 'انتهت مدة الحجز دون تسجيل دخول — أُلغي الحجز تلقائياً.'
            : 'The stay ended without check-in — the booking was cancelled automatically.'}
        </p>
      </section>
    );
  }

  if (tooEarly) {
    return (
      <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
        <h2 id="stay-checkin-title">{ar ? 'باركود تسجيل الوصول' : 'Check-in barcode'}</h2>
        <p className="notice" role="status">
          {ar
            ? `يفتح تسجيل الدخول قبل موعد الوصول بـ 4 ساعات كحد أقصى — اعتباراً من ${stamp(tooEarly, ar)}.`
            : `Check-in opens at most 4 hours before arrival — from ${stamp(tooEarly, ar)}.`}
        </p>
      </section>
    );
  }

  if (notReady) {
    return (
      <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
        <h2 id="stay-checkin-title">{ar ? 'باركود تسجيل الوصول' : 'Check-in barcode'}</h2>
        <p className="muted" role="status">
          {ar
            ? 'رمز الوصول يظهر بعد تأكيد الحجز والدفع.'
            : 'The arrival code appears after the booking is confirmed and paid.'}
        </p>
      </section>
    );
  }

  return (
    <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
      <h2 id="stay-checkin-title">{ar ? 'باركود تسجيل الوصول' : 'Check-in barcode'}</h2>
      <p>
        {ar
          ? 'عند وصولك اعرض هذا الرمز على عامل العقار ليمسحه — يُسجَّل تاريخ ووقت دخولك فوراً.'
          : 'On arrival, show this code to property staff to scan — your check-in date and time are recorded at once.'}
      </p>
      <div className="handover-pass__body">
        {pass ? (
          <>
            <span
              className="handover-pass__qr"
              role="img"
              aria-label={ar ? 'رمز الوصول' : 'Arrival code'}
              dangerouslySetInnerHTML={{ __html: pass.qrSvg }}
            />
            <div className="handover-pass__facts">
              <span>{ar ? 'رقم الحجز' : 'Booking'}</span>
              <strong dir="ltr">{referenceCode}</strong>
              <span>{ar ? 'الرمز اليدوي' : 'Manual code'}</span>
              <strong dir="ltr" className="handover-pass__code">
                {pass.code.slice(0, 3)} {pass.code.slice(3)}
              </strong>
              <small className="muted">
                {ar
                  ? `يتجدد تلقائياً · صالح حتى ${stamp(pass.expiresAt, ar)}`
                  : `Renews automatically · valid until ${stamp(pass.expiresAt, ar)}`}
              </small>
            </div>
          </>
        ) : (
          <p className="muted" role="status">
            {failed
              ? ar
                ? 'تعذّر تحميل الرمز، نعيد المحاولة…'
                : 'Could not load the code; retrying…'
              : ar
                ? 'جارٍ إنشاء رمز الوصول…'
                : 'Creating your arrival code…'}
          </p>
        )}
      </div>
      <p className="handover-pass__note">
        {ar
          ? 'لا يُقبل المسح قبل موعد الوصول بأكثر من 4 ساعات؛ بعد انتهاء مدة الحجز يُلغى تلقائياً إن لم يُسجَّل الدخول.'
          : 'Scanning is not accepted more than 4 hours before arrival; after the stay ends without check-in the booking is cancelled automatically.'}
      </p>
    </section>
  );
}
