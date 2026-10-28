'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, CardContent, Field } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';
import { ModalPortal } from '@/components/modal-portal';

type Proposal = {
  endsOn: string;
  proposedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto_approved';
  decidedAt?: string | null;
  decisionNote?: string | null;
};

export function TenantRenewalTermPanel({
  contractId,
  currentEndsOn,
  proposal,
  locale,
}: {
  contractId: string;
  currentEndsOn: string;
  proposal: Proposal | null;
  locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [systemEndsOn, setSystemEndsOn] = useState(currentEndsOn);
  const [localProposal, setLocalProposal] = useState(proposal);
  const [objectOpen, setObjectOpen] = useState(false);
  const [proposedEndsOn, setProposedEndsOn] = useState(currentEndsOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [congratsOpen, setCongratsOpen] = useState(false);
  const pendingReview = localProposal?.status === 'pending';

  async function submitObjection() {
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ status: Proposal['status']; endsOn: string }>(
        `/api/tenant/contracts/${encodeURIComponent(contractId)}/renewal-term`,
        { method: 'POST', body: JSON.stringify({ endsOn: proposedEndsOn }) },
      );
      setLocalProposal({
        endsOn: result.endsOn,
        proposedAt: new Date().toISOString(),
        status: result.status,
        decidedAt: result.status === 'auto_approved' ? new Date().toISOString() : null,
      });
      setObjectOpen(false);
      if (result.status === 'auto_approved') {
        setSystemEndsOn(result.endsOn);
        setCongratsOpen(true);
      }
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2>{ar ? 'تاريخ نهاية التجديد' : 'Renewal end date'}</h2>
        <p className="muted">
          {ar
            ? 'التاريخ أدناه هو ما حدده النظام. للاعتراض اقترح تاريخاً آخر.'
            : 'The date below is set by the system. Object if you need a different date.'}
        </p>
        <p>
          {ar ? 'تاريخ نهاية التجديد: ' : 'Renewal end date: '}
          <strong dir="ltr">{systemEndsOn}</strong>
        </p>
        {pendingReview ? (
          <p className="notice notice--warning" role="status">
            {ar
              ? `طلبك لتغيير النهاية إلى ${localProposal.endsOn} قيد المراجعة من قبل المؤجر.`
              : `Your request to change the end date to ${localProposal.endsOn} is pending landlord review.`}
          </p>
        ) : null}
        {!pendingReview ? (
          <Button
            type="button"
            className="button--secondary"
            onClick={() => {
              setProposedEndsOn(systemEndsOn);
              setError(null);
              setObjectOpen(true);
            }}
          >
            {ar ? 'اعتراض على التاريخ' : 'Object to this date'}
          </Button>
        ) : null}

        {objectOpen ? (
          <ModalPortal>
            <div className="ops-modal" onClick={() => !busy && setObjectOpen(false)}>
              <div
                className="ops-modal__card"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="ops-modal__head">
                  <h2>{ar ? 'اعتراض على تاريخ النهاية' : 'Object to end date'}</h2>
                </header>
                <Field
                  id="renewal-object-ends"
                  label={ar ? 'التاريخ المقترح' : 'Proposed end date'}
                  type="date"
                  value={proposedEndsOn}
                  onChange={(event) => setProposedEndsOn(event.target.value)}
                />
                {error ? (
                  <div className="notice notice--danger" role="alert">
                    {error}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <Button
                    type="button"
                    disabled={busy || !proposedEndsOn}
                    onClick={() => void submitObjection()}
                  >
                    {busy ? (ar ? 'جاري الإرسال…' : 'Sending…') : ar ? 'إرسال' : 'Send'}
                  </Button>
                  <Button
                    type="button"
                    className="button--secondary"
                    disabled={busy}
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
                onClick={(event) => event.stopPropagation()}
              >
                <h2>{ar ? 'مبروك' : 'Congratulations'}</h2>
                <p>
                  {ar
                    ? `وافق المالك إلكترونياً / تلقائياً على المدة المقترحة. تاريخ النهاية: ${systemEndsOn}.`
                    : `Landlord approved electronically / automatically. End date: ${systemEndsOn}.`}
                </p>
                <Button type="button" onClick={() => setCongratsOpen(false)}>
                  {ar ? 'متابعة' : 'Continue'}
                </Button>
              </div>
            </div>
          </ModalPortal>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OwnerRenewalTermDecisionPanel({
  contractId,
  proposal,
  locale,
}: {
  contractId: string;
  proposal: Proposal;
  locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/owner/contracts/${encodeURIComponent(contractId)}/renewal-term-decision`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, note: note.trim() || undefined }),
        },
      );
      router.refresh();
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  if (proposal.status !== 'pending') return null;

  return (
    <Card>
      <CardContent>
        <h2>{ar ? 'طلب تعديل مدة التجديد' : 'Renewal term change request'}</h2>
        <p>
          {ar ? 'المستأجر يقترح النهاية: ' : 'Tenant proposes end date: '}
          <strong dir="ltr">{proposal.endsOn}</strong>
        </p>
        <Field
          id="renewal-decision-note"
          label={ar ? 'ملاحظة (اختياري)' : 'Note (optional)'}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          <Button type="button" disabled={busy} onClick={() => void decide('approved')}>
            {ar ? 'اعتماد المدة' : 'Approve term'}
          </Button>
          <Button
            type="button"
            className="button--secondary"
            disabled={busy}
            onClick={() => void decide('rejected')}
          >
            {ar ? 'رفض' : 'Reject'}
          </Button>
        </div>
        {error ? (
          <div className="notice notice--danger" role="alert">
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OwnerContractRenewalAutomationPanel({
  contractId,
  locale,
  initialEnabled,
}: {
  contractId: string;
  locale: string;
  initialEnabled: boolean | null;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [mode, setMode] = useState<'inherit' | 'on' | 'off'>(
    initialEnabled === true ? 'on' : initialEnabled === false ? 'off' : 'inherit',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await browserNextMutation(
        `/api/owner/contracts/${encodeURIComponent(contractId)}/renewal-automation`,
        {
          method: 'PUT',
          body: JSON.stringify({
            override: {
              enabled: mode === 'inherit' ? null : mode === 'on',
            },
          }),
        },
      );
      setMessage(ar ? 'تم حفظ ضبط التجديد لهذا العقد.' : 'Renewal setting saved for this contract.');
      router.refresh();
    } catch (caught) {
      setMessage(humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <h2>{ar ? 'تجديد إلكتروني لهذا العقد' : 'Electronic renewal for this contract'}</h2>
        <p className="muted">
          {ar
            ? 'تجاوز إعدادات الضبط العامة: تلقائي / يدوي / وراثة المؤسسة.'
            : 'Override organization settings: automatic / off / inherit org policy.'}
        </p>
        <select
          className="select"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="inherit">{ar ? 'حسب ضبط المؤسسة' : 'Follow organization settings'}</option>
          <option value="on">{ar ? 'تجديد تلقائي مفعّل' : 'Force automatic renewal on'}</option>
          <option value="off">{ar ? 'إيقاف التجديد التلقائي' : 'Force automatic renewal off'}</option>
        </select>
        <div style={{ marginTop: '0.75rem' }}>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? (ar ? 'جاري الحفظ…' : 'Saving…') : ar ? 'حفظ' : 'Save'}
          </Button>
        </div>
        {message ? (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
