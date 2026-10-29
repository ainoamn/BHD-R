'use client';

import { useEffect, useState } from 'react';
import type { DimensionProperty } from '@/components/accounting/accounting-property-unit-fields';
import {
  DEFAULT_ACCOUNTING_SETTINGS,
  type AccountingBankAccount,
  type AccountingFxRate,
  type AccountingSettings,
  type AccountingTaxRow,
} from '@/lib/accounting-integrity';
import { browserNextMutation } from '@/lib/api';
import { OMAN_BANKS } from '@/lib/stay-deposit-refund';

function newBankAccountId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bank-${Date.now().toString(36)}`;
}

const BANK_OTHER = '__other__';

function emptyBankAccount(baseCurrency: string, makeDefault: boolean): AccountingBankAccount {
  return {
    id: newBankAccountId(),
    labelAr: 'حساب بنكي',
    labelEn: 'Bank account',
    bankName: OMAN_BANKS[0] ?? '',
    accountHolderName: '',
    accountHolderNameEn: '',
    iban: '',
    accountNumber: '',
    currency: baseCurrency,
    active: true,
    defaultForRent: makeDefault,
    propertyIds: [],
    ledgerAccountId: null,
  };
}

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
  const [properties, setProperties] = useState<DimensionProperty[]>([]);
  const [translating, setTranslating] = useState<string | null>(null);
  const [customBankIds, setCustomBankIds] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/owner/accounting/dimensions', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { properties?: DimensionProperty[] };
        if (!cancelled) setProperties(data.properties ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function translateHolder(index: number, direction: 'to_en' | 'to_ar') {
    const account = settings.bankAccounts[index];
    if (!account) return;
    const source =
      direction === 'to_en' ? account.accountHolderName.trim() : account.accountHolderNameEn.trim();
    if (source.length < 2) {
      onError(
        ar
          ? 'اكتب اسم صاحب الحساب أولاً ثم اطلب الترجمة.'
          : 'Enter the account holder name first, then translate.',
      );
      return;
    }
    setTranslating(`${account.id}:${direction}`);
    try {
      const result = await browserNextMutation<{ text: string }>('/api/owner/notes/translate', {
        method: 'POST',
        body: JSON.stringify({
          text: source.slice(0, 160),
          target: direction === 'to_en' ? 'en' : 'ar',
        }),
      });
      updateBank(
        index,
        direction === 'to_en'
          ? { accountHolderNameEn: result.text.trim().slice(0, 160) }
          : { accountHolderName: result.text.trim().slice(0, 160) },
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : ar ? 'تعذرت الترجمة' : 'Translate failed');
    } finally {
      setTranslating(null);
    }
  }

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

  const updateBank = (index: number, patch: Partial<AccountingBankAccount>) => {
    setSettings((current) => ({
      ...current,
      bankAccounts: current.bankAccounts.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
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
          <p className="accounting-hub__muted">
            {ar ? 'لا ضرائب إضافية بعد.' : 'No extra taxes yet.'}
          </p>
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
              currencies: [
                ...current.currencies,
                { code: 'GBP', rateToBase: '0.500', minorUnit: 2 },
              ],
            }))
          }
        >
          {ar ? '＋ عملة' : '+ Currency'}
        </button>
      </fieldset>

      <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
        <legend>
          {ar ? 'الحسابات البنكية لاستلام الإيجار' : 'Bank accounts for rent receipts'}
        </legend>
        <p className="accounting-hub__muted">
          {ar
            ? 'أضف حسابات البنك واربطها بالعقارات — تظهر تلقائياً في عقود تلك العقارات دون اختيار يدوي (يمكن تغييرها لاحقاً).'
            : 'Add bank accounts and link them to properties — they auto-fill on those properties’ leases (still changeable later).'}
        </p>
        {(settings.bankAccounts ?? []).map((account, index) => {
          const listed = (OMAN_BANKS).includes(account.bankName);
          const custom =
            customBankIds.has(account.id) || (Boolean(account.bankName.trim()) && !listed);
          const bankSelect = custom ? BANK_OTHER : account.bankName;
          return (
            <div key={account.id} className="accounting-bank-card">
              <div className="accounting-hub__form-grid">
                <label className="accounting-settings__field">
                  {ar ? 'التسمية عربي' : 'Label AR'}
                  <input
                    className="input"
                    value={account.labelAr}
                    onChange={(event) => updateBank(index, { labelAr: event.target.value })}
                  />
                </label>
                <label className="accounting-settings__field">
                  {ar ? 'التسمية إنجليزي' : 'Label EN'}
                  <input
                    className="input"
                    value={account.labelEn}
                    onChange={(event) => updateBank(index, { labelEn: event.target.value })}
                  />
                </label>
                <label className="accounting-settings__field">
                  {ar ? 'اسم البنك' : 'Bank name'}
                  <select
                    className="select"
                    value={bankSelect}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === BANK_OTHER) {
                        setCustomBankIds((current) => new Set(current).add(account.id));
                        if (listed) updateBank(index, { bankName: '' });
                        return;
                      }
                      setCustomBankIds((current) => {
                        const next = new Set(current);
                        next.delete(account.id);
                        return next;
                      });
                      updateBank(index, { bankName: value });
                    }}
                  >
                    <option value="">{ar ? '— اختر البنك —' : '— Select bank —'}</option>
                    {OMAN_BANKS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value={BANK_OTHER}>{ar ? 'بنك آخر…' : 'Other bank…'}</option>
                  </select>
                </label>
                {custom ? (
                  <label className="accounting-settings__field">
                    {ar ? 'اسم البنك (يدوي)' : 'Bank name (custom)'}
                    <input
                      className="input"
                      value={account.bankName}
                      placeholder={ar ? 'اكتب اسم البنك' : 'Type the bank name'}
                      onChange={(event) => updateBank(index, { bankName: event.target.value })}
                    />
                  </label>
                ) : null}
                <label className="accounting-settings__field">
                  {ar ? 'اسم صاحب الحساب (عربي)' : 'Account holder (Arabic)'}
                  <input
                    className="input"
                    value={account.accountHolderName}
                    onChange={(event) =>
                      updateBank(index, { accountHolderName: event.target.value })
                    }
                  />
                </label>
                <label className="accounting-settings__field">
                  {ar ? 'اسم صاحب الحساب (إنجليزي)' : 'Account holder (English)'}
                  <input
                    className="input"
                    dir="ltr"
                    value={account.accountHolderNameEn}
                    onChange={(event) =>
                      updateBank(index, { accountHolderNameEn: event.target.value })
                    }
                  />
                </label>
                <div className="accounting-settings__translate">
                  <button
                    type="button"
                    className="button button--quiet button--sm"
                    disabled={busy || translating !== null}
                    onClick={() => void translateHolder(index, 'to_en')}
                  >
                    {translating === `${account.id}:to_en`
                      ? ar
                        ? 'جارٍ الترجمة…'
                        : 'Translating…'
                      : ar
                        ? 'ترجمة ذكية ← إنجليزي'
                        : 'Smart translate → English'}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet button--sm"
                    disabled={busy || translating !== null}
                    onClick={() => void translateHolder(index, 'to_ar')}
                  >
                    {translating === `${account.id}:to_ar`
                      ? ar
                        ? 'جارٍ الترجمة…'
                        : 'Translating…'
                      : ar
                        ? 'ترجمة ذكية ← عربي'
                        : 'Smart translate → Arabic'}
                  </button>
                </div>
                <label className="accounting-settings__field">
                  {ar ? 'رقم الحساب' : 'Account number'}
                  <input
                    className="input"
                    dir="ltr"
                    value={account.accountNumber}
                    onChange={(event) => updateBank(index, { accountNumber: event.target.value })}
                  />
                </label>
                <label className="accounting-settings__field">
                  IBAN
                  <input
                    className="input"
                    dir="ltr"
                    value={account.iban}
                    onChange={(event) => updateBank(index, { iban: event.target.value })}
                  />
                </label>
                <label className="accounting-settings__field">
                  {ar ? 'العملة' : 'Currency'}
                  <input
                    className="input"
                    value={account.currency}
                    maxLength={3}
                    onChange={(event) =>
                      updateBank(index, { currency: event.target.value.toUpperCase() })
                    }
                  />
                </label>
                <label className="accounting-settings__check">
                  <input
                    type="checkbox"
                    checked={account.defaultForRent}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        bankAccounts: current.bankAccounts.map((row, i) => ({
                          ...row,
                          defaultForRent: i === index ? event.target.checked : false,
                        })),
                      }))
                    }
                  />
                  {ar
                    ? 'افتراضي لإيجار جديد (عقارات غير مربوطة)'
                    : 'Default for new leases (unlinked properties)'}
                </label>
                <label className="accounting-settings__check">
                  <input
                    type="checkbox"
                    checked={account.active}
                    onChange={(event) => updateBank(index, { active: event.target.checked })}
                  />
                  {ar ? 'نشط' : 'Active'}
                </label>
              </div>

              <div className="accounting-bank-card__properties">
                <strong>
                  {ar ? 'العقارات المرتبطة بهذا الحساب' : 'Properties linked to this account'}
                </strong>
                <p className="accounting-hub__muted">
                  {ar
                    ? 'عقود هذه العقارات تختار هذا الحساب تلقائياً. اتركها فارغة إن كان الحساب عاماً فقط.'
                    : 'Leases on these properties pick this account automatically. Leave empty for an org-wide account.'}
                </p>
                {properties.length ? (
                  <ul className="accounting-bank-card__property-list">
                    {properties.map((property) => {
                      const checked = account.propertyIds.includes(property.id);
                      return (
                        <li key={property.id}>
                          <label className="accounting-settings__check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const next = event.target.checked
                                  ? [...account.propertyIds, property.id]
                                  : account.propertyIds.filter((id) => id !== property.id);
                                updateBank(index, { propertyIds: next });
                              }}
                            />
                            <span>
                              {ar ? property.nameAr : property.nameEn || property.nameAr}
                              {property.serial ? (
                                <small dir="ltr"> · {property.serial}</small>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="accounting-hub__muted">
                    {ar ? 'لا عقارات ظاهرة بعد.' : 'No properties available yet.'}
                  </p>
                )}
              </div>

              <div className="accounting-bank-card__actions">
                <button
                  type="button"
                  className="button button--quiet button--sm"
                  onClick={() =>
                    setSettings((current) => ({
                      ...current,
                      bankAccounts: current.bankAccounts.filter((_, i) => i !== index),
                    }))
                  }
                >
                  {ar ? 'حذف الحساب' : 'Remove account'}
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="button button--quiet button--sm"
          onClick={() =>
            setSettings((current) => ({
              ...current,
              bankAccounts: [
                ...current.bankAccounts,
                emptyBankAccount(
                  current.baseCurrency,
                  current.bankAccounts.every((item) => !item.defaultForRent),
                ),
              ],
            }))
          }
        >
          {ar ? '＋ حساب بنكي' : '+ Bank account'}
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
          {ar
            ? 'العرض فقط — يلزم صلاحية إدارة المحاسبة للحفظ.'
            : 'Read-only — accounting manage required to save.'}
        </p>
      )}
    </div>
  );
}
