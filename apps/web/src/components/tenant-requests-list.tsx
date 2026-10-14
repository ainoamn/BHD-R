'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { RequestMediaButton, RequestMediaGallery } from '@/components/request-media';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  OPEN_TENANT_REQUEST,
  emergencyScopeLabel,
  requestAwaitsPayment,
  requestTakesPhotos,
  tenantRequestErrorText,
  tenantRequestStatusLabel,
  tenantRequestTypeLabel,
  type TenantRequest,
} from '@/lib/tenant-requests-shared';

const STATUS_TONE: Record<string, string> = {
  pending: 'warn',
  approved: 'good',
  completed: 'good',
  in_progress: 'info',
  on_hold: 'warn',
  rejected: 'bad',
  cancelled: '',
};

export function requestStamp(iso: string, ar: boolean): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    ...(iso.length > 10 ? { timeStyle: 'short' as const } : {}),
  });
}

/** What the request is about and what was said on it, for both the tenant and the landlord. */
export function RequestSummary({
  request,
  ar,
  locale,
  extra,
}: {
  request: TenantRequest;
  ar: boolean;
  locale: 'ar' | 'en';
  extra?: ReactNode;
}) {
  const tone = STATUS_TONE[request.status];
  const unit =
    (ar ? request.unitAr || request.unitEn : request.unitEn || request.unitAr) ?? request.unitCode;
  return (
    <>
      <header className="tenant-request__head">
        <div>
          <strong>{tenantRequestTypeLabel(request.type, ar)}</strong>
          <span className="muted">
            {' · '}
            <bdi>{request.reference}</bdi>
            {' · '}
            {requestStamp(request.createdAt, ar)}
          </span>
        </div>
        <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>
          {tenantRequestStatusLabel(request.status, ar)}
        </span>
      </header>
      <h3 className="tenant-request__subject">{request.subject}</h3>
      <dl className="tenant-request__facts">
        {extra}
        {unit ? (
          <div>
            <dt>{ar ? 'الوحدة' : 'Unit'}</dt>
            <dd>{unit}</dd>
          </div>
        ) : null}
        {request.chequeNumber ? (
          <div>
            <dt>{ar ? 'الشيك' : 'Cheque'}</dt>
            <dd>
              <bdi>{request.chequeNumber}</bdi>
              {request.chequeDueOn ? ` · ${requestStamp(request.chequeDueOn, ar)}` : ''}
              {request.chequeAmountMinor && request.currency
                ? ` · ${formatMoney(request.chequeAmountMinor, request.currency, locale)}`
                : ''}
            </dd>
          </div>
        ) : null}
        {request.proposedDate ? (
          <div>
            <dt>
              {request.type === 'lease_cancel'
                ? ar
                  ? 'تاريخ الإخلاء المقترح'
                  : 'Proposed move-out'
                : ar
                  ? 'التاريخ المقترح'
                  : 'Proposed date'}
            </dt>
            <dd>{requestStamp(request.proposedDate, ar)}</dd>
          </div>
        ) : null}
        {request.emergency ? (
          <div>
            <dt>{ar ? 'مستعجل' : 'Urgent'}</dt>
            <dd>
              {emergencyScopeLabel(request.emergency.scope, ar)}
              {' · '}
              {request.emergency.verified === true
                ? ar
                  ? 'أكدته الإدارة'
                  : 'Confirmed by management'
                : request.emergency.verified === false
                  ? ar
                    ? 'لم تعتبره الإدارة مستعجلاً'
                    : 'Not considered urgent'
                  : ar
                    ? 'قيد تحقق الإدارة'
                    : 'Being verified'}
            </dd>
          </div>
        ) : null}
        {request.staffName ? (
          <div>
            <dt>{ar ? 'الموظف المعني' : 'Staff member'}</dt>
            <dd>{request.staffName}</dd>
          </div>
        ) : null}
        {request.charge ? (
          <div>
            <dt>{ar ? 'تكلفة على المستأجر' : 'Cost to the tenant'}</dt>
            <dd>
              {formatMoney(request.charge.amountMinor, request.charge.currency, locale)}
              {' · '}
              <bdi>{request.charge.invoiceNumber}</bdi>
              {' · '}
              {request.charge.paidAt
                ? ar
                  ? 'مسددة'
                  : 'Paid'
                : request.charge.payment === 'before_work'
                  ? ar
                    ? 'تُسدد قبل بدء العمل'
                    : 'Pay before the work'
                  : ar
                    ? `مؤجلة حتى ${requestStamp(request.charge.dueOn, ar)}`
                    : `Deferred until ${requestStamp(request.charge.dueOn, ar)}`}
            </dd>
          </div>
        ) : null}
      </dl>
      {requestAwaitsPayment(request) ? (
        <p className="notice notice--error tenant-request__pay">
          {ar
            ? 'وافقت الإدارة على الطلب، ويبدأ التنفيذ بعد سداد التكلفة المذكورة. تواصل مع الإدارة للسداد، وسيُستأنف الطلب تلقائياً بعد تسجيله.'
            : 'Management approved the request; the work starts once the cost above is paid. Contact management to pay; the request resumes as soon as it is recorded.'}
        </p>
      ) : null}
      {request.description ? <p className="tenant-request__text">{request.description}</p> : null}
      {request.photoCount ? (
        <div className="handover-shots tenant-request__photos">
          {Array.from({ length: request.photoCount }, (_, index) => {
            const href = `/api/tenant/requests/${encodeURIComponent(request.id)}/photos/${index}`;
            return (
              <a
                key={index}
                className="handover-shots__item"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={href}
                  alt={ar ? `صورة ${index + 1}` : `Photo ${index + 1}`}
                  loading="lazy"
                />
              </a>
            );
          })}
        </div>
      ) : null}
      <RequestMediaGallery requestId={request.id} media={request.media} ar={ar} />
      {request.replies.length ? (
        <ol className="tenant-request__replies">
          {request.replies.map((reply, index) => (
            <li
              key={`${reply.at}-${index}`}
              className={`tenant-request__reply tenant-request__reply--${reply.by}`}
            >
              <span className="muted">
                {reply.by === 'owner'
                  ? ar
                    ? 'المالك'
                    : 'Landlord'
                  : ar
                    ? 'أنت/المستأجر'
                    : 'Tenant'}
                {reply.name ? ` (${reply.name})` : ''} · {requestStamp(reply.at, ar)}
                {reply.status ? ` · ${tenantRequestStatusLabel(reply.status, ar)}` : ''}
              </span>
              <p>{reply.note}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function TenantRequestItem({ request, locale }: { request: TenantRequest; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = OPEN_TENANT_REQUEST.has(request.status);

  async function act(action: 'cancel' | 'reply') {
    if (action === 'cancel' && !window.confirm(ar ? 'سحب هذا الطلب؟' : 'Withdraw this request?')) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await browserNextMutation(`/api/tenant/requests/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      setNote('');
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="tenant-request">
      <RequestSummary request={request} ar={ar} locale={locale} />
      {open ? (
        <div className="tenant-request__act">
          <textarea
            className="input"
            rows={2}
            maxLength={1000}
            placeholder={
              ar ? 'أضف رداً أو توضيحاً للمالك…' : 'Add a reply or detail for the landlord…'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="tenant-request__buttons">
            <button
              type="button"
              className="button button--primary button--tiny"
              disabled={busy !== null || !note.trim()}
              onClick={() => void act('reply')}
            >
              {busy === 'reply'
                ? ar
                  ? 'جارٍ الإرسال…'
                  : 'Sending…'
                : ar
                  ? 'إرسال الرد'
                  : 'Send reply'}
            </button>
            {request.status === 'pending' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('cancel')}
              >
                {ar ? 'سحب الطلب' : 'Withdraw'}
              </button>
            ) : null}
            {requestTakesPhotos(request.type) ? (
              <RequestMediaButton
                requestId={request.id}
                stage="report"
                ar={ar}
                label={ar ? '📎 إرفاق صورة أو فيديو' : '📎 Add a photo or video'}
                accept="image/*,video/mp4,video/quicktime,video/webm"
                onAdded={() => startRefresh(() => router.refresh())}
              />
            ) : null}
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

export function TenantRequestsList({
  requests,
  locale,
}: {
  requests: TenantRequest[];
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  if (!requests.length) {
    return (
      <p className="dash-alerts__empty">
        {ar
          ? 'لم ترسل أي طلب بعد. يمكنك طلب صيانة أو تأجيل شيك أو إيقافه أو إلغاء العقد، أو تقديم بلاغ عن العقار أو عن أحد العاملين لدى الشركة، ويصل مباشرة إلى المسؤولين.'
          : 'No requests yet. Ask for maintenance, to postpone or stop a cheque, to cancel the lease, or report something about the property or a staff member; it reaches the people in charge directly.'}
      </p>
    );
  }
  return (
    <ul className="tenant-requests">
      {requests.map((request) => (
        <TenantRequestItem key={request.id} request={request} locale={locale} />
      ))}
    </ul>
  );
}
