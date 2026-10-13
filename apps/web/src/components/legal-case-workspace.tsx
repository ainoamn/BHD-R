'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { formatMoney } from '@/lib/format';
import {
  fromMinor,
  fromMuscatInput,
  LEGAL_CHANGE_LABELS,
  LEGAL_FILE_MAX_CHARS,
  LEGAL_FILE_TYPES,
  LEGAL_FILES_MAX,
  LEGAL_FILES_MAX_CHARS,
  LEGAL_MESSAGE_MAX,
  LEGAL_POLL_MS,
  LEGAL_STAGE_LABELS,
  LEGAL_STAGES,
  LEGAL_UPDATE_LABELS,
  LEGAL_UPDATE_TYPES,
  legalDate,
  toMinor,
  toMuscatInput,
  type LegalCaseDetail,
  type LegalCaseEntry,
  type LegalChange,
  type LegalStage,
  type LegalUpdateType,
} from '@/lib/legal-case-shared';
import type { PortalRole } from '@/lib/types';
import { FilePreviewDialog, type PreviewFile } from './file-preview';

type Picked = { name: string; dataUrl: string };

const ERRORS: Record<string, [string, string]> = {
  legal_file_invalid: [
    'المرفقات: صور PNG/JPEG/WebP أو PDF، حتى 4 ملفات وبحجم إجمالي معقول.',
    'Attachments: PNG/JPEG/WebP images or PDF, up to 4 files of reasonable size.',
  ],
  legal_invalid: ['تحقّق من البيانات المدخلة.', 'Check the details you entered.'],
  legal_lawyer_invalid: ['اختر محامياً من القائمة.', 'Choose a lawyer from the list.'],
  legal_case_not_found: ['القضية غير متاحة لك.', 'This case is not available to you.'],
  forbidden: ['لا تملك صلاحية هذا الإجراء.', 'You cannot do this.'],
  rate_limited: ['محاولات كثيرة، انتظر دقيقة.', 'Too many attempts; wait a minute.'],
  invalid_body: ['البيانات غير مكتملة.', 'Some details are missing.'],
};

function errorText(error: unknown, ar: boolean): string {
  const code = error instanceof ApiError ? error.code : '';
  const known = ERRORS[code];
  if (known) return ar ? known[0] : known[1];
  if (error instanceof ApiError && error.status === 0) return error.message;
  return ar ? 'تعذّر الحفظ، أعد المحاولة.' : 'Could not save; try again.';
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read_failed'));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function stageLabel(value: string | null, ar: boolean): string {
  const label = value ? LEGAL_STAGE_LABELS[value as LegalStage] : null;
  return label ? (ar ? label.ar : label.en) : (value ?? '—');
}

function changeValue(
  change: LegalChange,
  value: string | null,
  detail: LegalCaseDetail,
  locale: 'ar' | 'en',
): string {
  if (value === null || value === '') return '—';
  if (change.field === 'status') return stageLabel(value, locale === 'ar');
  if (change.field === 'nextHearingAt') return legalDate(value, locale, true);
  if (change.field === 'claimAmountMinor' || change.field === 'recoveredAmountMinor') {
    return formatMoney(value, detail.currency, locale);
  }
  return value;
}

/** Files chosen for a message or update: images are shrunk, every file is checked for size. */
function useAttachments(ar: boolean) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setProblem(null);
    const next = [...files];
    for (const raw of [...list]) {
      if (next.length >= LEGAL_FILES_MAX) {
        setProblem(ar ? `حتى ${LEGAL_FILES_MAX} ملفات.` : `Up to ${LEGAL_FILES_MAX} files.`);
        break;
      }
      if (!LEGAL_FILE_TYPES.includes(raw.type)) {
        setProblem(ar ? 'صور أو PDF فقط.' : 'Images or PDF only.');
        continue;
      }
      const file = raw.type.startsWith('image/') ? await compressImageFile(raw) : raw;
      const dataUrl = await readDataUrl(file).catch(() => '');
      if (!dataUrl || dataUrl.length > LEGAL_FILE_MAX_CHARS) {
        setProblem(ar ? `الملف ${raw.name} كبير جداً.` : `${raw.name} is too large.`);
        continue;
      }
      const total = next.reduce((sum, item) => sum + item.dataUrl.length, 0) + dataUrl.length;
      if (total > LEGAL_FILES_MAX_CHARS) {
        setProblem(
          ar ? 'حجم المرفقات كبير، أرسلها على دفعات.' : 'Too large together; send in parts.',
        );
        continue;
      }
      next.push({ name: raw.name, dataUrl });
    }
    setFiles(next);
  };
  const remove = (index: number) => setFiles((current) => current.filter((_, i) => i !== index));
  const clear = () => {
    setFiles([]);
    setProblem(null);
  };
  return { files, problem, add, remove, clear };
}

