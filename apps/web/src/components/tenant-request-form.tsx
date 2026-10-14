'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, useTransition } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  TENANT_REQUEST_TYPES,
  requestNeedsCheque,
  requestNeedsDate,
  tenantRequestErrorText,
  tenantRequestTypeHint,
  tenantRequestTypeLabel,
  type TenantRequestType,
} from '@/lib/tenant-requests-shared';

export type RequestCheque = {
  id: string;
  number: string;
  dueOn: string;
  amountMinor: string;
};

export type RequestLease = {
  id: string;
  label: string;
  currency: string;
  cheques: RequestCheque[];
};

/**
 * Opens the request form for one lease (or lets the tenant pick one) with the type preset, e.g.
 * "postpone this cheque" from a statement row. The request goes straight to the landlord.
 */
export function TenantRequestLauncher({
  locale,
  leases,
  leaseId,
  type,
  chequeId,
  label,
  className = 'button button--quiet button--tiny',
}: {
  locale: 'ar' | 'en';
  leases: RequestLease[];
  leaseId?: string;
  type?: TenantRequestType;
  chequeId?: string;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!leases.length) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <TenantRequestDialog
          locale={locale}
          leases={leases}
          leaseId={leaseId}
          type={type}
          chequeId={chequeId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TenantRequestDialog({
  locale,
  leases,
  leaseId: initialLease,
  type: initialType,
  chequeId: initialCheque,
  onClose,
}: {
  locale: 'ar' | 'en';
  leases: RequestLease[];
  leaseId?: string | undefined;
  type?: TenantRequestType | undefined;
  chequeId?: string | undefined;
  onClose: () => void;
}) {
  const ar = locale === 'ar';
  const titleId = useId();
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [leaseId, setLeaseId] = useState(initialLease ?? leases[0]?.id ?? '');
  const [type, setType] = useState<TenantRequestType>(initialType ?? 'maintenance');
  const [chequeId, setChequeId] = useState(initialCheque ?? '');
  const [proposedDate, setProposedDate] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const lease = leases.find((item) => item.id === leaseId) ?? leases[0];
  const cheques = lease?.cheques ?? [];
  const cheque = cheques.find((item) => item.id === chequeId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!lease) return;
    setBusy(true);
    setError(null);
    try {
      const result = await browserNextMutation<{ reference: string }>('/api/tenant/requests', {
        method: 'POST',
        body: JSON.stringify({
          leaseId: lease.id,
          type,
          subject: subject.trim() || undefined,
          description: description.trim() || undefined,
          ...(type === 'maintenance' ? { priority } : {}),
          ...(requestNeedsCheque(type) ? { chequeId: chequeId || undefined } : {}),
          ...(requestNeedsDate(type) ? { proposedDate: proposedDate || undefined } : {}),
        }),
      });
      setSent(result.reference);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  const types = TENANT_REQUEST_TYPES.filter(
    (item) => !requestNeedsCheque(item) || cheques.length > 0,
  );

  return (
    <div className="tenant-request-modal" role="presentation" onClick={onClose}>
      <div
        className="tenant-request-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tenant-request-modal__head">
          <h2 id={titleId}>{ar ? 'طلب جديد إلى المالك' : 'New request to the landlord'}</h2>
          <button
            type="button"
            className="tenant-request-modal__close"
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {sent ? (
          <div className="tenant-request-modal__done">
            <p className="notice notice--success" role="status">
              {ar
                ? `أُرسل طلبك برقم ${sent} إلى المالك مباشرة، وسيصلك رده هنا وعلى بريدك.`
                : `Your request ${sent} went straight to the landlord; their answer arrives here and by email.`}
            </p>
            <button type="button" className="button button--primary" onClick={onClose}>
              {ar ? 'تم' : 'Done'}
            </button>
          </div>
        ) : (
          <form className="tenant-request-form" onSubmit={(event) => void submit(event)}>
            {leases.length > 1 ? (
              <label>
                <span>{ar ? 'العقد' : 'Lease'}</span>
                <select
                  className="input"
                  value={leaseId}
                  onChange={(event) => {
                    setLeaseId(event.target.value);
                    setChequeId('');
                  }}
                >
                  {leases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="tenant-request-form__lease">{lease?.label}</p>
            )}
            <label>
              <span>{ar ? 'نوع الطلب' : 'Request type'}</span>
              <select
                className="input"
                value={type}
                onChange={(event) => setType(event.target.value as TenantRequestType)}
              >
                {types.map((item) => (
                  <option key={item} value={item}>
                    {tenantRequestTypeLabel(item, ar)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted tenant-request-form__hint">{tenantRequestTypeHint(type, ar)}</p>
            {requestNeedsCheque(type) ? (
              <label>
                <span>{ar ? 'الشيك' : 'Cheque'}</span>
                <select
                  className="input"
                  required
                  value={chequeId}
                  onChange={(event) => setChequeId(event.target.value)}
                >
                  <option value="">{ar ? 'اختر الشيك' : 'Pick the cheque'}</option>
                  {cheques.map((item) => (
                    <option key={item.id} value={item.id}>
                      {`${item.number} · ${item.dueOn} · ${formatMoney(item.amountMinor, lease?.currency ?? 'OMR', locale)}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {requestNeedsDate(type) ? (
              <label>
                <span>
                  {type === 'cheque_postpone'
                    ? ar
                      ? 'التاريخ الجديد المقترح للشيك'
                      : 'Proposed new cheque date'
                    : ar
                      ? 'تاريخ الإخلاء المقترح'
                      : 'Proposed move-out date'}
                </span>
                <input
                  className="input"
                  type="date"
                  required
                  dir="ltr"
                  min={cheque && type === 'cheque_postpone' ? cheque.dueOn : undefined}
                  value={proposedDate}
                  onChange={(event) => setProposedDate(event.target.value)}
                />
              </label>
            ) : null}
            {type === 'maintenance' ? (
              <label>
                <span>{ar ? 'الأولوية' : 'Priority'}</span>
                <select
                  className="input"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as typeof priority)}
                >
                  <option value="low">{ar ? 'منخفضة' : 'Low'}</option>
                  <option value="normal">{ar ? 'عادية' : 'Normal'}</option>
                  <option value="high">{ar ? 'عالية' : 'High'}</option>
                  <option value="urgent">{ar ? 'طارئة' : 'Urgent'}</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>{ar ? 'العنوان (اختياري)' : 'Subject (optional)'}</span>
              <input
                className="input"
                maxLength={200}
                value={subject}
                placeholder={tenantRequestTypeLabel(type, ar)}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label>
              <span>{ar ? 'التفاصيل' : 'Details'}</span>
              <textarea
                className="input"
                rows={4}
                maxLength={2000}
                required={type === 'maintenance' || type === 'other' || type === 'contract_amend'}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {error ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="tenant-request-form__actions">
              <button type="submit" className="button button--primary" disabled={busy}>
                {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال إلى المالك' : 'Send'}
              </button>
              <button type="button" className="button button--quiet" onClick={onClose}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
