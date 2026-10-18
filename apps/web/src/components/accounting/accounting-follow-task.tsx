'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import { accountingExpenseStatusLabel } from '@/lib/accounting-i18n';
import { roleLabel } from '@/lib/team-shared';

type Assignee = { userId: string; name: string; roleKey: string };

const PRIORITY = [
  { id: 'low', ar: 'منخفضة', en: 'Low', tone: 'muted' },
  { id: 'normal', ar: 'عادية', en: 'Normal', tone: 'info' },
  { id: 'high', ar: 'عالية', en: 'High', tone: 'warn' },
  { id: 'urgent', ar: 'عاجلة', en: 'Urgent', tone: 'bad' },
] as const;

/** Assign any accounting line as a follower task that shows on /owner/tasks. */
export function AccountingFollowTask({
  locale,
  kind,
  sourceId,
  title,
  detail,
  dueOn,
  status,
}: {
  locale: 'ar' | 'en';
  kind: 'invoice' | 'receipt' | 'journal' | 'expense' | 'cheque' | 'deposit' | 'payment' | 'ledger';
  sourceId: string;
  title: string;
  detail?: string | null | undefined;
  dueOn?: string | null | undefined;
  status?: string | null | undefined;
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<(typeof PRIORITY)[number]['id']>('normal');
  const [due, setDue] = useState(dueOn && /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn : '');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [doneRef, setDoneRef] = useState<string | null>(null);

  const load = () => {
    setOpen(true);
    setMessage(null);
    setDoneRef(null);
    if (assignees) return;
    void (async () => {
      try {
        const response = await fetch('/api/owner/accounting/follow-task', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('fail');
        const payload = (await response.json()) as { assignees?: Assignee[] };
        const people = payload.assignees ?? [];
        setAssignees(people);
        setAssigneeId((current) => current || people[0]?.userId || '');
      } catch {
        setAssignees([]);
        setMessage(ar ? 'تعذر تحميل الموظفين' : 'Could not load the team');
      }
    })();
  };

  const chosen = assignees?.find((person) => person.userId === assigneeId);

  return (
    <>
      <button type="button" className="accounting-act accounting-act--task" onClick={load}>
        {ar ? 'مهمة' : 'Task'}
      </button>
      {open ? (
        <div className="accounting-hub__modal" role="presentation" onClick={() => setOpen(false)}>
          <form
            className="accounting-hub__modal-card accounting-task"
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-follow-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              if (!assigneeId || busy) return;
              setBusy(true);
              setMessage(null);
              void (async () => {
                try {
                  const result = await browserNextMutation<{
                    reference: string;
                    existing: boolean;
                  }>('/api/owner/accounting/follow-task', {
                    method: 'POST',
                    body: JSON.stringify({
                      kind,
                      sourceId,
                      title: title.slice(0, 200),
                      detail: detail ?? undefined,
                      assignedToUserId: assigneeId,
                      priority,
                      dueOn: due || undefined,
                      note: note.trim() || undefined,
                      attachments: files,
                    }),
                  });
                  setDoneRef(result.reference);
                  setMessage(
                    result.existing
                      ? ar
                        ? `المهمة ${result.reference} مفتوحة مسبقاً لهذا البند.`
                        : `Task ${result.reference} is already open for this item.`
                      : ar
                        ? `أُسندت المهمة ${result.reference} إلى ${chosen?.name ?? ''}.`
                        : `Task ${result.reference} was assigned to ${chosen?.name ?? ''}.`,
                  );
                } catch {
                  setMessage(ar ? 'تعذر إنشاء المهمة' : 'Could not create the task');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <div className="accounting-hub__modal-head">
              <div>
                <p className="accounting-hub__eyebrow">{ar ? 'إسناد متابعة' : 'Assign follow-up'}</p>
                <h2 id="accounting-follow-title">{ar ? 'تحويل البند إلى مهمة' : 'Turn this into a task'}</h2>
              </div>
              <button type="button" className="accounting-act accounting-act--archive" onClick={() => setOpen(false)}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>

            <div className="accounting-task__source">
              <strong>{title}</strong>
              {detail ? <span>{detail}</span> : null}
              {status ? (
                <em className={`accounting-hub__status accounting-hub__status--${status}`}>
                  {accountingExpenseStatusLabel(status, locale)}
                </em>
              ) : null}
            </div>

            <fieldset className="accounting-task__people">
              <legend>{ar ? 'من سيتابع المهمة' : 'Who will follow this'}</legend>
              {assignees === null ? (
                <p className="accounting-hub__muted">{ar ? 'جارٍ تحميل الفريق…' : 'Loading the team…'}</p>
              ) : assignees.length === 0 ? (
                <p className="accounting-hub__error">{ar ? 'لا موظفون نشطون في الفريق.' : 'No active team members.'}</p>
              ) : (
                <div className="accounting-task__grid">
                  {assignees.map((person) => {
                    const roles = person.roleKey
                      .split(' · ')
                      .map((role) => roleLabel(role, ar))
                      .join(' · ');
                    const on = person.userId === assigneeId;
                    return (
                      <label key={person.userId} className={`accounting-task__person${on ? ' is-on' : ''}`}>
                        <input
                          type="radio"
                          name="assignee"
                          value={person.userId}
                          checked={on}
                          onChange={() => setAssigneeId(person.userId)}
                        />
                        <span className="accounting-task__avatar" aria-hidden="true">
                          {(person.name || '?').slice(0, 1)}
                        </span>
                        <span>
                          <strong>{person.name}</strong>
                          <small>{roles}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="accounting-task__row">
              <fieldset>
                <legend>{ar ? 'الأولوية' : 'Priority'}</legend>
                <div className="accounting-task__priorities">
                  {PRIORITY.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`accounting-task__priority accounting-task__priority--${item.tone}${priority === item.id ? ' is-on' : ''}`}
                      aria-pressed={priority === item.id}
                      onClick={() => setPriority(item.id)}
                    >
                      {ar ? item.ar : item.en}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                {ar ? 'تاريخ الاستحقاق' : 'Due date'}
                <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
              </label>
            </div>

            <label>
              {ar ? 'ملاحظة للمتابع' : 'Note for the follower'}
              <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>

            <label className="accounting-task__files">
              {ar ? 'مرفقات (أسماء الملفات تُرفق مع المهمة)' : 'Attachments (file names travel with the task)'}
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const names = [...(event.target.files ?? [])].map((file) => file.name).slice(0, 8);
                  setFiles(names);
                }}
              />
              {files.length ? (
                <ul>
                  {files.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <small>{ar ? 'اختياري — حتى ٨ ملفات' : 'Optional — up to 8 files'}</small>
              )}
            </label>

            {message ? <p className="accounting-task__notice">{message}</p> : null}
            {doneRef ? (
              <p className="accounting-hub__meta">
                <Link href="/owner/tasks">{ar ? 'فتح المهام' : 'Open tasks'}</Link>
              </p>
            ) : null}
            <div className="accounting-task__submit">
              <button className="button button--primary" type="submit" disabled={busy || !assigneeId}>
                {busy ? (ar ? 'جارٍ الإسناد…' : 'Assigning…') : ar ? 'إسناد المهمة' : 'Assign task'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
