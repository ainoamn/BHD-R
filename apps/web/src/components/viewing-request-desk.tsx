'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NoteTranslateBar } from '@/components/note-translate';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { joinNoteTranslation } from '@/lib/note-translation';
import { VIEWING_NOTE_SUGGESTIONS } from '@/lib/viewing-note-suggestions';
import type { ViewingRequestDetail, ViewingTimelineEntry } from '@/lib/viewing-requests-shared';

function timelineTitle(entry: ViewingTimelineEntry, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    'viewing.requested': ['طلب المعاينة', 'Viewing requested'],
    'viewing.scheduled': ['موافقة وتحديد الموعد', 'Approved & scheduled'],
    'viewing.status_changed': ['تغيير الحالة', 'Status changed'],
    'viewing.reply': ['رد من الفريق', 'Team reply'],
    'viewing.checked_in': ['تسجيل وصول (الحارس)', 'Check-in (guard)'],
    'viewing.guest_reschedule': ['طلب تغيير موعد من العميل', 'Guest reschedule request'],
    'viewing.guest_cancel': ['إلغاء من العميل', 'Guest cancelled'],
    'viewing.guest_not_attending': ['عدم حضور من العميل', 'Guest will not attend'],
    'viewing.guest_decision': ['قرار العميل بعد المعاينة', 'Guest decision after visit'],
    'viewing.note': ['ملاحظة', 'Note'],
  };
  const pair = map[entry.eventType];
  return pair ? (ar ? pair[0] : pair[1]) : entry.eventType;
}

function sourceLabel(source: ViewingTimelineEntry['source'], ar: boolean): string {
  switch (source) {
    case 'guest':
      return ar ? 'العميل' : 'Guest';
    case 'guard':
      return ar ? 'الحارس' : 'Guard';
    case 'staff':
      return ar ? 'الفريق' : 'Staff';
    default:
      return ar ? 'النظام' : 'System';
  }
}

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stamp(iso: string | null, ar: boolean): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
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

/** Strong tone token used for badge + page accent. */
function statusTone(status: string): string {
  switch (status) {
    case 'requested':
      return 'request';
    case 'scheduled':
      return 'scheduled';
    case 'completed':
    case 'converted':
      return 'done';
    case 'no_show':
      return 'missed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'neutral';
  }
}

function decisionLabel(decision: string, ar: boolean): string {
  if (decision === 'book_rent') return ar ? 'يرغب بالاستئجار' : 'Wants to rent';
  if (decision === 'book_sale') return ar ? 'يرغب بالشراء' : 'Wants to buy';
  if (decision === 'declined') return ar ? 'رفض التأجير/الشراء' : 'Declined';
  return decision;
}

function decisionTone(decision: string): string {
  if (decision === 'declined') return 'cancelled';
  if (decision === 'book_rent' || decision === 'book_sale') return 'done';
  return 'neutral';
}

