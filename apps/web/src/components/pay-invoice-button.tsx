'use client';

import { useLocale } from 'next-intl';
import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { browserPublicMutation } from '@/lib/api';

export function PayInvoiceButton({ publicToken }: { publicToken: string }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const session = await browserPublicMutation<{ redirectUrl: string }>(
        `/v1/public/invoices/${encodeURIComponent(publicToken)}/payment-sessions`,
        { returnPath: `/${locale}/invoice/${encodeURIComponent(publicToken)}` },
      );
      const target = new URL(session.redirectUrl);
      if (
        target.protocol !== 'https:' &&
        !(target.protocol === 'http:' && target.hostname === 'localhost')
      )
        throw new Error('invalid_payment_redirect');
      window.location.assign(target.href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'payment_unavailable');
      setBusy(false);
    }
  }
  return (
    <div>
      <Button onClick={() => void pay()} disabled={busy}>
        {busy
          ? locale === 'ar'
            ? 'جارٍ التحويل…'
            : 'Redirecting…'
          : locale === 'ar'
            ? 'دفع الفاتورة'
            : 'Pay invoice'}
      </Button>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
