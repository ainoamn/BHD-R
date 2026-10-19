'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { WorkTaskDetail, WorkTaskSummary } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';
import {
  TASK_BOARD_COLUMNS,
  TASK_STATUS_ORDER,
  taskPriorityLabel,
  taskStatusLabel,
} from '@/lib/work-task-ui';

type ViewMode = 'list' | 'board';

type Draft = {
  title: string;
  description: string;
  priority: string;
  status: string;
  dueAt: string;
  startsAt: string;
  tags: string;
  checklist: string;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  priority: 'normal',
  status: 'pending',
  dueAt: '',
  startsAt: '',
  tags: '',
  checklist: '',
};

/** ClickUp-style list + board: status groups, create modal, priority flags. */
export function WorkTasksBoard({
  portal,
  locale,
  active,
}: {
  portal: PortalRole;
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkTaskSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/tasks', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      setTasks(((await response.json()) as { tasks: WorkTaskSummary[] }).tasks);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      if (!detail || detail.section === 'tasks') void load();
    };
    window.addEventListener('bhd-r-ops-refresh', onRefresh);
    return () => window.removeEventListener('bhd-r-ops-refresh', onRefresh);
  }, [active, load]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (tasks ?? []).filter(
        (item) =>
          !needle ||
          [item.reference, item.title, item.assigneeName, item.category, ...(item.tags ?? [])]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(needle)),
      ),
    [needle, tasks],
  );

  const groups = useMemo(() => {
    const map = new Map<string, WorkTaskSummary[]>();
    for (const status of TASK_STATUS_ORDER) map.set(status, []);
    for (const item of shown) {
      const key = map.has(item.status) ? item.status : 'pending';
      map.get(key)!.push(item);
    }
    return TASK_STATUS_ORDER.map((status) => ({
      status,
      items: map.get(status) ?? [],
    })).filter((group) => group.items.length > 0);
  }, [shown]);

  const listGroups = groups;

  const boardColumns = useMemo(
    () =>
      TASK_BOARD_COLUMNS.map((status) => ({
        status,
        items: shown.filter((item) => item.status === status),
      })),
    [shown],
  );

  const openCreate = (status = 'pending') => {
    setDraft({ ...EMPTY_DRAFT, status });
    setMessage(null);
    setCreating(true);
  };

  const submitCreate = async () => {
    const title = draft.title.trim();
    if (title.length < 2) {
      setMessage(ar ? 'اكتب عنوان المهمة (حرفان على الأقل).' : 'Enter a task title (at least 2 characters).');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const tags = draft.tags
        .split(/[,،]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12);
      const checklist = draft.checklist
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 40);
      const created = await browserNextMutation<WorkTaskDetail>('/api/portal/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: draft.description.trim() || undefined,
          priority: draft.priority,
          status: draft.status,
          startsAt: draft.startsAt || null,
          dueAt: draft.dueAt || null,
          tags: tags.length ? tags : undefined,
          checklist: checklist.length ? checklist : undefined,
        }),
      });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      await load();
      router.push(`/${portal}/tasks/${encodeURIComponent(created.id)}`);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'forbidden') {
        setCanCreate(false);
        setMessage(ar ? 'ليست لديك صلاحية إنشاء المهام.' : 'You do not have permission to create tasks.');
      } else {
        setMessage(ar ? 'تعذر إنشاء المهمة.' : 'Could not create the task.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="task-board" aria-label={ar ? 'المهام' : 'Tasks'}>
      <div className="task-board__toolbar">
        <div>
          <h2>{ar ? 'مساحة المهام' : 'Task space'}</h2>
          <p>
            {ar
              ? 'قائمة ولوحة بنفس تسلسل الحالات — أنشئ، أرفِق، وتابع من مكان واحد.'
              : 'List and board with the same status flow — create, attach, and follow up in one place.'}
          </p>
        </div>
        <div className="task-board__tools">
          <div className="task-board__views" role="group" aria-label={ar ? 'طريقة العرض' : 'View mode'}>
            <button
              type="button"
              className={view === 'list' ? 'is-active' : undefined}
              onClick={() => setView('list')}
            >
              {ar ? 'قائمة' : 'List'}
            </button>
            <button
              type="button"
              className={view === 'board' ? 'is-active' : undefined}
              onClick={() => setView('board')}
            >
              {ar ? 'لوحة' : 'Board'}
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? 'بحث بالمرجع أو العنوان أو الوسم' : 'Search reference, title or tag'}
            aria-label={ar ? 'بحث في المهام' : 'Search tasks'}
          />
          {canCreate ? (
            <button type="button" className="button button--primary" onClick={() => openCreate()}>
              {ar ? '+ مهمة جديدة' : '+ New task'}
            </button>
          ) : null}
        </div>
      </div>

      {tasks === null && !failed ? (
        <p className="task-board__empty">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : failed && tasks === null ? (
        <p className="task-board__empty">
          {ar ? 'تعذّر تحميل المهام.' : 'Could not load the tasks.'}{' '}
          <button type="button" className="ops-action" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : !shown.length && view === 'list' ? (
        <p className="task-board__empty">
          {needle ? (ar ? 'لا مهام مطابقة.' : 'No matching tasks.') : ar ? 'لا مهام بعد.' : 'No tasks yet.'}{' '}
          {canCreate && !needle ? (
            <button type="button" className="ops-action" onClick={() => openCreate()}>
              {ar ? 'أنشئ الأولى' : 'Create the first'}
            </button>
          ) : null}
        </p>
      ) : view === 'list' ? (
        <div className="task-board__groups">
          {listGroups.map((group) => (
            <section key={group.status} className="task-board__group">
              <header className="task-board__group-head">
                <span className={`task-status task-status--${group.status}`}>
                  {taskStatusLabel(group.status, locale)}
                </span>
                <em>{group.items.length}</em>
                {canCreate && TASK_BOARD_COLUMNS.includes(group.status as (typeof TASK_BOARD_COLUMNS)[number]) ? (
                  <button
                    type="button"
                    className="task-board__add"
                    onClick={() => openCreate(group.status)}
                  >
                    {ar ? '+ إضافة' : '+ Add'}
                  </button>
                ) : null}
              </header>
              <ul className="task-board__list">
                <li className="task-board__cols" aria-hidden="true">
                  <span>{ar ? 'الاسم' : 'Name'}</span>
                  <span>{ar ? 'المسؤول' : 'Assignee'}</span>
                  <span>{ar ? 'البدء / الاستحقاق' : 'Start / Due'}</span>
                  <span>{ar ? 'فرعية' : 'Subs'}</span>
                  <span>{ar ? 'الأولوية' : 'Priority'}</span>
                </li>
                {group.items.map((item) => (
                  <TaskRow key={item.id} item={item} portal={portal} locale={locale} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="task-board__kanban">
          {boardColumns.map((column) => (
            <section key={column.status} className="task-board__column">
              <header className="task-board__group-head">
                <span className={`task-status task-status--${column.status}`}>
                  {taskStatusLabel(column.status, locale)}
                </span>
                <em>{column.items.length}</em>
                {canCreate ? (
                  <button
                    type="button"
                    className="task-board__add"
                    onClick={() => openCreate(column.status)}
                  >
                    {ar ? '+' : '+'}
                  </button>
                ) : null}
              </header>
              <ul className="task-board__cards">
                {column.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/${portal}/tasks/${encodeURIComponent(item.id)}`}
                      className="task-board__card"
                      prefetch={false}
                    >
                      <span className={`task-priority-flag task-priority-flag--${item.priority}`} />
                      <strong>{item.title}</strong>
                      <small dir="ltr">{item.reference}</small>
                      {item.tags?.length ? (
                        <span className="task-board__tags">
                          {item.tags.slice(0, 3).map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      ) : null}
                      <span className="task-board__card-meta">
                        <span>{item.assigneeName || (ar ? 'بدون مسؤول' : 'Unassigned')}</span>
                        <span>
                          {item.dueAt?.slice(0, 10) || '—'}
                          {item.checklistTotal > 0
                            ? ` · ${item.checklistDone}/${item.checklistTotal}`
                            : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {!column.items.length ? (
                  <li className="task-board__card-empty">
                    {ar ? 'اسحب أو أنشئ هنا' : 'Add a task here'}
                  </li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      )}

      {creating ? (
        <div className="task-board__modal" role="dialog" aria-modal="true" aria-labelledby="task-create-title">
          <div className="task-board__modal-card">
            <header>
              <h3 id="task-create-title">{ar ? 'مهمة جديدة' : 'New task'}</h3>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </header>
            <div className="task-board__modal-grid">
              <label>
                <span>{ar ? 'العنوان' : 'Title'}</span>
                <input
                  value={draft.title}
                  autoFocus
                  maxLength={200}
                  onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label>
                <span>{ar ? 'الوصف' : 'Description'}</span>
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>{ar ? 'الحالة' : 'Status'}</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
                >
                  {TASK_BOARD_COLUMNS.map((status) => (
                    <option key={status} value={status}>
                      {taskStatusLabel(status, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{ar ? 'الأولوية' : 'Priority'}</span>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, priority: event.target.value }))
                  }
                >
                  {(['urgent', 'high', 'normal', 'low'] as const).map((priority) => (
                    <option key={priority} value={priority}>
                      {taskPriorityLabel(priority, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{ar ? 'تاريخ البدء' : 'Start date'}</span>
                <input
                  type="date"
                  value={draft.startsAt}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, startsAt: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>{ar ? 'تاريخ الاستحقاق' : 'Due date'}</span>
                <input
                  type="date"
                  value={draft.dueAt}
                  onChange={(event) => setDraft((prev) => ({ ...prev, dueAt: event.target.value }))}
                />
              </label>
              <label>
                <span>{ar ? 'الوسوم (مفصولة بفاصلة)' : 'Tags (comma separated)'}</span>
                <input
                  value={draft.tags}
                  placeholder={ar ? 'صيانة، تحصيل…' : 'maintenance, collection…'}
                  onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                />
              </label>
              <label>
                <span>{ar ? 'مهام فرعية (سطر لكل بند)' : 'Subtasks (one per line)'}</span>
                <textarea
                  rows={3}
                  value={draft.checklist}
                  placeholder={ar ? 'راجع العقود\nاتصل بالمستأجر' : 'Review lease\nCall tenant'}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, checklist: event.target.value }))
                  }
                />
              </label>
            </div>
            {message ? <p className="task-board__modal-msg">{message}</p> : null}
            <footer>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || draft.title.trim().length < 2}
                onClick={() => void submitCreate()}
              >
                {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'إنشاء المهمة' : 'Create task'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TaskRow({
  item,
  portal,
  locale,
}: {
  item: WorkTaskSummary;
  portal: PortalRole;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const start = item.startsAt?.slice(0, 10);
  const due = item.dueAt?.slice(0, 10);
  return (
    <li>
      <Link
        href={`/${portal}/tasks/${encodeURIComponent(item.id)}`}
        className="task-board__row"
        prefetch={false}
      >
        <span className="task-board__name">
          <i className={`task-priority-flag task-priority-flag--${item.priority}`} aria-hidden="true" />
          <i className={`task-status-dot task-status-dot--${item.status}`} aria-hidden="true" />
          <span>
            <strong>{item.title}</strong>
            <small dir="ltr">{item.reference}</small>
            {item.tags?.length ? (
              <span className="task-board__tags">
                {item.tags.slice(0, 4).map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
            ) : null}
          </span>
        </span>
        <span className="task-board__assignee">{item.assigneeName || '—'}</span>
        <span className="task-board__due">
          {start || due ? `${start || '—'} → ${due || '—'}` : '—'}
        </span>
        <span className="task-board__subs">
          {item.checklistTotal > 0
            ? `${item.checklistDone}/${item.checklistTotal}`
            : ar
              ? '—'
              : '—'}
        </span>
        <span className={`task-priority task-priority--${item.priority}`}>
          {taskPriorityLabel(item.priority, locale)}
        </span>
      </Link>
    </li>
  );
}
