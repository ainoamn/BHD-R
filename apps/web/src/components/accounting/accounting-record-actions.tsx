'use client';

import { isProtectedJournalSource, canUnpostJournalSource } from '@/lib/accounting-integrity';
import { browserNextMutation } from '@/lib/api';

type Kind = 'journal' | 'invoice' | 'expense' | 'receipt';

/** Standard follow-up actions: delete draft, reverse (not erase), void, archive. */
export function AccountingRecordActions({
  locale,
  kind,
  id,
  journalId,
  status,
  sourceType,
  archived = false,
  disabled = false,
  onDone,
  onError,
}: {
  locale: 'ar' | 'en';
  kind: Kind;
  id: string;
  /** Posted journal behind a receipt or document, when the row itself is not the journal. */
  journalId?: string | null | undefined;
  status: string;
  sourceType?: string | null | undefined;
  archived?: boolean | undefined;
  disabled?: boolean | undefined;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  if (!uuid) return null;

  const run = (
    action: string,
    resource: Kind,
    prompt: string,
    targetId = id,
    extra?: { note?: string; refundConfirmed?: boolean; approvalId?: string },
  ) => {
    if (!window.confirm(prompt)) return;
    void (async () => {
      try {
        await browserNextMutation('/api/owner/accounting/lifecycle', {
          method: 'POST',
          body: JSON.stringify({
            action,
            kind: resource === 'receipt' ? 'invoice' : resource,
            id: targetId,
            ...extra,
          }),
        });
        onDone();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : ar ? 'تعذر تنفيذ الإجراء' : 'Action failed',
        );
      }
    })();
  };

  const archiveKind: Kind = kind === 'receipt' ? 'invoice' : kind;
  const invoiceLike = kind === 'invoice' || (kind === 'receipt' && status !== 'succeeded');
  const journalTarget =
    journalId && /^[0-9a-f-]{36}$/i.test(journalId) ? journalId : kind === 'journal' ? id : null;
  const resolvedSource =
    sourceType ??
    (kind === 'receipt' && status === 'succeeded'
      ? 'stay_payment'
      : kind === 'receipt'
        ? 'rent_payment'
        : kind === 'expense'
          ? 'expense'
          : null);
  const protectedLine = isProtectedJournalSource(resolvedSource);
  const allowUnpost = canUnpostJournalSource(resolvedSource);
  const posted =
    status === 'posted' || status === 'succeeded' || status === 'paid' || status === 'issued';

  const undoReverse = () => {
    if (!journalTarget) return;
    const reason = window.prompt(
      ar
        ? 'سبب العكس / الاسترداد (مطلوب للمعاملات الإلكترونية):'
        : 'Reason for reverse / refund (required for electronic lines):',
      '',
    );
    if (reason === null) return;
    if (protectedLine && reason.trim().length < 8) {
      onError(
        ar ? 'أدخل سبباً أوضح (ثمانية أحرف على الأقل).' : 'Enter a clearer reason (8+ characters).',
      );
      return;
    }
    if (protectedLine) {
      const okRefund = window.confirm(
        ar
          ? 'هل تم عكس المبلغ من بوابة التحصيل (مثل ثواني) أو تسجيل استرداد يدوي موثّق؟ لا يُسمح بالعكس الإلكتروني بدون ذلك.'
          : 'Has the amount been reversed at the payment gateway (e.g. Thawani) or a documented manual refund recorded? Electronic reverse is blocked without that.',
      );
      if (!okRefund) return;
    }
    run(
      'reverse',
      'journal',
      ar
        ? 'التراجع ينشئ قيد عكس ويبقي أثراً في الدفتر. متابعة؟'
        : 'Undo posts a reversing entry and keeps an audit trail. Continue?',
      journalTarget,
      {
        note: reason.trim() || (ar ? 'تراجع من شاشة المحاسبة' : 'Undo from accounting'),
        refundConfirmed: protectedLine,
      },
    );
  };

  return (
    <div className="accounting-hub__row-actions">
      {journalTarget &&
      status !== 'draft' &&
      status !== 'reversed' &&
      status !== 'void' &&
      posted ? (
        <button
          type="button"
          className="accounting-act accounting-act--draft"
          disabled={disabled}
          onClick={undoReverse}
        >
          {ar ? 'تراجع' : 'Undo'}
        </button>
      ) : null}
      {kind === 'journal' && status === 'draft' ? (
        <button
          type="button"
          className="accounting-act accounting-act--void"
          disabled={disabled}
          onClick={() =>
            run(
              'discard',
              'journal',
              ar ? 'حذف مسودة القيد نهائياً؟' : 'Delete this draft journal?',
            )
          }
        >
          {ar ? 'حذف' : 'Delete'}
        </button>
      ) : null}
      {journalTarget && status === 'posted' && allowUnpost && !protectedLine ? (
        <button
          type="button"
          className="accounting-act accounting-act--void"
          disabled={disabled}
          onClick={() =>
            run(
              'unpost',
              'journal',
              ar
                ? 'حذف الترحيل يُخرج القيد اليدوي من الدفاتر ويعيده مسودة. متابعة؟'
                : 'Unpost this manual entry back to draft?',
              journalTarget,
            )
          }
        >
          {ar ? 'حذف الترحيل' : 'Unpost'}
        </button>
      ) : null}
      {invoiceLike && status !== 'void' && status !== 'paid' ? (
        <button
          type="button"
          className="accounting-act accounting-act--void"
          disabled={disabled}
          onClick={() =>
            run(
              'void',
              'invoice',
              ar
                ? 'إلغاء الفاتورة؟ لا يُلغى ما عليه مدفوعات أو تحصيل إلكتروني.'
                : 'Void this invoice? Paid or electronic collections cannot be voided.',
            )
          }
        >
          {ar ? 'حذف' : 'Delete'}
        </button>
      ) : null}
      {kind === 'expense' && status !== 'cancelled' && status !== 'void' ? (
        <button
          type="button"
          className="accounting-act accounting-act--void"
          disabled={disabled}
          onClick={() =>
            run(
              'cancel',
              'expense',
              ar
                ? 'إلغاء المصروف؟ إن وُجد قيد مرحّل يجب عكسه أولاً.'
                : 'Cancel this expense? A posted journal must be reversed first.',
            )
          }
        >
          {ar ? 'حذف' : 'Delete'}
        </button>
      ) : null}
      <button
        type="button"
        className="accounting-act accounting-act--archive"
        disabled={disabled}
        onClick={() =>
          run(
            archived ? 'restore' : 'archive',
            archiveKind,
            archived
              ? ar
                ? 'استعادة السجل من الأرشيف؟'
                : 'Restore this record?'
              : ar
                ? 'أرشفة السجل؟ يبقى في السجل مع شارة أرشيف.'
                : 'Archive this record? It stays listed with an archive badge.',
          )
        }
      >
        {archived ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
      </button>
    </div>
  );
}
