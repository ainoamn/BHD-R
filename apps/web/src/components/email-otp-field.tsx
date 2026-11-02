'use client';

import { useEffect, useRef, useState } from 'react';
import { maskEmailAddress } from '@/lib/email-address';

type Tone = 'ok' | 'error' | 'info';

/** Seconds before the customer may request another code. */
const RESEND_COOLDOWN_SEC = 120;

function formatCountdown(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Send / verify a 6-digit email OTP for tenant or company email during booking. */
export function EmailOtpField({
  email,
  verified,
  onVerified,
  locale,
  organizationId,
}: {
  email: string;
  verified: boolean;
  onVerified: (ok: boolean) => void;
  locale: 'ar' | 'en';
  organizationId?: string | null;
}) {
  const ar = locale === 'ar';
  const masked = maskEmailAddress(email);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>('info');
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownEndsAt = useRef(0);
  const autoSentFor = useRef<string | null>(null);
  const sendInFlight = useRef(false);

  function show(next: string, nextTone: Tone) {
    setMessage(next);
    setTone(nextTone);
  }

  function startCooldown(seconds = RESEND_COOLDOWN_SEC) {
    cooldownEndsAt.current = Date.now() + seconds * 1000;
    setCooldownLeft(seconds);
  }

  async function send(options: { silent?: boolean } = {}) {
    if (sendInFlight.current || email.trim().length < 5) return;
    if (cooldownLeft > 0 && sent) return;
    sendInFlight.current = true;
    setBusy(true);
    if (!options.silent) setMessage(null);
    onVerified(false);
    try {
      const response = await fetch('/api/public/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          action: 'send',
          email,
          locale,
          organizationId: organizationId ?? null,
        }),
      });
      const data = (await response.json()) as {
        error?: { code?: string };
        expiresAt?: string;
      };
      if (!response.ok) {
        setSent(false);
        const retry =
          response.status === 429
            ? Number(response.headers.get('retry-after') || RESEND_COOLDOWN_SEC)
            : 0;
        if (retry > 0) startCooldown(retry);
        show(
          data.error?.code === 'rate_limited'
            ? ar
              ? 'محاولات كثيرة — انتظر قبل إعادة الإرسال.'
              : 'Too many attempts — wait before resending.'
            : data.error?.code === 'email_unconfigured'
              ? ar
                ? 'إرسال البريد غير مفعّل حالياً — تواصل مع الدعم.'
                : 'Email sending is not configured — contact support.'
              : ar
                ? 'تعذّر إرسال الرمز. تحقّق من البريد.'
                : 'Could not send the code. Check the email.',
          'error',
        );
        return;
      }
      setSent(true);
      startCooldown(RESEND_COOLDOWN_SEC);
      show(
        ar
          ? `أُرسل الرمز إلى ${masked}. صالح لـ 15 دقيقة — إن لم يظهر راجع البريد غير المرغوب.`
          : `Code sent to ${masked}. Valid for 15 minutes — check spam/junk if missing.`,
        'ok',
      );
    } catch {
      setSent(false);
      show(ar ? 'تعذّر الاتصال.' : 'Could not connect.', 'error');
    } finally {
      sendInFlight.current = false;
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/public/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action: 'verify', email, code: code.trim() }),
      });
      const data = (await response.json()) as { error?: { code?: string }; ok?: boolean };
      if (!response.ok) {
        onVerified(false);
        const err = data.error?.code;
        if (err === 'otp_invalid' || err === 'invalid_otp') {
          show(ar ? 'رمز التحقق خاطئ.' : 'The verification code is incorrect.', 'error');
        } else if (err === 'otp_expired' || err === 'otp_used' || err === 'otp_not_found') {
          show(
            ar
              ? 'انتهت صلاحية الرمز أو لم يعد صالحاً — اطلب رمزاً جديداً.'
              : 'Code expired or no longer valid — request a new one.',
            'error',
          );
          setCooldownLeft(0);
          cooldownEndsAt.current = 0;
        } else if (err === 'otp_locked' || err === 'rate_limited') {
          show(
            ar
              ? 'محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة.'
              : 'Too many attempts — wait and try again.',
            'error',
          );
        } else {
          show(ar ? 'رمز التحقق خاطئ.' : 'The verification code is incorrect.', 'error');
        }
        return;
      }
      onVerified(true);
      show(ar ? 'تم تأكيد البريد.' : 'Email confirmed.', 'ok');
    } catch {
      onVerified(false);
      show(ar ? 'تعذّر الاتصال.' : 'Could not connect.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Auto-send once when this step mounts / email becomes ready.
  useEffect(() => {
    if (verified) return;
    const normalized = email.trim().toLowerCase();
    if (normalized.length < 5) return;
    if (autoSentFor.current === normalized) return;
    autoSentFor.current = normalized;
    void send({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send once per email on step enter
  }, [email, verified]);

  // Tick the resend countdown.
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = window.setInterval(() => {
      const left = Math.ceil((cooldownEndsAt.current - Date.now()) / 1000);
      setCooldownLeft(left > 0 ? left : 0);
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownLeft]);

  if (verified) {
    return (
      <p className="notice notice--success" role="status">
        {ar ? `البريد ${masked} مؤكَّد برمز OTP.` : `${masked} confirmed with OTP.`}
      </p>
    );
  }

  const codeInvalid = tone === 'error' && Boolean(message);
  const waiting = cooldownLeft > 0;
  const canResend = sent && !waiting && !busy;

  return (
    <div className={`party-form__otp field span-2${codeInvalid ? ' is-error' : ''}`}>
      <p className="muted">
        {sent
          ? ar
            ? `أرسلنا رمز تحقق إلى ${masked}. أدخله أدناه للتأكيد (واتساب لاحقاً للجوال).`
            : `We sent a verification code to ${masked}. Enter it below (WhatsApp OTP later).`
          : ar
            ? `جاري إرسال رمز تحقق إلى ${masked}…`
            : `Sending a verification code to ${masked}…`}
      </p>
      <p className="field__hint" dir="ltr">
        {masked}
      </p>
      <div className="form-actions party-form__otp-actions">
        <input
          className="input"
          dir="ltr"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder={ar ? 'الرمز المكوّن من 6 أرقام' : '6-digit code'}
          value={code}
          aria-invalid={codeInvalid || undefined}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            if (tone === 'error') setMessage(null);
          }}
        />
        <button
          type="button"
          className="button button--primary"
          disabled={busy || code.length !== 6}
          onClick={() => void verify()}
        >
          {ar ? 'تأكيد' : 'Confirm'}
        </button>
      </div>

      <div className="party-form__otp-resend" aria-live="polite">
        {waiting ? (
          <p className="party-form__otp-timer" role="timer">
            {ar
              ? `يمكنك إعادة الإرسال بعد ${formatCountdown(cooldownLeft)}`
              : `You can resend in ${formatCountdown(cooldownLeft)}`}
          </p>
        ) : null}
        {canResend ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void send()}
          >
            {ar ? 'إعادة إرسال الرمز' : 'Resend code'}
          </button>
        ) : null}
        {!sent && busy ? (
          <p className="field__hint muted">{ar ? 'جاري الإرسال…' : 'Sending…'}</p>
        ) : null}
      </div>

      {message ? (
        <p
          className={tone === 'error' ? 'field__error' : 'field__hint'}
          role={tone === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
