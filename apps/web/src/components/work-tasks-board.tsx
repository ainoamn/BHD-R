'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { WorkTaskSummary } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';
import {
  TASK_STATUS_ORDER,
  taskPriorityLabel,
  taskStatusLabel,
} from '@/lib/work-task-ui';

/** ClickUp-style list: tasks grouped under colored status headers. */
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
  const [tasks, setTasks] = useState<WorkTaskSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

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
          [item.reference, item.title, item.assigneeName, item.category]
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

  return (
    <section className="task-board" aria-label={ar ? 'المهام' : 'Tasks'}>
      <div className="task-board__toolbar">
        <div>
          <h2>{ar ? 'قائمة المهام' : 'Task list'}</h2>
          <p>
            {ar
              ? 'مجمّعة حسب الحالة الملونة — افتح أي تذكرة للمتابعة والرد.'
              : 'Grouped by colored status — open any ticket to follow up and reply.'}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ar ? 'بحث بالمرجع أو العنوان أو المسؤول' : 'Search reference, title or owner'}
          aria-label={ar ? 'بحث في المهام' : 'Search tasks'}
        />
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
      ) : !shown.length ? (
        <p className="task-board__empty">
          {needle ? (ar ? 'لا مهام مطابقة.' : 'No matching tasks.') : ar ? 'لا مهام بعد.' : 'No tasks yet.'}
        </p>
      ) : (
        <div className="task-board__groups">
          {groups.map((group) => (
            <section key={group.status} className="task-board__group">
              <header className="task-board__group-head">
                <span className={`task-status task-status--${group.status}`}>
                  {taskStatusLabel(group.status, locale)}
                </span>
                <em>{group.items.length}</em>
              </header>
              <ul className="task-board__list">
                <li className="task-board__cols" aria-hidden="true">
                  <span>{ar ? 'الاسم' : 'Name'}</span>
                  <span>{ar ? 'المسؤول' : 'Assignee'}</span>
                  <span>{ar ? 'الاستحقاق' : 'Due'}</span>
                  <span>{ar ? 'الأولوية' : 'Priority'}</span>
                </li>
                {group.items.map((item) => {
                  const due = item.dueAt ? item.dueAt.slice(0, 10) : null;
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/${portal}/tasks/${encodeURIComponent(item.id)}`}
                        className="task-board__row"
                        prefetch={false}
                      >
                        <span className="task-board__name">
                          <i className={`task-status-dot task-status-dot--${item.status}`} aria-hidden="true" />
                          <span>
                            <strong>{item.title}</strong>
                            <small dir="ltr">{item.reference}</small>
                          </span>
                        </span>
                        <span className="task-board__assignee">
                          {item.assigneeName || (ar ? '—' : '—')}
                        </span>
                        <span className="task-board__due">{due || '—'}</span>
                        <span className={`task-priority task-priority--${item.priority}`}>
                          {taskPriorityLabel(item.priority, locale)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
