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
          | (Pass & { qrSvg?: string })
          | Arrived
          | NotReady
          | { error?: { code?: string } }
          | null;
        if (stopped) return;
        if (!response.ok || !body || !('state' in body)) {
          setFailed(true);
        } else if (body.state === 'arrived') {
          setArrived(true);
          setPass(null);
          return;
        } else if (body.state === 'not_ready') {
          setFailed(false);
          setPass(null);
        } else if (body.state === 'pass' && body.qrSvg && body.code && body.refreshAt) {
          setFailed(false);
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

  return (
    <section className="guest-stay-detail__card handover-pass" aria-labelledby="stay-checkin-title">
      <h2 id="stay-checkin-title">{ar ? 'باركود تسجيل الوصول' : 'Check-in barcode'}</h2>
      <p>
        {ar
          ? 'عند وصولك اعرض هذا الرمز على عامل العقار أو الحارس ليمسحه — يُسجَّل دخولك فوراً ويُؤكَّد الحجز.'
          : 'On arrival, show this code to the property staff or guard to scan — your check-in is recorded at once.'}
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
          ? 'الرمز مشفّر ويتغيّر كل خمس دقائق؛ اعرضه فقط عند الوصول للعامل المخوّل.'
          : 'The code is sealed and rotates every five minutes; show it only on arrival to authorised staff.'}
      </p>
    </section>
  );
}
