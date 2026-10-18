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
  'task.roster': ['أُضيف متابع', 'Follower added'],
  'task.link': ['رُبطت المهمة', 'Task linked'],
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
  const [memberId, setMemberId] = useState('');
  const [memberDuty, setMemberDuty] = useState<'lead' | 'executor' | 'supervisor' | 'viewer'>('viewer');
  const [subjectKind, setSubjectKind] = useState<'party' | 'property' | 'unit'>(detail.subject?.kind ?? 'party');
  const [subjectId, setSubjectId] = useState(detail.subject?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const closed = detail.status === 'completed' || detail.status === 'cancelled' || detail.status === 'rejected';
  const status = STATUS[detail.status] ?? [detail.status, detail.status];

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await browserNextMutation<WorkTaskDetail>(path, {
        method: path === base ? 'PATCH' : 'POST',
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
  const steps = NEXT[detail.status] ?? [];
  const due = detail.dueAt ? detail.dueAt.slice(0, 10) : null;

  return (
    <article className="task-page" dir={ar ? 'rtl' : 'ltr'}>
      <header className="task-page__hero">
        <Link href={`/${portal}/tasks`} className="task-page__back" prefetch={false}>
          {ar ? 'كل المهام' : 'All tasks'}
        </Link>
        <div className="task-page__identity">
          <p>
            <span dir="ltr">{detail.reference}</span>
            {due ? <span>{ar ? `الاستحقاق ${due}` : `Due ${due}`}</span> : null}
            {detail.assigneeName ? <span>{detail.assigneeName}</span> : null}
          </p>
          <h1>{detail.title}</h1>
        </div>
        <span className={`task-page__status task-page__status--${detail.status}`}>
          {ar ? status[0] : status[1]}
        </span>
      </header>

      <div className="task-page__grid">
        <div className="task-page__main">
          <section className="task-page__card">
            <h2>{ar ? 'تفاصيل المهمة' : 'Task details'}</h2>
            <p className="task-page__body">
              {detail.description?.trim() || (ar ? 'لا يوجد وصف.' : 'No description.')}
            </p>
            {detail.followers.length ? (
              <ul className="task-page__roster">
                {detail.followers.map((person) => {
                  const duty = DUTY[person.duty] ?? [person.duty, person.duty];
                  return (
                    <li key={`${person.userId}-${person.duty}`}>
                      <strong>{person.name}</strong>
                      <em>{ar ? duty[0] : duty[1]}</em>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {detail.checklist.length ? (
              <ul className="task-page__checks">
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
                      <span>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {detail.files.length ? (
              <ul className="task-page__checks">
                {detail.files.map((file) => (
                  <li key={file.id}>
                    <a href={`/api/portal/tasks/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(file.id)}`}>
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {detail.canUpdate ? (
              <label className="task-page__stack">
                <span>{ar ? 'إرفاق ملف' : 'Attach a file'}</span>
                <input
                  type="file"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (file.size > 700_000) {
                      setMessage(ar ? 'الملف أكبر من المسموح (حوالي ٧٠٠ ك.ب).' : 'The file is larger than about 700 KB.');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      const data = typeof reader.result === 'string' ? reader.result : '';
                      void run(`${base}/files`, { name: file.name, data }, ar ? 'أُرفق الملف' : 'File attached');
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            ) : null}
          </section>

          <section className="task-page__card">
            <h2>{ar ? 'المحادثة' : 'Conversation'}</h2>
            <ol className="task-page__thread">
              {detail.events.length ? (
                detail.events.map((event) => {
                  const label = EVENT[event.type] ?? [event.type, event.type];
                  return (
                    <li key={event.id} className={event.type === 'task.reply' ? 'is-reply' : ''}>
                      <header>
                        <strong>{ar ? label[0] : label[1]}</strong>
                        <small>
                          {[event.actorName, event.at.slice(0, 16).replace('T', ' ')]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </header>
                      {event.note ? <p>{event.note}</p> : null}
                    </li>
                  );
                })
              ) : (
                <li>
                  <p>{ar ? 'لا ردود بعد. اكتب أول ملاحظة بالأسفل.' : 'No replies yet. Write the first note below.'}</p>
                </li>
              )}
            </ol>
            {detail.canUpdate ? (
              <form
                className="task-page__reply"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reply.trim().length < 2) return;
                  void run(`${base}/reply`, { note: reply.trim() }, ar ? 'أُرسل الرد' : 'Reply sent');
                }}
              >
                <label>
                  <span>{ar ? 'اكتب رداً' : 'Write a reply'}</span>
                  <textarea
                    rows={5}
                    maxLength={2000}
                    value={reply}
                    placeholder={ar ? 'ما الذي تم، أو ما المطلوب الآن؟' : 'What was done, or what is needed now?'}
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
        </div>

        <aside className="task-page__side">
          <section className="task-page__card">
            <h2>{ar ? 'الإجراء' : 'Action'}</h2>
            {detail.canUpdate && !closed ? (
              <div className="task-page__actions">
                {steps.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    className={action.status === 'completed' ? 'button button--primary' : 'button button--quiet'}
                    disabled={busy}
                    onClick={() =>
                      void run(base, { status: action.status }, ar ? `الحالة: ${action.ar}` : `Status: ${action.en}`)
                    }
                  >
                    {ar ? action.ar : action.en}
                  </button>
                ))}
                {!steps.some((action) => action.status === 'completed') ? (
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
            ) : (
              <p>{ar ? 'هذه المهمة مغلقة. يمكنك ما زلت قراءة المحادثة.' : 'This task is closed. The conversation stays readable.'}</p>
            )}
            {message ? <p className="task-page__notice">{message}</p> : null}
          </section>

          {detail.canAssign ? (
            <section className="task-page__card">
              <h2>{ar ? 'إضافة عضو' : 'Add a member'}</h2>
              <form
                className="task-page__stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!memberId) return;
                  void run(
                    `${base}/members`,
                    { userId: memberId, duty: memberDuty },
                    ar ? 'أُضيف العضو' : 'Member added',
                  );
                }}
              >
                <label>
                  <span>{ar ? 'العضو' : 'Member'}</span>
                  <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                    <option value="">{ar ? 'اختر موظفاً' : 'Choose a person'}</option>
                    {detail.people
                      .filter((person) => !detail.followers.some((seat) => seat.userId === person.userId))
                      .map((person) => (
                        <option key={person.userId} value={person.userId}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>{ar ? 'دوره في المهمة' : 'Duty on this task'}</span>
                  <select value={memberDuty} onChange={(event) => setMemberDuty(event.target.value as typeof memberDuty)}>
                    {Object.entries(DUTY).map(([id, label]) => (
                      <option key={id} value={id}>
                        {ar ? label[0] : label[1]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button button--quiet" type="submit" disabled={busy || !memberId}>
                  {ar ? 'إضافة' : 'Add'}
                </button>
              </form>
            </section>
          ) : null}

          {detail.canAssign ? (
            <section className="task-page__card">
              <h2>{ar ? 'تحويل المهمة' : 'Transfer'}</h2>
              <form
                className="task-page__stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(base, { assignedToUserId: assignTo || null }, ar ? 'حُوّلت المهمة' : 'Task transferred');
                }}
              >
                <label>
                  <span>{ar ? 'المسؤول الجديد' : 'New owner'}</span>
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
            </section>
          ) : null}

          <section className="task-page__card">
            <h2>{ar ? 'ربط المهمة' : 'Link this task'}</h2>
            {detail.subject ? (
              <p>
                <Link
                  href={
                    detail.subject.kind === 'party'
                      ? `/${portal}/contacts/${encodeURIComponent(detail.subject.id)}`
                      : detail.subject.kind === 'unit'
                        ? `/${portal}/properties/${encodeURIComponent(detail.units.find((unit) => unit.id === detail.subject?.id)?.propertyId ?? '')}?unit=${encodeURIComponent(detail.subject.id)}`
                        : `/${portal}/properties/${encodeURIComponent(detail.subject.id)}`
                  }
                >
                  {detail.subject.kind === 'party'
                    ? ar
                      ? `المستأجر: ${detail.subject.label}`
                      : `Tenant: ${detail.subject.label}`
                    : detail.subject.kind === 'unit'
                      ? ar
                        ? `الوحدة: ${detail.subject.label}`
                        : `Unit: ${detail.subject.label}`
                      : ar
                        ? `المبنى: ${detail.subject.label}`
                        : `Building: ${detail.subject.label}`}
                </Link>
              </p>
            ) : (
              <p>{ar ? 'غير مربوطة بعد.' : 'Not linked yet.'}</p>
            )}
            {detail.canUpdate ? (
              <form
                className="task-page__stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!subjectId) return;
                  void run(`${base}/link`, { kind: subjectKind, id: subjectId }, ar ? 'رُبطت المهمة' : 'Task linked');
                }}
              >
                <label>
                  <span>{ar ? 'النوع' : 'Type'}</span>
                  <select
                    value={subjectKind}
                    onChange={(event) => {
                      setSubjectKind(event.target.value as typeof subjectKind);
                      setSubjectId('');
                    }}
                  >
                    <option value="party">{ar ? 'مستأجر / شخص' : 'Tenant / person'}</option>
                    <option value="property">{ar ? 'مبنى' : 'Building'}</option>
                    <option value="unit">{ar ? 'وحدة' : 'Unit'}</option>
                  </select>
                </label>
                <label>
                  <span>{ar ? 'الاسم' : 'Name'}</span>
                  <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                    <option value="">{ar ? 'اختر' : 'Choose'}</option>
                    {(subjectKind === 'party'
                      ? detail.parties
                      : subjectKind === 'property'
                        ? detail.properties
                        : detail.units
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button button--quiet" type="submit" disabled={busy || !subjectId}>
                  {ar ? 'حفظ الربط' : 'Save link'}
                </button>
              </form>
            ) : null}
          </section>

          <section className="task-page__card">
            <h2>{ar ? 'المحامي' : 'Lawyer'}</h2>
            {detail.legalCase ? (
              <Link className="button button--primary" href={`/${portal}/legal/${encodeURIComponent(detail.legalCase.id)}`}>
                {ar ? `القضية ${detail.legalCase.reference}` : `Case ${detail.legalCase.reference}`}
              </Link>
            ) : detail.canLegal ? (
              <form
                className="task-page__stack"
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
                  <span>{ar ? 'اختر المحامي' : 'Choose a lawyer'}</span>
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
                  <textarea rows={3} maxLength={2000} value={legalNote} onChange={(event) => setLegalNote(event.target.value)} />
                </label>
                <button className="button button--primary" type="submit" disabled={busy}>
                  {ar ? 'فتح قضية' : 'Open a case'}
                </button>
              </form>
            ) : (
              <p>{ar ? 'فتح القضية يحتاج صلاحية إدارة المحاماة.' : 'Opening a case needs legal management access.'}</p>
            )}
          </section>
        </aside>
      </div>
    </article>
  );
}
