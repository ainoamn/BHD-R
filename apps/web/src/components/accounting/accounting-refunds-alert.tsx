'use client';

import { useEffect, useState } from 'react';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';

/** Dashboard cue when approved stay/deposit refunds await the accountant's transfer. */
export function AccountingRefundsAlert({
  locale,
  onOpen,
}: {
  locale: 'ar' | 'en';
  onOpen: () => void;
}) {
  const ar = locale === 'ar';
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/portal/pending-approvals', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const payload = (await response.json()) as PendingApprovals;
        if (cancelled) return;
        const transfers = (payload.items ?? []).filter((item) => item.kind === 'refund_transfer');
        setCount(transfers.length);
      } catch {
        /* keep last count */
      }
    };
    void load();
    const onChange = () => void load();
    window.addEventListener(PENDING_APPROVALS_CHANGED_EVENT, onChange);
    window.addEventListener(LIVE_CHANGE_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(PENDING_APPROVALS_CHANGED_EVENT, onChange);
      window.removeEventListener(LIVE_CHANGE_EVENT, onChange);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <button type="button" className="accounting-refunds-alert" onClick={onOpen}>
      <strong>{ar ? 'استردادات بانتظار التحويل' : 'Refunds to transfer'}</strong>
      <span>
        {ar
          ? `${count} — افتح أمانات التأمين للتحويل`
          : `${count} — open deposit trust to transfer`}
      </span>
    </button>
  );
}
