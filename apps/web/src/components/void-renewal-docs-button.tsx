'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';

export function VoidRenewalDocsButton({
  contractId,
  locale,
}: {
  contractId: string;
  locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function voidRenewal() {
    if (
      !window.confirm(
        ar
          ? 'إلغاء الملحق بسبب اختلاف المستندات؟ يتحمل المستأجر المسؤولية وفق إقرار التوثيق.'
          : 'Void this addendum for document mismatch? The tenant remains liable per the e-doc notice.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/owner/contracts/${encodeURIComponent(contractId)}/void-renewal-docs`,
        {
          method: 'POST',
          body: JSON.stringify({ note: note.trim() || undefined }),
        },
      );
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
      <Field
        id="void-docs-note"
        label={ar ? 'سبب الإلغاء (اختياري)' : 'Void reason (optional)'}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button
        type="button"
        className="button--secondary"
        disabled={busy}
        onClick={() => void voidRenewal()}
      >
        {busy
          ? ar
            ? 'جاري الإلغاء…'
            : 'Voiding…'
          : ar
            ? 'إلغاء الملحق لاختلاف المستندات'
            : 'Void addendum for document mismatch'}
      </Button>
      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
