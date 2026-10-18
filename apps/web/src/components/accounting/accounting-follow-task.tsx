'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';

type Assignee = { userId: string; name: string };

/** Assign any accounting line as a follower task that shows on /owner/tasks. */
export function AccountingFollowTask({
  locale,
  kind,
  sourceId,
  title,
  detail,
  dueOn,
}: {
  locale: 'ar' | 'en';
  kind: 'invoice' | 'receipt' | 'journal' | 'expense' | 'cheque' | 'deposit' | 'payment' | 'ledger';
  sourceId: string;
  title: string;
  detail?: string | null | undefined;
  dueOn?: string | null | undefined;
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('normal');
  const [due, setDue] = useState(dueOn && /^\d{4}-\d{2}-\d{2}$/.test(dueOn) ? dueOn : '');
  const [note, setNote] = useState('');
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
        setMessage(ar ? 'تعذر تحميل المتابعين' : 'Could not load followers');
      }
    })();
  };

  return (
    <>
      <button type="button" className="button button--quiet button--sm" onClick={load}>
        {ar ? 'مهمة' : 'Task'}
      </button>
      {open ? (
        <div className="accounting-hub__modal" role="presentation" onClick={() => setOpen(false)}>
          <form
            className="accounting-hub__modal-card accounting-hub__modal-card--narrow"
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
                    }),
                  });
                  setDoneRef(result.reference);
                  setMessage(
                    result.existing
                      ? ar
                        ? `المهمة ${result.reference} موجودة مسبقاً لدى المتابع.`
                        : `Task ${result.reference} is already open for this item.`
                      : ar
                        ? `أُنشئت المهمة ${result.reference} وستظهر في المهام.`
                        : `Task ${result.reference} was created and will show under Tasks.`,
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
              <h2 id="accounting-follow-title">{ar ? 'تحويل إلى مهمة' : 'Assign as a task'}</h2>
              <button type="button" className="button button--quiet button--sm" onClick={() => setOpen(false)}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>
            <p className="accounting-hub__hint">{title}</p>
            <label>
              {ar ? 'المتابع' : 'Follower'}
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                required
                disabled={!assignees?.length}
              >
                {(assignees ?? []).map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ar ? 'الأولوية' : 'Priority'}
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="low">{ar ? 'منخفضة' : 'Low'}</option>
                <option value="normal">{ar ? 'عادية' : 'Normal'}</option>
                <option value="high">{ar ? 'عالية' : 'High'}</option>
                <option value="urgent">{ar ? 'عاجلة' : 'Urgent'}</option>
              </select>
            </label>
            <label>
              {ar ? 'الاستحقاق' : 'Due'}
              <input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
            <label>
              {ar ? 'ملاحظة للمتابع' : 'Note for the follower'}
              <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {message ? <p className="accounting-hub__meta">{message}</p> : null}
            {doneRef ? (
              <p className="accounting-hub__meta">
                <Link href="/owner/tasks">{ar ? 'فتح المهام' : 'Open tasks'}</Link>
              </p>
            ) : null}
            <button className="button button--primary" type="submit" disabled={busy || !assigneeId}>
              {ar ? 'إنشاء المهمة' : 'Create task'}
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
