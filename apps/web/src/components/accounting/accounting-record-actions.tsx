'use client';

import { useAccountingTrustConfirm } from '@/components/accounting/accounting-trust-confirm';
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
  const trust = useAccountingTrustConfirm(locale);
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  if (!uuid) return null;

  const run = async (
    action: string,
    resource: Kind,
    review: {
      title: string;
      impact: string;
      tone?: 'default' | 'danger' | 'success';
    },
    targetId = id,
    extra?: { note?: string; refundConfirmed?: boolean; approvalId?: string },
  ) => {
    const ok = await trust.ask({
      title: review.title,
      rows: [
        { label: ar ? 'النوع' : 'Kind', value: resource },
        { label: ar ? 'المعرّف' : 'Id', value: targetId.slice(0, 8) + '…' },
        { label: ar ? 'الحالة' : 'Status', value: status },
        ...(sourceType
          ? [{ label: ar ? 'المصدر' : 'Source', value: sourceType }]
          : []),
        ...(extra?.note ? [{ label: ar ? 'السبب' : 'Reason', value: extra.note }] : []),
      ],
      impact: review.impact,
      tone: review.tone ?? 'danger',
      confirmLabel: ar ? 'تأكيد الإجراء' : 'Confirm action',
    });
    if (!ok) return;
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
    void (async () => {
      const reasonPrompt = await trust.ask({
        title: ar ? 'سبب العكس / الاسترداد' : 'Reason for reverse / refund',
        subtitle: ar
          ? 'اكتب السبب في الملاحظات بعد التأكيد — للمعاملات الإلكترونية يلزم توثيق الاسترداد'
          : 'Electronic lines require a documented refund confirmation',
        rows: [
          { label: ar ? 'القيد' : 'Journal', value: journalTarget.slice(0, 8) + '…' },
          { label: ar ? 'المصدر' : 'Source', value: resolvedSource || '—' },
        ],
        impact: ar
          ? 'سيُنشأ قيد عكسي ويبقي الأصل في الدفتر مع حالة معكوس.'
          : 'A reversing journal will be posted; the original stays as reversed.',
        tone: 'danger',
        confirmLabel: ar ? 'متابعة وإدخال السبب' : 'Continue & enter reason',
      });
      if (!reasonPrompt) return;
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
        const okRefund = await trust.ask({
          title: ar ? 'تأكيد الاسترداد الإلكتروني' : 'Confirm electronic refund',
          rows: [
            {
              label: ar ? 'السؤال' : 'Check',
              value: ar
                ? 'هل عُكس المبلغ من بوابة التحصيل أو سُجّل استرداد موثّق؟'
                : 'Was the amount reversed at the gateway or a documented refund recorded?',
            },
          ],
          impact: ar
            ? 'بدون تأكيد الاسترداد لا يُسمح بعكس قيد إلكتروني.'
            : 'Electronic reverse is blocked without refund confirmation.',
          tone: 'danger',
          confirmLabel: ar ? 'نعم، موثّق' : 'Yes, documented',
        });
        if (!okRefund) return;
      }
      await run(
        'reverse',
        'journal',
        {
          title: ar ? 'تأكيد عكس القيد' : 'Confirm journal reverse',
          impact: ar
            ? 'التراجع ينشئ قيد عكس ويبقي أثراً في الدفتر.'
            : 'Undo posts a reversing entry and keeps an audit trail.',
          tone: 'danger',
        },
        journalTarget,
        {
          note: reason.trim() || (ar ? 'تراجع من شاشة المحاسبة' : 'Undo from accounting'),
          refundConfirmed: protectedLine,
        },
      );
    })();
  };

  return (
    <div className="accounting-hub__row-actions">
      {trust.gate}
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
            void run('discard', 'journal', {
              title: ar ? 'حذف مسودة القيد' : 'Delete draft journal',
              impact: ar
                ? 'ستُحذف المسودة نهائياً ولن يظهر قيد في الدفتر.'
                : 'The draft will be deleted permanently with no ledger entry.',
              tone: 'danger',
            })
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
            void run(
              'unpost',
              'journal',
              {
                title: ar ? 'حذف الترحيل' : 'Unpost entry',
                impact: ar
                  ? 'يُخرج القيد اليدوي من الدفاتر ويعيده مسودة.'
                  : 'Removes this manual entry from the books back to draft.',
                tone: 'danger',
              },
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
            void run('void', 'invoice', {
              title: ar ? 'إلغاء الفاتورة' : 'Void invoice',
              impact: ar
                ? 'لا يُلغى ما عليه مدفوعات أو تحصيل إلكتروني.'
                : 'Paid or electronic collections cannot be voided.',
              tone: 'danger',
            })
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
            void run('cancel', 'expense', {
              title: ar ? 'إلغاء المصروف' : 'Cancel expense',
              impact: ar
                ? 'إن وُجد قيد مرحّل يجب عكسه أولاً.'
                : 'A posted journal must be reversed first.',
              tone: 'danger',
            })
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
          void run(archived ? 'restore' : 'archive', archiveKind, {
            title: archived
              ? ar
                ? 'استعادة من الأرشيف'
                : 'Restore from archive'
              : ar
                ? 'أرشفة السجل'
                : 'Archive record',
            impact: archived
              ? ar
                ? 'سيظهر السجل مجدداً في القوائم النشطة.'
                : 'The record will reappear in active lists.'
              : ar
                ? 'يبقى في السجل مع شارة أرشيف.'
                : 'Stays listed with an archive badge.',
            tone: 'default',
          })
        }
      >
        {archived ? (ar ? 'استعادة' : 'Restore') : ar ? 'أرشفة' : 'Archive'}
      </button>
    </div>
  );
}
