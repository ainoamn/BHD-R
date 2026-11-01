'use client';

import { useState } from 'react';
import { maskEmailAddress } from '@/lib/email-address';

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
        setMessage(
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
        );
        return;
      }
      setSent(true);
      setMessage(
        ar
          ? `أُرسل الرمز إلى ${masked}. إن لم يظهر في الوارد، راجع البريد غير المرغوب.`
          : `Code sent to ${masked}. If it is missing, check spam/junk.`,
      );
    } catch {
      setSent(false);
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
        {ar ? `البريد ${masked} مؤكَّد برمز OTP.` : `${masked} confirmed with OTP.`}
      </p>
    );
  }

  return (
    <div className="party-form__otp field span-2">
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
