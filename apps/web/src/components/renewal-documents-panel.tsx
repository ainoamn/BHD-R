'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, CardContent } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';

type Requirement = {
  code: string;
  labelAr: string;
  labelEn: string;
  uploaded: boolean;
  fileName: string | null;
  uploadedAt: string | null;
};

export function RenewalDocumentsPanel({
  contractId,
  requirements,
  locale,
  hideHeading = false,
}: {
  contractId: string;
  requirements: Requirement[];
  locale: string;
  /** When embedded in TenantRenewalWorkspace which already shows a section title. */
  hideHeading?: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hasChequeSlots = requirements.some((row) => row.code.startsWith('rent_cheque_'));

  if (!requirements.length) return null;

  async function onUpload(code: string, file: File | null) {
    if (!file) return;
    setBusyCode(code);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set('code', code);
      body.set('file', file);
      await browserNextMutation(
        `/api/tenant/contracts/${encodeURIComponent(contractId)}/renewal-documents`,
        {
          method: 'POST',
          body,
        },
      );
      setMessage(ar ? 'تم رفع المستند.' : 'Document uploaded.');
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusyCode(null);
    }
  }

  const body = (
    <>
      {hideHeading ? null : (
        <>
          <h2>
            {hasChequeSlots
              ? ar
                ? 'المستندات وشيكات الإيجار'
                : 'Documents & rent cheques'
              : ar
                ? 'مستندات التجديد المطلوبة'
                : 'Required renewal documents'}
          </h2>
          <p className="muted">
            {hasChequeSlots
              ? ar
                ? 'ارفع الهوية/المستندات وصور كل شيك إيجار قبل توثيق الملحق.'
                : 'Upload ID/documents and each rent cheque photo before documenting the addendum.'
              : ar
                ? 'ارفع المستندات أدناه قبل أو مع توقيع ملحق التجديد.'
                : 'Upload the documents below before or with signing the renewal addendum.'}
          </p>
        </>
      )}
      <ul className="contract-signatures">
        {requirements.map((row) => (
          <li key={row.code}>
            <strong>{ar ? row.labelAr : row.labelEn}</strong>
            {row.uploaded ? (
              <span>
                {ar ? 'مرفوع' : 'Uploaded'}
                {row.fileName ? ` · ${row.fileName}` : ''}
              </span>
            ) : (
              <label className="button button--secondary" style={{ cursor: 'pointer' }}>
                {busyCode === row.code
                  ? ar
                    ? 'جاري الرفع…'
                    : 'Uploading…'
                  : ar
                    ? 'اختيار ملف'
                    : 'Choose file'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  hidden
                  disabled={busyCode === row.code}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = '';
                    void onUpload(row.code, file);
                  }}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="notice notice--info" role="status">
          {message}
        </div>
      ) : null}
      {!requirements.every((row) => row.uploaded) ? (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          {hasChequeSlots
            ? ar
              ? 'لا يمكن إرسال الملحق قبل رفع كل المستندات وصور الشيكات.'
              : 'The addendum cannot be submitted until every document and cheque photo is uploaded.'
            : ar
              ? 'يمكنك التوقيع بعد رفع المستندات، أو رفعها ثم التوقيع.'
              : 'You can sign after uploading, or upload then sign.'}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          {ar ? 'اكتملت المستندات المطلوبة.' : 'All required documents are on file.'}
        </p>
      )}
      <Button type="button" className="button--quiet" onClick={() => router.refresh()}>
        {ar ? 'تحديث الحالة' : 'Refresh status'}
      </Button>
    </>
  );

  if (hideHeading) return <div className="renewal-documents-embed">{body}</div>;

  return (
    <Card>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
