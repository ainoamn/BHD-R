'use client';

import { useState } from 'react';
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

type Kind = 'purchase' | 'sale';

/** Purchases and sales that post balanced journals, optionally linked to a property/unit. */
export function AccountingTradingPanel({
  locale,
  canManage,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  locale: 'ar' | 'en';
  canManage: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const ar = locale === 'ar';
  const [kind, setKind] = useState<Kind>('purchase');
  const [form, setForm] = useState({
    description: '',
    amount: '',
    occurredOn: todayIso(),
    method: 'bank',
    propertyId: '',
    unitId: '',
  });

  return (
    <div className="accounting-hub__panel">
      <h2>{ar ? 'المشتريات والمبيعات' : 'Purchases & sales'}</h2>
      <p className="accounting-hub__hint">
        {ar
          ? 'سجّل فاتورة شراء أو بيع؛ يُنشأ قيد مزدوج تلقائياً (مشتريات 5600 / مبيعات 4400) مع ربط اختياري بالمبنى أو الوحدة.'
          : 'Record a purchase or sale; a balanced journal posts automatically (purchases 5600 / sales 4400), optionally linked to a property or unit.'}
      </p>
      {canManage ? (
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
                onChange={(event) => setKind(event.target.value as Kind)}
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
          <button className="button button--primary" type="submit" disabled={busy}>
            {kind === 'purchase'
              ? ar
                ? 'تسجيل مشتريات + قيد'
                : 'Record purchase + journal'
              : ar
                ? 'تسجيل مبيعات + قيد'
                : 'Record sale + journal'}
          </button>
        </form>
      ) : (
        <p className="muted">{ar ? 'عرض فقط — لا صلاحية إدخال.' : 'Read-only — no posting rights.'}</p>
      )}
    </div>
  );
}
