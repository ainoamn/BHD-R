'use client';

import { useLocale } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Field, Logo } from '@bhd-r/ui';
import Link from 'next/link';

type Step = 'facts' | 'otp' | 'done';

export function SecurityUnlockForm() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [step, setStep] = useState<Step>('facts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [whatsappNeeded, setWhatsappNeeded] = useState(false);

  async function submitFacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/security/unlock/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: String(form.get('email') || ''),
          civilId: String(form.get('civilId') || ''),
          dateOfBirth: String(form.get('dateOfBirth') || ''),
          idExpiry: String(form.get('idExpiry') || ''),
          whatsapp: String(form.get('whatsapp') || ''),
          lastTransaction: String(form.get('lastTransaction') || ''),
          locale: ar ? 'ar' : 'en',
        }),
      });
      const payload = (await response.json()) as {
        challengeId?: string;
        whatsappChannel?: string;
        error?: { code?: string };
      };
      if (!response.ok || !payload.challengeId) {
        setError(payload.error?.code || (ar ? 'تعذّر البدء' : 'Could not start'));
        return;
      }
      setChallengeId(payload.challengeId);
      setWhatsappNeeded(payload.whatsappChannel === 'sent');
      setStep('otp');
    } catch {
      setError(ar ? 'تعذّر الاتصال' : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/security/unlock/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          emailOtp: String(form.get('emailOtp') || ''),
          ...(whatsappNeeded ? { whatsappOtp: String(form.get('whatsappOtp') || '') } : {}),
        }),
      });
      const payload = (await response.json()) as {
        unlocked?: boolean;
        passwordResetPath?: string;
        error?: { code?: string };
      };
      if (!response.ok || !payload.unlocked) {
        setError(payload.error?.code || (ar ? 'رمز غير صالح' : 'Invalid code'));
        return;
      }
      setStep('done');
    } catch {
      setError(ar ? 'تعذّر الاتصال' : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-shell">
      <Card className="auth-card">
        <CardContent>
          <Logo descriptor={ar ? 'استعادة الحماية' : 'Security recovery'} />
          <h1>{ar ? 'فتح الحساب المقفول أمنياً' : 'Unlock a secured account'}</h1>
          <p>
            {ar
              ? 'بعد محاولات سرقة متكررة يُقفل الحساب. أكّد هويتك ثم رموز التحقق، ثم استعد كلمة المرور.'
              : 'After repeated theft attempts the account is locked. Confirm your identity and OTPs, then reset the password.'}
          </p>

          {error ? (
            <div className="notice notice--danger" role="alert">
              {error}
            </div>
          ) : null}

          {step === 'facts' ? (
            <form onSubmit={(event) => void submitFacts(event)}>
              <Field
                id="unlock-email"
                name="email"
                type="email"
                label={ar ? 'البريد المستخدم للحساب' : 'Account email'}
                autoComplete="email"
                required
              />
              <Field
                id="unlock-civil"
                name="civilId"
                label={ar ? 'الرقم المدني' : 'Civil ID number'}
                required
              />
              <Field
                id="unlock-dob"
                name="dateOfBirth"
                type="date"
                label={ar ? 'تاريخ الميلاد' : 'Date of birth'}
                required
              />
              <Field
                id="unlock-expiry"
                name="idExpiry"
                type="date"
                label={ar ? 'تاريخ انتهاء البطاقة' : 'ID expiry date'}
                required
              />
              <Field
                id="unlock-whatsapp"
                name="whatsapp"
                label={ar ? 'رقم واتساب' : 'WhatsApp number'}
                required
              />
              <Field
                id="unlock-txn"
                name="lastTransaction"
                label={
                  ar ? 'آخر معاملة (مرجع حجز أو مبلغ)' : 'Last transaction (booking ref or amount)'
                }
                required
              />
              <Button type="submit" disabled={busy}>
                {busy
                  ? ar
                    ? 'جارٍ التحقق…'
                    : 'Verifying…'
                  : ar
                    ? 'إرسال رموز التحقق'
                    : 'Send OTPs'}
              </Button>
            </form>
          ) : null}

          {step === 'otp' ? (
            <form onSubmit={(event) => void submitOtp(event)}>
              <Field
                id="unlock-email-otp"
                name="emailOtp"
                label={ar ? 'رمز البريد (6 أرقام)' : 'Email code (6 digits)'}
                inputMode="numeric"
                maxLength={6}
                required
              />
              {whatsappNeeded ? (
                <Field
                  id="unlock-wa-otp"
                  name="whatsappOtp"
                  label={ar ? 'رمز واتساب (6 أرقام)' : 'WhatsApp code (6 digits)'}
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
              ) : (
                <p className="muted">
                  {ar
                    ? 'قناة واتساب غير مفعّلة بعد — يكفي رمز البريد حالياً.'
                    : 'WhatsApp is not enabled yet — email OTP is enough for now.'}
                </p>
              )}
              <Button type="submit" disabled={busy}>
                {busy
                  ? ar
                    ? 'جارٍ الفتح…'
                    : 'Unlocking…'
                  : ar
                    ? 'تأكيد وفتح الحساب'
                    : 'Confirm & unlock'}
              </Button>
            </form>
          ) : null}

          {step === 'done' ? (
            <div className="notice notice--success" role="status">
              <p>
                {ar
                  ? 'تم فتح الحساب. الآن أعد تعيين كلمة المرور عبر صفحة الاستعادة.'
                  : 'Account unlocked. Reset your password via the recovery page.'}
              </p>
              <Link href={`/${locale}/forgot-password`}>
                {ar ? 'استعادة كلمة المرور' : 'Recover password'}
              </Link>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
