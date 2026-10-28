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
  currentEndsOn,
  locale,
}: {
  contractId: string;
  proposal: Proposal;
  /** System / current renewal end date before this decision. */
  currentEndsOn: string;
  locale: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'idle' | 'modify' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const [ownerEndsOn, setOwnerEndsOn] = useState(proposal.endsOn);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    decision: 'approved' | 'rejected',
    options?: { endsOn?: string; requireNote?: boolean },
  ) {
    if (options?.requireNote && note.trim().length < 2) {
      setError(ar ? 'اكتب ملاحظة للمستأجر.' : 'Add a note for the tenant.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/owner/contracts/${encodeURIComponent(contractId)}/renewal-term-decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            note: note.trim() || undefined,
            ...(decision === 'approved' && options?.endsOn
              ? { endsOn: options.endsOn }
              : {}),
          }),
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

  const proposedAtLabel = new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Muscat',
  }).format(new Date(proposal.proposedAt));

  return (
    <aside className="renewal-term-alert" role="region" aria-labelledby="renewal-term-alert-title">
      <div className="renewal-term-alert__banner">
        <span className="renewal-term-alert__mark" aria-hidden>
          !
        </span>
        <div>
          <h2 id="renewal-term-alert-title">
            {ar ? 'طلب المستأجر: تعديل تاريخ نهاية التجديد' : 'Tenant request: change renewal end date'}
          </h2>
          <p>
            {ar
              ? `أرسل في ${proposedAtLabel}. التاريخ الحالي ${currentEndsOn} — المقترح ${proposal.endsOn}.`
              : `Sent ${proposedAtLabel}. Current end ${currentEndsOn} — proposed ${proposal.endsOn}.`}
          </p>
        </div>
      </div>

      <dl className="renewal-term-alert__facts">
        <div>
          <dt>{ar ? 'التاريخ الحالي (النظام)' : 'Current (system) date'}</dt>
          <dd dir="ltr">{currentEndsOn}</dd>
        </div>
        <div>
          <dt>{ar ? 'تاريخ المستأجر المقترح' : 'Tenant proposed date'}</dt>
          <dd dir="ltr">{proposal.endsOn}</dd>
        </div>
      </dl>

      {mode === 'idle' ? (
        <div className="renewal-term-alert__actions">
          <Button type="button" disabled={busy} onClick={() => void decide('approved')}>
            {busy
              ? ar
                ? 'جارٍ…'
                : 'Working…'
              : ar
                ? 'موافقة على التاريخ المقترح'
                : 'Approve proposed date'}
          </Button>
          <Button
            type="button"
            className="button--secondary"
            disabled={busy}
            onClick={() => {
              setMode('modify');
              setOwnerEndsOn(proposal.endsOn);
              setNote('');
              setError(null);
            }}
          >
            {ar ? 'تعديل التاريخ مع ملاحظة' : 'Change date with a note'}
          </Button>
          <Button
            type="button"
            className="button--quiet"
            disabled={busy}
            onClick={() => {
              setMode('reject');
              setNote('');
              setError(null);
            }}
          >
            {ar ? 'رفض والاستمرار على نفس التاريخ' : 'Reject — keep current date'}
          </Button>
        </div>
      ) : null}

      {mode === 'modify' ? (
        <div className="renewal-term-alert__form">
          <Field
            id="renewal-owner-ends"
            label={ar ? 'تاريخ النهاية الذي تعتمده' : 'End date you approve'}
            type="date"
            value={ownerEndsOn}
            onChange={(event) => setOwnerEndsOn(event.target.value)}
          />
          <label className="field" htmlFor="renewal-modify-note">
            <span className="field__label">{ar ? 'ملاحظة للمستأجر' : 'Note for the tenant'}</span>
            <textarea
              id="renewal-modify-note"
              className="textarea"
              rows={3}
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                ar
                  ? 'مثال: نوافق على تاريخ أقرب ضمن سياسة العقار'
                  : 'e.g. We approve an earlier date within the property policy'
              }
            />
          </label>
          <div className="renewal-term-alert__actions">
            <Button
              type="button"
              disabled={busy || !ownerEndsOn}
              onClick={() =>
                void decide('approved', { endsOn: ownerEndsOn, requireNote: true })
              }
            >
              {busy
                ? ar
                  ? 'جارٍ الاعتماد…'
                  : 'Saving…'
                : ar
                  ? 'اعتماد التاريخ المعدّل'
                  : 'Approve modified date'}
            </Button>
            <Button
              type="button"
              className="button--quiet"
              disabled={busy}
              onClick={() => setMode('idle')}
            >
              {ar ? 'تراجع' : 'Back'}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === 'reject' ? (
        <div className="renewal-term-alert__form">
          <p className="muted">
            {ar
              ? `سيُرفض طلب المستأجر ويبقى تاريخ النهاية ${currentEndsOn}.`
              : `The tenant request is declined and the end date stays ${currentEndsOn}.`}
          </p>
          <label className="field" htmlFor="renewal-reject-note">
            <span className="field__label">{ar ? 'سبب الرفض (يظهر للمستأجر)' : 'Rejection reason (shown to tenant)'}</span>
            <textarea
              id="renewal-reject-note"
              className="textarea"
              rows={3}
              maxLength={500}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                ar
                  ? 'مثال: المدة المقترحة أقصر من الحد الأدنى للعقار'
                  : 'e.g. The proposed term is shorter than the property minimum'
              }
            />
          </label>
          <div className="renewal-term-alert__actions">
            <Button
              type="button"
              className="button--danger"
              disabled={busy}
              onClick={() => void decide('rejected', { requireNote: true })}
            >
              {busy
                ? ar
                  ? 'جارٍ الرفض…'
                  : 'Rejecting…'
                : ar
                  ? 'تأكيد الرفض والإبقاء على التاريخ'
                  : 'Confirm reject — keep current date'}
            </Button>
            <Button
              type="button"
              className="button--quiet"
              disabled={busy}
              onClick={() => setMode('idle')}
            >
              {ar ? 'تراجع' : 'Back'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="notice notice--danger" role="alert">
          {error}
        </div>
      ) : null}
    </aside>
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
