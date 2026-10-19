'use client';

import { useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { browserNextMutation, ApiError } from '@/lib/api';
import { NoteTranslateBar, TranslatableNote } from '@/components/note-translate';
import type { WorkTaskDetail } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';
import {
  taskDay,
  taskNeedsReason,
  taskPriorityLabel,
  taskStatusLabel,
} from '@/lib/work-task-ui';

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
  'task.file': ['مرفق', 'File'],
  'task.tags': ['تحديث الوسوم', 'Tags updated'],
  'task.dates': ['تحديث التواريخ', 'Dates updated'],
  'task.priority': ['تحديث الأولوية', 'Priority updated'],
  'task.reopen': ['إعادة فتح / متابعة', 'Reopened / follow-up'],
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

/** ClickUp-style workspace: colored status, activity with who/when, reason on close/reject. */
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
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [reply, setReply] = useState('');
  const [replyFiles, setReplyFiles] = useState<Array<{ name: string; data: string }>>([]);
  const [assignTo, setAssignTo] = useState(detail.assigneeId ?? '');
  const [lawyerId, setLawyerId] = useState(detail.lawyers[0]?.id ?? '');
  const [legalNote, setLegalNote] = useState('');
  const [memberId, setMemberId] = useState('');
  const [memberDuty, setMemberDuty] = useState<'lead' | 'executor' | 'supervisor' | 'viewer'>('viewer');
  const [subjectKind, setSubjectKind] = useState<'party' | 'property' | 'unit'>(detail.subject?.kind ?? 'party');
  const [subjectId, setSubjectId] = useState(detail.subject?.id ?? '');
  const [subjectPropertyId, setSubjectPropertyId] = useState(
    detail.place.property?.id ??
      detail.units.find((item) => item.id === detail.subject?.id)?.propertyId ??
      '',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState((initial.tags ?? []).join(', '));
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [startsDraft, setStartsDraft] = useState(taskDay(initial.startsAt));
  const [dueDraft, setDueDraft] = useState(taskDay(initial.dueAt));
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const closed = detail.status === 'completed' || detail.status === 'cancelled' || detail.status === 'rejected';
  const base = `/api/portal/tasks/${encodeURIComponent(detail.id)}`;
  const steps = NEXT[detail.status] ?? [];
  const due = detail.dueAt ? detail.dueAt.slice(0, 10) : null;
  const starts = detail.startsAt ? detail.startsAt.slice(0, 10) : null;

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
      setTagDraft((next.tags ?? []).join(', '));
      setStartsDraft(taskDay(next.startsAt));
      setDueDraft(taskDay(next.dueAt));
      setMessage(ok);
      if (path.endsWith('/reply')) {
        setReply('');
        setReplyFiles([]);
      }
      if (path.endsWith('/legal')) setLegalNote('');
      setPendingStatus(null);
      setStatusReason('');
      setSubtaskDraft('');
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      if (code === 'reason_required') {
        setMessage(
          ar
            ? 'اكتب سبب الرفض أو الإغلاق أو الإلغاء (خمسة أحرف على الأقل).'
            : 'Write a reason for reject, close, or cancel (at least 5 characters).',
        );
      } else {
        setMessage(ar ? 'تعذر حفظ الإجراء' : 'Could not save that action');
      }
    } finally {
      setBusy(false);
    }
  };

  const requestStatus = (status: string, label: string) => {
    if (taskNeedsReason(status)) {
      setPendingStatus(status);
      setStatusReason('');
      setMessage(null);
      return;
    }
    void run(base, { status }, label);
  };

  const confirmStatus = () => {
    if (!pendingStatus) return;
    if (statusReason.trim().length < 5) {
      setMessage(
        ar
          ? 'اكتب سبب الرفض أو الإغلاق أو الإلغاء (خمسة أحرف على الأقل).'
          : 'Write a reason for reject, close, or cancel (at least 5 characters).',
      );
      return;
    }
    void run(
      base,
      { status: pendingStatus, note: statusReason.trim() },
      ar
        ? `الحالة: ${taskStatusLabel(pendingStatus, 'ar')}`
        : `Status: ${taskStatusLabel(pendingStatus, 'en')}`,
    );
  };

  const reopenAsNew = async () => {
    const note = reopenReason.trim();
    if (note.length < 5) {
      setMessage(
        ar
          ? 'اكتب سبب إعادة الفتح والشرح (خمسة أحرف على الأقل).'
          : 'Write why you are reopening (at least 5 characters).',
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await browserNextMutation<WorkTaskDetail>(`${base}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      setReopenOpen(false);
      setReopenReason('');
      setMessage(ar ? `فُتحت متابعة ${next.reference}` : `Opened follow-up ${next.reference}`);
      router.push(`/${portal}/tasks/${encodeURIComponent(next.id)}`);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      setMessage(
        code === 'forbidden'
          ? ar
            ? 'ليست لديك صلاحية إنشاء مهمة جديدة.'
            : 'You do not have permission to create a new task.'
          : code === 'reason_required'
            ? ar
              ? 'اكتب سبب إعادة الفتح والشرح (خمسة أحرف على الأقل).'
              : 'Write why you are reopening (at least 5 characters).'
            : code === 'followup_open'
              ? ar
                ? 'توجد متابعة مفتوحة مرتبطة — أغلقها أولاً ثم أعد المحاولة.'
                : 'An open linked follow-up already exists — close it first, then try again.'
              : ar
                ? 'تعذر فتح متابعة جديدة. المهمة المغلقة تبقى كما هي.'
                : 'Could not open a follow-up. The closed task stays closed.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="task-desk" dir={ar ? 'rtl' : 'ltr'} data-status={detail.status}>
      <header className="task-desk__top">
        <Link href={`/${portal}/tasks`} className="task-desk__back" prefetch={false}>
          {ar ? '← المهام' : '← Tasks'}
        </Link>
        <div className="task-desk__title-block">
          <p className="task-desk__ref" dir="ltr">
            {detail.reference}
          </p>
          <h1>{detail.title}</h1>
          <TranslatableNote text={detail.title} locale={locale} />
        </div>
        <div className="task-desk__top-actions">
          <a
            className="button button--quiet"
            href={`/${locale}/${portal}/tasks/${encodeURIComponent(detail.id)}/print`}
            target="_blank"
            rel="noreferrer"
          >
            {ar ? 'طباعة' : 'Print'}
          </a>
          <span className={`task-status task-status--${detail.status}`}>
            {taskStatusLabel(detail.status, locale)}
          </span>
        </div>
      </header>

      <div className="task-desk__meta">
        <div className="task-desk__meta-item">
          <span className="task-desk__meta-label">{ar ? 'المسؤول' : 'Assignee'}</span>
          <strong>{detail.assigneeName || '—'}</strong>
        </div>
        <div className="task-desk__meta-item">
          <span className="task-desk__meta-label">{ar ? 'البدء' : 'Start'}</span>
          <strong>{starts || (ar ? 'بدون تاريخ' : 'No date')}</strong>
        </div>
        <div className="task-desk__meta-item">
          <span className="task-desk__meta-label">{ar ? 'الاستحقاق' : 'Due'}</span>
          <strong>{due || (ar ? 'بدون تاريخ' : 'No date')}</strong>
        </div>
        <div className="task-desk__meta-item">
          <span className="task-desk__meta-label">{ar ? 'الأولوية' : 'Priority'}</span>
          <strong className={`task-priority task-priority--${detail.priority}`}>
            <i className={`task-priority-flag task-priority-flag--${detail.priority}`} aria-hidden="true" />{' '}
            {taskPriorityLabel(detail.priority, locale)}
          </strong>
        </div>
        <div className="task-desk__meta-item">
          <span className="task-desk__meta-label">{ar ? 'التصنيف' : 'Category'}</span>
          <strong>{detail.category || '—'}</strong>
        </div>
      </div>

      {(detail.tags?.length || detail.canUpdate) && !closed ? (
        <div className="task-desk__tags">
          {detail.tags?.length ? (
            <span className="task-board__tags">
              {detail.tags.map((tag) => (
                <em key={tag}>{tag}</em>
              ))}
            </span>
          ) : (
            <span className="task-desk__muted">{ar ? 'لا وسوم بعد' : 'No tags yet'}</span>
          )}
        </div>
      ) : detail.tags?.length ? (
        <div className="task-desk__tags">
          <span className="task-board__tags">
            {detail.tags.map((tag) => (
              <em key={tag}>{tag}</em>
            ))}
          </span>
        </div>
      ) : null}

      {(detail.place.property || detail.place.unit || detail.place.party || detail.related?.length) && (
        <div className="task-desk__links">
          {detail.place.property ? (
            <Link href={`/${portal}/properties/${encodeURIComponent(detail.place.property.id)}`}>
              {ar ? `المبنى: ${detail.place.property.label}` : `Building: ${detail.place.property.label}`}
            </Link>
          ) : null}
          {detail.place.unit ? (
            <span>{ar ? `الوحدة: ${detail.place.unit.label}` : `Unit: ${detail.place.unit.label}`}</span>
          ) : null}
          {detail.place.party ? (
            <Link href={`/${portal}/contacts/${encodeURIComponent(detail.place.party.id)}`}>
              {ar ? `المستأجر / الطرف: ${detail.place.party.label}` : `Tenant / party: ${detail.place.party.label}`}
            </Link>
          ) : null}
          {(detail.related ?? []).map((row) => (
            <Link
              key={row.id}
              href={`/${portal}/tasks/${encodeURIComponent(row.id)}`}
              className="task-desk__chain-link"
              prefetch={false}
            >
              {row.relation === 'previous'
                ? ar
                  ? `المهمة السابقة: ${row.reference}`
                  : `Previous: ${row.reference}`
                : ar
                  ? `المتابعة: ${row.reference}`
                  : `Follow-up: ${row.reference}`}
            </Link>
          ))}
        </div>
      )}

      <div className="task-desk__grid">
        <div className="task-desk__main">
          <section className="task-desk__card">
            <h2>{ar ? 'الوصف' : 'Description'}</h2>
            <p className="task-desk__body">
              {detail.description?.trim() || (ar ? 'لا يوجد وصف.' : 'No description.')}
            </p>
            {detail.description?.trim() ? (
              <TranslatableNote text={detail.description} locale={locale} />
            ) : null}
          </section>

          {detail.followers.length ? (
            <section className="task-desk__card">
              <h2>{ar ? 'الفريق' : 'Team'}</h2>
              <ul className="task-desk__roster">
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
            </section>
          ) : null}

          <section className="task-desk__card">
            <h2>
              {ar ? 'المهام الفرعية' : 'Subtasks'}{' '}
              <small>
                {detail.checklist.filter((item) => item.done).length}/{detail.checklist.length}
              </small>
            </h2>
            {detail.checklist.length ? (
              <ul className="task-desk__checks">
                {detail.checklist.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={busy || !detail.canUpdate || closed}
                        onChange={(event) =>
                          void run(
                            base,
                            { checklistIndex: index, checklistDone: event.target.checked },
                            ar ? 'حُفظت القائمة' : 'Checklist saved',
                          )
                        }
                      />
                      <span className={item.done ? 'is-done' : undefined}>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="task-desk__muted">
                {ar ? 'لا مهام فرعية بعد.' : 'No subtasks yet.'}
              </p>
            )}
            {detail.canUpdate && !closed ? (
              <form
                className="task-desk__inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  const label = subtaskDraft.trim();
                  if (!label) return;
                  void run(base, { checklistAdd: label }, ar ? 'أُضيفت مهمة فرعية' : 'Subtask added');
                }}
              >
                <input
                  value={subtaskDraft}
                  maxLength={200}
                  placeholder={ar ? 'أضف مهمة فرعية…' : 'Add a subtask…'}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                />
                <button className="button button--quiet" type="submit" disabled={busy || !subtaskDraft.trim()}>
                  {ar ? 'إضافة' : 'Add'}
                </button>
              </form>
            ) : null}
          </section>

          {detail.canUpdate && !closed ? (
            <section className="task-desk__card">
              <h2>{ar ? 'التواريخ والأولوية والوسوم' : 'Dates, priority & tags'}</h2>
              <form
                className="task-desk__more-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    base,
                    {
                      startsAt: startsDraft || null,
                      dueAt: dueDraft || null,
                    },
                    ar ? 'حُفظت التواريخ' : 'Dates saved',
                  );
                }}
              >
                <label className="task-desk__stack">
                  <span>{ar ? 'تاريخ البدء' : 'Start date'}</span>
                  <input
                    type="date"
                    value={startsDraft}
                    onChange={(event) => setStartsDraft(event.target.value)}
                  />
                </label>
                <label className="task-desk__stack">
                  <span>{ar ? 'تاريخ الاستحقاق' : 'Due date'}</span>
                  <input
                    type="date"
                    value={dueDraft}
                    onChange={(event) => setDueDraft(event.target.value)}
                  />
                </label>
                <button className="button button--quiet" type="submit" disabled={busy}>
                  {ar ? 'حفظ التواريخ' : 'Save dates'}
                </button>
              </form>
              <label className="task-desk__stack">
                <span>{ar ? 'الأولوية' : 'Priority'}</span>
                <select
                  value={detail.priority}
                  disabled={busy}
                  onChange={(event) =>
                    void run(
                      base,
                      { priority: event.target.value },
                      ar ? 'حُفظت الأولوية' : 'Priority saved',
                    )
                  }
                >
                  {(['urgent', 'high', 'normal', 'low'] as const).map((priority) => (
                    <option key={priority} value={priority}>
                      {taskPriorityLabel(priority, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <form
                className="task-desk__inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  const tags = tagDraft
                    .split(/[,،]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                    .slice(0, 12);
                  void run(base, { tags }, ar ? 'حُفظت الوسوم' : 'Tags saved');
                }}
              >
                <input
                  value={tagDraft}
                  maxLength={240}
                  placeholder={ar ? 'وسوم مفصولة بفاصلة' : 'Comma-separated tags'}
                  onChange={(event) => setTagDraft(event.target.value)}
                />
                <button className="button button--quiet" type="submit" disabled={busy}>
                  {ar ? 'حفظ الوسوم' : 'Save tags'}
                </button>
              </form>
            </section>
          ) : null}

          {detail.files.length || (detail.canUpdate && !closed) ? (
            <section className="task-desk__card">
              <h2>{ar ? 'المرفقات' : 'Files'}</h2>
              {detail.files.length ? (
                <ul className="task-desk__checks">
                  {detail.files.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/portal/tasks/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(file.id)}`}
                      >
                        {file.name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="task-desk__muted">{ar ? 'لا مرفقات.' : 'No files.'}</p>
              )}
              {detail.canUpdate && !closed ? (
                <label className="task-desk__stack">
                  <span>{ar ? 'إرفاق ملف' : 'Attach a file'}</span>
                  <input
                    type="file"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      if (file.size > 700_000) {
                        setMessage(
                          ar ? 'الملف أكبر من المسموح (حوالي ٧٠٠ ك.ب).' : 'The file is larger than about 700 KB.',
                        );
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const data = typeof reader.result === 'string' ? reader.result : '';
                        void run(
                          `${base}/files`,
                          { name: file.name, data },
                          ar ? 'أُرفق الملف' : 'File attached',
                        );
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              ) : null}
            </section>
          ) : null}

          {(detail.related ?? []).length ? (
            <section className="task-desk__card">
              <h2>{ar ? 'سلسلة المتابعة' : 'Follow-up chain'}</h2>
              <ul className="task-desk__chain">
                {(detail.related ?? []).map((row) => (
                  <li key={row.id}>
                    <Link href={`/${portal}/tasks/${encodeURIComponent(row.id)}`} prefetch={false}>
                      <strong dir="ltr">{row.reference}</strong>
                      <span>{row.title}</span>
                      <em className={`task-status task-status--sm task-status--${row.status}`}>
                        {taskStatusLabel(row.status, locale)}
                      </em>
                      <small>
                        {row.relation === 'previous'
                          ? ar
                            ? 'مهمة سابقة'
                            : 'Previous task'
                          : ar
                            ? 'مهمة متابعة'
                            : 'Follow-up task'}
                      </small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {(() => {
            const placeLocked = Boolean(
              detail.place.property || detail.place.unit || detail.place.party || detail.subject,
            );
            if (placeLocked) {
              return (
                <section className="task-desk__card">
                  <h2>{ar ? 'الربط (ثابت)' : 'Link (locked)'}</h2>
                  <p className="task-desk__muted">
                    {ar
                      ? 'هذه المهمة مربوطة ولا يمكن تغيير العقار أو المستأجر أو الوحدة بعد الربط.'
                      : 'This task is linked. Building, tenant, or unit cannot be changed after linking.'}
                  </p>
                  <ul className="task-desk__checks">
                    {detail.place.property ? (
                      <li>
                        {ar ? 'المبنى' : 'Building'}: {detail.place.property.label}
                      </li>
                    ) : null}
                    {detail.place.unit ? (
                      <li>
                        {ar ? 'الوحدة' : 'Unit'}: {detail.place.unit.label}
                      </li>
                    ) : null}
                    {detail.place.party ? (
                      <li>
                        {ar ? 'المستأجر / الطرف' : 'Tenant / party'}: {detail.place.party.label}
                      </li>
                    ) : null}
                  </ul>
                </section>
              );
            }
            if (closed || !detail.canUpdate) return null;
            return (
              <section className="task-desk__card">
                <h2>{ar ? 'ربط بعقار / مستأجر / وحدة' : 'Link to building / tenant / unit'}</h2>
                <form
                  className="task-desk__stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!subjectId) return;
                    if (subjectKind === 'unit' && !subjectPropertyId) {
                      setMessage(
                        ar
                          ? 'اختر رقم العقار الأصلي أولاً ثم الوحدة.'
                          : 'Choose the parent property first, then the unit.',
                      );
                      return;
                    }
                    void run(
                      `${base}/link`,
                      {
                        kind: subjectKind,
                        id: subjectId,
                        ...(subjectKind === 'unit' && subjectPropertyId
                          ? { propertyId: subjectPropertyId }
                          : {}),
                      },
                      ar ? 'رُبطت المهمة' : 'Task linked',
                    );
                  }}
                >
                  <label>
                    <span>{ar ? 'النوع' : 'Type'}</span>
                    <select
                      value={subjectKind}
                      disabled={busy}
                      onChange={(event) => {
                        setSubjectKind(event.target.value as typeof subjectKind);
                        setSubjectId('');
                        setSubjectPropertyId('');
                      }}
                    >
                      <option value="party">{ar ? 'مستأجر / شخص' : 'Tenant / person'}</option>
                      <option value="property">{ar ? 'مبنى' : 'Building'}</option>
                      <option value="unit">{ar ? 'وحدة' : 'Unit'}</option>
                    </select>
                  </label>
                  {subjectKind === 'unit' ? (
                    <label>
                      <span>{ar ? 'رقم العقار الأصلي' : 'Parent property'}</span>
                      <select
                        value={subjectPropertyId}
                        disabled={busy}
                        onChange={(event) => {
                          setSubjectPropertyId(event.target.value);
                          setSubjectId('');
                        }}
                      >
                        <option value="">{ar ? 'اختر العقار أولاً' : 'Choose property first'}</option>
                        {detail.properties.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    <span>
                      {subjectKind === 'unit'
                        ? ar
                          ? 'الوحدة'
                          : 'Unit'
                        : ar
                          ? 'الاسم'
                          : 'Name'}
                    </span>
                    <select
                      value={subjectId}
                      disabled={busy || (subjectKind === 'unit' && !subjectPropertyId)}
                      onChange={(event) => setSubjectId(event.target.value)}
                    >
                      <option value="">
                        {subjectKind === 'unit' && !subjectPropertyId
                          ? ar
                            ? 'اختر العقار أولاً'
                            : 'Choose property first'
                          : ar
                            ? 'اختر'
                            : 'Choose'}
                      </option>
                      {(subjectKind === 'party'
                        ? detail.parties
                        : subjectKind === 'property'
                          ? detail.properties
                          : detail.units.filter(
                              (item) =>
                                !subjectPropertyId || item.propertyId === subjectPropertyId,
                            )
                      ).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {subjectKind === 'unit' ? (
                    <p className="task-desk__muted">
                      {ar
                        ? 'تظهر المهمة على صفحة العقار وصفحة الوحدة معاً.'
                        : 'The task will appear on both the property and unit pages.'}
                    </p>
                  ) : null}
                  <button
                    className="button button--quiet"
                    type="submit"
                    disabled={
                      busy ||
                      !subjectId ||
                      (subjectKind === 'unit' && !subjectPropertyId)
                    }
                  >
                    {ar ? 'حفظ الربط' : 'Save link'}
                  </button>
                </form>
              </section>
            );
          })()}

          <section className="task-desk__card task-desk__card--actions">
            <h2>{closed ? (ar ? 'المهمة مغلقة' : 'Task closed') : ar ? 'تغيير الحالة' : 'Change status'}</h2>
            {detail.canUpdate && !closed ? (
              <>
                <div className="task-desk__actions">
                  {steps.map((action) => (
                    <button
                      key={action.status}
                      type="button"
                      className={`task-status-btn task-status-btn--${action.status}`}
                      disabled={busy}
                      onClick={() =>
                        requestStatus(
                          action.status,
                          ar ? `الحالة: ${action.ar}` : `Status: ${action.en}`,
                        )
                      }
                    >
                      {ar ? action.ar : action.en}
                    </button>
                  ))}
                  {!steps.some((action) => action.status === 'completed') ? (
                    <button
                      type="button"
                      className="task-status-btn task-status-btn--completed"
                      disabled={busy}
                      onClick={() =>
                        requestStatus('completed', ar ? 'أُغلقت المهمة' : 'Task closed')
                      }
                    >
                      {ar ? 'إغلاق المهمة' : 'Close task'}
                    </button>
                  ) : null}
                </div>
                {pendingStatus ? (
                  <div className="task-desk__reason">
                    <p>
                      {ar
                        ? `سبب «${taskStatusLabel(pendingStatus, 'ar')}» مطلوب قبل الحفظ:`
                        : `A reason for “${taskStatusLabel(pendingStatus, 'en')}” is required:`}
                    </p>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={statusReason}
                      placeholder={
                        ar
                          ? 'اكتب سبب الرفض أو الإغلاق أو الإلغاء…'
                          : 'Write why you are rejecting, closing, or cancelling…'
                      }
                      onChange={(event) => setStatusReason(event.target.value)}
                    />
                    <NoteTranslateBar
                      value={statusReason}
                      onChange={setStatusReason}
                      locale={locale}
                      max={2000}
                      disabled={busy}
                    />
                    <div className="task-desk__reason-actions">
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={busy}
                        onClick={() => {
                          setPendingStatus(null);
                          setStatusReason('');
                        }}
                      >
                        {ar ? 'إلغاء' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={busy || statusReason.trim().length < 5}
                        onClick={confirmStatus}
                      >
                        {ar ? 'تأكيد التغيير' : 'Confirm change'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : closed ? (
              <div className="task-desk__reopen">
                {(() => {
                  const openFollowUps = (detail.related ?? []).filter(
                    (row) =>
                      row.relation === 'next' &&
                      row.status !== 'completed' &&
                      row.status !== 'cancelled' &&
                      row.status !== 'rejected',
                  );
                  const openFollowUp = openFollowUps[0] ?? null;
                  if (openFollowUp) {
                    return (
                      <>
                        <p className="task-desk__muted">
                          {ar
                            ? 'لا يمكن إعادة الفتح مرة أخرى بينما توجد متابعة مفتوحة مرتبطة. أغلق المتابعة أولاً.'
                            : 'Cannot reopen again while a linked follow-up is still open. Close that follow-up first.'}
                        </p>
                        <Link
                          className="button button--primary"
                          href={`/${portal}/tasks/${encodeURIComponent(openFollowUp.id)}`}
                          prefetch={false}
                        >
                          {ar
                            ? `فتح المتابعة ${openFollowUp.reference}`
                            : `Open follow-up ${openFollowUp.reference}`}
                        </Link>
                      </>
                    );
                  }
                  if (detail.canReopen) {
                    return (
                      <>
                        <p className="task-desk__muted">
                          {ar
                            ? 'هذه المهمة مغلقة في السجل للقراءة فقط. يمكنك فتح متابعة جديدة مرتبطة بها.'
                            : 'This task is closed and read-only. You can open a linked follow-up.'}
                        </p>
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={busy}
                          onClick={() => {
                            setReopenReason('');
                            setMessage(null);
                            setReopenOpen(true);
                          }}
                        >
                          {ar ? 'إعادة فتح كمهمة جديدة' : 'Reopen as a new task'}
                        </button>
                      </>
                    );
                  }
                  return (
                    <p className="task-desk__muted">
                      {ar
                        ? 'ليست لديك صلاحية إنشاء متابعة جديدة.'
                        : 'You do not have permission to create a follow-up.'}
                    </p>
                  );
                })()}
              </div>
            ) : null}
            {message ? <p className="task-desk__notice">{message}</p> : null}
          </section>

          {!closed ? (
          <details className="task-desk__more">
            <summary>{ar ? 'المزيد: أعضاء، تحويل، محامٍ' : 'More: members, transfer, lawyer'}</summary>
            <div className="task-desk__more-grid">
              {detail.canAssign ? (
                <form
                  className="task-desk__stack"
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
                  <h3>{ar ? 'إضافة عضو' : 'Add a member'}</h3>
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
                    <span>{ar ? 'دوره' : 'Duty'}</span>
                    <select
                      value={memberDuty}
                      onChange={(event) => setMemberDuty(event.target.value as typeof memberDuty)}
                    >
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
              ) : null}

              {detail.canAssign ? (
                <form
                  className="task-desk__stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      base,
                      { assignedToUserId: assignTo || null },
                      ar ? 'حُوّلت المهمة' : 'Task transferred',
                    );
                  }}
                >
                  <h3>{ar ? 'تحويل' : 'Transfer'}</h3>
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
              ) : null}

              <div className="task-desk__stack">
                <h3>{ar ? 'المحامي' : 'Lawyer'}</h3>
                {detail.legalCase ? (
                  <Link
                    className="button button--primary"
                    href={`/${portal}/legal/${encodeURIComponent(detail.legalCase.id)}`}
                  >
                    {ar ? `القضية ${detail.legalCase.reference}` : `Case ${detail.legalCase.reference}`}
                  </Link>
                ) : detail.canLegal ? (
                  <form
                    className="task-desk__stack"
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
                  <p className="task-desk__muted">
                    {ar
                      ? 'فتح القضية يحتاج صلاحية إدارة المحاماة.'
                      : 'Opening a case needs legal management access.'}
                  </p>
                )}
              </div>
            </div>
          </details>
          ) : null}
        </div>

        <aside className="task-desk__side">
          <section className="task-desk__card task-desk__activity">
            <header className="task-desk__activity-head">
              <h2>{ar ? 'النشاط والردود' : 'Activity & comments'}</h2>
              <small>
                {ar ? 'أُنشئت' : 'Created'}{' '}
                {detail.events[0]?.at.slice(0, 10) ?? '—'}
              </small>
            </header>
            <ol className="task-desk__thread">
              {detail.events.length ? (
                [...detail.events].reverse().map((event) => {
                  const label = EVENT[event.type] ?? [event.type, event.type];
                  const isStatus = event.type === 'task.status';
                  return (
                    <li
                      key={event.id}
                      className={
                        event.type === 'task.reply'
                          ? 'is-reply'
                          : isStatus
                            ? 'is-status'
                            : ''
                      }
                    >
                      <header>
                        <strong>{ar ? label[0] : label[1]}</strong>
                        <small>
                          {[event.actorName, event.at.slice(0, 16).replace('T', ' ')]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </header>
                      {isStatus && (event.fromStatus || event.toStatus) ? (
                        <p className="task-desk__status-change">
                          <span className={`task-status task-status--sm task-status--${event.fromStatus ?? 'draft'}`}>
                            {taskStatusLabel(event.fromStatus ?? 'draft', locale)}
                          </span>
                          <span aria-hidden="true">→</span>
                          <span className={`task-status task-status--sm task-status--${event.toStatus ?? 'draft'}`}>
                            {taskStatusLabel(event.toStatus ?? 'draft', locale)}
                          </span>
                        </p>
                      ) : null}
                      {event.note ? (
                        <>
                          <p>
                            {isStatus && taskNeedsReason(event.toStatus ?? '')
                              ? `${ar ? 'السبب:' : 'Reason:'} ${event.note}`
                              : event.note}
                          </p>
                          <TranslatableNote text={event.note} locale={locale} />
                        </>
                      ) : null}
                      {event.files.length ? (
                        <ul className="task-desk__checks">
                          {event.files.map((file) => (
                            <li key={file.id}>
                              <a
                                href={`/api/portal/tasks/${encodeURIComponent(detail.id)}/files/${encodeURIComponent(file.id)}`}
                              >
                                {file.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })
              ) : (
                <li>
                  <p className="task-desk__muted">
                    {ar ? 'لا نشاط بعد.' : 'No activity yet.'}
                  </p>
                </li>
              )}
            </ol>
            {detail.canUpdate && !closed ? (
              <form
                className="task-desk__reply"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reply.trim().length < 2 && !replyFiles.length) return;
                  void run(
                    `${base}/reply`,
                    { note: reply.trim(), files: replyFiles },
                    ar ? 'أُرسل الرد' : 'Reply sent',
                  );
                }}
              >
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={reply}
                  placeholder={ar ? 'اكتب تعليقاً أو رداً…' : 'Write a comment or reply…'}
                  onChange={(event) => setReply(event.target.value)}
                />
                <NoteTranslateBar value={reply} onChange={setReply} locale={locale} max={2000} disabled={busy} />
                <label className="task-desk__stack">
                  <span>{ar ? 'مرفق مع الرد' : 'Attachment with the reply'}</span>
                  <input
                    type="file"
                    multiple
                    disabled={busy}
                    onChange={(event) => {
                      const picked = [...(event.target.files ?? [])].slice(0, 4);
                      event.target.value = '';
                      for (const file of picked) {
                        if (file.size > 700_000) {
                          setMessage(
                            ar
                              ? 'أحد الملفات أكبر من حوالي ٧٠٠ ك.ب.'
                              : 'A file is larger than about 700 KB.',
                          );
                          continue;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          const data = typeof reader.result === 'string' ? reader.result : '';
                          if (!data) return;
                          setReplyFiles((current) =>
                            [...current, { name: file.name, data }].slice(0, 4),
                          );
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
                {replyFiles.length ? (
                  <ul className="task-desk__checks">
                    {replyFiles.map((file) => (
                      <li key={file.name}>
                        <span>{file.name}</span>
                        <button
                          type="button"
                          className="button button--quiet"
                          onClick={() =>
                            setReplyFiles((current) =>
                              current.filter((item) => item.name !== file.name),
                            )
                          }
                        >
                          {ar ? 'إزالة' : 'Remove'}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={busy || (reply.trim().length < 2 && !replyFiles.length)}
                >
                  {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال' : 'Send'}
                </button>
              </form>
            ) : closed ? (
              <p className="task-desk__muted">
                {ar
                  ? 'المهمة مغلقة — التعليقات الجديدة تكون على مهمة المتابعة بعد إعادة الفتح.'
                  : 'This task is closed — new comments go on the follow-up after reopen.'}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {reopenOpen ? (
        <div
          className="task-quick"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-reopen-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setReopenOpen(false);
          }}
        >
          <div className="task-quick__card" dir={ar ? 'rtl' : 'ltr'}>
            <header className="task-quick__head">
              <div>
                <p className="task-quick__eyebrow" id="task-reopen-title">
                  {ar ? 'إعادة فتح كمهمة جديدة' : 'Reopen as a new task'}
                </p>
                <p className="task-quick__list" dir="ltr">
                  {detail.reference}
                </p>
              </div>
              <button
                type="button"
                className="task-quick__close"
                aria-label={ar ? 'إغلاق' : 'Close'}
                disabled={busy}
                onClick={() => setReopenOpen(false)}
              >
                ×
              </button>
            </header>
            <p className="task-desk__muted">
              {ar
                ? 'اكتب سبب إعادة الفتح والشرح. ستُنشأ مهمة جديدة برقم جديد مرتبطة بهذه المهمة المغلقة.'
                : 'Write the reason and explanation. A new numbered task will open, linked to this closed one.'}
            </p>
            <textarea
              className="task-quick__desc"
              rows={5}
              maxLength={2000}
              autoFocus
              value={reopenReason}
              placeholder={ar ? 'السبب والشرح…' : 'Reason and explanation…'}
              onChange={(event) => setReopenReason(event.target.value)}
            />
            <NoteTranslateBar
              value={reopenReason}
              onChange={setReopenReason}
              locale={locale}
              max={2000}
              disabled={busy}
            />
            {message ? <p className="task-quick__msg">{message}</p> : null}
            <footer className="task-quick__foot">
              <button
                type="button"
                className="task-quick__ghost"
                disabled={busy}
                onClick={() => setReopenOpen(false)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                className="task-quick__submit"
                disabled={busy || reopenReason.trim().length < 5}
                onClick={() => void reopenAsNew()}
              >
                {busy
                  ? ar
                    ? 'جارٍ الفتح…'
                    : 'Opening…'
                  : ar
                    ? 'إنشاء المتابعة'
                    : 'Create follow-up'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </article>
  );
}
