'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import { accountingExpenseStatusLabel } from '@/lib/accounting-i18n';
import { roleLabel } from '@/lib/team-shared';
import { NoteTranslateBar } from '@/components/note-translate';

type Assignee = { userId: string; name: string; roleKey: string };

export type AccountingTaskLink = {
  id: string;
  reference: string;
  title: string;
  status: string;
  kind: string;
  sourceId: string;
};

const TASK_OPEN = new Set(['draft', 'pending', 'approved', 'in_progress', 'on_hold']);

const KIND_LABEL: Record<string, [string, string]> = {
  invoice: ['فاتورة', 'Invoice'],
  receipt: ['إيصال', 'Receipt'],
  journal: ['قيد', 'Journal'],
  expense: ['مصروف', 'Expense'],
  cheque: ['شيك', 'Cheque'],
  deposit: ['تأمين', 'Deposit'],
  payment: ['دفعة', 'Payment'],
  ledger: ['أستاذ', 'Ledger'],
};

const TaskLinks = createContext<{ tasks: AccountingTaskLink[]; reload: () => void }>({
  tasks: [],
  reload: () => undefined,
});

/** Loads which accounting lines already have a task, once for the whole hub. */
export function AccountingTasksProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const [tasks, setTasks] = useState<AccountingTaskLink[]>([]);
  const reload = useCallback(() => {
    void fetch('/api/owner/accounting/follow-task', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { tasks?: AccountingTaskLink[] };
        setTasks(payload.tasks ?? []);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (active) reload();
  }, [active, reload]);
  return <TaskLinks.Provider value={{ tasks, reload }}>{children}</TaskLinks.Provider>;
}

