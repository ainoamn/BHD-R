'use client';

import { useLocale } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Field, Logo } from '@bhd-r/ui';
import { browserPublicMutation } from '@/lib/api';

export function CredentialForm({
  token,
  purpose,
}: {
  token: string;
  purpose: 'activation' | 'reset';
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const passwordValue = form.get('password');
    const confirmationValue = form.get('confirmation');
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const confirmation = typeof confirmationValue === 'string' ? confirmationValue : '';
    if (password !== confirmation) {
      setMessage({
        error: true,
        text: ar ? 'كلمتا المرور غير متطابقتين.' : 'Passwords do not match.',
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await browserPublicMutation(
        purpose === 'activation' ? '/v1/auth/activate' : '/v1/auth/password/reset',
        { token, password },
      );
      if (purpose === 'activation') {
        window.location.replace(`/${locale}/portal`);
        return;
      }
      setMessage({
        error: false,
        text: ar
          ? 'تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.'
          : 'Password changed. You can now sign in.',
      });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'request_failed' });
    } finally {
      setBusy(false);
    }
  }
  const title =
    purpose === 'activation'
      ? ar
        ? 'تفعيل حسابك'
        : 'Activate your account'
      : ar
        ? 'استعادة كلمة المرور'
        : 'Reset your password';
  return (
    <section className="auth-shell">
      <Card className="auth-card">
        <CardContent>
          <Logo descriptor={ar ? 'إدارة العقارات' : 'Real Estate Management'} />
          <h1>{title}</h1>
          <p>
            {ar
              ? 'اختر كلمة مرور قوية لا تقل عن 12 حرفاً. رابطك صالح للاستخدام مرة واحدة فقط.'
              : 'Choose a strong password of at least 12 characters. Your link can only be used once.'}
          </p>
          <form className="form-grid" onSubmit={(event) => void submit(event)}>
            <Field
              id={`${purpose}-password`}
              name="password"
              type="password"
              label={ar ? 'كلمة المرور الجديدة' : 'New password'}
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              required
              className="span-2"
            />
            <Field
              id={`${purpose}-confirmation`}
              name="confirmation"
              type="password"
              label={ar ? 'تأكيد كلمة المرور' : 'Confirm password'}
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
              required
              className="span-2"
            />
            {message ? (
              <div
                className={`notice notice--${message.error ? 'error' : 'success'} span-2`}
                role={message.error ? 'alert' : 'status'}
              >
                {message.text}
              </div>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : title}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
