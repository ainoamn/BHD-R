'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
import type { ViewingRequestDetail } from '@/lib/viewing-requests-shared';

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusLabel(status: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    requested: ['طلب معاينة', 'Requested'],
    scheduled: ['مجدول', 'Scheduled'],
    completed: ['مكتمل', 'Completed'],
    no_show: ['لم يحضر', 'No-show'],
    cancelled: ['ملغى', 'Cancelled'],
    converted: ['تحوّل لحجز', 'Converted'],
  };
  const pair = map[status];
  return pair ? (ar ? pair[0] : pair[1]) : status;
}

export function ViewingRequestDesk({
  viewing: initial,
  locale,
  portal,
}: {
  viewing: ViewingRequestDetail;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [viewing, setViewing] = useState(initial);
  const [scheduledAt, setScheduledAt] = useState(
    toLocalInput(initial.scheduledAt) || toLocalInput(new Date(Date.now() + 86_400_000).toISOString()),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: 'schedule' | 'complete' | 'cancel' | 'no_show' | 'reply') {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/owner/viewings/${encodeURIComponent(viewing.id)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': await fetchBrowserCsrfToken(),
        },
        body: JSON.stringify({
          action,
          scheduledAt:
            action === 'schedule' && scheduledAt
              ? new Date(scheduledAt).toISOString()
              : undefined,
          note: note.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ViewingRequestDetail
        | { error?: { code?: string } }
        | null;
      if (!response.ok) {
        throw new Error(
          (payload && 'error' in payload && payload.error?.code) || 'update_failed',
        );
      }
      setViewing(payload as ViewingRequestDetail);
      setNote('');
      setMessage(
        action === 'schedule'
          ? ar
            ? 'تم تحديد الموعد وإصدار بطاقة المعاينة وإشعار العميل والحارس.'
            : 'Schedule saved; visit pass issued; guest and guard notified.'
          : action === 'reply'
            ? ar
              ? 'أُضيفت الملاحظة.'
              : 'Note saved.'
            : ar
              ? 'تم تحديث الحالة.'
              : 'Status updated.',
      );
      router.refresh();
      window.dispatchEvent(new Event('bhd-r-pending-approvals-changed'));
      window.dispatchEvent(new Event('bhd-r-ops-refresh'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'update_failed');
    } finally {
      setBusy(false);
    }
  }

  const open = viewing.status === 'requested' || viewing.status === 'scheduled';

  return (
    <div className="form-shell viewing-desk">
      <header className="viewing-desk__head">
        <div>
          <span className="ops-kicker">{ar ? 'طلب معاينة' : 'Viewing request'}</span>
          <h1 dir="ltr">{viewing.reference}</h1>
          <p className="muted">
            {ar ? viewing.propertyNameAr : viewing.propertyNameEn || viewing.propertyNameAr}
            {' · '}
            {viewing.unitCode}
          </p>
        </div>
        <Link className="button button--quiet" href={`/${locale}/${portal}/bookings`}>
          {ar ? 'العودة للحجوزات' : 'Back to bookings'}
        </Link>
      </header>

      <dl className="viewing-desk__facts">
        <div>
          <dt>{ar ? 'الحالة' : 'Status'}</dt>
          <dd>
            <span className={`ops-status ops-status--${viewing.status}`}>
              {statusLabel(viewing.status, ar)}
            </span>
          </dd>
        </div>
        <div>
          <dt>{ar ? 'الطالب' : 'Prospect'}</dt>
          <dd>{viewing.prospectName}</dd>
        </div>
        {viewing.prospectEmail ? (
          <div>
            <dt>{ar ? 'البريد' : 'Email'}</dt>
            <dd dir="ltr">
              <a href={`mailto:${viewing.prospectEmail}`}>{viewing.prospectEmail}</a>
            </dd>
          </div>
        ) : null}
        {viewing.prospectPhone ? (
          <div>
            <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
            <dd dir="ltr">
              <a href={`tel:${viewing.prospectPhone}`}>{viewing.prospectPhone}</a>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'تاريخ الطلب' : 'Requested'}</dt>
          <dd dir="ltr">{viewing.createdAt.slice(0, 16).replace('T', ' ')}</dd>
        </div>
        {viewing.scheduledAt ? (
          <div>
            <dt>{ar ? 'الموعد المحدد' : 'Scheduled'}</dt>
            <dd dir="ltr">{viewing.scheduledAt.slice(0, 16).replace('T', ' ')}</dd>
          </div>
        ) : null}
      </dl>

      {viewing.notes ? (
        <section className="viewing-desk__notes">
          <h2>{ar ? 'الملاحظات' : 'Notes'}</h2>
          <pre className="viewing-desk__notes-body">{viewing.notes}</pre>
        </section>
      ) : null}

      {viewing.accessUsername && viewing.accessPin ? (
        <section className="viewing-desk__pass" aria-labelledby="viewing-pass-title">
          <h2 id="viewing-pass-title">{ar ? 'بطاقة زيارة المعاينة' : 'Viewing visit pass'}</h2>
          <p className="muted">
            {ar
              ? 'أُرسلت للعميل بالبريد مع الباركود؛ ويصل إشعار للحارس/الموظف لمسحها عند الوصول.'
              : 'Emailed to the guest with a barcode; staff/guards are notified to scan on arrival.'}
          </p>
          <dl className="viewing-desk__facts">
            <div>
              <dt>{ar ? 'اسم المستخدم' : 'Username'}</dt>
              <dd dir="ltr">{viewing.accessUsername}</dd>
            </div>
            <div>
              <dt>{ar ? 'الرقم السري' : 'PIN'}</dt>
              <dd dir="ltr">{viewing.accessPin}</dd>
            </div>
            {viewing.arrivedAt ? (
              <div>
                <dt>{ar ? 'وقت الوصول' : 'Arrived'}</dt>
                <dd dir="ltr">{viewing.arrivedAt.slice(0, 16).replace('T', ' ')}</dd>
              </div>
            ) : null}
            {viewing.guestDecision ? (
              <div>
                <dt>{ar ? 'قرار العميل' : 'Guest decision'}</dt>
                <dd>{viewing.guestDecision}</dd>
              </div>
            ) : null}
          </dl>
          {viewing.passPath ? (
            <p>
              <Link href={`/${locale}${viewing.passPath}`} target="_blank" rel="noreferrer">
                {ar ? 'فتح بطاقة العميل' : 'Open guest pass'}
              </Link>
              {viewing.gatePath ? (
                <>
                  {' · '}
                  <Link href={`/${locale}${viewing.gatePath}`} target="_blank" rel="noreferrer">
                    {ar ? 'بوابة المسح' : 'Scan gate'}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {viewing.canManage && open ? (
        <section className="viewing-desk__reply" aria-labelledby="viewing-reply-title">
          <h2 id="viewing-reply-title">{ar ? 'الرد وتحديد الموعد' : 'Reply and schedule'}</h2>
          <p className="muted">
            {ar
              ? 'حدّد تاريخ ووقت المعاينة، واكتب تفاصيل الوصول أو أي ملاحظات للعميل.'
              : 'Set the viewing date and time, and add access details or notes for the guest.'}
          </p>
          <label className="field">
            <span>{ar ? 'تاريخ ووقت المعاينة' : 'Viewing date & time'}</span>
            <input
              className="input"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>{ar ? 'تفاصيل / ملاحظات للعميل' : 'Details / notes for the guest'}</span>
            <textarea
              className="textarea"
              rows={4}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                ar
                  ? 'مثال: الدخول من البوابة الجنوبية، الاتصال قبل 15 دقيقة…'
                  : 'e.g. Enter via the south gate, call 15 minutes before…'
              }
            />
          </label>
          <div className="viewing-desk__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !scheduledAt}
              onClick={() => void submit('schedule')}
            >
              {ar ? 'تأكيد الموعد وإشعار العميل' : 'Confirm schedule & notify guest'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy || !note.trim()}
              onClick={() => void submit('reply')}
            >
              {ar ? 'حفظ ملاحظة فقط' : 'Save note only'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void submit('complete')}
            >
              {ar ? 'إكمال' : 'Complete'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void submit('no_show')}
            >
              {ar ? 'لم يحضر' : 'No-show'}
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => void submit('cancel')}
            >
              {ar ? 'إلغاء الطلب' : 'Cancel request'}
            </button>
          </div>
        </section>
      ) : null}

      {message ? (
        <p className="notice notice--success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="viewing-desk__links">
        <Link href={`/${locale}/units/${viewing.unitId}`}>
          {ar ? 'صفحة الوحدة العامة' : 'Public unit page'}
        </Link>
        {' · '}
        <Link href={`/${locale}/${portal}/properties/${viewing.propertyId}`}>
          {ar ? 'إدارة العقار' : 'Manage property'}
        </Link>
      </p>
    </div>
  );
}
