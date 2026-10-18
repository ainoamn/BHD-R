'use client';

import { useState, type ReactNode } from 'react';
import { AccountingPropertyUnitFields } from '@/components/accounting/accounting-property-unit-fields';
import { browserNextMutation } from '@/lib/api';

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

function ModalShell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="accounting-hub__modal"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="accounting-hub__modal-card">
        <header className="accounting-hub__modal-head">
          <h2>{title}</h2>
          <button type="button" className="button button--quiet" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Expense / income entry opened from a toolbar button. */
export function AccountingExpenseIncomeModal({
  open,
  onClose,
  locale,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  locale: 'ar' | 'en';
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [form, setForm] = useState({
    category: ar ? 'تشغيل' : 'Operating',
    description: '',
    amount: '',
    issuedOn: todayIso(),
    method: 'bank',
    propertyId: '',
    unitId: '',
    partyId: '',
    linkTo: 'property' as 'property' | 'tenant' | 'owner',
  });

  return (
    <ModalShell
      open={open}
      title={ar ? 'إضافة صرف أو دخل' : 'Add expense or income'}
      onClose={onClose}
    >
      <form
        className="accounting-hub__form"
        onSubmit={(event) => {
          event.preventDefault();
          onBusy(true);
          void (async () => {
            try {
              if (kind === 'income') {
                await browserNextMutation('/api/owner/accounting/ops', {
                  method: 'POST',
                  body: JSON.stringify({
                    kind: 'income',
                    description: form.description,
                    amountMinor: toMinor(form.amount),
                    occurredOn: form.issuedOn,
                    method: form.method,
                    ...(form.propertyId ? { propertyId: form.propertyId } : {}),
                    ...(form.unitId ? { unitId: form.unitId } : {}),
                    ...(form.partyId ? { partyId: form.partyId } : {}),
                  }),
                });
              } else {
                await browserNextMutation('/api/owner/accounting/expenses', {
                  method: 'POST',
                  body: JSON.stringify({
                    category: form.category,
                    description: form.description,
                    amountMinor: toMinor(form.amount),
                    currency: 'OMR',
                    issuedOn: form.issuedOn,
                    ...(form.propertyId ? { propertyId: form.propertyId } : {}),
                    ...(form.unitId ? { unitId: form.unitId } : {}),
                    ...(form.partyId ? { partyId: form.partyId } : {}),
                  }),
                });
              }
              setForm((current) => ({ ...current, description: '', amount: '' }));
              onDone();
              onClose();
            } catch {
              onError(ar ? 'تعذر تسجيل الحركة' : 'Could not record the entry');
            } finally {
              onBusy(false);
            }
          })();
        }}
      >
        <div className="accounting-hub__form-grid">
          <label>
            {ar ? 'النوع' : 'Type'}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as 'expense' | 'income')}
            >
              <option value="expense">{ar ? 'صرف / مصروف' : 'Expense'}</option>
              <option value="income">{ar ? 'دخل' : 'Income'}</option>
            </select>
          </label>
          {kind === 'expense' ? (
            <label>
              {ar ? 'التصنيف' : 'Category'}
              <input
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({ ...current, category: event.target.value }))
                }
                required
              />
            </label>
          ) : (
            <label>
              {ar ? 'طريقة القبض' : 'Collection method'}
              <select
                value={form.method}
                onChange={(event) =>
                  setForm((current) => ({ ...current, method: event.target.value }))
                }
              >
                <option value="cash">{ar ? 'نقداً' : 'Cash'}</option>
                <option value="bank">{ar ? 'بنك / تحويل' : 'Bank / transfer'}</option>
                <option value="cheque">{ar ? 'شيك' : 'Cheque'}</option>
              </select>
            </label>
          )}
          <label>
            {ar ? 'الوصف' : 'Description'}
            <input
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              required
            />
          </label>
          <label>
            {ar ? 'المبلغ' : 'Amount'}
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
              required
            />
          </label>
          <label>
            {ar ? 'التاريخ' : 'Date'}
            <input
              type="date"
              value={form.issuedOn}
              onChange={(event) =>
                setForm((current) => ({ ...current, issuedOn: event.target.value }))
              }
              required
            />
          </label>
          <AccountingPropertyUnitFields
            locale={locale}
            propertyId={form.propertyId}
            unitId={form.unitId}
            partyId={form.partyId}
            linkTo={form.linkTo}
            showLink
            onChange={(next) => setForm((current) => ({ ...current, ...next }))}
          />
        </div>
        <div className="accounting-hub__actions">
          <button type="button" className="button button--quiet" onClick={onClose}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button className="button button--primary" type="submit" disabled={busy}>
            {kind === 'income'
              ? ar
                ? 'حفظ الدخل'
                : 'Save income'
              : ar
                ? 'حفظ المصروف'
                : 'Save expense'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/** Purchase / sale entry opened from a toolbar button. */
export function AccountingTradingModal({
  open,
  onClose,
  locale,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  locale: 'ar' | 'en';
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const [kind, setKind] = useState<'purchase' | 'sale'>('purchase');
  const [form, setForm] = useState({
    description: '',
    amount: '',
    occurredOn: todayIso(),
    method: 'bank',
    propertyId: '',
    unitId: '',
  });

  return (
    <ModalShell
      open={open}
      title={ar ? 'إضافة مشتريات أو مبيعات' : 'Add purchase or sale'}
      onClose={onClose}
    >
      <form
        className="accounting-hub__form"
        onSubmit={(event) => {
          event.preventDefault();
          onBusy(true);
          void (async () => {
            try {
              await browserNextMutation('/api/owner/accounting/ops', {
                method: 'POST',
                body: JSON.stringify({
                  kind,
                  description: form.description,
                  amountMinor: toMinor(form.amount),
                  occurredOn: form.occurredOn,
                  method: form.method,
                  ...(form.propertyId ? { propertyId: form.propertyId } : {}),
                  ...(form.unitId ? { unitId: form.unitId } : {}),
                }),
              });
              setForm((current) => ({ ...current, description: '', amount: '' }));
              onDone();
              onClose();
            } catch {
              onError(ar ? 'تعذر تسجيل الحركة' : 'Could not record the entry');
            } finally {
              onBusy(false);
            }
          })();
        }}
      >
        <div className="accounting-hub__form-grid">
          <label>
            {ar ? 'النوع' : 'Type'}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as 'purchase' | 'sale')}
            >
              <option value="purchase">{ar ? 'مشتريات' : 'Purchase'}</option>
              <option value="sale">{ar ? 'مبيعات' : 'Sale'}</option>
            </select>
          </label>
          <label>
            {ar ? 'الوصف' : 'Description'}
            <input
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              required
            />
          </label>
          <label>
            {ar ? 'المبلغ' : 'Amount'}
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
              required
            />
          </label>
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
            {ar ? 'طريقة الدفع / التحصيل' : 'Pay / collect via'}
            <select
              value={form.method}
              onChange={(event) =>
                setForm((current) => ({ ...current, method: event.target.value }))
              }
            >
              <option value="cash">{ar ? 'نقداً' : 'Cash'}</option>
              <option value="bank">{ar ? 'بنك / تحويل' : 'Bank / transfer'}</option>
              <option value="cheque">{ar ? 'شيك' : 'Cheque'}</option>
              {kind === 'purchase' ? (
                <option value="payable">{ar ? 'آجل (موردون)' : 'On credit (payables)'}</option>
              ) : (
                <option value="receivable">{ar ? 'آجل (ذمم)' : 'On credit (receivables)'}</option>
              )}
            </select>
          </label>
          <AccountingPropertyUnitFields
            locale={locale}
            propertyId={form.propertyId}
            unitId={form.unitId}
            onChange={(next) => setForm((current) => ({ ...current, ...next }))}
          />
        </div>
        <div className="accounting-hub__actions">
          <button type="button" className="button button--quiet" onClick={onClose}>
            {ar ? 'إلغاء' : 'Cancel'}
          </button>
          <button className="button button--primary" type="submit" disabled={busy}>
            {kind === 'purchase'
              ? ar
                ? 'حفظ المشتريات'
                : 'Save purchase'
              : ar
                ? 'حفظ المبيعات'
                : 'Save sale'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
