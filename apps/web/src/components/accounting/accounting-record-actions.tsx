'use client';

import { browserNextMutation } from '@/lib/api';

type Kind = 'journal' | 'invoice' | 'expense' | 'receipt';

/** Standard follow-up actions: delete draft, return to draft, void, archive. */
export function AccountingRecordActions({
  locale,
  kind,
  id,
  status,
  archived = false,
  disabled = false,
  onDone,
  onError,
}: {
  locale: 'ar' | 'en';
  kind: Kind;
  id: string;
  status: string;
  archived?: boolean | undefined;
  disabled?: boolean | undefined;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  if (!uuid) return null;

  const run = (action: string, resource: Kind, prompt: string) => {
    if (!window.confirm(prompt)) return;
    void (async () => {
      try {
        await browserNextMutation('/api/owner/accounting/lifecycle', {
          method: 'POST',
          body: JSON.stringify({ action, kind: resource === 'receipt' ? 'invoice' : resource, id }),
        });
        onDone();
      } catch (error) {
        onError(error instanceof Error ? error.message : ar ? 'تعذر تنفيذ الإجراء' : 'Action failed');
      }
    })();
  };

  const archiveKind: Kind = kind === 'receipt' ? 'invoice' : kind;
  const invoiceLike = kind === 'invoice' || (kind === 'receipt' && status !== 'succeeded');

  return (
    <div className="accounting-hub__row-actions">
      {kind === 'journal' && status === 'draft' ? (
        <button
          type="button"
          className="button button--quiet button--sm"
          disabled={disabled}
          onClick={() =>
            run('discard', 'journal', ar ? 'حذف مسودة القيد نهائياً؟' : 'Delete this draft journal?')
          }
        >
          {ar ? 'حذف' : 'Delete'}
        </button>
      ) : null}
      {kind === 'journal' && status === 'posted' ? (
        <button
          type="button"
          className="button button--quiet button--sm"
          disabled={disabled}
          onClick={() =>
            run(
              'unpost',
              'journal',
              ar
                ? 'إرجاع القيد إلى مسودة وإخراجه من الدفاتر المرحّلة؟'
                : 'Return this entry to draft and remove it from the posted books?',
            )
          }
        >
          {ar ? 'مسودة' : 'Draft'}
        </button>
      ) : null}
      {invoiceLike && status !== 'void' && status !== 'paid' ? (
        <button
          type="button"
          className="button button--quiet button--sm"
          disabled={disabled}
          onClick={() =>
            run('void', 'invoice', ar ? 'إلغاء الفاتورة؟ لا يُلغى ما عليه مدفوعات.' : 'Void this invoice?')
          }
        >
          {ar ? 'إلغاء' : 'Void'}
        </button>
      ) : null}
      {kind === 'expense' && status !== 'cancelled' && status !== 'void' ? (
        <button
          type="button"
          className="button button--quiet button--sm"
          disabled={disabled}
          onClick={() => run('cancel', 'expense', ar ? 'إلغاء المصروف؟' : 'Cancel this expense?')}
        >
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      ) : null}
      <button
        type="button"
        className="button button--quiet button--sm"
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
