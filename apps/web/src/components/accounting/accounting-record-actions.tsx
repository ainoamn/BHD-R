'use client';

import { browserNextMutation } from '@/lib/api';

type Kind = 'journal' | 'invoice' | 'expense' | 'receipt';

/** Standard follow-up actions: delete draft, return to draft, void, archive. */
export function AccountingRecordActions({
  locale,
  kind,
  id,
  journalId,
  status,
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
  archived?: boolean | undefined;
  disabled?: boolean | undefined;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  if (!uuid) return null;

  const run = (action: string, resource: Kind, prompt: string, targetId = id) => {
    if (!window.confirm(prompt)) return;
    void (async () => {
      try {
        await browserNextMutation('/api/owner/accounting/lifecycle', {
          method: 'POST',
          body: JSON.stringify({
            action,
            kind: resource === 'receipt' ? 'invoice' : resource,
            id: targetId,
          }),
        });
        onDone();
      } catch (error) {
        onError(error instanceof Error ? error.message : ar ? 'تعذر تنفيذ الإجراء' : 'Action failed');
      }
    })();
  };

  const archiveKind: Kind = kind === 'receipt' ? 'invoice' : kind;
  const invoiceLike = kind === 'invoice' || (kind === 'receipt' && status !== 'succeeded');
  const journalTarget =
    journalId && /^[0-9a-f-]{36}$/i.test(journalId)
      ? journalId
      : kind === 'journal'
        ? id
        : null;
  const posted = status === 'posted' || status === 'succeeded' || status === 'paid' || status === 'issued';
  const undo = (action: 'reverse' | 'unpost') => {
    if (!journalTarget) return;
    run(
      action,
      'journal',
      action === 'reverse'
        ? ar
          ? 'التراجع ينشئ قيد عكس ويبقي أثراً في الدفتر. متابعة؟'
          : 'Undo posts a reversing entry and keeps an audit trail. Continue?'
        : ar
          ? 'حذف الترحيل يُخرج القيد من الدفاتر ويعيده مسودة. متابعة؟'
          : 'Delete the posting and return the entry to draft?',
      journalTarget,
    );
  };

  return (
    <div className="accounting-hub__row-actions">
      {journalTarget && status !== 'draft' && status !== 'reversed' && status !== 'void' && posted ? (
        <button
          type="button"
          className="accounting-act accounting-act--draft"
          disabled={disabled}
          onClick={() => undo('reverse')}
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
            run('discard', 'journal', ar ? 'حذف مسودة القيد نهائياً؟' : 'Delete this draft journal?')
          }
        >
          {ar ? 'حذف' : 'Delete'}
        </button>
      ) : null}
      {journalTarget && status === 'posted' ? (
        <button
          type="button"
          className="accounting-act accounting-act--void"
          disabled={disabled}
          onClick={() => undo('unpost')}
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
            run('void', 'invoice', ar ? 'إلغاء الفاتورة؟ لا يُلغى ما عليه مدفوعات.' : 'Void this invoice?')
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
          onClick={() => run('cancel', 'expense', ar ? 'إلغاء المصروف؟' : 'Cancel this expense?')}
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
