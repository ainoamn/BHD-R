'use client';

import { useMemo, useState } from 'react';
import { AccountingPropertyUnitFields } from '@/components/accounting/accounting-property-unit-fields';
import type { LedgerAccountType } from '@/lib/accounting-gl';
import { browserNextMutation } from '@/lib/api';

type Account = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: LedgerAccountType;
};

type DraftLine = {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function toMinor(value: string): string {
  const cleaned = value.trim().replace(/,/g, '');
  if (!cleaned) return '0';
  if (/^\d+$/.test(cleaned)) return (BigInt(cleaned) * 1000n).toString();
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,3}))?$/);
  if (!match) return '0';
  return `${match[1]}${(match[2] ?? '').padEnd(3, '0')}`.replace(/^0+(?=\d)/, '') || '0';
}

function money(minor: string, currency: string, ar: boolean) {
  const n = Number(minor) / 1000;
  return new Intl.NumberFormat(ar ? 'ar-OM' : 'en-OM', {
    style: 'currency',
    currency,
    minimumFractionDigits: 3,
  }).format(n);
}

/** Modal “add journal entry” form — opened by a toolbar button, not always on the page. */
export function AccountingJournalComposerModal({
  open,
  onClose,
  locale,
  accounts,
  canPost,
  busy,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  locale: 'ar' | 'en';
  accounts: Account[];
  canPost: boolean;
  busy: boolean;
  onSaved: (journalId?: string) => void;
}) {
  const ar = locale === 'ar';
  const [form, setForm] = useState({
    occurredOn: todayIso(),
    description: '',
    post: true,
    propertyId: '',
    unitId: '',
    lines: [
      { accountId: '', debit: '', credit: '', memo: '' },
      { accountId: '', debit: '', credit: '', memo: '' },
    ] as DraftLine[],
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const lineBalance = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    for (const line of form.lines) {
      debit += BigInt(toMinor(line.debit) || '0');
      credit += BigInt(toMinor(line.credit) || '0');
    }
    return { debit, credit, ok: debit > 0n && debit === credit };
  }, [form.lines]);

  if (!open) return null;

  return (
    <div
      className="accounting-hub__modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="journal-composer-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="accounting-hub__modal-card">
        <header className="accounting-hub__modal-head">
          <h2 id="journal-composer-title">{ar ? 'إضافة قيد يومية' : 'Add journal entry'}</h2>
          <button type="button" className="button button--quiet" onClick={onClose}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </header>
        <form
          className="accounting-hub__form accounting-hub__form--composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!lineBalance.ok) {
              setLocalError(ar ? 'القيد غير متوازن أو بلا مبالغ' : 'Journal is unbalanced');
              return;
            }
            if (!accounts.length) {
              setLocalError(ar ? 'لا حسابات في الدليل' : 'No accounts in the chart');
              return;
            }
            setLocalError(null);
            void (async () => {
              try {
                const created = await browserNextMutation<{ journal?: { id?: string } }>(
                  '/api/owner/accounting/journals',
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      occurredOn: form.occurredOn,
                      description: form.description,
                      post: form.post,
                      lines: form.lines
                        .filter((line) => line.accountId && (line.debit || line.credit))
                        .map((line) => ({
                          accountId: line.accountId,
                          debitMinor: toMinor(line.debit),
                          creditMinor: toMinor(line.credit),
                          currency: 'OMR',
                          memo: line.memo || undefined,
                          ...(form.propertyId ? { propertyId: form.propertyId } : {}),
                          ...(form.unitId ? { unitId: form.unitId } : {}),
                        })),
                    }),
                  },
                );
                setForm({
                  occurredOn: todayIso(),
                  description: '',
                  post: true,
                  propertyId: '',
                  unitId: '',
                  lines: [
                    { accountId: '', debit: '', credit: '', memo: '' },
                    { accountId: '', debit: '', credit: '', memo: '' },
                  ],
                });
                onSaved(created.journal?.id);
                onClose();
              } catch {
                setLocalError(ar ? 'تعذر حفظ القيد' : 'Could not save the entry');
              }
            })();
          }}
        >
          <div className="accounting-hub__form-grid">
            <label>
              {ar ? 'التاريخ' : 'Date'}
              <input
                type="date"
                value={form.occurredOn}
                onChange={(event) =>
                  setForm((current) => ({ ...current, occurredOn: event.target.value }))
                }
                required
              />
            </label>
            <label>
              {ar ? 'البيان' : 'Description'}
              <input
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                required
              />
            </label>
            <label>
              {ar ? 'الترحيل فوراً' : 'Post immediately'}
              <select
                value={form.post ? 'yes' : 'no'}
                onChange={(event) =>
                  setForm((current) => ({ ...current, post: event.target.value === 'yes' }))
                }
                disabled={!canPost}
              >
                <option value="yes">{ar ? 'نعم' : 'Yes'}</option>
                <option value="no">{ar ? 'مسودة' : 'Draft'}</option>
              </select>
            </label>
            <AccountingPropertyUnitFields
              locale={locale}
              propertyId={form.propertyId}
              unitId={form.unitId}
              onChange={(next) => setForm((current) => ({ ...current, ...next }))}
            />
          </div>
          <div className="accounting-hub__lines">
            {form.lines.map((line, index) => (
              <div className="accounting-hub__line" key={index}>
                <select
                  value={line.accountId}
                  onChange={(event) =>
                    setForm((current) => {
                      const lines = [...current.lines];
                      lines[index] = { ...lines[index]!, accountId: event.target.value };
                      return { ...current, lines };
                    })
                  }
                  required
                >
                  <option value="">{ar ? 'الحساب…' : 'Account…'}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} — {ar ? account.nameAr : account.nameEn}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="decimal"
                  placeholder={ar ? 'مدين' : 'Debit'}
                  value={line.debit}
                  onChange={(event) =>
                    setForm((current) => {
                      const lines = [...current.lines];
                      lines[index] = {
                        ...lines[index]!,
                        debit: event.target.value,
                        credit: event.target.value ? '' : lines[index]!.credit,
                      };
                      return { ...current, lines };
                    })
                  }
                />
                <input
                  inputMode="decimal"
                  placeholder={ar ? 'دائن' : 'Credit'}
                  value={line.credit}
                  onChange={(event) =>
                    setForm((current) => {
                      const lines = [...current.lines];
                      lines[index] = {
                        ...lines[index]!,
                        credit: event.target.value,
                        debit: event.target.value ? '' : lines[index]!.debit,
                      };
                      return { ...current, lines };
                    })
                  }
                />
                <input
                  placeholder={ar ? 'ملاحظة' : 'Memo'}
                  value={line.memo}
                  onChange={(event) =>
                    setForm((current) => {
                      const lines = [...current.lines];
                      lines[index] = { ...lines[index]!, memo: event.target.value };
                      return { ...current, lines };
                    })
                  }
                />
                <button
                  type="button"
                  className="button button--quiet button--sm"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      lines: current.lines.filter((_, i) => i !== index),
                    }))
                  }
                  disabled={form.lines.length <= 2}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="accounting-hub__actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  lines: [...current.lines, { accountId: '', debit: '', credit: '', memo: '' }],
                }))
              }
            >
              {ar ? '＋ سطر' : '+ Line'}
            </button>
            <span
              className={`accounting-hub__balance ${lineBalance.ok ? 'accounting-hub__balance--ok' : 'accounting-hub__balance--bad'}`}
            >
              {ar ? 'مدين' : 'Debit'} {money(lineBalance.debit.toString(), 'OMR', ar)} ·{' '}
              {ar ? 'دائن' : 'Credit'} {money(lineBalance.credit.toString(), 'OMR', ar)}
            </span>
            <button className="button button--primary" type="submit" disabled={busy || !accounts.length}>
              {ar ? 'حفظ القيد' : 'Save entry'}
            </button>
          </div>
          {localError ? <p className="accounting-hub__error">{localError}</p> : null}
        </form>
      </div>
    </div>
  );
}
