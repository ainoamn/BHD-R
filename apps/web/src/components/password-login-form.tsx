'use client';

import { useLocale } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Field } from '@bhd-r/ui';
import { ApiError, browserPublicMutation } from '@/lib/api';

export function PasswordLoginForm() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await browserPublicMutation('/v1/auth/password/login', {
        username: username.trim(),
        password,
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      window.location.replace(`/${locale}/portal`);
    } catch (caught) {
      if (caught instanceof ApiError && /TOTP_REQUIRED/i.test(caught.code)) {
        setNeedsTotp(true);
        setTotpCode('');
        setError(
          ar
            ? 'أدخل رمز Google Authenticator (أو رمز الاسترداد) لإكمال الدخول.'
            : 'Enter your Google Authenticator code (or a recovery code) to finish signing in.',
        );
      } else if (caught instanceof ApiError && /ACCOUNT_LOCKED/i.test(caught.code)) {
        setError(
          caught.message ||
            (ar
              ? 'الحساب مقفل مؤقتاً بعد محاولات فاشلة — انتظر 15 دقيقة.'
              : 'Account temporarily locked after failed attempts — wait 15 minutes.'),
        );
      } else if (caught instanceof ApiError && /TOTP_INVALID/i.test(caught.code)) {
        setNeedsTotp(true);
        setError(
          ar
            ? 'رمز المصادقة غير صالح — جرّب رمزاً جديداً من التطبيق.'
            : 'Invalid authenticator code — try a fresh code from the app.',
        );
      } else {
        setError(caught instanceof Error ? caught.message : 'login_failed');
      }
      setBusy(false);
    }
  }

  return (
    <form className="form-grid auth-form" onSubmit={(event) => void submit(event)}>
      <Field
        id="login-username"
        name="username"
        label={ar ? 'اسم المستخدم' : 'Username'}
        autoComplete="username"
        maxLength={100}
        required
        className="span-2"
        value={username}
        readOnly={needsTotp}
        onChange={(event) => setUsername(event.target.value)}
      />
      <Field
        id="login-password"
        name="password"
        type="password"
        label={ar ? 'كلمة المرور' : 'Password'}
        autoComplete="current-password"
        minLength={12}
        maxLength={256}
        required
        className="span-2"
        value={password}
        readOnly={needsTotp}
        onChange={(event) => setPassword(event.target.value)}
      />
      {needsTotp ? (
        <Field
          id="login-totp"
          name="totpCode"
          label={ar ? 'رمز Google Authenticator' : 'Google Authenticator code'}
          inputMode="text"
          autoComplete="one-time-code"
          maxLength={14}
          required
          className="span-2"
          autoFocus
          value={totpCode}
          onChange={(event) => setTotpCode(event.target.value)}
        />
      ) : (
        <p className="muted span-2">
          {ar
            ? 'إن كانت المصادقة الثنائية مفعّلة سيُطلب رمز التطبيق بعد التحقق من كلمة المرور.'
            : 'If two-factor is enabled, you will be asked for an authenticator code after the password check.'}
        </p>
      )}
      {error ? (
        <div className="notice notice--error span-2" role="alert">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy
          ? ar
            ? 'جارٍ الدخول…'
            : 'Signing in…'
          : needsTotp
            ? ar
              ? 'تأكيد الرمز والدخول'
              : 'Verify code & sign in'
            : ar
              ? 'دخول'
              : 'Sign in'}
      </Button>
      {needsTotp ? (
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => {
            setNeedsTotp(false);
            setTotpCode('');
            setPassword('');
            setError(null);
          }}
        >
          {ar ? 'رجوع' : 'Back'}
        </button>
      ) : null}
    </form>
  );
}
