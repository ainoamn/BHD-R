'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DimensionProperty } from '@/components/accounting/accounting-property-unit-fields';
import {
  DEFAULT_ACCOUNTING_SETTINGS,
  isRentBankAccountComplete,
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

type SettingsSection = 'taxes' | 'fx' | 'banks' | 'integrity';

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
  const [section, setSection] = useState<SettingsSection>('banks');

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

  const incompleteBanks = useMemo(
    () => (settings.bankAccounts ?? []).filter((row) => !isRentBankAccountComplete(row)).length,
    [settings.bankAccounts],
  );

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
    return (
      <div className="accounting-settings accounting-settings--loading">
        <p className="accounting-hub__muted">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
      </div>
    );
  }

  const sections: Array<{ id: SettingsSection; label: string; hint: string; badge?: number }> = [
    {
      id: 'banks',
      label: ar ? 'الحسابات البنكية' : 'Bank accounts',
      hint: ar ? 'مستفيد شيكات الإيجار' : 'Rent cheque payee',
      ...(incompleteBanks > 0 ? { badge: incompleteBanks } : {}),
    },
    {
      id: 'taxes',
      label: ar ? 'الضرائب' : 'Taxes',
      hint: ar ? 'ضريبة القيمة المضافة وغيرها' : 'VAT and other taxes',
    },
    {
      id: 'fx',
      label: ar ? 'العملات' : 'Currencies',
      hint: ar ? 'عملة الأساس وأسعار التحويل' : 'Base currency and FX',
    },
    {
      id: 'integrity',
      label: ar ? 'سلامة الدفاتر' : 'Book integrity',
      hint: ar ? 'سياسات العكس والحذف' : 'Reverse and delete policy',
    },
  ];

  return (
    <div className="fin-dash fin-dash--workspace accounting-settings">
      <div className="fin-dash__secondary fin-dash__secondary--3">
        <div className="fin-dash__stat">
          <span>{ar ? 'حساب بنكي' : 'Banks'}</span>
          <strong>{settings.bankAccounts?.length ?? 0}</strong>
        </div>
        <div className="fin-dash__stat">
          <span>{ar ? 'ضريبة' : 'Taxes'}</span>
          <strong>{settings.otherTaxes.length + (settings.vatEnabled ? 1 : 0)}</strong>
        </div>
        <div className="fin-dash__stat">
          <span>{ar ? 'عملة' : 'FX'}</span>
          <strong>{1 + settings.currencies.length}</strong>
        </div>
      </div>
      <section className="fin-dash__section fin-dash__section--workspace">
        <header className="fin-dash__section-head">
          <div className="fin-dash__section-copy">
            <p className="accounting-hub__eyebrow">
              {ar ? 'إعدادات المحاسبة' : 'Accounting setup'}
            </p>
            <h2>{ar ? 'ضبط الحسابات' : 'Accounting settings'}</h2>
            <div className="fin-dash__section-hint">
              {ar
                ? 'نظّم الضرائب والعملات والحسابات البنكية وسياسة سلامة الدفاتر في مكان واحد مرتب.'
                : 'Organize taxes, currencies, bank accounts, and book-integrity policy in one clear place.'}
            </div>
          </div>
        </header>
        <div className="fin-dash__section-body accounting-settings__body">

      {notice ? (
        <p className="accounting-settings__notice" role="status">
          {notice}
        </p>
      ) : null}

      {incompleteBanks > 0 ? (
        <div className="accounting-settings__alert" role="status">
          <strong>
            {ar
              ? `${incompleteBanks} حساب بنكي غير مكتمل`
              : `${incompleteBanks} incomplete bank account${incompleteBanks === 1 ? '' : 's'}`}
          </strong>
          <span>
            {ar
              ? 'أكمل اسم المستفيد والبنك ورقم الحساب/IBAN حتى يظهر للمستأجر عند تحرير الشيكات.'
              : 'Complete payee name, bank, and account/IBAN so tenants see it when writing cheques.'}
          </span>
          <button
            type="button"
            className="button button--quiet button--sm"
            onClick={() => setSection('banks')}
          >
            {ar ? 'الانتقال للحسابات' : 'Go to banks'}
          </button>
        </div>
      ) : null}

      <nav className="accounting-settings__nav" aria-label={ar ? 'أقسام الضبط' : 'Settings sections'}>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              section === item.id
                ? 'accounting-settings__nav-btn accounting-settings__nav-btn--active'
                : 'accounting-settings__nav-btn'
            }
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
          >
            <span className="accounting-settings__nav-label">{item.label}</span>
            <small>{item.hint}</small>
            {item.badge ? <em>{item.badge}</em> : null}
          </button>
        ))}
      </nav>

      {section === 'taxes' ? (
        <div className="accounting-settings__stack">
          <section className="accounting-settings__card">
            <header className="accounting-settings__card-head">
              <div>
                <h3>{ar ? 'ضريبة القيمة المضافة' : 'Value-added tax'}</h3>
                <p className="accounting-hub__muted">
                  {ar
                    ? 'فعّل الضريبة وحدّد نسبتها الافتراضية للقيود والفواتير.'
                    : 'Enable VAT and set the default rate for journals and invoices.'}
                </p>
              </div>
            </header>
            <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
              <label className="accounting-settings__switch">
                <input
                  type="checkbox"
                  checked={settings.vatEnabled}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, vatEnabled: event.target.checked }))
                  }
                />
                <span>
                  <strong>{ar ? 'تفعيل ضريبة القيمة المضافة' : 'Enable VAT'}</strong>
                  <small>
                    {ar
                      ? 'عند الإيقاف تُخفى حقول الضريبة من المسارات الجديدة.'
                      : 'When off, VAT fields stay hidden on new flows.'}
                  </small>
                </span>
              </label>
              <label className="accounting-settings__field accounting-settings__field--narrow">
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
              <label className="accounting-settings__field">
                {ar ? 'معاملة إيجار ضريبة القيمة المضافة (عُمان)' : 'Rent VAT treatment (Oman)'}
                <select
                  value={settings.rentVatMode}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      rentVatMode: event.target.value === 'standard' ? 'standard' : 'exempt',
                    }))
                  }
                >
                  <option value="exempt">
                    {ar
                      ? 'سكني معفى (4010) — الافتراضي القانوني للإيجار السكني >3 أشهر'
                      : 'Residential exempt (4010) — default for residential leases >3 months'}
                  </option>
                  <option value="standard">
                    {ar
                      ? 'تجاري خاضع 5% (4000 + 2200)'
                      : 'Commercial taxable 5% (4000 + 2200)'}
                  </option>
                </select>
              </label>
              <label className="accounting-settings__switch">
                <input
                  type="checkbox"
                  checked={settings.accrualBasis}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, accrualBasis: event.target.checked }))
                  }
                />
                <span>
                  <strong>
                    {ar ? 'أساس الاستحقاق (IFRS)' : 'Accrual basis (IFRS)'}
                  </strong>
                  <small>
                    {ar
                      ? 'الفاتورة تثبّت الذمة والإيراد؛ القبض يصفّي الذمة دون تكرار الإيراد.'
                      : 'Invoice books AR + revenue; cash receipt clears AR without double-counting revenue.'}
                  </small>
                </span>
              </label>
            </fieldset>
          </section>

          <section className="accounting-settings__card">
            <header className="accounting-settings__card-head">
              <div>
                <h3>{ar ? 'ضرائب أخرى' : 'Other taxes'}</h3>
                <p className="accounting-hub__muted">
                  {ar
                    ? 'ضرائب إضافية اختيارية برمز ونسبة واسم ثنائي اللغة.'
                    : 'Optional extra taxes with code, rate, and bilingual names.'}
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="button button--quiet button--sm"
                  disabled={busy}
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
              ) : null}
            </header>
            <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
              {settings.otherTaxes.length === 0 ? (
                <p className="accounting-settings__empty">
                  {ar ? 'لا ضرائب إضافية بعد.' : 'No extra taxes yet.'}
                </p>
              ) : (
                <div className="accounting-settings__rows">
                  {settings.otherTaxes.map((tax, index) => (
                    <div key={`${tax.code}-${index}`} className="accounting-settings__row">
                      <div className="accounting-hub__form-grid">
                        <label className="accounting-settings__field">
                          {ar ? 'الرمز' : 'Code'}
                          <input
                            value={tax.code}
                            onChange={(event) =>
                              updateTax(index, { code: event.target.value.toUpperCase() })
                            }
                          />
                        </label>
                        <label className="accounting-settings__field">
                          {ar ? 'الاسم عربي' : 'Name AR'}
                          <input
                            value={tax.nameAr}
                            onChange={(event) => updateTax(index, { nameAr: event.target.value })}
                          />
                        </label>
                        <label className="accounting-settings__field">
                          {ar ? 'الاسم إنجليزي' : 'Name EN'}
                          <input
                            value={tax.nameEn}
                            onChange={(event) => updateTax(index, { nameEn: event.target.value })}
                          />
                        </label>
                        <label className="accounting-settings__field">
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
                      </div>
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
                </div>
              )}
            </fieldset>
          </section>
        </div>
      ) : null}

      {section === 'fx' ? (
        <section className="accounting-settings__card">
          <header className="accounting-settings__card-head">
            <div>
              <h3>{ar ? 'العملات الأجنبية' : 'Foreign currencies'}</h3>
              <p className="accounting-hub__muted">
                {ar
                  ? 'عملة الأساس للدفاتر وأسعار التحويل للعملات الأخرى.'
                  : 'Ledger base currency and conversion rates for other currencies.'}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                className="button button--quiet button--sm"
                disabled={busy}
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
            ) : null}
          </header>
          <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
            <label className="accounting-settings__field accounting-settings__field--narrow">
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
            {settings.currencies.length === 0 ? (
              <p className="accounting-settings__empty">
                {ar ? 'لا عملات إضافية بعد.' : 'No extra currencies yet.'}
              </p>
            ) : (
              <div className="accounting-settings__rows">
                {settings.currencies.map((fx, index) => (
                  <div key={`${fx.code}-${index}`} className="accounting-settings__row">
                    <div className="accounting-hub__form-grid">
                      <label className="accounting-settings__field">
                        {ar ? 'العملة' : 'Code'}
                        <input
                          value={fx.code}
                          maxLength={3}
                          onChange={(event) =>
                            updateFx(index, { code: event.target.value.toUpperCase() })
                          }
                        />
                      </label>
                      <label className="accounting-settings__field">
                        {ar
                          ? `سعر التحويل إلى ${settings.baseCurrency}`
                          : `Rate to ${settings.baseCurrency}`}
                        <input
                          value={fx.rateToBase}
                          onChange={(event) => updateFx(index, { rateToBase: event.target.value })}
                        />
                      </label>
                      <label className="accounting-settings__field">
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
                    </div>
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
              </div>
            )}
          </fieldset>
        </section>
      ) : null}

      {section === 'banks' ? (
        <section className="accounting-settings__card">
          <header className="accounting-settings__card-head">
            <div>
              <h3>{ar ? 'الحسابات البنكية لاستلام الإيجار' : 'Bank accounts for rent receipts'}</h3>
              <p className="accounting-hub__muted">
                {ar
                  ? 'اسم المستفيد يظهر للمستأجر عند تحرير الشيكات. اربط الحساب بالعقارات ليُملأ تلقائياً في العقود.'
                  : 'Payee name is shown to tenants when writing cheques. Link accounts to properties for auto-fill on leases.'}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                className="button button--primary button--sm"
                disabled={busy}
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
            ) : null}
          </header>

          <fieldset className="accounting-settings__block accounting-settings__block--flush" disabled={!canManage || busy}>
            {(settings.bankAccounts ?? []).length === 0 ? (
              <div className="accounting-settings__empty accounting-settings__empty--panel">
                <strong>{ar ? 'لا حسابات بنكية بعد' : 'No bank accounts yet'}</strong>
                <p>
                  {ar
                    ? 'أضف حساباً باسم المستفيد والبنك ورقم الحساب قبل التأجير أو التجديد.'
                    : 'Add a payee name, bank, and account number before leasing or renewing.'}
                </p>
              </div>
            ) : (
              <div className="accounting-settings__banks">
                {(settings.bankAccounts ?? []).map((account, index) => {
                  const listed = OMAN_BANKS.includes(account.bankName);
                  const custom =
                    customBankIds.has(account.id) ||
                    (Boolean(account.bankName.trim()) && !listed);
                  const bankSelect = custom ? BANK_OTHER : account.bankName;
                  const complete = isRentBankAccountComplete(account);
                  const payee =
                    (ar
                      ? account.accountHolderName.trim() || account.accountHolderNameEn.trim()
                      : account.accountHolderNameEn.trim() || account.accountHolderName.trim()) ||
                    (ar ? account.labelAr : account.labelEn || account.labelAr);
                  return (
                    <article
                      key={account.id}
                      className={
                        complete
                          ? 'accounting-bank-card'
                          : 'accounting-bank-card accounting-bank-card--incomplete'
                      }
                    >
                      <header className="accounting-bank-card__head">
                        <div>
                          <p className="accounting-bank-card__eyebrow">
                            {ar ? `حساب ${index + 1}` : `Account ${index + 1}`}
                          </p>
                          <h4>{payee || (ar ? 'حساب بدون اسم' : 'Unnamed account')}</h4>
                          <p className="accounting-hub__muted">
                            {[account.bankName.trim(), account.currency].filter(Boolean).join(' · ') ||
                              (ar ? 'أكمل بيانات البنك' : 'Complete bank details')}
                          </p>
                        </div>
                        <div className="accounting-bank-card__badges">
                          {account.defaultForRent ? (
                            <span className="accounting-bank-card__badge accounting-bank-card__badge--accent">
                              {ar ? 'افتراضي' : 'Default'}
                            </span>
                          ) : null}
                          <span
                            className={
                              account.active
                                ? 'accounting-bank-card__badge accounting-bank-card__badge--ok'
                                : 'accounting-bank-card__badge'
                            }
                          >
                            {account.active ? (ar ? 'نشط' : 'Active') : ar ? 'موقوف' : 'Inactive'}
                          </span>
                          <span
                            className={
                              complete
                                ? 'accounting-bank-card__badge accounting-bank-card__badge--ok'
                                : 'accounting-bank-card__badge accounting-bank-card__badge--warn'
                            }
                          >
                            {complete ? (ar ? 'مكتمل' : 'Complete') : ar ? 'ناقص' : 'Incomplete'}
                          </span>
                        </div>
                      </header>

                      <div className="accounting-bank-card__groups">
                        <div className="accounting-bank-card__group">
                          <h5>{ar ? 'التسمية' : 'Labels'}</h5>
                          <div className="accounting-hub__form-grid">
                            <label className="accounting-settings__field">
                              {ar ? 'التسمية عربي' : 'Label AR'}
                              <input
                                className="input"
                                value={account.labelAr}
                                onChange={(event) =>
                                  updateBank(index, { labelAr: event.target.value })
                                }
                              />
                            </label>
                            <label className="accounting-settings__field">
                              {ar ? 'التسمية إنجليزي' : 'Label EN'}
                              <input
                                className="input"
                                value={account.labelEn}
                                onChange={(event) =>
                                  updateBank(index, { labelEn: event.target.value })
                                }
                              />
                            </label>
                          </div>
                        </div>

                        <div className="accounting-bank-card__group">
                          <h5>{ar ? 'البنك والمستفيد' : 'Bank & payee'}</h5>
                          <div className="accounting-hub__form-grid">
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
                                <option value="">
                                  {ar ? '— اختر البنك —' : '— Select bank —'}
                                </option>
                                {OMAN_BANKS.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                                <option value={BANK_OTHER}>
                                  {ar ? 'بنك آخر…' : 'Other bank…'}
                                </option>
                              </select>
                            </label>
                            {custom ? (
                              <label className="accounting-settings__field">
                                {ar ? 'اسم البنك (يدوي)' : 'Bank name (custom)'}
                                <input
                                  className="input"
                                  value={account.bankName}
                                  placeholder={ar ? 'اكتب اسم البنك' : 'Type the bank name'}
                                  onChange={(event) =>
                                    updateBank(index, { bankName: event.target.value })
                                  }
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
                          </div>
                        </div>

                        <div className="accounting-bank-card__group">
                          <h5>{ar ? 'أرقام الحساب' : 'Account numbers'}</h5>
                          <div className="accounting-hub__form-grid">
                            <label className="accounting-settings__field">
                              {ar ? 'رقم الحساب' : 'Account number'}
                              <input
                                className="input"
                                dir="ltr"
                                value={account.accountNumber}
                                onChange={(event) =>
                                  updateBank(index, { accountNumber: event.target.value })
                                }
                              />
                            </label>
                            <label className="accounting-settings__field">
                              IBAN
                              <input
                                className="input"
                                dir="ltr"
                                value={account.iban}
                                onChange={(event) =>
                                  updateBank(index, { iban: event.target.value })
                                }
                              />
                            </label>
                            <label className="accounting-settings__field accounting-settings__field--narrow">
                              {ar ? 'العملة' : 'Currency'}
                              <input
                                className="input"
                                value={account.currency}
                                maxLength={3}
                                onChange={(event) =>
                                  updateBank(index, {
                                    currency: event.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </label>
                          </div>
                        </div>

                        <div className="accounting-bank-card__group">
                          <h5>{ar ? 'الخيارات' : 'Options'}</h5>
                          <div className="accounting-settings__switches">
                            <label className="accounting-settings__switch">
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
                              <span>
                                <strong>
                                  {ar
                                    ? 'افتراضي لإيجار جديد'
                                    : 'Default for new leases'}
                                </strong>
                                <small>
                                  {ar
                                    ? 'للعقارات غير المربوطة بحساب آخر'
                                    : 'For properties not linked to another account'}
                                </small>
                              </span>
                            </label>
                            <label className="accounting-settings__switch">
                              <input
                                type="checkbox"
                                checked={account.active}
                                onChange={(event) =>
                                  updateBank(index, { active: event.target.checked })
                                }
                              />
                              <span>
                                <strong>{ar ? 'نشط' : 'Active'}</strong>
                                <small>
                                  {ar
                                    ? 'الحسابات الموقوفة لا تُقترح في العقود الجديدة'
                                    : 'Inactive accounts are not suggested on new leases'}
                                </small>
                              </span>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="accounting-bank-card__properties">
                        <div className="accounting-bank-card__properties-head">
                          <strong>
                            {ar
                              ? 'العقارات المرتبطة بهذا الحساب'
                              : 'Properties linked to this account'}
                          </strong>
                          <span>
                            {account.propertyIds.length
                              ? ar
                                ? `${account.propertyIds.length} عقار`
                                : `${account.propertyIds.length} linked`
                              : ar
                                ? 'عام للمؤسسة'
                                : 'Org-wide'}
                          </span>
                        </div>
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
                                      {ar
                                        ? property.nameAr
                                        : property.nameEn || property.nameAr}
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
                    </article>
                  );
                })}
              </div>
            )}
          </fieldset>
        </section>
      ) : null}

      {section === 'integrity' ? (
        <section className="accounting-settings__card">
          <header className="accounting-settings__card-head">
            <div>
              <h3>{ar ? 'سلامة الدفاتر' : 'Book integrity'}</h3>
              <p className="accounting-hub__muted">
                {ar
                  ? 'المعاملات المرحّلة والإلكترونية لا تُمحى — تُعكس بعد التحقق والاعتماد.'
                  : 'Posted and electronic lines are never erased — reverse after verification and approval.'}
              </p>
            </div>
          </header>
          <fieldset className="accounting-settings__block" disabled={!canManage || busy}>
            <div className="accounting-settings__switches">
              <label className="accounting-settings__switch">
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
                <span>
                  <strong>
                    {ar
                      ? 'منع حذف ترحيل القيود المربوطة — العكس فقط'
                      : 'Block unpost for linked journals — reverse only'}
                  </strong>
                  <small>
                    {ar
                      ? 'يحمي القيود المرتبطة بالمدفوعات والعقود من المسح المباشر.'
                      : 'Protects journals linked to payments and contracts from direct erase.'}
                  </small>
                </span>
              </label>
              <label className="accounting-settings__switch">
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
                <span>
                  <strong>
                    {ar
                      ? 'عكس الدفع الإلكتروني يتطلب تأكيد الاسترداد / فشل التحصيل'
                      : 'Electronic reverse requires refund / collection-failure confirm'}
                  </strong>
                  <small>
                    {ar
                      ? 'يطلب سبب الاسترداد قبل عكس قيود الدفع عبر الإنترنت.'
                      : 'Requires a refund reason before reversing online payment journals.'}
                  </small>
                </span>
              </label>
              <label className="accounting-settings__switch">
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
                <span>
                  <strong>
                    {ar
                      ? 'عكس المعاملات الإلكترونية يحتاج اعتماداً ثانياً'
                      : 'Electronic reverse needs a second approver'}
                  </strong>
                  <small>
                    {ar
                      ? 'يضيف طبقة مراجعة قبل عكس القيود الإلكترونية.'
                      : 'Adds a review layer before reversing electronic journals.'}
                  </small>
                </span>
              </label>
            </div>
          </fieldset>
        </section>
      ) : null}

      <footer className="accounting-settings__footer">
        {canManage ? (
          <>
            <p className="accounting-hub__muted">
              {ar
                ? 'احفظ بعد تعديل أي قسم حتى تُطبَّق التغييرات على العقود والتجديدات.'
                : 'Save after editing any section so leases and renewals pick up the changes.'}
            </p>
            <button type="button" className="button button--primary" disabled={busy} onClick={save}>
              {busy
                ? ar
                  ? 'جارٍ الحفظ…'
                  : 'Saving…'
                : ar
                  ? 'حفظ الضبط'
                  : 'Save settings'}
            </button>
          </>
        ) : (
          <p className="accounting-hub__muted">
            {ar
              ? 'العرض فقط — يلزم صلاحية إدارة المحاسبة للحفظ.'
              : 'Read-only — accounting manage required to save.'}
          </p>
        )}
      </footer>
        </div>
      </section>
    </div>
  );
}