/** Accounting lines that were sent to tasks. */
export function AccountingTasksInbox({ locale }: { locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const { tasks } = useContext(TaskLinks);
  return (
    <section className="accounting-tasks" aria-label={ar ? 'المهام المحاسبية' : 'Accounting tasks'}>
      <header>
        <h2>{ar ? 'المهام المحاسبية' : 'Accounting tasks'}</h2>
        <p>
          {ar
            ? 'كل عملية أُحيلت للمتابعة تظهر هنا. العملية الواحدة لها مهمة واحدة.'
            : 'Every accounting line sent for follow-up is listed here. Each line has one task.'}
        </p>
      </header>
      {tasks.length === 0 ? (
        <p className="accounting-hub__muted">{ar ? 'لا مهام محاسبية بعد.' : 'No accounting tasks yet.'}</p>
      ) : (
        <ul>
          {tasks.slice(0, 12).map((task) => {
            const kind = KIND_LABEL[task.kind] ?? [task.kind, task.kind];
            const live = TASK_OPEN.has(task.status);
            return (
              <li key={task.id}>
                <Link href={`/owner/tasks/${encodeURIComponent(task.id)}`}>
                  <span className={live ? 'accounting-tasks__mark is-open' : 'accounting-tasks__mark'}>
                    {live ? (ar ? 'مفتوحة' : 'Open') : ar ? 'مغلقة' : 'Closed'}
                  </span>
                  <strong>{task.title}</strong>
                  <small>
                    {ar ? kind[0] : kind[1]} · {task.reference}
                  </small>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > 12 ? <Link href="/owner/tasks">{ar ? 'كل المهام' : 'All tasks'}</Link> : null}
    </section>
  );
}

function OpenTaskIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3.5h9.2L19 8.2V20.5H5V3.5zm8.2 1.6V8.8H18l-4.8-3.7zM8 12h8v1.4H8V12zm0 3.2h5.2v1.4H8v-1.4z"
      />
      <circle cx="17.2" cy="17.2" r="3.2" fill="#fff" />
      <circle cx="17.2" cy="17.2" r="2.1" />
    </svg>
  );
}
type Duty = 'lead' | 'executor' | 'supervisor' | 'viewer';
type Seat = { userId: string; duty: Duty };

const PRIORITY = [
  { id: 'low', ar: 'منخفضة', en: 'Low', tone: 'muted' },
  { id: 'normal', ar: 'عادية', en: 'Normal', tone: 'info' },
  { id: 'high', ar: 'عالية', en: 'High', tone: 'warn' },
  { id: 'urgent', ar: 'عاجلة', en: 'Urgent', tone: 'bad' },
] as const;

const DUTY: Array<{ id: Duty; ar: string; en: string }> = [
  { id: 'lead', ar: 'المسؤول', en: 'Responsible' },
  { id: 'executor', ar: 'المنفّذ', en: 'Doer' },
  { id: 'supervisor', ar: 'المراقب', en: 'Reviewer' },
  { id: 'viewer', ar: 'للاطلاع', en: 'For information' },
];

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
  const { tasks, reload } = useContext(TaskLinks);
  const existing = tasks.find((task) => task.kind === kind && task.sourceId === sourceId);
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
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
        setSeats((current) =>
          current.length || !people[0] ? current : [{ userId: people[0].userId, duty: 'lead' }],
        );
      } catch {
        setAssignees([]);
        setMessage(ar ? 'تعذر تحميل الموظفين' : 'Could not load the team');
      }
    })();
  };

  const lead = seats.find((seat) => seat.duty === 'lead') ?? seats[0];
  const leadName = assignees?.find((person) => person.userId === lead?.userId)?.name ?? '';

  const setDuty = (index: number, duty: Duty) => {
    setSeats((current) =>
      current.map((seat, seatIndex) => {
        if (seatIndex === index) return { ...seat, duty };
        if (duty === 'lead' && seat.duty === 'lead') return { ...seat, duty: 'supervisor' };
        return seat;
      }),
    );
  };

  const addSeat = () => {
    const taken = new Set(seats.map((seat) => seat.userId));
    const next = assignees?.find((person) => !taken.has(person.userId));
    if (!next) {
      setMessage(ar ? 'كل أعضاء الفريق مضافون. أضف مستخدماً جديداً من صفحة الفريق.' : 'Everyone on the team is already added.');
      return;
    }
    setSeats((current) => [...current, { userId: next.userId, duty: 'viewer' }]);
  };

  return (
    <>
      {existing ? (
        <Link
          href={`/owner/tasks/${encodeURIComponent(existing.id)}`}
          className={
            TASK_OPEN.has(existing.status)
              ? 'accounting-act accounting-act--task-open'
              : 'accounting-act accounting-act--task-done'
          }
          title={existing.reference}
        >
          <OpenTaskIcon />
          {TASK_OPEN.has(existing.status)
            ? ar
              ? 'مهمة مفتوحة'
              : 'Open task'
            : ar
              ? 'مهمة مغلقة'
              : 'Closed task'}
        </Link>
      ) : (
        <button type="button" className="accounting-act accounting-act--task" onClick={load}>
          {ar ? 'مهمة' : 'Task'}
        </button>
      )}
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
              if (!seats.length || busy) return;
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
                      assignedToUserId: lead?.userId,
                      priority,
                      dueOn: due || undefined,
                      note: note.trim() || undefined,
                      attachments: files,
                      followers: seats,
                    }),
                  });
                  setDoneRef(result.reference);
                  reload();
                  setMessage(
                    result.existing
                      ? ar
                        ? `المهمة ${result.reference} مفتوحة مسبقاً لهذا البند.`
                        : `Task ${result.reference} is already open for this item.`
                      : ar
                        ? `أُسندت المهمة ${result.reference} إلى ${leadName} ومعه ${seats.length} متابع.`
                        : `Task ${result.reference} was assigned to ${leadName} with ${seats.length} followers.`,
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
              <legend>{ar ? 'المتابعون وأدوارهم' : 'Followers and their roles'}</legend>
              {assignees === null ? (
                <p className="accounting-hub__muted">{ar ? 'جارٍ تحميل الفريق…' : 'Loading the team…'}</p>
              ) : assignees.length === 0 ? (
                <p className="accounting-hub__error">{ar ? 'لا موظفون نشطون في الفريق.' : 'No active team members.'}</p>
              ) : (
                <ul className="accounting-task__seats">
                  {seats.map((seat, index) => {
                    const person = assignees.find((item) => item.userId === seat.userId);
                    const roles = (person?.roleKey ?? '')
                      .split(' · ')
                      .filter(Boolean)
                      .map((role) => roleLabel(role, ar))
                      .join(' · ');
                    return (
                      <li key={`${seat.userId}-${index}`} className="accounting-task__seat">
                        <span className="accounting-task__avatar" aria-hidden="true">
                          {(person?.name || '?').slice(0, 1)}
                        </span>
                        <label>
                          <span className="sr-only">{ar ? 'المتابع' : 'Follower'}</span>
                          <select
                            value={seat.userId}
                            onChange={(event) => {
                              const userId = event.target.value;
                              setSeats((current) =>
                                current.map((item, seatIndex) =>
                                  seatIndex === index ? { ...item, userId } : item,
                                ),
                              );
                            }}
                          >
                            {assignees
                              .filter(
                                (option) =>
                                  option.userId === seat.userId ||
                                  !seats.some((other) => other.userId === option.userId),
                              )
                              .map((option) => (
                                <option key={option.userId} value={option.userId}>
                                  {option.name}
                                </option>
                              ))}
                          </select>
                          {roles ? <small>{roles}</small> : null}
                        </label>
                        <label>
                          <span className="sr-only">{ar ? 'الدور في المتابعة' : 'Follow-up role'}</span>
                          <select
                            value={seat.duty}
                            onChange={(event) => setDuty(index, event.target.value as Duty)}
                          >
                            {DUTY.map((duty) => (
                              <option key={duty.id} value={duty.id}>
                                {ar ? duty.ar : duty.en}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="accounting-act accounting-act--void"
                          disabled={seats.length < 2}
                          onClick={() =>
                            setSeats((current) => current.filter((_, seatIndex) => seatIndex !== index))
                          }
                        >
                          {ar ? 'إزالة' : 'Remove'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="accounting-task__add">
                <button type="button" className="accounting-act accounting-act--task" onClick={addSeat}>
                  {ar ? 'إضافة متابع' : 'Add follower'}
                </button>
                <Link href="/owner/team">{ar ? 'إضافة مستخدم للفريق' : 'Add a user to the team'}</Link>
              </div>
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

            <label className="accounting-task__note">
              <span>{ar ? 'ملاحظة للمتابع' : 'Note for the follower'}</span>
              <textarea
                rows={6}
                maxLength={2000}
                value={note}
                placeholder={
                  ar
                    ? 'اكتب هنا ما يجب على المتابع فعله، بالتفصيل…'
                    : 'Write what the follower should do…'
                }
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <NoteTranslateBar value={note} onChange={setNote} locale={locale} max={2000} disabled={busy} />

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
              <button className="button button--primary" type="submit" disabled={busy || !seats.length}>
                {busy ? (ar ? 'جارٍ الإسناد…' : 'Assigning…') : ar ? 'إسناد المهمة' : 'Assign task'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
