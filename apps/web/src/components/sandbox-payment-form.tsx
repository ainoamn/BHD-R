'use client';

import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { useLocale } from 'next-intl';
import { browserPublicMutation } from '@/lib/api';

export function SandboxPaymentForm({ sessionReference }: { sessionReference: string }) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await browserPublicMutation<{
        completed: boolean;
        returnPath: string | null;
      }>(
        `/v1/public/payment-sessions/${encodeURIComponent(sessionReference)}/sandbox-complete`,
        {},
      );
      if (result.returnPath?.startsWith(`/${locale}/invoice/`)) {
        window.location.assign(result.returnPath);
        return;
      }
      setMessage(ar ? 'اكتمل الدفع التجريبي بنجاح.' : 'Sandbox payment completed successfully.');
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
