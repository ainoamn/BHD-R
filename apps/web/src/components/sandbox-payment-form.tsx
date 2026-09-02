'use client';

import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { useLocale } from 'next-intl';
import { browserPublicMutation } from '@/lib/api';

async function completeStaySandboxPayment(
  sessionReference: string,
  returnPath?: string,
): Promise<{ completed: boolean; returnPath: string | null; kind?: string }> {
  const response = await fetch(
    `/api/public/stays/payment-sessions/${encodeURIComponent(sessionReference)}/sandbox-complete`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-requested-with': 'BHD-R',
      },
      body: JSON.stringify(returnPath ? { returnPath } : {}),
      signal: AbortSignal.timeout(45_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: { messageAr?: string; message?: string };
    completed?: boolean;
    returnPath?: string | null;
    kind?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? 'payment_failed');
  }
  return {
    completed: Boolean(payload?.completed),
    returnPath: payload?.returnPath ?? null,
    ...(payload?.kind !== undefined ? { kind: payload.kind } : {}),
  };
}

export function SandboxPaymentForm({
  sessionReference,
  returnPath,
  stayKind = false,
}: {
  sessionReference: string;
  returnPath?: string;
  stayKind?: boolean;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setMessage(null);
    try {
      const result = stayKind
        ? await completeStaySandboxPayment(sessionReference, returnPath)
        : await browserPublicMutation<{
            completed: boolean;
            returnPath: string | null;
            kind?: string;
          }>(`/v1/public/payment-sessions/${encodeURIComponent(sessionReference)}/sandbox-complete`, {
            ...(returnPath ? { returnPath } : {}),
          });
      const target = result.returnPath ?? returnPath ?? null;
      if (
        target &&
        (target.startsWith(`/${locale}/invoice/`) ||
          target.startsWith(`/${locale}/guest/stays`) ||
          target.startsWith(`/${locale}/stays/`))
      ) {
        window.location.assign(target);
        return;
      }
      setMessage(
        result.kind === 'stay_booking'
          ? ar
            ? 'اكتمل دفع الإقامة التجريبي بنجاح.'
            : 'Sandbox stay payment completed successfully.'
          : ar
            ? 'اكتمل الدفع التجريبي بنجاح.'
            : 'Sandbox payment completed successfully.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'payment_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="payment-sandbox__actions">
      <Button type="button" disabled={busy} onClick={() => void complete()}>
        {busy
          ? ar
            ? 'جارٍ التأكيد…'
            : 'Confirming…'
          : ar
            ? 'تأكيد الدفع التجريبي'
            : 'Confirm sandbox payment'}
      </Button>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
