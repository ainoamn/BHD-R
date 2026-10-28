'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Card, CardContent, Field, StatusBadge } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';
import { ELECTRONIC_RENEWAL_NOTICE } from '@/lib/electronic-renewal-notice';
import { formatMoney } from '@/lib/format';
import type { ContractDetail } from '@/lib/contract-detail-neon';
import { RenewalDocumentsPanel } from '@/components/renewal-documents-panel';

/**
 * Focused tenant flow for a renewal addendum: only what they may change,
 * required attachments, and one submit that auto-documents the addendum.
 */
export function TenantRenewalWorkspace({
  contract,
  locale,
  viewerName,
}: {
  contract: ContractDetail;
  locale: string;
  viewerName: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [endsOn, setEndsOn] = useState(contract.endsOn);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(contract.status === 'signed');

  const requirements = contract.renewalRequirements ?? [];
  const allDocsUploaded = useMemo(
    () => requirements.length === 0 || requirements.every((row) => row.uploaded),
    [requirements],
  );

  const rentAmount = contract.document?.amount;
  const rentLabel = rentAmount
    ? formatMoney(rentAmount.amountMinor, rentAmount.currency, ar ? 'ar' : 'en')
    : null;

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/tenant/contracts/${encodeURIComponent(contract.id)}/complete-renewal`,
        {
          method: 'POST',
          body: JSON.stringify({
            endsOn: endsOn !== contract.endsOn ? endsOn : undefined,
            consentAccepted: true as const,
          }),
        },
      );
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  if (done || contract.status === 'signed') {
    return (
      <div className="form-shell lease-renewal" dir={ar ? 'rtl' : 'ltr'}>
        <header className="portal-topbar">
          <div>
            <span className="ops-kicker">BHD R · E-RENEWAL</span>
            <h1>{ar ? 'الملحق موثّق إلكترونياً' : 'Addendum documented electronically'}</h1>
            <p className="muted">
              {contract.reference} · {viewerName}
            </p>
          </div>
          <StatusBadge status="positive" label={ar ? 'موثّق' : 'Documented'} />
        </header>

        <Card>
          <CardContent>
            <h2>{ar ? ELECTRONIC_RENEWAL_NOTICE.titleAr : ELECTRONIC_RENEWAL_NOTICE.titleEn}</h2>
            <p>{ar ? ELECTRONIC_RENEWAL_NOTICE.bodyAr : ELECTRONIC_RENEWAL_NOTICE.bodyEn}</p>
            <p className="muted">
              {ar
                ? 'ستراجع الإدارة المستندات. إن اختلفت يحق لها إلغاء الملحق مع تحملك المسؤولية.'
                : 'Management will review the documents and may cancel the addendum if they differ — you remain liable.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              <Link className="button" href={`/${locale}/tenant/contracts/${contract.id}?view=full`}>
                {ar ? 'عرض الملحق الموثّق' : 'View documented addendum'}
              </Link>
              <Link className="button button--secondary" href={`/${locale}/tenant`}>
                {ar ? 'حساب المستأجر' : 'Tenant home'}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="form-shell lease-renewal" dir={ar ? 'rtl' : 'ltr'}>
      <header className="portal-topbar">
        <div>
          <span className="ops-kicker">BHD R · E-RENEWAL</span>
          <h1>{ar ? 'إكمال تجديد العقد' : 'Complete lease renewal'}</h1>
          <p className="muted">
            {ar
              ? 'راجع المدة، ارفع المستندات، ووافق على التوثيق الإلكتروني — يعتمد النظام الملحق تلقائياً.'
              : 'Review the term, upload documents, and consent to e-documentation — the system documents the addendum automatically.'}
          </p>
        </div>
        <StatusBadge status="warning" label={ar ? 'بانتظار إكمالك' : 'Awaiting you'} />
      </header>

      <section className="card lease-renewal__summary" aria-labelledby="renewal-summary">
        <h2 id="renewal-summary">{ar ? 'ملخص الملحق (للقراءة)' : 'Addendum summary (read-only)'}</h2>
        <dl className="lease-renewal__facts">
          <div>
            <dt>{ar ? 'الرقم' : 'Reference'}</dt>
            <dd dir="ltr">{contract.reference}</dd>
          </div>
          <div>
            <dt>{ar ? 'العقار' : 'Property'}</dt>
            <dd>
              {ar
                ? contract.property?.nameAr || '—'
                : contract.property?.nameEn || contract.property?.nameAr || '—'}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
            <dd>
              {ar
                ? contract.unit?.nameAr || contract.unit?.code || '—'
                : contract.unit?.nameEn || contract.unit?.code || '—'}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'بداية التجديد' : 'Renewal starts'}</dt>
            <dd dir="ltr">{contract.startsOn || '—'}</dd>
          </div>
          {rentLabel ? (
            <div>
              <dt>{ar ? 'الإيجار' : 'Rent'}</dt>
              <dd dir="ltr">{rentLabel}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <Card>
        <CardContent>
          <h2>{ar ? '1) المدة التي يمكنك تعديلها' : '1) Term you may adjust'}</h2>
          <p className="muted">
            {ar
              ? 'إن لم تناسبك النهاية المقترحة غيّرها هنا قبل الإرسال. باقي بنود العقد من العقد السابق.'
              : 'Change the proposed end date here before submit if needed. Other terms come from the previous lease.'}
          </p>
          <Field
            id="tenant-renewal-ends"
            type="date"
            label={ar ? 'تاريخ نهاية التجديد' : 'Renewal end date'}
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </CardContent>
      </Card>

      {requirements.length ? (
        <RenewalDocumentsPanel
          contractId={contract.id}
          requirements={requirements}
          locale={locale}
        />
      ) : (
        <Card>
          <CardContent>
            <h2>{ar ? '2) المستندات' : '2) Documents'}</h2>
            <p className="muted">
              {ar ? 'لا توجد مستندات إضافية مطلوبة لهذا الملحق.' : 'No extra documents are required for this addendum.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          <h2>{ar ? '3) التوثيق والتوقيع الإلكتروني' : '3) Electronic documentation & signature'}</h2>
          <div className="notice notice--info" role="note">
            <strong>
              {ar ? ELECTRONIC_RENEWAL_NOTICE.titleAr : ELECTRONIC_RENEWAL_NOTICE.titleEn}
            </strong>
            <p>{ar ? ELECTRONIC_RENEWAL_NOTICE.bodyAr : ELECTRONIC_RENEWAL_NOTICE.bodyEn}</p>
          </div>
          <label className="checkbox-row" style={{ marginTop: '1rem' }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            {ar ? ELECTRONIC_RENEWAL_NOTICE.consentAr : ELECTRONIC_RENEWAL_NOTICE.consentEn}
          </label>
          {!allDocsUploaded ? (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {ar
                ? 'أكمل رفع المستندات أعلاه قبل الإرسال.'
                : 'Finish uploading the documents above before submitting.'}
            </p>
          ) : null}
          {error ? (
            <div className="notice notice--danger" role="alert" style={{ marginTop: '0.75rem' }}>
              {error}
            </div>
          ) : null}
          <div style={{ marginTop: '1rem' }}>
            <Button
              type="button"
              disabled={busy || !consent || !allDocsUploaded || !endsOn}
              onClick={() => void complete()}
            >
              {busy
                ? ar
                  ? 'جاري التوثيق…'
                  : 'Documenting…'
                : ar
                  ? 'إرسال وتوثيق الملحق تلقائياً'
                  : 'Submit & document addendum automatically'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
