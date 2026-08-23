'use client';

import { useLocale } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Field, Logo } from '@bhd-r/ui';
import { browserPublicMutation } from '@/lib/api';
export function ForgotPasswordForm() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    setBusy(true);
    await browserPublicMutation('/v1/auth/password/forgot', {
      email: typeof emailValue === 'string' ? emailValue : '',
    }).catch(() => undefined);
    setBusy(false);
    setAccepted(true);
  }
  return (
    <section className="auth-shell">
      <Card className="auth-card">
        <CardContent>
          <Logo descriptor={ar ? 'إدارة العقارات' : 'Real Estate Management'} />
          <h1>{ar ? 'استعادة كلمة المرور' : 'Recover your password'}</h1>
          <p>
            {ar
              ? 'أدخل بريد حسابك. إن كان مسجلاً فسنرسل رابطاً صالحاً لمرة واحدة.'
              : 'Enter your account email. If it exists, we will send a single-use link.'}
          </p>
          {accepted ? (
            <div className="notice notice--success" role="status">
              {ar
                ? 'إذا كان الحساب موجوداً فقد أُرسلت الرسالة.'
                : 'If the account exists, the message has been sent.'}
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              <Field
                id="forgot-email"
                name="email"
                type="email"
                label={ar ? 'البريد الإلكتروني' : 'Email'}
                autoComplete="email"
                maxLength={320}
                required
              />
              <Button type="submit" disabled={busy}>
                {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال الرابط' : 'Send link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
