'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, CardContent, Field } from '@bhd-r/ui';
import { browserNextMutation, humanizeBrowserError } from '@/lib/api';

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
  const [endsOn, setEndsOn] = useState(currentEndsOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/tenant/contracts/${encodeURIComponent(contractId)}/renewal-term`,
        { method: 'POST', body: JSON.stringify({ endsOn }) },
      );
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
        <h2>{ar ? 'مدة التجديد' : 'Renewal term'}</h2>
        <p className="muted">
          {ar
            ? 'إن لم تناسبك المدة المقترحة، اختر تاريخ نهاية آخر. إن قصّرت المدة قد تُعتمد تلقائياً حسب ضبط المالك، وإلا تنتظر اعتماده ثم تُعاد إليك للمستندات والتوقيع.'
            : 'If the offered term does not suit you, pick another end date. Shortening may auto-approve per the owner’s settings; otherwise the owner decides, then you finish documents and e-sign.'}
        </p>
        {proposal ? (
          <p className="notice notice--info" role="status">
            {ar ? 'اقتراحك: ' : 'Your proposal: '}
            <strong dir="ltr">{proposal.endsOn}</strong>
            {' — '}
            {proposal.status === 'pending'
              ? ar
                ? 'بانتظار المالك'
                : 'Awaiting owner'
              : proposal.status === 'rejected'
                ? ar
                  ? 'مرفوض'
                  : 'Rejected'
                : ar
                  ? 'معتمد'
                  : 'Approved'}
          </p>
        ) : null}
        <div className="form-grid">
          <Field
            id="renewal-ends-on"
            label={ar ? 'تاريخ نهاية التجديد' : 'Renewal end date'}
            type="date"
            value={endsOn}
            onChange={(event) => setEndsOn(event.target.value)}
          />
          <Button type="button" disabled={busy || !endsOn} onClick={() => void submit()}>
            {busy
              ? ar
                ? 'جاري الإرسال…'
                : 'Sending…'
              : ar
                ? 'إرسال المدة للمالك'
                : 'Send term to owner'}
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
