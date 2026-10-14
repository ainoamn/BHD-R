'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { RequestSummary } from '@/components/tenant-requests-list';
import { ApiError, browserNextMutation } from '@/lib/api';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import {
  OPEN_TENANT_REQUEST,
  requestNeedsCheque,
  tenantRequestErrorText,
  type OwnerTenantRequest,
} from '@/lib/tenant-requests-shared';

type Action = 'approve' | 'reject' | 'in_progress' | 'on_hold' | 'complete' | 'reply';

function OwnerRequestItem({
  request,
  locale,
  focused,
}: {
  request: OwnerTenantRequest;
  locale: 'ar' | 'en';
  focused: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [note, setNote] = useState('');
  const [date, setDate] = useState(request.proposedDate ?? '');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = OPEN_TENANT_REQUEST.has(request.status);
  const cheque = requestNeedsCheque(request.type);

  async function act(action: Action) {
    if ((action === 'reject' || action === 'reply') && !note.trim()) {
      setError(ar ? 'اكتب ملاحظة للمستأجر أولاً.' : 'Write a note for the tenant first.');
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await browserNextMutation(`/api/owner/tenant-requests/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          ...(action === 'approve' && request.type === 'cheque_postpone' && date ? { date } : {}),
        }),
      });
      setNote('');
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(null);
    }
  }

  const property = ar
    ? request.propertyNameAr || request.propertyNameEn
    : request.propertyNameEn || request.propertyNameAr;

  return (
    <li
      id={`request-${request.id}`}
      className={`tenant-request${focused ? ' tenant-request--focus' : ''}`}
    >
      <RequestSummary
        request={request}
        ar={ar}
        locale={locale}
        extra={
          <>
            <div>
              <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
              <dd>{request.tenantName ?? '—'}</dd>
            </div>
            {property ? (
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd>{property}</dd>
              </div>
            ) : null}
          </>
        }
      />
      {open ? (
        <div className="tenant-request__act">
          {request.type === 'cheque_postpone' && request.status === 'pending' ? (
            <label className="tenant-request__date">
              <span>{ar ? 'تاريخ الشيك الجديد عند الموافقة' : 'New cheque date if approved'}</span>
              <input
                className="input"
                type="date"
                dir="ltr"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          ) : null}
          <textarea
            className="input"
            rows={2}
            maxLength={1000}
            placeholder={
              ar
                ? 'ملاحظة أو رد للمستأجر (مطلوب عند الرفض)…'
                : 'Note for the tenant (required to reject)…'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="tenant-request__buttons">
            {request.status === 'pending' ? (
              <button
                type="button"
                className="button button--primary button--tiny"
                disabled={busy !== null}
                onClick={() => void act('approve')}
              >
                {cheque
                  ? request.type === 'cheque_postpone'
                    ? ar
                      ? 'موافقة وتأجيل الشيك'
                      : 'Approve and move the cheque'
                    : ar
                      ? 'موافقة وإيقاف الشيك'
                      : 'Approve and stop the cheque'
                  : ar
                    ? 'موافقة'
                    : 'Approve'}
              </button>
            ) : null}
            {!cheque && request.status !== 'in_progress' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('in_progress')}
              >
                {ar ? 'قيد التنفيذ' : 'In progress'}
              </button>
            ) : null}
            {!cheque && request.status !== 'pending' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('complete')}
              >
                {ar ? 'تم الإنجاز' : 'Completed'}
              </button>
            ) : null}
            {request.status !== 'on_hold' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('on_hold')}
              >
                {ar ? 'تعليق' : 'On hold'}
              </button>
            ) : null}
            <button
              type="button"
              className="button button--quiet button--tiny"
              disabled={busy !== null}
              onClick={() => void act('reply')}
            >
              {ar ? 'رد فقط' : 'Reply only'}
            </button>
            <button
              type="button"
              className="button button--danger button--tiny"
              disabled={busy !== null}
              onClick={() => void act('reject')}
            >
              {ar ? 'رفض' : 'Reject'}
            </button>
          </div>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function OwnerTenantRequests({
  requests,
  locale,
  focus,
}: {
  requests: OwnerTenantRequest[];
  locale: 'ar' | 'en';
  focus: string | null;
}) {
  const ar = locale === 'ar';
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const shown =
    filter === 'open' ? requests.filter((item) => OPEN_TENANT_REQUEST.has(item.status)) : requests;
  const openCount = requests.filter((item) => OPEN_TENANT_REQUEST.has(item.status)).length;

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`request-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  return (
    <>
      <div className="tenant-requests__filter" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'open'}
          className={`button button--tiny ${filter === 'open' ? 'button--primary' : 'button--quiet'}`}
          onClick={() => setFilter('open')}
        >
          {ar ? `المفتوحة (${openCount})` : `Open (${openCount})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`button button--tiny ${filter === 'all' ? 'button--primary' : 'button--quiet'}`}
          onClick={() => setFilter('all')}
        >
          {ar ? `الكل (${requests.length})` : `All (${requests.length})`}
        </button>
      </div>
      {shown.length ? (
        <ul className="tenant-requests">
          {shown.map((request) => (
            <OwnerRequestItem
              key={request.id}
              request={request}
              locale={locale}
              focused={request.id === focus}
            />
          ))}
        </ul>
      ) : (
        <p className="dash-alerts__empty">
          {ar ? 'لا طلبات مفتوحة من المستأجرين الآن.' : 'No open tenant requests right now.'}
        </p>
      )}
    </>
  );
}
