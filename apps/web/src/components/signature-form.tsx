'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, CardContent, Field } from '@bhd-r/ui';
import { useLocale, useTranslations } from 'next-intl';
import { browserMutation } from '@/lib/api';

export function SignatureForm({
  contractId,
  expectedName,
}: {
  contractId: string;
  expectedName: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const text = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const challenge = await browserMutation<{ challengeId: string }>(
        `/v1/leasing/contracts/${contractId}/signature-challenges`,
        {
          method: 'POST',
          body: JSON.stringify({ authenticationMethod: 'totp', totpCode: formText(form, 'otp') }),
        },
      );
      await browserMutation(`/v1/leasing/contracts/${contractId}/signatures`, {
        method: 'POST',
        headers: { 'idempotency-key': `contract-signature:${challenge.challengeId}` },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          consentTextVersion: 'bhd-r-contract-consent-v1',
        }),
      });
      setMessage(
        text(
          'تم توقيع العقد وتسجيل دليل التوقيع.',
          'The lease was signed and its evidence recorded.',
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent>
        <h2>{text('التوقيع الإلكتروني', 'Electronic signature')}</h2>
        <p className="muted">
          {text(
            `الموقّع: ${expectedName}. أدخل رمز التحقق. سيُحفظ وقت الموافقة ونسخة العقد وبصمتها الرقمية.`,
            `Signer: ${expectedName}. Enter the verification code. The consent time, lease version and document hash are recorded.`,
          )}
        </p>
        <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <Field
            id="otp"
            name="otp"
            label={text('رمز التحقق', 'Verification code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              required
            />
            {text(
              'قرأت العقد وأوافق على توقيعه إلكترونياً.',
              'I have read the lease and consent to sign it electronically.',
            )}
          </label>
          {message ? (
            <div className="notice notice--info span-2" role="status">
              {message}
            </div>
          ) : null}
          <Button type="submit" disabled={busy || !consent}>
            {busy ? t('Common.saving') : text('توقيع العقد', 'Sign lease')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
