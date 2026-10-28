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
import { ModalPortal } from '@/components/modal-portal';

type TermProposal = NonNullable<ContractDetail['tenantTermProposal']>;

/**
 * Focused tenant flow for a renewal addendum: system end date (with objection),
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
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(contract.status === 'signed');
  const [proposal, setProposal] = useState<TermProposal | null>(
    contract.tenantTermProposal ?? null,
  );
  const [systemEndsOn, setSystemEndsOn] = useState(contract.endsOn);
  const [objectOpen, setObjectOpen] = useState(false);
  const [proposedEndsOn, setProposedEndsOn] = useState(contract.endsOn);
  const [objectBusy, setObjectBusy] = useState(false);
  const [objectError, setObjectError] = useState<string | null>(null);
  const [congratsOpen, setCongratsOpen] = useState(false);

  const requirements = contract.renewalRequirements ?? [];
  const allDocsUploaded = useMemo(
    () => requirements.length === 0 || requirements.every((row) => row.uploaded),
    [requirements],
  );
  const pendingReview = proposal?.status === 'pending';

  const rentAmount = contract.document?.amount;
  const rentLabel = rentAmount
    ? formatMoney(rentAmount.amountMinor, rentAmount.currency, ar ? 'ar' : 'en')
    : null;

  async function submitObjection() {
    setObjectBusy(true);
    setObjectError(null);
    try {
      const result = await browserNextMutation<{
        status: TermProposal['status'];
        endsOn: string;
      }>(`/api/tenant/contracts/${encodeURIComponent(contract.id)}/renewal-term`, {
        method: 'POST',
        body: JSON.stringify({ endsOn: proposedEndsOn }),
      });
      const next: TermProposal = {
        endsOn: result.endsOn,
        proposedAt: new Date().toISOString(),
        status: result.status,
        decidedAt: result.status === 'auto_approved' ? new Date().toISOString() : null,
        decisionNote: null,
      };
      setProposal(next);
      setObjectOpen(false);
      if (result.status === 'auto_approved') {
        setSystemEndsOn(result.endsOn);
        setCongratsOpen(true);
      }
      router.refresh();
    } catch (caught) {
      setObjectError(humanizeBrowserError(caught, ar));
    } finally {
      setObjectBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/tenant/contracts/${encodeURIComponent(contract.id)}/complete-renewal`,
        {
          method: 'POST',
          body: JSON.stringify({
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
              ? 'راجع تاريخ النهاية الذي حدده النظام، ارفع المستندات، ووافق على التوثيق الإلكتروني.'
              : 'Review the system end date, upload documents, and consent to e-documentation.'}
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
          <h2>{ar ? '1) تاريخ نهاية التجديد' : '1) Renewal end date'}</h2>
          <p className="muted">
            {ar
              ? 'التاريخ أدناه هو ما حدده النظام حسب مدة التجديد. إن لم يناسبك يمكنك الاعتراض باقتراح تاريخ آخر.'
              : 'The date below is set by the system for this renewal. If it does not suit you, object with another proposed date.'}
          </p>
          <dl className="lease-renewal__facts">
            <div>
              <dt>{ar ? 'تاريخ نهاية التجديد' : 'Renewal end date'}</dt>
              <dd dir="ltr">
                <strong>{systemEndsOn || '—'}</strong>
              </dd>
            </div>
          </dl>
          {pendingReview ? (
            <div className="notice notice--warning" role="status" style={{ marginTop: '0.75rem' }}>
              {ar
                ? `طلبك لتغيير النهاية إلى ${proposal.endsOn} قيد المراجعة من قبل المؤجر.`
                : `Your request to change the end date to ${proposal.endsOn} is pending landlord review.`}
            </div>
          ) : null}
          {proposal &&
          (proposal.status === 'auto_approved' || proposal.status === 'approved') &&
          proposal.endsOn === systemEndsOn ? (
            <p className="notice notice--info" role="status" style={{ marginTop: '0.75rem' }}>
              {ar
                ? `تم اعتماد النهاية المقترحة: ${proposal.endsOn}`
                : `Proposed end date approved: ${proposal.endsOn}`}
            </p>
          ) : null}
          {proposal?.status === 'rejected' ? (
            <p className="notice notice--danger" role="status" style={{ marginTop: '0.75rem' }}>
              {ar
                ? `رُفض اقتراح ${proposal.endsOn}. يبقى تاريخ النظام أعلاه سارياً.`
                : `Proposal ${proposal.endsOn} was rejected. The system date above remains.`}
            </p>
          ) : null}
          {!pendingReview ? (
            <div style={{ marginTop: '1rem' }}>
              <Button
                type="button"
                className="button--secondary"
                onClick={() => {
                  setProposedEndsOn(systemEndsOn);
                  setObjectError(null);
                  setObjectOpen(true);
                }}
              >
                {ar ? 'اعتراض على التاريخ' : 'Object to this date'}
              </Button>
            </div>
          ) : null}
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
          {pendingReview ? (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              {ar
                ? 'لا يمكن توثيق الملحق حتى يبتّ المؤجر في اعتراض المدة.'
                : 'The addendum cannot be documented until the landlord decides on the term objection.'}
            </p>
          ) : null}
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
              disabled={busy || !consent || !allDocsUploaded || pendingReview || !systemEndsOn}
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

      {objectOpen ? (
        <ModalPortal>
          <div className="ops-modal" onClick={() => !objectBusy && setObjectOpen(false)}>
            <div
              className="ops-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="renewal-object-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="ops-modal__head">
                <h2 id="renewal-object-title">
                  {ar ? 'اعتراض على تاريخ النهاية' : 'Object to end date'}
                </h2>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={objectBusy}
                  onClick={() => setObjectOpen(false)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </header>
              <p className="muted">
                {ar
                  ? 'أدخل التاريخ الذي تقترحه. إن كان ضمن الأشهر التي ضبطها المؤجر يُعتمد تلقائياً؛ وإلا يُرسل للمؤجر للموافقة اليدوية.'
                  : 'Enter your proposed date. If it falls within the landlord’s allowed months it is auto-approved; otherwise it goes to the landlord for manual approval.'}
              </p>
              <Field
                id="tenant-object-ends"
                type="date"
                label={ar ? 'التاريخ المقترح' : 'Proposed end date'}
                value={proposedEndsOn}
                onChange={(event) => setProposedEndsOn(event.target.value)}
              />
              {objectError ? (
                <div className="notice notice--danger" role="alert" style={{ marginTop: '0.75rem' }}>
                  {objectError}
                </div>
              ) : null}
              <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  disabled={objectBusy || !proposedEndsOn}
                  onClick={() => void submitObjection()}
                >
                  {objectBusy
                    ? ar
                      ? 'جاري الإرسال…'
                      : 'Sending…'
                    : ar
                      ? 'إرسال'
                      : 'Send'}
                </Button>
                <Button
                  type="button"
                  className="button--secondary"
                  disabled={objectBusy}
                  onClick={() => setObjectOpen(false)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {congratsOpen ? (
        <ModalPortal>
          <div className="ops-modal" onClick={() => setCongratsOpen(false)}>
            <div
              className="ops-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="renewal-congrats-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="ops-modal__head">
                <h2 id="renewal-congrats-title">{ar ? 'مبروك' : 'Congratulations'}</h2>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setCongratsOpen(false)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </header>
              <p>
                {ar
                  ? `وافق المالك إلكترونياً / تلقائياً على المدة المقترحة. تاريخ نهاية التجديد أصبح ${systemEndsOn}.`
                  : `The landlord approved electronically / automatically. The renewal end date is now ${systemEndsOn}.`}
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Button type="button" onClick={() => setCongratsOpen(false)}>
                  {ar ? 'متابعة' : 'Continue'}
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}
