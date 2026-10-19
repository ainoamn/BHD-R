'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { WorkTaskChoice, WorkTaskDetail, WorkTaskSummary } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';
import {
  TASK_BOARD_COLUMNS,
  TASK_STATUS_ORDER,
  taskPriorityLabel,
  taskStatusLabel,
} from '@/lib/work-task-ui';

type ViewMode = 'list' | 'board';
type ChipPanel = 'assignee' | 'due' | 'priority' | 'tags' | 'checklist' | 'place' | null;
type PlaceKind = 'party' | 'property' | 'unit';

type Person = { userId: string; name: string };

type Draft = {
  title: string;
  description: string;
  priority: string;
  status: string;
  dueAt: string;
  startsAt: string;
  tags: string;
  checklist: string;
  assignedToUserId: string;
  linkKind: PlaceKind;
  linkId: string;
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
  assignedToUserId: '',
  linkKind: 'property',
  linkId: '',
};

/** ClickUp/Bitrix-inspired list + board with one quick-create desk. */
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
  const [people, setPeople] = useState<Person[]>([]);
  const [parties, setParties] = useState<WorkTaskChoice[]>([]);
  const [properties, setProperties] = useState<WorkTaskChoice[]>([]);
  const [units, setUnits] = useState<WorkTaskChoice[]>([]);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [creating, setCreating] = useState(false);
  const [chip, setChip] = useState<ChipPanel>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/portal/tasks', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as {
        tasks: WorkTaskSummary[];
        people?: Person[];
        parties?: WorkTaskChoice[];
        properties?: WorkTaskChoice[];
        units?: WorkTaskChoice[];
        canCreate?: boolean;
      };
      setTasks(body.tasks);
      setPeople(body.people ?? []);
      setParties(body.parties ?? []);
      setProperties(body.properties ?? []);
      setUnits(body.units ?? []);
      setCanCreate(Boolean(body.canCreate));
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

  useEffect(() => {
    if (!active || !canCreate) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('create') === '1') {
        setDraft({ ...EMPTY_DRAFT });
        setChip(null);
        setMessage(null);
        setCreating(true);
        params.delete('create');
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
      }
    } catch {
      /* ignore */
    }
  }, [active, canCreate]);

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

  const listGroups = useMemo(() => {
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
    setChip(null);
    setMessage(null);
    setCreating(true);
  };

  const assigneeName =
    people.find((person) => person.userId === draft.assignedToUserId)?.name ?? null;
  const placeChoices =
    draft.linkKind === 'party' ? parties : draft.linkKind === 'property' ? properties : units;
  const placeLabel = placeChoices.find((item) => item.id === draft.linkId)?.label ?? null;
  const checklistCount = draft.checklist
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const tagCount = draft.tags
    .split(/[,،]/)
    .map((tag) => tag.trim())
    .filter(Boolean).length;

  const submitCreate = async (andOpen = true) => {
    const title = draft.title.trim();
    if (title.length < 2) {
      setMessage(ar ? 'اكتب اسم المهمة (حرفان على الأقل).' : 'Enter a task name (at least 2 characters).');
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
          assignedToUserId: draft.assignedToUserId || null,
          startsAt: draft.startsAt || null,
          dueAt: draft.dueAt || null,
          tags: tags.length ? tags : undefined,
          checklist: checklist.length ? checklist : undefined,
          ...(draft.linkId
            ? { linkKind: draft.linkKind, linkId: draft.linkId }
            : {}),
        }),
      });
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      await load();
      if (andOpen) router.push(`/${portal}/tasks/${encodeURIComponent(created.id)}`);
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

  const toggleChip = (next: ChipPanel) => setChip((current) => (current === next ? null : next));

  return (
    <section className="task-board" aria-label={ar ? 'المهام' : 'Tasks'}>
      <div className="task-board__toolbar task-board__toolbar--slim">
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
            <button type="button" className="task-board__create" onClick={() => openCreate()}>
              <span aria-hidden="true">+</span>
              {ar ? 'مهمة جديدة' : 'New task'}
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
        <div className="task-board__hero-empty">
          <h3>{needle ? (ar ? 'لا مهام مطابقة' : 'No matching tasks') : ar ? 'ابدأ أول مهمة' : 'Start your first task'}</h3>
          <p>
            {needle
              ? ar
                ? 'جرّب كلمة أخرى أو امسح البحث.'
                : 'Try another word or clear the search.'
              : ar
                ? 'عنوان واضح، مسؤول، موعد، ومرفقات — بنفس أسلوب أنظمة المتابعة العالمية.'
                : 'A clear title, owner, due date, and files — the same flow as world-class work desks.'}
          </p>
          {canCreate && !needle ? (
            <button type="button" className="task-board__create" onClick={() => openCreate()}>
              <span aria-hidden="true">+</span>
              {ar ? 'إنشاء مهمة' : 'Create a task'}
            </button>
          ) : null}
        </div>
      ) : view === 'list' ? (
        <div className="task-board__groups">
          {listGroups.map((group) => (
            <section key={group.status} className="task-board__group">
              <header className="task-board__group-head">
                <span className={`task-status task-status--${group.status}`}>
                  {taskStatusLabel(group.status, locale)}
                </span>
                <em>{group.items.length}</em>
                {canCreate &&
                TASK_BOARD_COLUMNS.includes(group.status as (typeof TASK_BOARD_COLUMNS)[number]) ? (
                  <button
                    type="button"
                    className="task-board__add"
                    onClick={() => openCreate(group.status)}
                  >
                    {ar ? '+ إضافة هنا' : '+ Add here'}
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
                    +
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
                    {ar ? 'أضف مهمة لهذه الحالة' : 'Add a task to this status'}
                  </li>
                ) : null}
              </ul>
            </section>
          ))}
        </div>
      )}

      {creating ? (
        <div
          className="task-quick"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-quick-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setCreating(false);
          }}
        >
          <div className="task-quick__card" dir={ar ? 'rtl' : 'ltr'}>
            <header className="task-quick__head">
              <div>
                <p className="task-quick__eyebrow" id="task-quick-title">
                  {ar ? 'مهمة' : 'Task'}
                </p>
                <p className="task-quick__list">
                  {ar ? 'مساحة العمل · ' : 'Workspace · '}
                  {taskStatusLabel(draft.status, locale)}
                </p>
              </div>
              <button
                type="button"
                className="task-quick__close"
                aria-label={ar ? 'إغلاق' : 'Close'}
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                ×
              </button>
            </header>

            <input
              className="task-quick__title"
              value={draft.title}
              autoFocus
              maxLength={200}
              placeholder={ar ? 'اسم المهمة…' : 'Task name…'}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitCreate(true);
                }
              }}
            />
            <textarea
              className="task-quick__desc"
              rows={3}
              maxLength={4000}
              value={draft.description}
              placeholder={ar ? 'الوصف (اختياري)…' : 'Description (optional)…'}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
            />

            <div className="task-quick__chips" role="toolbar" aria-label={ar ? 'خصائص المهمة' : 'Task details'}>
              <button
                type="button"
                className={chip === 'assignee' || draft.assignedToUserId ? 'is-on' : undefined}
                onClick={() => toggleChip('assignee')}
              >
                <i className="task-quick__mark task-quick__mark--person" aria-hidden="true" />
                {assigneeName || (ar ? 'المسؤول' : 'Assignee')}
              </button>
              <button
                type="button"
                className={chip === 'due' || draft.dueAt || draft.startsAt ? 'is-on' : undefined}
                onClick={() => toggleChip('due')}
              >
                <i className="task-quick__mark task-quick__mark--date" aria-hidden="true" />
                {draft.dueAt || (ar ? 'الموعد' : 'Due date')}
              </button>
              <button
                type="button"
                className={chip === 'priority' || draft.priority !== 'normal' ? 'is-on' : undefined}
                onClick={() => toggleChip('priority')}
              >
                <span className={`task-priority-flag task-priority-flag--${draft.priority}`} />
                {taskPriorityLabel(draft.priority, locale)}
              </button>
              <button
                type="button"
                className={chip === 'tags' || tagCount > 0 ? 'is-on' : undefined}
                onClick={() => toggleChip('tags')}
              >
                <i className="task-quick__mark task-quick__mark--tag" aria-hidden="true" />
                {tagCount > 0
                  ? ar
                    ? `${tagCount} وسم`
                    : `${tagCount} tags`
                  : ar
                    ? 'الوسوم'
                    : 'Tags'}
              </button>
              <button
                type="button"
                className={chip === 'checklist' || checklistCount > 0 ? 'is-on' : undefined}
                onClick={() => toggleChip('checklist')}
              >
                <i className="task-quick__mark task-quick__mark--check" aria-hidden="true" />
                {checklistCount > 0
                  ? ar
                    ? `${checklistCount} فرعية`
                    : `${checklistCount} subtasks`
                  : ar
                    ? 'قائمة تحقق'
                    : 'Checklist'}
              </button>
              <button
                type="button"
                className={chip === 'place' || draft.linkId ? 'is-on' : undefined}
                onClick={() => toggleChip('place')}
              >
                <i className="task-quick__mark task-quick__mark--place" aria-hidden="true" />
                {placeLabel ||
                  (ar
                    ? draft.linkKind === 'party'
                      ? 'مستأجر'
                      : draft.linkKind === 'unit'
                        ? 'وحدة'
                        : 'عقار'
                    : draft.linkKind === 'party'
                      ? 'Tenant'
                      : draft.linkKind === 'unit'
                        ? 'Unit'
                        : 'Property')}
              </button>
            </div>

            {chip === 'assignee' ? (
              <div className="task-quick__panel">
                <label>
                  <span>{ar ? 'اختر المسؤول' : 'Choose assignee'}</span>
                  <select
                    value={draft.assignedToUserId}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, assignedToUserId: event.target.value }))
                    }
                  >
                    <option value="">{ar ? 'بدون مسؤول' : 'Unassigned'}</option>
                    {people.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {chip === 'due' ? (
              <div className="task-quick__panel task-quick__panel--dates">
                <label>
                  <span>{ar ? 'البدء' : 'Start'}</span>
                  <input
                    type="date"
                    value={draft.startsAt}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, startsAt: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <span>{ar ? 'الاستحقاق' : 'Due'}</span>
                  <input
                    type="date"
                    value={draft.dueAt}
                    onChange={(event) => setDraft((prev) => ({ ...prev, dueAt: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {chip === 'priority' ? (
              <div className="task-quick__panel task-quick__priorities">
                {(['urgent', 'high', 'normal', 'low'] as const).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    className={draft.priority === priority ? 'is-active' : undefined}
                    onClick={() => {
                      setDraft((prev) => ({ ...prev, priority }));
                      setChip(null);
                    }}
                  >
                    <span className={`task-priority-flag task-priority-flag--${priority}`} />
                    {taskPriorityLabel(priority, locale)}
                  </button>
                ))}
              </div>
            ) : null}

            {chip === 'tags' ? (
              <div className="task-quick__panel">
                <label>
                  <span>{ar ? 'وسوم مفصولة بفاصلة' : 'Comma-separated tags'}</span>
                  <input
                    value={draft.tags}
                    placeholder={ar ? 'صيانة، تحصيل…' : 'maintenance, collection…'}
                    onChange={(event) => setDraft((prev) => ({ ...prev, tags: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {chip === 'checklist' ? (
              <div className="task-quick__panel">
                <label>
                  <span>{ar ? 'مهمة فرعية في كل سطر' : 'One subtask per line'}</span>
                  <textarea
                    rows={4}
                    value={draft.checklist}
                    placeholder={ar ? 'راجع العقود\nاتصل بالمستأجر' : 'Review lease\nCall tenant'}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, checklist: event.target.value }))
                    }
                  />
                </label>
              </div>
            ) : null}

            {chip === 'place' ? (
              <div className="task-quick__panel task-quick__panel--dates">
                <label>
                  <span>{ar ? 'النوع' : 'Type'}</span>
                  <select
                    value={draft.linkKind}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        linkKind: event.target.value as PlaceKind,
                        linkId: '',
                      }))
                    }
                  >
                    <option value="property">{ar ? 'عقار / مبنى' : 'Property / building'}</option>
                    <option value="party">{ar ? 'مستأجر / طرف' : 'Tenant / party'}</option>
                    <option value="unit">{ar ? 'وحدة' : 'Unit'}</option>
                  </select>
                </label>
                <label>
                  <span>{ar ? 'الاسم' : 'Name'}</span>
                  <select
                    value={draft.linkId}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, linkId: event.target.value }))
                    }
                  >
                    <option value="">{ar ? 'بدون ربط' : 'No link'}</option>
                    {placeChoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {message ? <p className="task-quick__msg">{message}</p> : null}

            <footer className="task-quick__foot">
              <button
                type="button"
                className="task-quick__ghost"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                className="task-quick__submit"
                disabled={busy || draft.title.trim().length < 2}
                onClick={() => void submitCreate(true)}
              >
                {busy ? (ar ? 'جارٍ الإنشاء…' : 'Creating…') : ar ? 'إنشاء' : 'Create'}
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
          {item.checklistTotal > 0 ? `${item.checklistDone}/${item.checklistTotal}` : '—'}
        </span>
        <span className={`task-priority task-priority--${item.priority}`}>
          {taskPriorityLabel(item.priority, locale)}
        </span>
      </Link>
    </li>
  );
}
