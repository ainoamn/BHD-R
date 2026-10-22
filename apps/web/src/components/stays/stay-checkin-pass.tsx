'use client';

import { useEffect, useState } from 'react';
import { ModalPortal } from '@/components/modal-portal';
import { formatMoney } from '@/lib/format';

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
type DepositUnpaid = {
  state: 'deposit_unpaid';
  referenceCode: string;
  status: string;
  depositMinor: string;
  currency: string;
  paymentRedirectUrl: string | null;
};

type PassBody = Pass | Arrived | NotReady | TooEarly | Expired | DepositUnpaid;

const stamp = (iso: string, ar: boolean) =>
  new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * Guest arrival barcode: staff at the property scan it (or type the 6-digit code)
 * to confirm check-in — same idea as viewing gate / lease handover.
 * Unpaid refundable deposit blocks the barcode behind a modal with a pay CTA.
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
  const [depositUnpaid, setDepositUnpaid] = useState<DepositUnpaid | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

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
          setLoaded(true);
        } else if (body.state === 'arrived') {
          setArrived(true);
          setPass(null);
          setTooEarly(null);
          setExpired(false);
          setNotReady(false);
          setDepositUnpaid(null);
          setLoaded(true);
          return;
        } else if (body.state === 'expired') {
          setExpired(true);
          setPass(null);
          setTooEarly(null);
          setNotReady(false);
          setDepositUnpaid(null);
          setLoaded(true);
          return;
        } else if (body.state === 'deposit_unpaid') {
          setDepositUnpaid(body);
          setPass(null);
          setTooEarly(null);
          setExpired(false);
          setNotReady(false);
          setFailed(false);
          setLoaded(true);
        } else if (body.state === 'too_early') {
          setTooEarly(body.opensAt);
          setPass(null);
          setExpired(false);
          setNotReady(false);
          setDepositUnpaid(null);
          setFailed(false);
          setLoaded(true);
        } else if (body.state === 'not_ready') {
          setNotReady(true);
          setPass(null);
          setTooEarly(null);
          setExpired(false);
          setDepositUnpaid(null);
          setFailed(false);
          setLoaded(true);
        } else if (body.state === 'pass' && body.qrSvg && body.code && body.refreshAt) {
          setFailed(false);
          setTooEarly(null);
          setExpired(false);
          setNotReady(false);
          setDepositUnpaid(null);
          setLoaded(true);
          setPass((current) =>
            current?.refreshAt === body.refreshAt ? current : (body as Pass),
          );
        }
      } catch {
        if (!stopped) {
          setFailed(true);
          setLoaded(true);
        }
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

  if (depositUnpaid) {
    const amount = formatMoney(
      depositUnpaid.depositMinor,
      depositUnpaid.currency,
      locale,
    );
    return (
      <>
        <section
          className="guest-stay-detail__card handover-pass handover-pass--locked"
          aria-labelledby="stay-checkin-title"
        >
          <h2 id="stay-checkin-title">{ar ? 'باركود تسجيل الوصول' : 'Check-in barcode'}</h2>
          <p className="muted" role="status">
            {ar
              ? 'باركود الوصول مقفل حتى يُدفع مبلغ التأمين المسترد.'
              : 'The arrival barcode stays locked until the refundable deposit is paid.'}
          </p>
        </section>
        <ModalPortal>
          <div
            className="ops-modal stay-deposit-gate-modal"
            role="presentation"
          >
            <div
              className="ops-modal__card stay-deposit-gate-modal__card"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="stay-deposit-gate-title"
              aria-describedby="stay-deposit-gate-body"
            >
              <header className="ops-modal__head">
                <div>
                  <p className="ops-kicker">{ar ? 'خطوة الوصول' : 'Arrival step'}</p>
                  <h2 id="stay-deposit-gate-title">
                    {ar ? 'ادفع مبلغ التأمين أولاً' : 'Pay the deposit first'}
                  </h2>
                </div>
              </header>
              <div className="stay-deposit-gate-modal__body">
                <p id="stay-deposit-gate-body">
                  {ar
                    ? `قبل ظهور باركود الوصول يجب دفع مبلغ التأمين المسترد (${amount}).`
                    : `Pay the refundable deposit (${amount}) before the arrival barcode appears.`}
                </p>
                <p className="muted">
                  {ar
                    ? 'يُسترد التأمين بعد المغادرة وفحص العقار وفق سياسة الإقامة.'
                    : 'The deposit is refunded after check-out and inspection under the stay policy.'}
                </p>
                {depositUnpaid.paymentRedirectUrl ? (
                  <a
                    className="button button--primary stay-deposit-gate-modal__pay"
                    href={depositUnpaid.paymentRedirectUrl}
                  >
                    {ar ? `ادفع التأمين · ${amount}` : `Pay deposit · ${amount}`}
                  </a>
                ) : (
                  <p className="notice notice--warn" role="status">
                    {ar
                      ? 'تعذّر فتح بوابة الدفع الآن. أعد تحميل الصفحة بعد لحظات.'
                      : 'Payment could not be opened right now. Reload in a moment.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      </>
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
          ? 'عند وصولك اعرض هذا الرمز المشفّر على عامل العقار المخوّل ليمسحه من تطبيق المالك — يُسجَّل دخولك فوراً. مسحه بكاميرا الهاتف العادية يُظهر رموزاً فقط ولا يفتح أي صفحة.'
          : 'On arrival, show this sealed code to authorized property staff to scan in the owner app — your check-in is recorded at once. A regular phone camera only shows symbols and opens no page.'}
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
              : !loaded
                ? ar
                  ? 'جارٍ التحقق من التأمين ورمز الوصول…'
                  : 'Checking deposit and arrival code…'
                : ar
                  ? 'جارٍ إنشاء رمز الوصول…'
                  : 'Creating your arrival code…'}
          </p>
        )}
      </div>
      <p className="handover-pass__note">
        {ar
          ? 'الرمز مشفّر ويتجدد تلقائياً؛ يعمل فقط مع حساب مالك أو موظف مخوّل. يُقبل أثناء مدة حجزك (بحد أقصى 4 ساعات قبل البدء)، وبعد انتهائها دون دخول يُلغى الحجز تلقائياً.'
          : 'The code is encrypted and renews automatically; only an authorized owner or staff account can use it. Valid during your booked period (at most 4 hours early); after it ends without check-in the booking is cancelled automatically.'}
      </p>
    </section>
  );
}
