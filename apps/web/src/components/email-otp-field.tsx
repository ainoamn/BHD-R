'use client';

import { useState } from 'react';
import { maskEmailAddress } from '@/lib/email-address';

type Tone = 'ok' | 'error' | 'info';

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

  function show(next: string, nextTone: Tone) {
    setMessage(next);
    setTone(nextTone);
  }

  async function send() {
    setBusy(true);
    setMessage(null);
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
      const data = (await response.json()) as { error?: { code?: string } };
      if (!response.ok) {
        setSent(false);
        show(
          data.error?.code === 'rate_limited'
            ? ar
              ? 'محاولات كثيرة — انتظر دقيقة.'
              : 'Too many attempts — wait a minute.'
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
      show(
        ar
          ? `أُرسل الرمز إلى ${masked}. إن لم يظهر في الوارد، راجع البريد غير المرغوب.`
          : `Code sent to ${masked}. If it is missing, check spam/junk.`,
        'ok',
      );
    } catch {
      setSent(false);
      show(ar ? 'تعذّر الاتصال.' : 'Could not connect.', 'error');
    } finally {
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
        } else if (err === 'otp_locked' || err === 'rate_limited') {
          show(
            ar ? 'محاولات كثيرة — انتظر قليلاً ثم أعد المحاولة.' : 'Too many attempts — wait and try again.',
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

  if (verified) {
    return (
      <p className="notice notice--success" role="status">
        {ar ? `البريد ${masked} مؤكَّد برمز OTP.` : `${masked} confirmed with OTP.`}
      </p>
    );
  }

  const codeInvalid = tone === 'error' && Boolean(message);

  return (
    <div className={`party-form__otp field span-2${codeInvalid ? ' is-error' : ''}`}>
      <p className="muted">
        {ar
          ? `سنرسل رمز تحقق إلى ${masked} للتأكد من صحة البريد (واتساب لاحقاً للجوال).`
          : `We will send a verification code to ${masked} (WhatsApp OTP for mobile later).`}
      </p>
      <p className="field__hint" dir="ltr">
        {masked}
      </p>
      <div className="form-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || email.trim().length < 5}
          onClick={() => void send()}
        >
          {sent
            ? ar
              ? 'إعادة إرسال الرمز'
              : 'Resend code'
            : ar
              ? 'إرسال رمز التحقق'
              : 'Send verification code'}
        </button>
        <input
          className="input"
          dir="ltr"
          inputMode="numeric"
          maxLength={6}
          placeholder={ar ? 'الرمز المكوّن من 6 أرقام' : '6-digit code'}
          value={code}
          aria-invalid={codeInvalid || undefined}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            if (tone === 'error') setMessage(null);
          }}
          style={{ maxWidth: '10rem' }}
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
