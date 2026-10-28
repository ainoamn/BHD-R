'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';

export function DeliverRenewalButton({
  contractId,
  locale,
}: {
  contractId: string;
  locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deliver() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/owner/contracts/${encodeURIComponent(contractId)}/deliver-renewal`,
        { method: 'POST', body: '{}' },
      );
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="span-2" style={{ display: 'grid', gap: '0.5rem' }}>
      <Button type="button" disabled={busy} onClick={() => void deliver()}>
        {busy
          ? ar
            ? 'جاري الإرسال…'
            : 'Sending…'
          : ar
            ? 'إرسال الملحق للمستأجر للتوقيع'
            : 'Send addendum to tenant for signing'}
      </Button>
      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : (
        <p className="muted">
          {ar
            ? 'الملحق ما زال مسودة — أرسله ليظهر في حساب المستأجر مع طلب التوقيع والمستندات.'
            : 'This addendum is still a draft — send it so it appears on the tenant account for e-sign and documents.'}
        </p>
      )}
    </div>
  );
}
