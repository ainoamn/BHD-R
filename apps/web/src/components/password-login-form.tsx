'use client';

import { useLocale } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Field } from '@bhd-r/ui';
import { browserPublicMutation } from '@/lib/api';

export function PasswordLoginForm() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => {
      const item = form.get(key);
      return typeof item === 'string' ? item : '';
    };
    setBusy(true);
    setError(null);
    try {
      const totpCode = value('totpCode');
      await browserPublicMutation('/v1/auth/password/login', {
        username: value('username'),
        password: value('password'),
        ...(totpCode ? { totpCode } : {}),
      });
      window.location.replace(`/${locale}/portal`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'login_failed');
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
      />
      <Field
        id="login-totp"
        name="totpCode"
        label={ar ? 'رمز التحقق إن كان مفعلاً' : 'Verification code, if enabled'}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        className="span-2"
      />
      {error ? (
        <div className="notice notice--error span-2" role="alert">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? (ar ? 'جارٍ الدخول…' : 'Signing in…') : ar ? 'دخول' : 'Sign in'}
      </Button>
    </form>
  );
}
