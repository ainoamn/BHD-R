'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { NoteTranslateBar, TENANT_NOTE_SERVICE } from '@/components/note-translate';
import { OpsThFilterHeader } from '@/components/ops-th-filter-header';
import { RequestMediaButton, RequestMediaGallery } from '@/components/request-media';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { NOTE_TRANSLATE_MAX } from '@/lib/note-translation';
import {
  emptyOpsColumnFilter,
  matchesOpsColumnFilter,
  opsColumnFilterActive,
  sortOpsColumnRows,
  type OpsColumnTableFilter,
} from '@/lib/ops-column-table';
import {
  OPEN_TENANT_REQUEST,
  emergencyScopeLabel,
  requestAwaitsPayment,
  requestTakesPhotos,
  tenantRequestErrorText,
  tenantRequestStatusLabel,
  tenantRequestTypeLabel,
  type TenantRequest,
  type TenantRequestStatus,
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

function statusToneClass(status: string): string {
  const tone = STATUS_TONE[status];
  return tone ? `tenant-status tenant-status--${tone}` : 'tenant-status';
}

/** Compact inbox row: reference, who/what, date-time, status — expand to read the thread. */
export function RequestInboxRow({
  reference,
  party,
  kind,
  createdAt,
  status,
  ar,
  expanded,
  onToggle,
  controlsId,
}: {
  reference: string;
  /** Tenant name (owner inbox) or request type (tenant inbox). */
  party: string;
  /** Secondary line: type/unit/subject. */
  kind: string;
  createdAt: string;
  status: TenantRequestStatus;
  ar: boolean;
  expanded: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  return (
    <div className="tenant-preview-row tenant-request__preview">
      <div className="tenant-preview-row__copy">
        <span className="tenant-preview-row__eyebrow">{party}</span>
        <strong className="tenant-preview-row__title">
          <bdi>{reference}</bdi>
        </strong>
        <span className="tenant-preview-row__summary">
          {[kind, requestStamp(createdAt, ar)].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="tenant-preview-row__side">
        <span className={statusToneClass(status)}>{tenantRequestStatusLabel(status, ar)}</span>
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={onToggle}
        >
          {expanded ? (ar ? 'إخفاء' : 'Hide') : ar ? 'استعراض' : 'Review'}
        </button>
      </div>
    </div>
  );
}

/** What the request is about and what was said on it, for both the tenant and the landlord. */
export function RequestSummary({
  request,
  ar,
  locale,
  extra,
  showHead = true,
}: {
  request: TenantRequest;
  ar: boolean;
  locale: 'ar' | 'en';
  extra?: ReactNode;
  /** Hide the top meta row when the inbox already shows reference/status/date. */
  showHead?: boolean;
}) {
  const unit =
    (ar ? request.unitAr || request.unitEn : request.unitEn || request.unitAr) ?? request.unitCode;
  return (
    <>
      {showHead ? (
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
          <span className={statusToneClass(request.status)}>
            {tenantRequestStatusLabel(request.status, ar)}
          </span>
        </header>
      ) : null}
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
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'reply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = OPEN_TENANT_REQUEST.has(request.status);
  const bodyId = `tenant-request-body-${request.id}`;
  const unit =
    (ar ? request.unitAr || request.unitEn : request.unitEn || request.unitAr) ?? request.unitCode;
  const kindLine = [request.subject, unit].filter(Boolean).join(' · ');

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
    <li className={`tenant-request${expanded ? ' is-open' : ''}`}>
      <RequestInboxRow
        reference={request.reference}
        party={tenantRequestTypeLabel(request.type, ar)}
        kind={kindLine}
        createdAt={request.createdAt}
        status={request.status}
        ar={ar}
        expanded={expanded}
        onToggle={() => setExpanded((value) => !value)}
        controlsId={bodyId}
      />
      {expanded ? (
        <div className="tenant-request__body" id={bodyId}>
          <RequestSummary request={request} ar={ar} locale={locale} showHead={false} />
          {open ? (
            <div className="tenant-request__act">
              <textarea
                className="input"
                rows={2}
                maxLength={Math.min(1000, NOTE_TRANSLATE_MAX)}
                placeholder={
                  ar ? 'أضف رداً أو توضيحاً للمالك…' : 'Add a reply or detail for the landlord…'
                }
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <NoteTranslateBar
                value={note}
                onChange={setNote}
                locale={locale}
                max={Math.min(1000, NOTE_TRANSLATE_MAX)}
                disabled={busy !== null}
                service={TENANT_NOTE_SERVICE}
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
  const [filter, setFilter] = useState<OpsColumnTableFilter>(() =>
    emptyOpsColumnFilter('createdAt'),
  );
  const [openKey, setOpenKey] = useState<string | null>(null);

  const columns = useMemo(
    () => [
      { key: 'type', label: ar ? 'النوع' : 'Type', kind: 'text' as const },
      { key: 'reference', label: ar ? 'المرجع' : 'Reference', kind: 'text' as const },
      { key: 'unit', label: ar ? 'الوحدة' : 'Unit', kind: 'text' as const },
      { key: 'createdAt', label: ar ? 'التاريخ' : 'Date', kind: 'date' as const },
      { key: 'status', label: ar ? 'الحالة' : 'Status', kind: 'text' as const },
    ],
    [ar],
  );

  const visible = useMemo(() => {
    const records = requests.map((request) => ({
      id: request.id,
      type: tenantRequestTypeLabel(request.type, ar),
      reference: request.reference,
      unit:
        (ar ? request.unitAr || request.unitEn : request.unitEn || request.unitAr) ??
        request.unitCode ??
        '',
      createdAt: request.createdAt.slice(0, 10),
      status: tenantRequestStatusLabel(request.status, ar),
      request,
    }));
    const columnDefs = columns.map((column) => ({
      key: column.key,
      format: column.kind === 'date' ? ('date' as const) : undefined,
    }));
    const matched = records.filter((row) =>
      matchesOpsColumnFilter(row, filter, columnDefs, (item, key) => item[key]),
    );
    return sortOpsColumnRows(
      matched,
      filter,
      ar ? 'ar' : 'en',
      (item, key) => item[key],
      (key) => (key === 'createdAt' ? 'date' : undefined),
    );
  }, [requests, filter, ar, columns]);

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
    <div className="tenant-requests-wrap">
      <div className="data-table-wrap tenant-table-wrap">
        {opsColumnFilterActive(filter) ? (
          <div className="tenant-table-filter-bar">
            <button
              type="button"
              className="button button--quiet button--sm"
              onClick={() => {
                setFilter(emptyOpsColumnFilter('createdAt'));
                setOpenKey(null);
              }}
            >
              {ar ? 'مسح التصفية' : 'Clear filters'}
            </button>
            <span className="ops-result-count">
              {visible.length} {ar ? 'نتيجة' : 'results'}
            </span>
          </div>
        ) : null}
        <table className="data-table tenant-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <OpsThFilterHeader
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                  kind={column.kind}
                  ar={ar}
                  filter={filter}
                  openKey={openKey}
                  onOpenKey={setOpenKey}
                  onFilterChange={setFilter}
                />
              ))}
            </tr>
          </thead>
        </table>
      </div>
      {visible.length ? (
        <ul className="tenant-requests">
          {visible.map((row) => (
            <TenantRequestItem key={row.id} request={row.request} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className="tenant-home__calm">
          {ar ? 'لا نتائج مطابقة للتصفية.' : 'No rows match these filters.'}
        </p>
      )}
    </div>
  );
}
