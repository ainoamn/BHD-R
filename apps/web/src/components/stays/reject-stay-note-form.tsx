'use client';

import { useState } from 'react';
import { NoteTranslateBar } from '@/components/note-translate';
import { REFUND_NOTE_MAX } from '@/lib/stay-deposit-refund';

export type RejectStayKind = 'booking' | 'reschedule';

export function RejectStayNoteForm({
  kind,
  reference,
  locale,
  busy,
  fromRange,
  toRange,
  onConfirm,
  onCancel,
}: {
  kind: RejectStayKind;
  reference: string;
  locale: 'ar' | 'en';
  busy: boolean;
  /** Current booking dates (reschedule). */
  fromRange?: string | null;
  /** Requested dates (reschedule). */
  toRange?: string | null;
  onConfirm: (note: string | null) => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const [note, setNote] = useState('');
  const id = `reject-${kind}-${reference}`;

  const title =
    kind === 'reschedule'
      ? ar
        ? `رفض تعديل التواريخ · ${reference}`
        : `Reject date change · ${reference}`
      : ar
        ? `رفض طلب الحجز · ${reference}`
        : `Reject booking request · ${reference}`;

  return (
    <form
      className="psr-reject-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = note.trim();
        onConfirm(trimmed.length ? trimmed.slice(0, REFUND_NOTE_MAX) : null);
      }}
    >
      <header className="psr-reject-form__head">
        <h3>{title}</h3>
        <p className="muted">
          {kind === 'reschedule'
            ? ar
              ? 'يبقى الحجز على تواريخه الحالية. الملاحظة اختيارية وتظهر للضيف إن كتبتها.'
              : 'The booking stays on its current dates. A note is optional and shown to the guest if you write one.'
            : ar
              ? 'سيُرفض الطلب ويُلغى. الملاحظة اختيارية وتظهر للضيف إن كتبتها.'
              : 'The request will be rejected and cancelled. A note is optional and shown to the guest if you write one.'}
        </p>
      </header>

      {kind === 'reschedule' && (fromRange || toRange) ? (
        <table className="psr-reject-form__change">
          <tbody>
            <tr>
              <th scope="row">{ar ? 'من' : 'From'}</th>
              <td className="is-from" dir="ltr">
                {fromRange || '—'}
              </td>
            </tr>
            <tr>
              <th scope="row">{ar ? 'إلى' : 'To'}</th>
              <td className="is-to" dir="ltr">
                {toRange || '—'}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}

      <div className="field">
        <label htmlFor={id}>{ar ? 'سبب الرفض (اختياري)' : 'Rejection reason (optional)'}</label>
        <textarea
          id={id}
          className="textarea"
          rows={3}
          maxLength={REFUND_NOTE_MAX}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            ar
              ? 'مثال: الوحدة محجوزة في هذه الفترة · أو التواريخ غير مناسبة للتشغيل…'
              : 'e.g. the unit is already booked for those dates, or the dates do not work operationally…'
          }
        />
        <NoteTranslateBar
          value={note}
          onChange={setNote}
          locale={locale}
          max={REFUND_NOTE_MAX}
          disabled={busy}
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="button button--danger" disabled={busy}>
          {busy
            ? ar
              ? 'جارٍ…'
              : 'Working…'
            : kind === 'reschedule'
              ? ar
                ? 'تأكيد رفض التعديل'
                : 'Confirm reject change'
              : ar
                ? 'تأكيد الرفض'
                : 'Confirm reject'}
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={onCancel}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
