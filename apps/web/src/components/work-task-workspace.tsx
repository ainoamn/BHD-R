'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import { NoteTranslateBar } from '@/components/note-translate';
import type { WorkTaskDetail } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';

const STATUS: Record<string, [string, string]> = {
  draft: ['مسودة', 'Draft'],
  pending: ['جديدة', 'New'],
  approved: ['معتمدة', 'Approved'],
  in_progress: ['قيد التنفيذ', 'In progress'],
  on_hold: ['معلقة', 'On hold'],
  completed: ['مغلقة', 'Closed'],
  cancelled: ['ملغاة', 'Cancelled'],
  rejected: ['مرفوضة', 'Rejected'],
};

const DUTY: Record<string, [string, string]> = {
  lead: ['المسؤول', 'Responsible'],
  executor: ['المنفّذ', 'Doer'],
  supervisor: ['المراقب', 'Reviewer'],
  viewer: ['للاطلاع', 'For information'],
};

const EVENT: Record<string, [string, string]> = {
  'task.created': ['أُنشئت المهمة', 'Task opened'],
  'task.reply': ['رد', 'Reply'],
  'task.status': ['تغيير الحالة', 'Status change'],
  'task.reassigned': ['تحويل', 'Reassigned'],
  'task.legal': ['فُتحت قضية', 'Legal case opened'],
};

const NEXT: Record<string, Array<{ status: string; ar: string; en: string }>> = {
  draft: [{ status: 'pending', ar: 'إرسال', en: 'Submit' }],
  pending: [
    { status: 'approved', ar: 'اعتماد', en: 'Approve' },
    { status: 'rejected', ar: 'رفض', en: 'Reject' },
  ],
  approved: [
    { status: 'in_progress', ar: 'بدء التنفيذ', en: 'Start' },
    { status: 'on_hold', ar: 'تعليق', en: 'Hold' },
  ],
  in_progress: [
    { status: 'on_hold', ar: 'تعليق', en: 'Hold' },
    { status: 'completed', ar: 'إغلاق', en: 'Close' },
  ],
  on_hold: [
    { status: 'in_progress', ar: 'استئناف', en: 'Resume' },
    { status: 'cancelled', ar: 'إلغاء', en: 'Cancel' },
  ],
};

