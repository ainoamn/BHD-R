'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NoteTranslateBar } from '@/components/note-translate';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { joinNoteTranslation } from '@/lib/note-translation';
import { VIEWING_NOTE_SUGGESTIONS } from '@/lib/viewing-note-suggestions';
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
        {viewing.preferredAt ? (
          <div>
            <dt>{ar ? 'موعد بديل طلبه العميل' : 'Guest-requested time'}</dt>
            <dd dir="ltr">{viewing.preferredAt.slice(0, 16).replace('T', ' ')}</dd>
          </div>
        ) : null}
        <div>
          <dt>{ar ? 'مسؤول المعاينة' : 'Viewing contact'}</dt>
          <dd>
            {viewing.viewingContactName ? (
              viewing.viewingContactName
            ) : (
              <span className="ops-status ops-status--requested">
                {ar ? 'غير محدد' : 'Not set'}
              </span>
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
          <div>
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

      {viewing.preferredAt && viewing.status === 'scheduled' && !viewing.arrivedAt ? (
        <p className="notice" role="status">
          {ar
            ? 'العميل طلب تغيير الموعد من بطاقة الزيارة. أكّد الموعد الجديد أدناه لإصدار بطاقة محدّثة.'
            : 'The guest requested a new time from the visit pass. Confirm the new schedule below to issue an updated pass.'}
        </p>
      ) : null}

      {viewing.canManage && open && !viewing.canSchedule ? (
        <div className="notice notice--error viewing-desk__contact-gate" role="alert">
          <p>
            {ar
              ? 'لا يمكن تأكيد الموعد وإشعار العميل قبل تحديد حارس المبنى أو المسؤول عن المعاينة ورقم هاتفه في صفحة العقار.'
              : 'Confirming the schedule and notifying the guest requires a building guard or viewing contact with a phone number on the property page first.'}
          </p>
          <Link
            className="button button--primary"
            href={`/${locale}/${portal}/properties/${viewing.propertyId}?returnTo=${encodeURIComponent(`/${locale}/${portal}/bookings/viewings/${viewing.id}`)}#viewing-contact`}
          >
            {ar ? 'تحديد المسؤول الآن' : 'Set contact now'}
          </Link>
        </div>
      ) : null}

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
                  ? 'اكتب ملاحظة، أو اختر اقتراحاً مرحّاً بالأسفل، ثم استخدم الذكاء الاصطناعي للترجمة والصياغة…'
                  : 'Write a note, or pick a cheerful suggestion below, then use AI to translate and rephrase…'
              }
            />
          </label>
          <div className="viewing-desk__suggestions" role="group" aria-label={ar ? 'اقتراحات جاهزة' : 'Ready suggestions'}>
            <p className="muted viewing-desk__suggestions-label">
              {ar
                ? 'اقتراحات مرحّة جاهزة (عربي + إنجليزي) — اضغط لإدراجها:'
                : 'Cheerful ready-made notes (AR + EN) — tap to insert:'}
            </p>
            <div className="viewing-desk__suggestion-chips">
              {VIEWING_NOTE_SUGGESTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="button button--quiet viewing-desk__chip"
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
          <NoteTranslateBar value={note} onChange={setNote} locale={locale} max={4000} disabled={busy} />
          <div className="viewing-desk__actions">
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
