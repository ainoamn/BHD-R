'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_ACCOUNTING_SETTINGS,
  type AccountingFxRate,
  type AccountingSettings,
  type AccountingTaxRow,
} from '@/lib/accounting-integrity';
import { browserNextMutation } from '@/lib/api';

export function AccountingSettingsPanel({
  locale,
  canManage,
  busy,
  onBusy,
  onError,
  onSaved,
}: {
  locale: 'ar' | 'en';
  canManage: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (message: string) => void;
  onSaved?: () => void;
}) {
  const ar = locale === 'ar';
  const [settings, setSettings] = useState<AccountingSettings>(DEFAULT_ACCOUNTING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch('/api/owner/accounting/settings', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(ar ? 'تعذر التحميل' : 'Load failed');
        const data = (await response.json()) as { settings: AccountingSettings };
        if (!cancelled) setSettings(data.settings);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : ar ? 'تعذر التحميل' : 'Load failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Load once per mount; parent onError may be inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [ar]);

  const save = () => {
    onBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const result = await browserNextMutation<{ settings: AccountingSettings }>(
          '/api/owner/accounting/settings',
          { method: 'PUT', body: JSON.stringify(settings) },
        );
        setSettings(result.settings);
        setNotice(ar ? 'تم حفظ ضبط الحسابات.' : 'Accounting settings saved.');
        onSaved?.();
      } catch (error) {
        onError(error instanceof Error ? error.message : ar ? 'تعذر الحفظ' : 'Save failed');
      } finally {
        onBusy(false);
      }
    })();
  };

  const updateTax = (index: number, patch: Partial<AccountingTaxRow>) => {
    setSettings((current) => ({
      ...current,
      otherTaxes: current.otherTaxes.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  const updateFx = (index: number, patch: Partial<AccountingFxRate>) => {
    setSettings((current) => ({
      ...current,
      currencies: current.currencies.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  };

  if (loading) {
    return <p className="accounting-hub__muted">{ar ? 'جاري التحميل…' : 'Loading…'}</p>;
  }

  return (
    <div className="accounting-hub__panel accounting-settings">
      <h2>{ar ? 'ضبط الحسابات' : 'Accounting settings'}</h2>
      <p className="accounting-hub__muted">
        {ar
          ? 'نسبة الضريبة والعملات وسياسة الحذف والعكس. المعاملات المرحّلة والإلكترونية لا تُمحى — تُعكس بعد التحقق والاعتماد.'
          : 'VAT, FX rates, and delete/reverse policy. Posted and electronic lines are never erased — reverse after verification and approval.'}
      </p>
      {notice ? <p className="accounting-hub__meta">{notice}</p> : null}

      <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
        <legend>{ar ? 'ضريبة القيمة المضافة' : 'VAT'}</legend>
        <label className="accounting-settings__check">
          <input
            type="checkbox"
            checked={settings.vatEnabled}
            onChange={(event) =>
              setSettings((current) => ({ ...current, vatEnabled: event.target.checked }))
            }
          />
          {ar ? 'تفعيل ضريبة القيمة المضافة' : 'Enable VAT'}
        </label>
        <label>
          {ar ? 'نسبة الضريبة %' : 'VAT rate %'}
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={settings.vatRatePercent}
            disabled={!settings.vatEnabled}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                vatRatePercent: Number(event.target.value) || 0,
              }))
            }
          />
        </label>
      </fieldset>

      <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
        <legend>{ar ? 'ضرائب أخرى' : 'Other taxes'}</legend>
        {settings.otherTaxes.length === 0 ? (
          <p className="accounting-hub__muted">{ar ? 'لا ضرائب إضافية بعد.' : 'No extra taxes yet.'}</p>
        ) : null}
        {settings.otherTaxes.map((tax, index) => (
          <div key={`${tax.code}-${index}`} className="accounting-hub__form-grid">
            <label>
              {ar ? 'الرمز' : 'Code'}
              <input
                value={tax.code}
                onChange={(event) => updateTax(index, { code: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              {ar ? 'الاسم عربي' : 'Name AR'}
              <input
                value={tax.nameAr}
                onChange={(event) => updateTax(index, { nameAr: event.target.value })}
              />
            </label>
            <label>
              {ar ? 'الاسم إنجليزي' : 'Name EN'}
              <input
                value={tax.nameEn}
                onChange={(event) => updateTax(index, { nameEn: event.target.value })}
              />
            </label>
            <label>
              {ar ? 'النسبة %' : 'Rate %'}
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={tax.ratePercent}
                onChange={(event) =>
                  updateTax(index, { ratePercent: Number(event.target.value) || 0 })
                }
              />
            </label>
            <button
              type="button"
              className="button button--quiet button--sm"
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  otherTaxes: current.otherTaxes.filter((_, i) => i !== index),
                }))
              }
            >
              {ar ? 'حذف' : 'Remove'}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--quiet button--sm"
          onClick={() =>
            setSettings((current) => ({
              ...current,
              otherTaxes: [
                ...current.otherTaxes,
                { code: 'TAX', nameAr: 'ضريبة', nameEn: 'Tax', ratePercent: 0 },
              ],
            }))
          }
        >
          {ar ? '＋ ضريبة' : '+ Tax'}
        </button>
      </fieldset>

      <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
        <legend>{ar ? 'العملات الأجنبية' : 'Foreign currencies'}</legend>
        <label>
          {ar ? 'عملة الأساس' : 'Base currency'}
          <input
            value={settings.baseCurrency}
            maxLength={3}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                baseCurrency: event.target.value.toUpperCase(),
              }))
            }
          />
        </label>
        {settings.currencies.map((fx, index) => (
          <div key={`${fx.code}-${index}`} className="accounting-hub__form-grid">
            <label>
              {ar ? 'العملة' : 'Code'}
              <input
                value={fx.code}
                maxLength={3}
                onChange={(event) => updateFx(index, { code: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              {ar ? `سعر التحويل إلى ${settings.baseCurrency}` : `Rate to ${settings.baseCurrency}`}
              <input
                value={fx.rateToBase}
                onChange={(event) => updateFx(index, { rateToBase: event.target.value })}
              />
            </label>
            <label>
              {ar ? 'الكسور' : 'Minor'}
              <input
                type="number"
                min={0}
                max={6}
                value={fx.minorUnit}
                onChange={(event) =>
                  updateFx(index, { minorUnit: Number(event.target.value) || 0 })
                }
              />
            </label>
            <button
              type="button"
              className="button button--quiet button--sm"
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  currencies: current.currencies.filter((_, i) => i !== index),
                }))
              }
            >
              {ar ? 'حذف' : 'Remove'}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--quiet button--sm"
          onClick={() =>
            setSettings((current) => ({
              ...current,
              currencies: [...current.currencies, { code: 'GBP', rateToBase: '0.500', minorUnit: 2 }],
            }))
          }
        >
          {ar ? '＋ عملة' : '+ Currency'}
        </button>
      </fieldset>

      <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
        <legend>{ar ? 'سلامة الدفاتر' : 'Book integrity'}</legend>
        <label className="accounting-settings__check">
          <input
            type="checkbox"
            checked={settings.blockUnpostForLinked}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                blockUnpostForLinked: event.target.checked,
              }))
            }
          />
          {ar
            ? 'منع حذف ترحيل القيود المربوطة — العكس فقط'
            : 'Block unpost for linked journals — reverse only'}
        </label>
        <label className="accounting-settings__check">
          <input
            type="checkbox"
            checked={settings.requireRefundConfirmForOnline}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                requireRefundConfirmForOnline: event.target.checked,
              }))
            }
          />
          {ar
            ? 'عكس الدفع الإلكتروني يتطلب تأكيد الاسترداد / فشل التحصيل'
            : 'Electronic reverse requires refund / collection-failure confirm'}
        </label>
        <label className="accounting-settings__check">
          <input
            type="checkbox"
            checked={settings.requireSecondApproverForOnline}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                requireSecondApproverForOnline: event.target.checked,
              }))
            }
          />
          {ar
            ? 'عكس المعاملات الإلكترونية يحتاج اعتماداً ثانياً'
            : 'Electronic reverse needs a second approver'}
        </label>
      </fieldset>

      {canManage ? (
        <button type="button" className="button button--primary" disabled={busy} onClick={save}>
          {ar ? 'حفظ الضبط' : 'Save settings'}
        </button>
      ) : (
        <p className="accounting-hub__muted">
          {ar ? 'العرض فقط — يلزم صلاحية إدارة المحاسبة للحفظ.' : 'Read-only — accounting manage required to save.'}
        </p>
      )}
    </div>
  );
}
