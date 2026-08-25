'use client';

import { useRouter } from '@/i18n/navigation';
import { useState } from 'react';
import { browserMutation } from '@/lib/api';

export function TenantCancelLeaseButton({
  leaseId,
  endsOn,
  locale,
}: {
  leaseId: string;
  endsOn?: string;
  locale: string;
}) {
  const ar = locale.startsWith('ar');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCancel() {
    const proposed =
      window.prompt(
        ar ? 'تاريخ الإلغاء المقترح (YYYY-MM-DD)' : 'Proposed cancel date (YYYY-MM-DD)',
        endsOn,
      ) ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(proposed)) {
      setError(ar ? 'تاريخ غير صالح' : 'Invalid date');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserMutation(`/v1/tenant/leases/${encodeURIComponent(leaseId)}/cancellation-requests`, {
        method: 'POST',
        body: JSON.stringify({ proposedEndsOn: proposed }),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="tenant-cancel-lease">
      <button className="button button--quiet" type="button" disabled={busy} onClick={() => void requestCancel()}>
        {ar ? 'طلب إلغاء العقد' : 'Request cancellation'}
      </button>
      {error ? <span className="form-error">{error}</span> : null}
    </span>
  );
}
