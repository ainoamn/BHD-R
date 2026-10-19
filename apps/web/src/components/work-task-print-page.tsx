'use client';

import { Link } from '@/i18n/navigation';
import type { WorkTaskDetail } from '@/lib/work-task-shared';
import type { PortalRole } from '@/lib/types';
import {
  taskPriorityLabel,
  taskStatusLabel,
} from '@/lib/work-task-ui';
import { taskEventLabel } from '@/lib/work-task-print-labels';

function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—';
}

function stamp(value: string): string {
  return value.slice(0, 16).replace('T', ' ');
}

const CONVERSATION_TYPES = new Set(['task.reply']);

/** Printable task sheet: clearer sections, zebra conversation, branded QR. */
export function WorkTaskPrintPage({
  detail,
  locale,
  portal,
  qrSvg,
  openUrl,
}: {
  detail: WorkTaskDetail;
  locale: 'ar' | 'en';
  portal: PortalRole;
  qrSvg: string;
  openUrl: string;
}) {
  const ar = locale === 'ar';
  const backHref = `/${portal}/tasks/${encodeURIComponent(detail.id)}`;
  const conversation = detail.events.filter((event) => CONVERSATION_TYPES.has(event.type));
  const history = detail.events.filter((event) => !CONVERSATION_TYPES.has(event.type));
  const doneCount = detail.checklist.filter((item) => item.done).length;

  return (
    <div className="task-print-shell" dir={ar ? 'rtl' : 'ltr'}>
      <div className="task-print-toolbar no-print">
        <button type="button" className="button button--primary" onClick={() => window.print()}>
          {ar ? 'طباعة / حفظ PDF' : 'Print / save PDF'}
        </button>
        <Link className="button button--quiet" href={backHref} prefetch={false}>
          {ar ? 'العودة للمهمة' : 'Back to task'}
        </Link>
      </div>

      <article className="task-print">
        <header className="task-print__head">
          <div className="task-print__identity">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="task-print__logo"
              src="/brand/bhd-official-symbol.svg"
              alt="BHD"
              width={120}
              height={38}
            />
            <p className="task-print__brand">{ar ? 'ورقة مهمة' : 'Task sheet'}</p>
            <h1>{detail.title}</h1>
            <p className="task-print__ref" dir="ltr">
              {detail.reference}
            </p>
          </div>
          <div className="task-print__qr">
            <div
              className="task-print__qr-svg"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <small>{ar ? 'امسح لفتح المهمة' : 'Scan to open task'}</small>
            <span className="task-print__qr-url" dir="ltr">
              {openUrl}
            </span>
          </div>
        </header>

        <section className="task-print__grid" aria-label={ar ? 'ملخص' : 'Summary'}>
          <div>
            <span>{ar ? 'الحالة' : 'Status'}</span>
            <strong>{taskStatusLabel(detail.status, locale)}</strong>
          </div>
          <div>
            <span>{ar ? 'الأولوية' : 'Priority'}</span>
            <strong>{taskPriorityLabel(detail.priority, locale)}</strong>
          </div>
          <div>
            <span>{ar ? 'المسؤول' : 'Assignee'}</span>
            <strong>{detail.assigneeName || '—'}</strong>
          </div>
          <div>
            <span>{ar ? 'التصنيف' : 'Category'}</span>
            <strong>{detail.category || '—'}</strong>
          </div>
          <div>
            <span>{ar ? 'البدء' : 'Start'}</span>
            <strong>{day(detail.startsAt)}</strong>
          </div>
          <div>
            <span>{ar ? 'الاستحقاق' : 'Due'}</span>
            <strong>{day(detail.dueAt)}</strong>
          </div>
          <div>
            <span>{ar ? 'الإكمال' : 'Completed'}</span>
            <strong>{day(detail.completedAt)}</strong>
          </div>
          <div>
            <span>{ar ? 'الوسوم' : 'Tags'}</span>
            <strong>{detail.tags?.length ? detail.tags.join(' · ') : '—'}</strong>
          </div>
        </section>

        <div className="task-print__columns">
          <section className="task-print__block">
            <h2>{ar ? 'الوصف' : 'Description'}</h2>
            <p className="task-print__body">
              {detail.description?.trim() || (ar ? 'لا يوجد وصف.' : 'No description.')}
            </p>
          </section>

          <div className="task-print__side">
            {(detail.place.property || detail.place.unit || detail.place.party) && (
              <section className="task-print__block">
                <h2>{ar ? 'الربط' : 'Links'}</h2>
                <ul>
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
            )}

            {(detail.related ?? []).length ? (
              <section className="task-print__block">
                <h2>{ar ? 'سلسلة المتابعة' : 'Follow-up chain'}</h2>
                <ul>
                  {detail.related.map((row) => (
                    <li key={row.id}>
                      <span dir="ltr">{row.reference}</span>
                      {' — '}
                      {row.title} ({taskStatusLabel(row.status, locale)}) ·{' '}
                      {row.relation === 'previous'
                        ? ar
                          ? 'سابقة'
                          : 'previous'
                        : ar
                          ? 'متابعة'
                          : 'follow-up'}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {detail.followers.length ? (
              <section className="task-print__block">
                <h2>{ar ? 'الفريق' : 'Team'}</h2>
                <ul>
                  {detail.followers.map((person) => (
                    <li key={`${person.userId}-${person.duty}`}>
                      {person.name} · {person.duty}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>

        <div className="task-print__columns task-print__columns--even">
          <section className="task-print__block">
            <h2>
              {ar ? 'المهام الفرعية' : 'Subtasks'}{' '}
              <small>
                {doneCount}/{detail.checklist.length}
              </small>
            </h2>
            {detail.checklist.length ? (
              <ul className="task-print__checks">
                {detail.checklist.map((item, index) => (
                  <li key={`${item.label}-${index}`} className={item.done ? 'is-done' : undefined}>
                    [{item.done ? 'x' : ' '}] {item.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="task-print__muted">{ar ? 'لا مهام فرعية.' : 'No subtasks.'}</p>
            )}
          </section>

          <section className="task-print__block">
            <h2>{ar ? 'المرفقات' : 'Attachments'}</h2>
            {detail.files.length ? (
              <ul>
                {detail.files.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            ) : (
              <p className="task-print__muted">{ar ? 'لا مرفقات.' : 'No attachments.'}</p>
            )}
            {detail.legalCase ? (
              <p className="task-print__legal" dir="ltr">
                {ar ? 'قضية: ' : 'Case: '}
                {detail.legalCase.reference}
              </p>
            ) : null}
          </section>
        </div>

        <section className="task-print__block">
          <h2>
            {ar ? 'المحادثة' : 'Conversation'}{' '}
            <small>
              {conversation.length} {ar ? 'رسالة' : conversation.length === 1 ? 'message' : 'messages'}
            </small>
          </h2>
          {conversation.length ? (
            <ol className="task-print__chat">
              {conversation.map((event, index) => (
                <li
                  key={event.id}
                  className={index % 2 === 0 ? 'task-print__chat-item--a' : 'task-print__chat-item--b'}
                >
                  <header>
                    <strong>{event.actorName || (ar ? 'مستخدم' : 'User')}</strong>
                    <span>{stamp(event.at)}</span>
                  </header>
                  {event.note ? <p>{event.note}</p> : null}
                  {event.files.length ? (
                    <ul>
                      {event.files.map((file) => (
                        <li key={file.id}>{file.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="task-print__muted">{ar ? 'لا رسائل بعد.' : 'No messages yet.'}</p>
          )}
        </section>

        <section className="task-print__block">
          <h2>{ar ? 'سجل النظام' : 'System history'}</h2>
          {history.length ? (
            <ol className="task-print__timeline">
              {history.map((event, index) => (
                <li
                  key={event.id}
                  className={index % 2 === 0 ? 'task-print__row--light' : 'task-print__row--dark'}
                >
                  <header>
                    <strong>{taskEventLabel(event.type, locale)}</strong>
                    <span>
                      {[event.actorName, stamp(event.at)].filter(Boolean).join(' · ')}
                    </span>
                  </header>
                  {event.fromStatus || event.toStatus ? (
                    <p>
                      {taskStatusLabel(event.fromStatus ?? 'draft', locale)} →{' '}
                      {taskStatusLabel(event.toStatus ?? 'draft', locale)}
                    </p>
                  ) : null}
                  {event.note ? <p>{event.note}</p> : null}
                  {event.files.length ? (
                    <ul>
                      {event.files.map((file) => (
                        <li key={file.id}>{file.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="task-print__muted">{ar ? 'لا أحداث.' : 'No events.'}</p>
          )}
        </section>

        <footer className="task-print__foot">
          <span>{ar ? 'طُبعت من BHD-R' : 'Printed from BHD-R'}</span>
          <span dir="ltr">{new Date().toISOString().slice(0, 16).replace('T', ' ')}</span>
        </footer>
      </article>
    </div>
  );
}
