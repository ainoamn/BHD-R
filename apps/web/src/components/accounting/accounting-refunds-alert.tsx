'use client';

import { useEffect, useState } from 'react';
import {
  PENDING_APPROVALS_CHANGED_EVENT,
  type PendingApprovals,
} from '@/lib/pending-approvals-shared';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';

type Cue = {
  transfers: number;
  objections: number;
};

/** Dashboard cues for accountant work on deposits: transfers + guest objections. */
export function AccountingRefundsAlert({
  locale,
  onOpen,
}: {
  locale: 'ar' | 'en';
  onOpen: () => void;
}) {
  const ar = locale === 'ar';
  const [cue, setCue] = useState<Cue>({ transfers: 0, objections: 0 });

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
        const items = payload.items ?? [];
        setCue({
          transfers: items.filter((item) => item.kind === 'refund_transfer').length,
          objections: items.filter((item) => item.kind === 'deposit_claim').length,
        });
      } catch {
        /* keep last */
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

  const total = cue.transfers + cue.objections;
  if (total <= 0) return null;

  const lines: string[] = [];
  if (cue.objections > 0) {
    lines.push(
      ar
        ? `${cue.objections} اعتراض المبلغ لم يصل — علامة حمراء في أمانات التأمين`
        : `${cue.objections} not-received objection${cue.objections === 1 ? '' : 's'} — red mark on deposits`,
    );
  }
  if (cue.transfers > 0) {
    lines.push(
      ar
        ? `${cue.transfers} استرداد بانتظار التحويل`
        : `${cue.transfers} refund${cue.transfers === 1 ? '' : 's'} awaiting transfer`,
    );
  }

  return (
    <button type="button" className="accounting-refunds-alert" onClick={onOpen}>
      <strong>
        {cue.objections > 0
          ? ar
            ? 'تنبيهات المحاسب — أمانات التأمين'
            : 'Accountant alerts — deposits'
          : ar
            ? 'استردادات بانتظار التحويل'
            : 'Refunds to transfer'}
      </strong>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      <span className="accounting-refunds-alert__hint">
        {ar ? 'افتح أمانات التأمين للمتابعة' : 'Open deposit trust to continue'}
      </span>
    </button>
  );
}
