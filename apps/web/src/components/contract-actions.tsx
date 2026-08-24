'use client';

import { useState } from 'react';
import { Button } from '@bhd-r/ui';
import { useRouter } from 'next/navigation';
import { browserMutation } from '@/lib/api';

export function ContractActions({
  contractId,
  status,
  approvalStatus,
  locale,
}: {
  contractId: string;
  status: string;
  approvalStatus: string | null;
  locale: 'ar' | 'en';
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const action =
    status !== 'draft'
      ? null
      : approvalStatus === 'approved'
        ? 'send'
        : approvalStatus === 'pending'
          ? null
          : 'request-approval';

  async function run() {
    if (!action) return;
    setBusy(true);
    setMessage(null);
    try {
      const path =
        action === 'send'
          ? `/v1/leasing/contracts/${contractId}/send`
          : `/v1/leasing/contracts/${contractId}/request-approval`;
      await browserMutation(path, { method: 'POST', body: '{}' });
      setMessage(
        action === 'send'
          ? ar
            ? 'أُرسل العقد للتوقيع.'
            : 'Contract sent for signature.'
          : ar
            ? 'أُرسل طلب الاعتماد.'
            : 'Approval request submitted.',
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }

  if (!action && !message) {
    return approvalStatus === 'pending' ? (
      <p className="notice notice--info">
        {ar ? 'العقد بانتظار اعتماد المسؤول.' : 'The contract is awaiting approval.'}
      </p>
    ) : null;
  }
  return (
    <div className="contract-actions">
      {action ? (
        <Button type="button" disabled={busy} onClick={() => void run()}>
          {busy
            ? ar
              ? 'جارٍ التنفيذ…'
              : 'Working…'
            : action === 'send'
              ? ar
                ? 'إرسال العقد للتوقيع'
                : 'Send for signature'
              : ar
                ? 'طلب اعتماد العقد'
                : 'Request approval'}
        </Button>
      ) : null}
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
