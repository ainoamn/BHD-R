'use client';

import { useState } from 'react';

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
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        setMessage(
          data.error?.code === 'rate_limited'
            ? ar
              ? 'محاولات كثيرة — انتظر دقيقة.'
              : 'Too many attempts — wait a minute.'
            : ar
              ? 'تعذّر إرسال الرمز. تحقّق من البريد.'
              : 'Could not send the code. Check the email.',
        );
        return;
      }
      setMessage(ar ? 'أُرسل الرمز إلى بريدك.' : 'Code sent to your inbox.');
    } catch {
      setMessage(ar ? 'تعذّر الاتصال.' : 'Could not connect.');
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
        setMessage(
          data.error?.code === 'otp_invalid'
            ? ar
              ? 'رمز غير صحيح.'
              : 'Incorrect code.'
            : data.error?.code === 'otp_expired'
              ? ar
                ? 'انتهت صلاحية الرمز — اطلب رمزاً جديداً.'
                : 'Code expired — request a new one.'
              : ar
                ? 'تعذّر التحقق.'
                : 'Verification failed.',
        );
        return;
      }
      onVerified(true);
      setMessage(ar ? 'تم تأكيد البريد.' : 'Email confirmed.');
    } catch {
      onVerified(false);
      setMessage(ar ? 'تعذّر الاتصال.' : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return (
      <p className="notice notice--success" role="status">
        {ar ? 'البريد مؤكَّد برمز OTP.' : 'Email confirmed with OTP.'}
      </p>
    );
  }

  return (
    <div className="party-form__otp field span-2">
      <p className="muted">
        {ar
          ? 'أرسلنا رمز تحقق إلى البريد للتأكد من صحته (واتساب لاحقاً للجوال).'
          : 'We send a verification code to the email (WhatsApp OTP for mobile later).'}
      </p>
      <div className="form-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || email.trim().length < 5}
          onClick={() => void send()}
        >
          {ar ? 'إرسال رمز التحقق' : 'Send verification code'}
        </button>
        <input
          className="input"
          dir="ltr"
          inputMode="numeric"
          maxLength={6}
          placeholder={ar ? 'الرمز المكوّن من 6 أرقام' : '6-digit code'}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
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
        <p className="field__hint" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