function StatusBadge({
  tone,
  children,
  large,
}: {
  tone: string;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <span className={`vd-badge vd-badge--${tone}${large ? ' vd-badge--lg' : ''}`}>{children}</span>
  );
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
    toLocalInput(initial.preferredAt) ||
      toLocalInput(initial.scheduledAt) ||
      toLocalInput(new Date(Date.now() + 86_400_000).toISOString()),
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
            action === 'schedule' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          note: note.trim() || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        ViewingRequestDetail | { error?: { code?: string } } | null;
      if (!response.ok) {
        throw new Error((payload && 'error' in payload && payload.error?.code) || 'update_failed');
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
      const code = caught instanceof Error ? caught.message : 'update_failed';
      if (code === 'viewing_contact_required') {
        setError(
          ar
            ? 'حدّد حارس المبنى أو مسؤول المعاينة في صفحة العقار قبل تأكيد الموعد.'
            : 'Set the building guard or viewing contact on the property page before confirming.',
        );
      } else if (code === 'viewing_contact_phone_required') {
        setError(
          ar
            ? 'أضف رقم هاتف الحارس في صفحة العقار (مسؤول المعاينة) قبل تأكيد الموعد.'
            : 'Add the guard’s phone on the property viewing-contact card before confirming.',
        );
      } else if (code === 'viewing_schedule_required') {
        setError(ar ? 'اختر تاريخ ووقت المعاينة.' : 'Choose a viewing date and time.');
      } else {
        setError(code);
      }
    } finally {
      setBusy(false);
    }
  }

  const open = viewing.status === 'requested' || viewing.status === 'scheduled';
  const tone = statusTone(viewing.status);
  const propertyTitle = ar
    ? viewing.propertyNameAr
    : viewing.propertyNameEn || viewing.propertyNameAr;

  const steps = [
    {
      id: 'requested',
      label: ar ? 'طلب' : 'Request',
      done: true,
    },
    {
      id: 'scheduled',
      label: ar ? 'جدولة' : 'Scheduled',
      done:
        Boolean(viewing.scheduledAt) ||
        ['scheduled', 'completed', 'converted'].includes(viewing.status),
    },
    {
      id: 'arrived',
      label: ar ? 'وصول' : 'Arrived',
      done: Boolean(viewing.arrivedAt),
    },
    {
      id: 'decision',
      label: ar ? 'قرار' : 'Decision',
      done: Boolean(viewing.guestDecision),
    },
    {
      id: 'closed',
      label: ar ? 'إغلاق' : 'Closed',
      done: ['completed', 'converted', 'cancelled', 'no_show'].includes(viewing.status),
    },
  ];

  return (
    <div className={`vd vd--${tone}`}>
      <header className="vd__hero">
        <div className="vd__hero-main">
          <p className="vd__kicker">{ar ? 'مكتب طلبات المعاينة' : 'Viewing request desk'}</p>
          <h1 className="vd__title" dir="ltr">
            {viewing.reference}
          </h1>
          <p className="vd__subtitle">
            {propertyTitle}
            <span aria-hidden="true"> · </span>
            <span dir="ltr">{viewing.unitCode}</span>
          </p>
        </div>
        <div className="vd__hero-side">
          <StatusBadge tone={tone} large>
            {statusLabel(viewing.status, ar)}
          </StatusBadge>
          <Link className="button button--quiet" href={`/${locale}/${portal}/bookings`}>
            {ar ? 'العودة للحجوزات' : 'Back to bookings'}
          </Link>
        </div>
      </header>

      <ol className="vd__steps" aria-label={ar ? 'مراحل المعاينة' : 'Viewing stages'}>
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`vd__step${step.done ? ' is-done' : ''}${
              (step.id === 'scheduled' && viewing.status === 'scheduled' && !viewing.arrivedAt) ||
              (step.id === 'arrived' && viewing.arrivedAt && !viewing.guestDecision) ||
              (step.id === 'requested' && viewing.status === 'requested')
                ? ' is-current'
                : ''
            }`}
          >
            <span className="vd__step-index" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="vd__grid">
        <section className="vd__card" aria-labelledby="vd-guest-title">
          <h2 id="vd-guest-title">{ar ? 'العميل' : 'Guest'}</h2>
          <dl className="vd__facts">
            <div>
              <dt>{ar ? 'الاسم' : 'Name'}</dt>
              <dd>{viewing.prospectName}</dd>
            </div>
            {viewing.prospectPhone ? (
              <div>
                <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
                <dd dir="ltr">
                  <a href={`tel:${viewing.prospectPhone}`}>{viewing.prospectPhone}</a>
                </dd>
              </div>
            ) : null}
            {viewing.prospectEmail ? (
              <div>
                <dt>{ar ? 'البريد' : 'Email'}</dt>
                <dd dir="ltr">
                  <a href={`mailto:${viewing.prospectEmail}`}>{viewing.prospectEmail}</a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{ar ? 'تاريخ الطلب' : 'Requested'}</dt>
              <dd dir="ltr">{stamp(viewing.createdAt, ar)}</dd>
            </div>
          </dl>
        </section>

        <section className="vd__card" aria-labelledby="vd-visit-title">
          <h2 id="vd-visit-title">{ar ? 'الموعد والوصول' : 'Visit & arrival'}</h2>
          <dl className="vd__facts">
            <div>
              <dt>{ar ? 'الحالة' : 'Status'}</dt>
              <dd>
                <StatusBadge tone={tone}>{statusLabel(viewing.status, ar)}</StatusBadge>
              </dd>
            </div>
            {viewing.scheduledAt ? (
              <div>
                <dt>{ar ? 'الموعد المحدد' : 'Scheduled'}</dt>
                <dd dir="ltr">{stamp(viewing.scheduledAt, ar)}</dd>
              </div>
            ) : null}
            {viewing.preferredAt ? (
              <div>
                <dt>{ar ? 'موعد بديل طلبه العميل' : 'Guest-requested time'}</dt>
                <dd dir="ltr">{stamp(viewing.preferredAt, ar)}</dd>
              </div>
            ) : null}
            {viewing.arrivedAt ? (
              <div>
                <dt>{ar ? 'وقت الوصول' : 'Arrived'}</dt>
                <dd dir="ltr">{stamp(viewing.arrivedAt, ar)}</dd>
              </div>
            ) : null}
            {viewing.guestDecision ? (
              <div>
                <dt>{ar ? 'قرار العميل' : 'Guest decision'}</dt>
                <dd>
                  <StatusBadge tone={decisionTone(viewing.guestDecision)}>
                    {decisionLabel(viewing.guestDecision, ar)}
                  </StatusBadge>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="vd__card" aria-labelledby="vd-site-title">
          <h2 id="vd-site-title">{ar ? 'الموقع والحارس' : 'Site & guard'}</h2>
          <dl className="vd__facts">
            <div>
              <dt>{ar ? 'مسؤول المعاينة' : 'Viewing contact'}</dt>
              <dd>
                {viewing.viewingContactName ? (
                  viewing.viewingContactName
                ) : (
                  <StatusBadge tone="missed">{ar ? 'غير محدد' : 'Not set'}</StatusBadge>
                )}
              </dd>
            </div>
            {viewing.viewingContactPhone ? (
              <div>
                <dt>{ar ? 'هاتف الحارس' : 'Guard phone'}</dt>
                <dd dir="ltr">
                  <a href={`tel:${viewing.viewingContactPhone.replace(/[^\d+]/g, '')}`}>
                    {viewing.viewingContactPhone}
                  </a>
                </dd>
              </div>
            ) : null}
            {viewing.propertyAddress ? (
              <div className="vd__fact--wide">
                <dt>{ar ? 'موقع العقار' : 'Property location'}</dt>
                <dd>{viewing.propertyAddress}</dd>
              </div>
            ) : null}
            {viewing.propertyMapsUrl ? (
              <div>
                <dt>{ar ? 'خريطة الوصول' : 'Directions'}</dt>
                <dd>
                  <a href={viewing.propertyMapsUrl} target="_blank" rel="noreferrer">
                    {ar ? 'فتح الخريطة' : 'Open map'}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      {viewing.preferredAt && viewing.status === 'scheduled' && !viewing.arrivedAt ? (
        <p className="vd__banner vd__banner--info" role="status">
          {ar
            ? 'العميل طلب تغيير الموعد من بطاقة الزيارة. أكّد الموعد الجديد أدناه لإصدار بطاقة محدّثة.'
            : 'The guest requested a new time from the visit pass. Confirm the new schedule below to issue an updated pass.'}
        </p>
      ) : null}

      {viewing.canManage && open && !viewing.canSchedule ? (
        <div className="vd__banner vd__banner--warn" role="alert">
          <p>
            {ar
              ? 'لا يمكن تأكيد الموعد قبل تحديد حارس المبنى أو مسؤول المعاينة ورقم هاتفه في صفحة العقار.'
              : 'Confirming the schedule requires a building guard or viewing contact with a phone number on the property page first.'}
          </p>
          <Link
            className="button button--primary"
            href={`/${locale}/${portal}/properties/${viewing.propertyId}?returnTo=${encodeURIComponent(`/${locale}/${portal}/bookings/viewings/${viewing.id}`)}#viewing-contact`}
          >
            {ar ? 'تحديد المسؤول الآن' : 'Set contact now'}
          </Link>
        </div>
      ) : null}

      {viewing.accessUsername && viewing.accessPin ? (
        <section className="vd__pass" aria-labelledby="vd-pass-title">
          <div className="vd__pass-head">
            <div>
              <h2 id="vd-pass-title">{ar ? 'بطاقة زيارة المعاينة' : 'Viewing visit pass'}</h2>
              <p>
                {ar
                  ? 'أُرسلت للعميل بالبريد مع الباركود؛ ويصل إشعار للحارس لمسحها عند الوصول.'
                  : 'Emailed to the guest with a barcode; the guard is notified to scan on arrival.'}
              </p>
            </div>
            <div className="vd__pass-links">
              {viewing.passPath ? (
                <Link
                  className="button button--quiet"
                  href={`/${locale}${viewing.passPath}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'بطاقة العميل' : 'Guest pass'}
                </Link>
              ) : null}
              {viewing.gatePath ? (
                <Link
                  className="button button--quiet"
                  href={`/${locale}${viewing.gatePath}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'بوابة المسح' : 'Scan gate'}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="vd__creds">
            <div className="vd__cred">
              <span>{ar ? 'اسم المستخدم' : 'Username'}</span>
              <strong dir="ltr">{viewing.accessUsername}</strong>
            </div>
            <div className="vd__cred">
              <span>{ar ? 'الرقم السري' : 'PIN'}</span>
              <strong dir="ltr">{viewing.accessPin}</strong>
            </div>
          </div>
        </section>
      ) : null}

      {(viewing.timeline?.length ?? 0) > 0 ? (
        <section className="vd__card vd__card--timeline" aria-labelledby="vd-timeline-title">
          <h2 id="vd-timeline-title">{ar ? 'سجل الموافقات والردود' : 'Approvals & replies log'}</h2>
          <p className="vd__hint">
            {ar
              ? 'من وافق، ومتى سجّل الحارس الوصول، وما كتبه العميل أو الحارس.'
              : 'Who approved, when the guard checked in, and notes from the guest or guard.'}
          </p>
          <ol className="vd__timeline">
            {(viewing.timeline ?? []).map((entry) => (
              <li key={entry.id} className={`vd__timeline-item vd__timeline-item--${entry.source}`}>
                <div className="vd__timeline-meta">
                  <strong>{timelineTitle(entry, ar)}</strong>
                  <time dateTime={entry.at}>{stamp(entry.at, ar)}</time>
                </div>
                <p className="vd__timeline-who">
                  <span className="vd__timeline-source">{sourceLabel(entry.source, ar)}</span>
                  {entry.actorName ? (
                    <>
                      {' · '}
                      <span>{entry.actorName}</span>
                    </>
                  ) : null}
                  {entry.toStatus && entry.toStatus !== entry.fromStatus ? (
                    <>
                      {' · '}
                      <span dir="ltr">
                        {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                        {entry.toStatus}
                      </span>
                    </>
                  ) : null}
                </p>
                {entry.note ? <p className="vd__timeline-note">{entry.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : viewing.notes ? (
        <section className="vd__card vd__card--notes" aria-labelledby="vd-notes-title">
          <h2 id="vd-notes-title">{ar ? 'الملاحظات وسجل القرارات' : 'Notes & decision log'}</h2>
          <pre className="vd__notes">{viewing.notes}</pre>
        </section>
      ) : null}

      {viewing.canManage && open ? (
        <section className="vd__actions-panel" aria-labelledby="vd-reply-title">
          <h2 id="vd-reply-title">{ar ? 'الرد وتحديد الموعد' : 'Reply and schedule'}</h2>
          <p className="vd__hint">
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
              disabled={!viewing.canSchedule}
            />
          </label>
          <label className="field">
            <span>{ar ? 'تفاصيل / ملاحظات للعميل' : 'Details / notes for the guest'}</span>
            <textarea
              className="textarea"
              rows={4}
              value={note}
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                ar
                  ? 'اكتب ملاحظة، أو اختر اقتراحاً مرحّاً بالأسفل…'
                  : 'Write a note, or pick a cheerful suggestion below…'
              }
            />
          </label>
          <div
            className="vd__suggestions"
            role="group"
            aria-label={ar ? 'اقتراحات جاهزة' : 'Ready suggestions'}
          >
            <p className="vd__hint">
              {ar ? 'اقتراحات جاهزة — اضغط لإدراجها:' : 'Ready suggestions — tap to insert:'}
            </p>
            <div className="vd__chips">
              {VIEWING_NOTE_SUGGESTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="button button--quiet vd__chip"
                  disabled={busy}
                  onClick={() =>
                    setNote(joinNoteTranslation(item.textAr, item.textEn, 'en').slice(0, 4000))
                  }
                >
                  {ar ? item.labelAr : item.labelEn}
                </button>
              ))}
            </div>
          </div>
          <NoteTranslateBar
            value={note}
            onChange={setNote}
            locale={locale}
            max={4000}
            disabled={busy}
          />
          <div className="vd__action-row">
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !scheduledAt || !viewing.canSchedule}
              title={
                !viewing.canSchedule
                  ? ar
                    ? 'حدّد مسؤول المعاينة في صفحة العقار أولاً'
                    : 'Set the viewing contact on the property page first'
                  : undefined
              }
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
        <p className="vd__banner vd__banner--ok" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="vd__banner vd__banner--err" role="alert">
          {error}
        </p>
      ) : null}

      <nav className="vd__footer-links" aria-label={ar ? 'روابط إضافية' : 'More links'}>
        <Link href={`/${locale}/units/${viewing.unitId}`}>
          {ar ? 'صفحة الوحدة العامة' : 'Public unit page'}
        </Link>
        <Link href={`/${locale}/${portal}/properties/${viewing.propertyId}`}>
          {ar ? 'إدارة العقار' : 'Manage property'}
        </Link>
      </nav>
    </div>
  );
}