function AttachmentPicker({
  ar,
  attachments,
  disabled,
}: {
  ar: boolean;
  attachments: ReturnType<typeof useAttachments>;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="legal-attach">
      <button
        type="button"
        className="ops-action"
        disabled={disabled || attachments.files.length >= LEGAL_FILES_MAX}
        onClick={() => input.current?.click()}
      >
        {ar ? '＋ إرفاق ملف' : '＋ Attach'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={LEGAL_FILE_TYPES.join(',')}
        onChange={(event) => {
          void attachments.add(event.target.files).finally(() => {
            event.target.value = '';
          });
        }}
      />
      {attachments.files.map((file, index) => (
        <span key={`${file.name}:${index}`} className="legal-attach__chip">
          {file.name}
          <button
            type="button"
            aria-label={ar ? `إزالة ${file.name}` : `Remove ${file.name}`}
            onClick={() => attachments.remove(index)}
          >
            ×
          </button>
        </span>
      ))}
      {attachments.problem ? <small className="legal-error">{attachments.problem}</small> : null}
    </div>
  );
}

function EntryFiles({
  entry,
  caseId,
  ar,
  onOpen,
}: {
  entry: LegalCaseEntry;
  caseId: string;
  ar: boolean;
  onOpen: (file: PreviewFile) => void;
}) {
  if (!entry.files.length) return null;
  return (
    <span className="legal-files">
      {entry.files.map((file) => {
        const href = `/api/portal/legal/cases/${encodeURIComponent(caseId)}/files/${encodeURIComponent(file.id)}`;
        return (
          <button
            key={file.id}
            type="button"
            className="legal-files__item"
            onClick={() => onOpen({ href, label: file.name })}
          >
            <span aria-hidden="true">{file.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>
            {file.name}
            <small>{file.size > 0 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : ''}</small>
          </button>
        );
      })}
      <span className="sr-only">{ar ? 'مرفقات' : 'Attachments'}</span>
    </span>
  );
}

function sideLabel(entry: LegalCaseEntry, ar: boolean): string {
  if (entry.mine) return ar ? 'أنت' : 'You';
  return entry.authorSide === 'lawyer'
    ? ar
      ? 'المحامي'
      : 'Lawyer'
    : ar
      ? 'فريق المالك'
      : 'Owner team';
}

function EditCaseForm({
  detail,
  locale,
  onDone,
  onCancel,
}: {
  detail: LegalCaseDetail;
  locale: 'ar' | 'en';
  onDone: () => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const [status, setStatus] = useState<LegalStage>(detail.status);
  const [caseNumber, setCaseNumber] = useState(detail.caseNumber ?? '');
  const [court, setCourt] = useState(detail.court ?? '');
  const [hearing, setHearing] = useState(toMuscatInput(detail.nextHearingAt));
  const [claim, setClaim] = useState(fromMinor(detail.claimAmountMinor, detail.minorUnit));
  const [recovered, setRecovered] = useState(
    fromMinor(detail.recoveredAmountMinor, detail.minorUnit),
  );
  const [lawyer, setLawyer] = useState(detail.lawyer?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const claimMinor = toMinor(claim, detail.minorUnit);
    const recoveredMinor = toMinor(recovered, detail.minorUnit);
    if (claimMinor === null || recoveredMinor === null) {
      setError(
        ar ? 'اكتب المبالغ بالأرقام، مثل 1250.500' : 'Enter amounts as numbers, e.g. 1250.500',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(`/api/portal/legal/cases/${encodeURIComponent(detail.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          caseNumber: caseNumber.trim() || null,
          court: court.trim() || null,
          nextHearingAt: fromMuscatInput(hearing),
          claimAmountMinor: claimMinor,
          recoveredAmountMinor: recoveredMinor,
          ...(detail.canManage ? { lawyerPartyId: lawyer || null } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      onDone();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="legal-edit" onSubmit={(event) => void submit(event)}>
      <h2>{ar ? 'تحديث بيانات القضية' : 'Update the case'}</h2>
      <div className="legal-edit__grid">
        <label>
          <span>{ar ? 'المرحلة' : 'Stage'}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as LegalStage)}>
            {LEGAL_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabel(stage, ar)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{ar ? 'رقم القضية' : 'Case number'}</span>
          <input
            value={caseNumber}
            maxLength={120}
            dir="ltr"
            onChange={(event) => setCaseNumber(event.target.value)}
          />
        </label>
        <label>
          <span>{ar ? 'المحكمة / الجهة' : 'Court / authority'}</span>
          <input value={court} maxLength={200} onChange={(event) => setCourt(event.target.value)} />
        </label>
        <label>
          <span>{ar ? 'الجلسة القادمة (توقيت مسقط)' : 'Next hearing (Muscat time)'}</span>
          <input
            type="datetime-local"
            value={hearing}
            onChange={(event) => setHearing(event.target.value)}
          />
        </label>
        <label>
          <span>
            {ar ? 'المبلغ المطالب به' : 'Amount claimed'} ({detail.currency})
          </span>
          <input
            inputMode="decimal"
            dir="ltr"
            value={claim}
            onChange={(event) => setClaim(event.target.value)}
          />
        </label>
        <label>
          <span>
            {ar ? 'المبلغ المحصّل' : 'Amount recovered'} ({detail.currency})
          </span>
          <input
            inputMode="decimal"
            dir="ltr"
            value={recovered}
            onChange={(event) => setRecovered(event.target.value)}
          />
        </label>
        {detail.canManage ? (
          <label>
            <span>{ar ? 'المحامي المسند' : 'Assigned lawyer'}</span>
            <select value={lawyer} onChange={(event) => setLawyer(event.target.value)}>
              <option value="">{ar ? 'بدون محامٍ' : 'No lawyer'}</option>
              {detail.lawyers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="legal-edit__wide">
          <span>{ar ? 'ملاحظة على التحديث (اختياري)' : 'Note on this change (optional)'}</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      {detail.canManage && !detail.lawyers.length ? (
        <p className="legal-muted">
          {ar
            ? 'لإسناد القضية لمحامٍ أضفه أولاً من «الفريق ← المحامون».'
            : 'To assign a lawyer, add them first under Team → Lawyers.'}
        </p>
      ) : null}
      {error ? <p className="legal-error">{error}</p> : null}
      <div className="legal-actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ التحديث' : 'Save'}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}

function Composer({
  detail,
  ar,
  onSent,
}: {
  detail: LegalCaseDetail;
  ar: boolean;
  onSent: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = useAttachments(ar);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() && !attachments.files.length) return;
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/portal/legal/cases/${encodeURIComponent(detail.id)}/entries`,
        {
          method: 'POST',
          body: JSON.stringify({ kind: 'message', text: text.trim(), files: attachments.files }),
        },
      );
      setText('');
      attachments.clear();
      onSent();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="legal-composer" onSubmit={(event) => void send(event)}>
      <textarea
        rows={3}
        maxLength={LEGAL_MESSAGE_MAX}
        value={text}
        placeholder={
          detail.viewerSide === 'lawyer'
            ? ar
              ? 'اكتب رسالتك لفريق المالك…'
              : 'Write to the owner’s team…'
            : ar
              ? 'اكتب رسالتك للمحامي…'
              : 'Write to the lawyer…'
        }
        onChange={(event) => setText(event.target.value)}
      />
      <AttachmentPicker ar={ar} attachments={attachments} disabled={busy} />
      {error ? <p className="legal-error">{error}</p> : null}
      <div className="legal-actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={busy || (!text.trim() && !attachments.files.length)}
        >
          {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال' : 'Send'}
        </button>
      </div>
    </form>
  );
}

function UpdateForm({
  detail,
  ar,
  onSaved,
}: {
  detail: LegalCaseDetail;
  ar: boolean;
  onSaved: () => void;
}) {
  const [type, setType] = useState<LegalUpdateType>('hearing');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [occurred, setOccurred] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachments = useAttachments(ar);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const occurredAt = fromMuscatInput(occurred);
    const deadlineAt = fromMuscatInput(deadline);
    try {
      await browserNextMutation(
        `/api/portal/legal/cases/${encodeURIComponent(detail.id)}/entries`,
        {
          method: 'POST',
          body: JSON.stringify({
            kind: 'update',
            type,
            title: title.trim(),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(occurredAt ? { occurredAt } : {}),
            ...(deadlineAt ? { deadlineAt } : {}),
            files: attachments.files,
          }),
        },
      );
      setTitle('');
      setNotes('');
      setOccurred('');
      setDeadline('');
      attachments.clear();
      onSaved();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="legal-update-form" onSubmit={(event) => void save(event)}>
      <div className="legal-edit__grid">
        <label>
          <span>{ar ? 'نوع التحديث' : 'Update type'}</span>
          <select value={type} onChange={(event) => setType(event.target.value as LegalUpdateType)}>
            {LEGAL_UPDATE_TYPES.map((item) => (
              <option key={item} value={item}>
                {ar ? LEGAL_UPDATE_LABELS[item].ar : LEGAL_UPDATE_LABELS[item].en}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{ar ? 'العنوان' : 'Title'}</span>
          <input
            value={title}
            maxLength={200}
            placeholder={ar ? LEGAL_UPDATE_LABELS[type].ar : LEGAL_UPDATE_LABELS[type].en}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span>{ar ? 'التاريخ (اختياري)' : 'Date (optional)'}</span>
          <input
            type="datetime-local"
            value={occurred}
            onChange={(event) => setOccurred(event.target.value)}
          />
        </label>
        <label>
          <span>{ar ? 'موعد نهائي (اختياري)' : 'Deadline (optional)'}</span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        <label className="legal-edit__wide">
          <span>{ar ? 'التفاصيل' : 'Details'}</span>
          <textarea
            rows={3}
            maxLength={10_000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>
      <AttachmentPicker ar={ar} attachments={attachments} disabled={busy} />
      {error ? <p className="legal-error">{error}</p> : null}
      <div className="legal-actions">
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'إضافة التحديث' : 'Add update'}
        </button>
      </div>
    </form>
  );
}

/** One case: its facts, the timeline of updates and the conversation between lawyer and team. */
export function LegalCaseWorkspace({
  initial,
  locale,
  portal,
}: {
  initial: LegalCaseDetail;
  locale: 'ar' | 'en';
  portal: PortalRole;
}) {
  const ar = locale === 'ar';
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<'thread' | 'timeline'>('thread');
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const caseId = initial.id;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/portal/legal/cases/${encodeURIComponent(caseId)}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) setDetail((await response.json()) as LegalCaseDetail);
    } catch {
      /* keep what is shown */
    }
  }, [caseId]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), LEGAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const messages = detail.entries.filter((entry) => entry.kind === 'message');
  const timeline = detail.entries.filter((entry) => entry.kind !== 'message').reverse();
  const lastMessage = messages.at(-1)?.id;

  useEffect(() => {
    if (tab === 'thread') threadEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [lastMessage, tab]);

  const remaining = (() => {
    try {
      const value = BigInt(detail.claimAmountMinor) - BigInt(detail.recoveredAmountMinor);
      return value > 0n ? value.toString() : '0';
    } catch {
      return '0';
    }
  })();
  const place = [
    detail.property
      ? ar
        ? detail.property.nameAr
        : detail.property.nameEn || detail.property.nameAr
      : null,
    detail.unitCode,
  ]
    .filter(Boolean)
    .join(' · ');
  const done = (message: string) => {
    setNotice(message);
    void refresh();
  };

  return (
    <div className="legal-case" dir={ar ? 'rtl' : 'ltr'}>
      <header className="legal-case__head">
        <Link href={`/${portal}/legal`} className="legal-case__back" prefetch={false}>
          {ar ? '→ القضايا' : '← Cases'}
        </Link>
        <div className="legal-case__title">
          <span className="legal-case__ref" dir="ltr">
            {detail.reference}
          </span>
          <h1>{detail.title}</h1>
          <span className={`legal-stage legal-stage--${detail.status}`}>
            {stageLabel(detail.status, ar)}
          </span>
        </div>
        {detail.canEdit && !editing ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
          >
            {ar ? 'تحديث بيانات القضية' : 'Update the case'}
          </button>
        ) : null}
      </header>

      {notice ? (
        <p className="legal-notice" role="status">
          {notice}
        </p>
      ) : null}

      {editing ? (
        <EditCaseForm
          detail={detail}
          locale={locale}
          onCancel={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            done(ar ? 'حُفظ التحديث وأُبلغ الطرف الآخر.' : 'Saved; the other side was notified.');
          }}
        />
      ) : null}

      <section className="legal-facts" aria-label={ar ? 'بيانات القضية' : 'Case facts'}>
        <dl>
          <div>
            <dt>{ar ? 'نوع القضية' : 'Case type'}</dt>
            <dd>{detail.caseType}</dd>
          </div>
          <div>
            <dt>{ar ? 'رقم القضية' : 'Case number'}</dt>
            <dd dir="ltr">{detail.caseNumber ?? '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'المحكمة / الجهة' : 'Court / authority'}</dt>
            <dd>{detail.court ?? '—'}</dd>
          </div>
          <div>
            <dt>{ar ? 'الجلسة القادمة' : 'Next hearing'}</dt>
            <dd>{legalDate(detail.nextHearingAt, locale, true)}</dd>
          </div>
          <div>
            <dt>{ar ? 'المطالبة' : 'Claimed'}</dt>
            <dd>{formatMoney(detail.claimAmountMinor, detail.currency, locale)}</dd>
          </div>
          <div>
            <dt>{ar ? 'المحصّل' : 'Recovered'}</dt>
            <dd>{formatMoney(detail.recoveredAmountMinor, detail.currency, locale)}</dd>
          </div>
          <div>
            <dt>{ar ? 'المتبقي' : 'Outstanding'}</dt>
            <dd>{formatMoney(remaining, detail.currency, locale)}</dd>
          </div>
          <div>
            <dt>{ar ? 'المحامي' : 'Lawyer'}</dt>
            <dd>{detail.lawyer?.name ?? (ar ? 'غير مسند' : 'Unassigned')}</dd>
          </div>
          <div>
            <dt>{ar ? 'الخصم' : 'Counterparty'}</dt>
            <dd>
              {detail.counterparty ? (
                <>
                  {detail.counterparty.name}
                  {detail.counterparty.phone ? (
                    <small dir="ltr">{detail.counterparty.phone}</small>
                  ) : null}
                  {detail.counterparty.email ? (
                    <small dir="ltr">{detail.counterparty.email}</small>
                  ) : null}
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>{ar ? 'العقار / الوحدة' : 'Property / unit'}</dt>
            <dd>{place || '—'}</dd>
          </div>
          {detail.lease ? (
            <div>
              <dt>{ar ? 'عقد الإيجار' : 'Lease'}</dt>
              <dd>
                {detail.lease.contractReference ? (
                  <span dir="ltr">{detail.lease.contractReference}</span>
                ) : null}
                <small>
                  {legalDate(detail.lease.startsOn, locale)} —{' '}
                  {legalDate(detail.lease.endsOn, locale)}
                </small>
                <small>
                  {ar ? 'الإيجار:' : 'Rent:'}{' '}
                  {formatMoney(detail.lease.rentMinor, detail.lease.currency, locale)}
                </small>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{ar ? 'فُتح في' : 'Opened'}</dt>
            <dd>
              {legalDate(detail.openedOn, locale)}
              {detail.closedOn ? (
                <small>
                  {ar ? 'أُغلق في' : 'Closed'} {legalDate(detail.closedOn, locale)}
                </small>
              ) : null}
            </dd>
          </div>
        </dl>
        {detail.description ? (
          <p className="legal-facts__description">{detail.description}</p>
        ) : null}
      </section>

      <div className="legal-tabs" role="tablist" aria-label={ar ? 'أقسام القضية' : 'Case sections'}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'thread'}
          className={tab === 'thread' ? 'legal-tab is-active' : 'legal-tab'}
          onClick={() => setTab('thread')}
        >
          {ar ? 'المحادثة' : 'Conversation'} <small>{messages.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'timeline'}
          className={tab === 'timeline' ? 'legal-tab is-active' : 'legal-tab'}
          onClick={() => setTab('timeline')}
        >
          {ar ? 'التحديثات والسجل' : 'Updates & history'} <small>{timeline.length}</small>
        </button>
      </div>

      {tab === 'thread' ? (
        <section className="legal-thread" aria-label={ar ? 'المحادثة' : 'Conversation'}>
          {messages.length ? (
            <ol className="legal-thread__list">
              {messages.map((entry) => (
                <li
                  key={entry.id}
                  className={`legal-msg legal-msg--${entry.mine ? 'mine' : entry.authorSide}`}
                >
                  <span className="legal-msg__who">
                    <strong>{entry.authorName}</strong>
                    <small>{sideLabel(entry, ar)}</small>
                    <time dateTime={entry.occurredAt}>
                      {legalDate(entry.occurredAt, locale, true)}
                    </time>
                  </span>
                  {entry.notes ? <p className="legal-msg__text">{entry.notes}</p> : null}
                  <EntryFiles entry={entry} caseId={caseId} ar={ar} onOpen={setPreview} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="legal-muted">
              {ar
                ? 'لا رسائل بعد. ابدأ المحادثة بين المحامي وفريق المالك هنا.'
                : 'No messages yet. Start the conversation between the lawyer and the team here.'}
            </p>
          )}
          <div ref={threadEnd} />
          {detail.canEdit ? (
            <Composer
              detail={detail}
              ar={ar}
              onSent={() => done(ar ? 'أُرسلت الرسالة.' : 'Message sent.')}
            />
          ) : null}
        </section>
      ) : (
        <section className="legal-timeline" aria-label={ar ? 'التحديثات والسجل' : 'Updates'}>
          {detail.canEdit ? (
            <details className="legal-timeline__add">
              <summary>
                {ar ? '＋ إضافة تحديث (جلسة، مذكرة، حكم، تحصيل…)' : '＋ Add an update'}
              </summary>
              <UpdateForm
                detail={detail}
                ar={ar}
                onSaved={() => done(ar ? 'أُضيف التحديث.' : 'Update added.')}
              />
            </details>
          ) : null}
          <ol className="legal-timeline__list">
            {timeline.map((entry) => (
              <li key={entry.id} className={`legal-event legal-event--${entry.kind}`}>
                <span className="legal-event__when">
                  {legalDate(entry.occurredAt, locale, true)}
                </span>
                <div className="legal-event__body">
                  <strong>
                    {entry.kind === 'update' && entry.type in LEGAL_UPDATE_LABELS ? (
                      <span className="legal-event__type">
                        {ar
                          ? LEGAL_UPDATE_LABELS[entry.type as LegalUpdateType].ar
                          : LEGAL_UPDATE_LABELS[entry.type as LegalUpdateType].en}
                      </span>
                    ) : null}
                    {entry.kind === 'change'
                      ? ar
                        ? 'تحديث بيانات القضية'
                        : 'Case updated'
                      : entry.title}
                  </strong>
                  <small>
                    {entry.authorName} · {sideLabel(entry, ar)}
                  </small>
                  {entry.changes.length ? (
                    <ul className="legal-event__changes">
                      {entry.changes.map((change) => (
                        <li key={change.field}>
                          {ar
                            ? LEGAL_CHANGE_LABELS[change.field].ar
                            : LEGAL_CHANGE_LABELS[change.field].en}
                          : {changeValue(change, change.from, detail, locale)} {ar ? '←' : '→'}{' '}
                          <b>{changeValue(change, change.to, detail, locale)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.notes ? <p>{entry.notes}</p> : null}
                  {entry.deadlineAt ? (
                    <small className="legal-event__deadline">
                      {ar ? 'موعد نهائي:' : 'Deadline:'} {legalDate(entry.deadlineAt, locale, true)}
                    </small>
                  ) : null}
                  <EntryFiles entry={entry} caseId={caseId} ar={ar} onOpen={setPreview} />
                </div>
              </li>
            ))}
            <li className="legal-event legal-event--opened">
              <span className="legal-event__when">{legalDate(detail.openedOn, locale)}</span>
              <div className="legal-event__body">
                <strong>{ar ? 'فُتح الملف القانوني' : 'Case opened'}</strong>
              </div>
            </li>
          </ol>
        </section>
      )}

      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}