/** One task: read it, reply, reassign, change its status, or open a legal case. */
export function WorkTaskWorkspace({
  initial,
  locale,
  portal,
}: {
  initial: WorkTaskDetail;
  locale: 'ar' | 'en';
  portal: PortalRole;
}) {
  const ar = locale === 'ar';
  const [detail, setDetail] = useState(initial);
  const [reply, setReply] = useState('');
  const [assignTo, setAssignTo] = useState(detail.assigneeId ?? '');
  const [lawyerId, setLawyerId] = useState(detail.lawyers[0]?.id ?? '');
  const [legalNote, setLegalNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closed = detail.status === 'completed' || detail.status === 'cancelled' || detail.status === 'rejected';
  const status = STATUS[detail.status] ?? [detail.status, detail.status];

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await browserNextMutation<WorkTaskDetail>(path, {
        method: path.endsWith('/reply') || path.endsWith('/legal') ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      setDetail(next);
      setAssignTo(next.assigneeId ?? '');
      setMessage(ok);
      if (path.endsWith('/reply')) setReply('');
      if (path.endsWith('/legal')) setLegalNote('');
    } catch {
      setMessage(ar ? 'تعذر حفظ الإجراء' : 'Could not save that action');
    } finally {
      setBusy(false);
    }
  };

  const base = `/api/portal/tasks/${encodeURIComponent(detail.id)}`;

  return (
    <div className="legal-case task-desk" dir={ar ? 'rtl' : 'ltr'}>
      <header className="legal-case__head">
        <Link href={`/${portal}/tasks`} className="legal-case__back" prefetch={false}>
          {ar ? 'المهام' : 'Tasks'}
        </Link>
        <div className="legal-case__title">
          <span className="legal-case__ref" dir="ltr">
            {detail.reference}
          </span>
          <h1>{detail.title}</h1>
        </div>
        <span className={`legal-stage legal-stage--${detail.status}`}>{ar ? status[0] : status[1]}</span>
      </header>

      {detail.description ? <p className="task-desk__body">{detail.description}</p> : null}

      {detail.followers.length ? (
        <ul className="task-desk__people">
          {detail.followers.map((person) => {
            const duty = DUTY[person.duty] ?? [person.duty, person.duty];
            return (
              <li key={`${person.userId}-${person.duty}`}>
                <strong>{person.name}</strong>
                <small>{ar ? duty[0] : duty[1]}</small>
              </li>
            );
          })}
        </ul>
      ) : detail.assigneeName ? (
        <p className="legal-muted">
          {ar ? 'المسؤول:' : 'Responsible:'} {detail.assigneeName}
        </p>
      ) : null}

      {detail.checklist.length ? (
        <ul className="task-desk__checks">
          {detail.checklist.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              <label>
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busy || !detail.canUpdate}
                  onChange={(event) =>
                    void run(
                      base,
                      { checklistIndex: index, checklistDone: event.target.checked },
                      ar ? 'حُفظت القائمة' : 'Checklist saved',
                    )
                  }
                />
                {item.label}
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {detail.canUpdate && !closed ? (
        <div className="task-desk__actions">
          {(NEXT[detail.status] ?? []).map((action) => (
            <button
              key={action.status}
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() =>
                void run(
                  base,
                  { status: action.status },
                  ar ? `الحالة: ${action.ar}` : `Status: ${action.en}`,
                )
              }
            >
              {ar ? action.ar : action.en}
            </button>
          ))}
          {detail.status !== 'completed' &&
          detail.status !== 'cancelled' &&
          !(NEXT[detail.status] ?? []).some((action) => action.status === 'completed') ? (
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void run(base, { status: 'completed' }, ar ? 'أُغلقت المهمة' : 'Task closed')}
            >
              {ar ? 'إغلاق المهمة' : 'Close task'}
            </button>
          ) : null}
        </div>
      ) : null}

      <section className="legal-thread">
        <h2>{ar ? 'الردود والإجراءات' : 'Replies and actions'}</h2>
        <ol className="legal-thread__list">
          {detail.events.length ? (
            detail.events.map((event) => {
              const label = EVENT[event.type] ?? [event.type, event.type];
              return (
                <li key={event.id}>
                  <strong>{ar ? label[0] : label[1]}</strong>
                  <small>
                    {event.actorName} · {event.at.slice(0, 16).replace('T', ' ')}
                  </small>
                  {event.note ? <p>{event.note}</p> : null}
                </li>
              );
            })
          ) : (
            <li>
              <p>{ar ? 'لا ردود بعد.' : 'No replies yet.'}</p>
            </li>
          )}
        </ol>
        {detail.canUpdate ? (
          <form
            className="task-desk__reply"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim().length < 2) return;
              void run(`${base}/reply`, { note: reply.trim() }, ar ? 'أُرسل الرد' : 'Reply sent');
            }}
          >
            <label>
              <span>{ar ? 'رد على المهمة' : 'Reply'}</span>
              <textarea
                rows={5}
                maxLength={2000}
                value={reply}
                placeholder={ar ? 'اكتب الرد أو ما تم إنجازه…' : 'Write the reply or what was done…'}
                onChange={(event) => setReply(event.target.value)}
              />
            </label>
            <NoteTranslateBar value={reply} onChange={setReply} locale={locale} max={2000} disabled={busy} />
            <button className="button button--primary" type="submit" disabled={busy || reply.trim().length < 2}>
              {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال الرد' : 'Send reply'}
            </button>
          </form>
        ) : null}
      </section>

      {detail.canAssign ? (
        <form
          className="task-desk__transfer"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              base,
              { assignedToUserId: assignTo || null },
              ar ? 'حُوّلت المهمة' : 'Task transferred',
            );
          }}
        >
          <label>
            <span>{ar ? 'تحويل المهمة إلى' : 'Transfer the task to'}</span>
            <select value={assignTo} onChange={(event) => setAssignTo(event.target.value)}>
              <option value="">{ar ? 'بدون مسؤول' : 'Unassigned'}</option>
              {detail.people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <button className="button button--quiet" type="submit" disabled={busy}>
            {ar ? 'تحويل' : 'Transfer'}
          </button>
        </form>
      ) : null}

      <section className="task-desk__legal">
        <h2>{ar ? 'المحامي والقضية' : 'Lawyer and case'}</h2>
        {detail.legalCase ? (
          <p>
            <Link href={`/${portal}/legal/${encodeURIComponent(detail.legalCase.id)}`}>
              {ar ? `فتح القضية ${detail.legalCase.reference}` : `Open case ${detail.legalCase.reference}`}
            </Link>
          </p>
        ) : detail.canLegal ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                `${base}/legal`,
                { lawyerPartyId: lawyerId || null, note: legalNote.trim() || undefined },
                ar ? 'فُتحت القضية' : 'Case opened',
              );
            }}
          >
            <label>
              <span>{ar ? 'المحامي' : 'Lawyer'}</span>
              <select value={lawyerId} onChange={(event) => setLawyerId(event.target.value)}>
                <option value="">{ar ? 'بدون محامٍ الآن' : 'No lawyer yet'}</option>
                {detail.lawyers.map((lawyer) => (
                  <option key={lawyer.id} value={lawyer.id}>
                    {lawyer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{ar ? 'ملاحظة للمحامي' : 'Note for the lawyer'}</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={legalNote}
                onChange={(event) => setLegalNote(event.target.value)}
              />
            </label>
            <button className="button button--primary" type="submit" disabled={busy}>
              {ar ? 'فتح قضية' : 'Open a case'}
            </button>
          </form>
        ) : (
          <p className="legal-muted">
            {ar ? 'فتح القضية يحتاج صلاحية إدارة المحاماة.' : 'Opening a case needs legal management access.'}
          </p>
        )}
      </section>

      {message ? <p className="legal-muted">{message}</p> : null}
    </div>
  );
}
