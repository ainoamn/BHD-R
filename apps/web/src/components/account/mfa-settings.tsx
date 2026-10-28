'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, browserGet, browserMutation } from '@/lib/api';

type Locale = 'ar' | 'en';

/**
 * Google Authenticator / TOTP enrollment for the signed-in user.
 * Uses Nest `/v1/auth/totp/enroll` + `/confirm` (secrets encrypted at rest).
 */
export function MfaSettings({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');

  const load = useCallback(async () => {
    try {
      const me = await browserGet<{ mfaEnabled?: boolean }>('/v1/me');
      setMfaEnabled(Boolean(me.mfaEnabled));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'load_failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setRecoveryCodes(null);
    try {
      const result = await browserMutation<{ secret: string; uri: string }>(
        '/v1/auth/totp/enroll',
        {
          method: 'POST',
          body: JSON.stringify(
            mfaEnabled && stepUpCode.trim()
              ? { currentCode: stepUpCode.trim() }
              : {},
          ),
        },
      );
      setPending(result);
      setNotice(
        ar
          ? 'أضف المفتاح في Google Authenticator ثم أدخل الرمز للتأكيد.'
          : 'Add the key in Google Authenticator, then enter a code to confirm.',
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'enroll_failed',
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError(ar ? 'أدخل رمزاً من 6 أرقام' : 'Enter a 6-digit code');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserMutation<{ confirmed: true; recoveryCodes: string[] }>(
        '/v1/auth/totp/confirm',
        {
          method: 'POST',
          body: JSON.stringify({ code: code.trim() }),
        },
      );
      setPending(null);
      setCode('');
      setStepUpCode('');
      setRecoveryCodes(result.recoveryCodes);
      setMfaEnabled(true);
      setNotice(
        ar
          ? 'تم تفعيل المصادقة الثنائية. احفظ رموز الاسترداد في مكان آمن — تظهر مرة واحدة فقط.'
          : 'Two-factor authentication is on. Save the recovery codes — shown once only.',
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'confirm_failed',
      );
    } finally {
      setBusy(false);
    }
  }

  const qrUrl = pending?.uri
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pending.uri)}`
    : null;

  return (
    <section className="card account-mfa" aria-labelledby="mfa-title">
      <h2 id="mfa-title">{ar ? 'المصادقة الثنائية (Authenticator)' : 'Two-factor authentication'}</h2>
      <p className="muted">
        {ar
          ? 'بعد اسم المستخدم وكلمة المرور يُطلب رمز من تطبيق Google Authenticator أو Authy.'
          : 'After username and password, a code from Google Authenticator or Authy is required.'}
      </p>
      {mfaEnabled === null ? (
        <p className="muted">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : (
        <p className={mfaEnabled ? 'notice notice--ok' : 'notice'} role="status">
          {mfaEnabled
            ? ar
              ? 'مفعّلة على هذا الحساب.'
              : 'Enabled on this account.'
            : ar
              ? 'غير مفعّلة — يُنصح بتفعيلها.'
              : 'Not enabled — recommended.'}
        </p>
      )}

      {mfaEnabled ? (
        <label className="field">
          <span>
            {ar
              ? 'رمز حالي لإعادة الربط (اختياري)'
              : 'Current code to re-enroll (optional)'}
          </span>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={14}
            value={stepUpCode}
            onChange={(event) => setStepUpCode(event.target.value)}
            placeholder={ar ? '6 أرقام أو رمز استرداد' : '6 digits or recovery code'}
          />
        </label>
      ) : null}

      {!pending ? (
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void startEnroll()}>
          {busy
            ? ar
              ? 'جارٍ…'
              : 'Working…'
            : mfaEnabled
              ? ar
                ? 'إعادة ربط Authenticator'
                : 'Re-link Authenticator'
              : ar
                ? 'تفعيل Google Authenticator'
                : 'Enable Google Authenticator'}
        </button>
      ) : (
        <div className="account-mfa__enroll">
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt={ar ? 'رمز QR للمصادقة' : 'Authenticator QR code'} width={180} height={180} />
          ) : null}
          <p className="muted" dir="ltr">
            {ar ? 'أو أدخل المفتاح يدوياً:' : 'Or enter this key manually:'}{' '}
            <code>{pending.secret}</code>
          </p>
          <label className="field">
            <span>{ar ? 'رمز التطبيق (6 أرقام)' : 'App code (6 digits)'}</span>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void confirmEnroll()}
          >
            {busy ? (ar ? 'جارٍ التأكيد…' : 'Confirming…') : ar ? 'تأكيد التفعيل' : 'Confirm'}
          </button>
        </div>
      )}

      {recoveryCodes?.length ? (
        <div className="notice" role="status">
          <strong>{ar ? 'رموز الاسترداد (مرة واحدة):' : 'Recovery codes (once):'}</strong>
          <ul dir="ltr">
            {recoveryCodes.map((row) => (
              <li key={row}>
                <code>{row}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <div className="notice" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
