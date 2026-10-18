'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import type { WorkTaskSummary } from '@/lib/work-task-shared';
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

const PRIORITY: Record<string, [string, string]> = {
  low: ['منخفضة', 'Low'],
  normal: ['عادية', 'Normal'],
  high: ['عالية', 'High'],
  urgent: ['عاجلة', 'Urgent'],
};

/** Task cards that open the task workspace. */
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
  const shown = (tasks ?? []).filter(
    (item) =>
      !needle ||
      [item.reference, item.title, item.assigneeName, item.category]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
  );

  return (
    <section className="legal-board" aria-label={ar ? 'المهام' : 'Tasks'}>
      <div className="legal-board__tools">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ar ? 'بحث بالمرجع أو العنوان أو المسؤول' : 'Search reference, title or owner'}
          aria-label={ar ? 'بحث في المهام' : 'Search tasks'}
        />
      </div>
      {tasks === null && !failed ? (
        <p className="legal-board__empty">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
      ) : failed && tasks === null ? (
        <p className="legal-board__empty">
          {ar ? 'تعذّر تحميل المهام.' : 'Could not load the tasks.'}{' '}
          <button type="button" className="ops-action" onClick={() => void load()}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </p>
      ) : !shown.length ? (
        <p className="legal-board__empty">
          {needle ? (ar ? 'لا مهام مطابقة.' : 'No matching tasks.') : ar ? 'لا مهام بعد.' : 'No tasks yet.'}
        </p>
      ) : (
        <ul className="legal-board__list">
          {shown.map((item) => {
            const status = STATUS[item.status] ?? [item.status, item.status];
            const priority = PRIORITY[item.priority] ?? [item.priority, item.priority];
            const due = item.dueAt ? item.dueAt.slice(0, 10) : null;
            return (
              <li key={item.id}>
                <Link
                  href={`/${portal}/tasks/${encodeURIComponent(item.id)}`}
                  className="legal-card"
                  prefetch={false}
                >
                  <span className="legal-card__head">
                    <strong dir="ltr">{item.reference}</strong>
                    <span className={`legal-stage legal-stage--${item.status}`}>
                      {ar ? status[0] : status[1]}
                    </span>
                  </span>
                  <span className="legal-card__title">{item.title}</span>
                  <span className="legal-card__meta">
                    {[
                      item.assigneeName ? `${ar ? 'المسؤول:' : 'Owner:'} ${item.assigneeName}` : null,
                      `${ar ? 'الأولوية:' : 'Priority:'} ${ar ? priority[0] : priority[1]}`,
                      due ? `${ar ? 'الاستحقاق:' : 'Due:'} ${due}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
