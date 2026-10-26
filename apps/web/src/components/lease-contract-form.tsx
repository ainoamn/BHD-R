'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  LeaseTotalsSummary,
  DEPOSIT_METHOD_LABELS,
  FREQUENCY_LABELS,
  PAYMENT_METHOD_LABELS,
  RECURRENCE_LABELS,
  SCOPE_LABELS,
  periodText,
  pick,
} from '@/components/lease-terms-view';
import { LeaseRequirementsPicker } from '@/components/lease-requirements-picker';
import { MissingFieldsBanner } from '@/components/missing-fields-banner';
import { NoteTranslateBar } from '@/components/note-translate';
import { browserNextMutation } from '@/lib/api';
import type { AccountingSettings } from '@/lib/accounting-integrity';
import { formatMoney } from '@/lib/format';
import {
  DEFAULT_LEASE_DOCUMENT_RULES,
  type DocumentRequirementPick,
  type LeaseDocumentRules,
} from '@/lib/lease-document-rules';
import { missingLeaseContractFields } from '@/lib/lease-form-missing';
import {
  ADJUSTMENT_RECURRENCES,
  ADJUSTMENT_SCOPES,
  DEFAULT_VAT_RATE_PERCENT,
  DEPOSIT_METHODS,
  PAYMENT_FREQUENCIES,
  PAYMENT_METHODS,
  buildRentSchedule,
  computeLeaseTerms,
  contractPeriod,
  endDateForMonths,
  formatMinor,
  graceDaysBetween,
  isIsoDate,
  minorDigitsFor,
  nextChequeNumber,
  parseMoney,
  type ContractUse,
  type LeaseAdjustmentDraft,
  type LeaseDepositItemDraft,
  type LeaseTermsDraft,
  type LeaseTermsError,
} from '@/lib/lease-terms';
import { OMAN_BANKS } from '@/lib/stay-deposit-refund';
import { isOmaniNationality } from '@/lib/lease-document-rules';
import type { PropertyRecordTenant, PropertyRecordUnit } from '@/lib/property-records-neon';

export type LeaseTenantDraft = {
  partyId: string;
  entityType: 'person' | 'company';
  nameAr: string;
  nameEn: string;
  civilId: string;
  passport: string;
  nationality: string;
  crNumber: string;
  crExpiry: string;
  signatoryName: string;
  signatoryCivilId: string;
  /** Used for smart document suggestions (Omani vs expatriate signatory). */
  signatoryNationality: string;
  phone: string;
  email: string;
};

export type LeaseContractPayload = {
  unitId: string;
  tenant: Omit<LeaseTenantDraft, 'partyId'> & { partyId?: string };
  terms: LeaseTermsDraft;
};

const EMPTY_TENANT: LeaseTenantDraft = {
  partyId: '',
  entityType: 'person',
  nameAr: '',
  nameEn: '',
  civilId: '',
  passport: '',
  nationality: '',
  crNumber: '',
  crExpiry: '',
  signatoryName: '',
  signatoryCivilId: '',
  signatoryNationality: '',
  phone: '',
  email: '',
};

const EXTRA_SUGGESTIONS: Array<[string, string]> = [
  ['إنترنت', 'Internet'],
  ['مواقف سيارات', 'Parking'],
  ['رسوم خدمات', 'Service charges'],
  ['كهرباء', 'Electricity'],
  ['ماء', 'Water'],
  ['صيانة', 'Maintenance'],
  ['عمولة', 'Commission'],
  ['خصم ترحيبي', 'Welcome discount'],
];

const ERROR_TEXT: Record<LeaseTermsError, [string, string]> = {
  invalid_dates: [
    'تحقّق من التواريخ: النهاية بعد البداية، وتاريخ الاستلام لا يتجاوز البداية.',
    'Check the dates: end after start, handover not after start.',
  ],
  invalid_amount: ['الإيجار الشهري غير صحيح.', 'Monthly rent is invalid.'],
  invalid_schedule: [
    'جدول الدفع غير مكتمل: تحقّق من التواريخ والمبالغ.',
    'The payment schedule is incomplete: check dates and amounts.',
  ],
  invalid_terms: [
    'تحقّق من النسب والمبالغ وبنود الإضافات والتأمين.',
    'Check rates, amounts, extra items and deposit lines.',
  ],
  meters_required: [
    'قراءة عداد الكهرباء والماء إلزامية.',
    'Electricity and water meter readings are required.',
  ],
  handover_required: [
    'تاريخ استلام الوحدة إلزامي (لحساب فترة السماح).',
    'Unit handover date is required (for the grace period).',
  ],
  bank_account_required: [
    'اختر حساباً بنكياً لتُكتب الشيكات باسمه، أو أضف حساباً جديداً.',
    'Choose a bank account for the cheque payee, or add a new one.',
  ],
  duplicate_cheque_number: [
    'رقم شيك مكرر في العقد. لكل شيك رقم مختلف.',
    'A cheque number is repeated. Each cheque needs its own number.',
  ],
};

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

function decimal(minor: string | null | undefined, digits: number): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  return formatMinor(Number(minor), digits).replace(/\.?0+$/, '');
}

function initialDraft(unit: PropertyRecordUnit | undefined): LeaseTermsDraft {
  const digits = minorDigitsFor(unit?.currency ?? 'OMR');
  const startsOn = todayIso();
  return {
    contractType: 'residential',
    usageType: 'residential',
    municipalFormNo: '',
    municipalContractNo: '',
    rentCalcMode: 'full',
    monthlyRent: decimal(unit?.rentMinor, digits),
    rentAreaSqm: unit?.areaSquareMeters ?? '',
    rentPerSqm: '',
    handoverOn: '',
    startsOn,
    endsOn: endDateForMonths(startsOn, 12),
    paymentDay: '5',
    paymentMethod: 'cheque',
    paymentFrequency: 'monthly',
    vatEnabled: false,
    vatRate: DEFAULT_VAT_RATE_PERCENT,
    vatMode: 'with_rent',
    vatChequeCount: '1',
    municipalityFeeEnabled: true,
    municipalityFeePayer: 'owner',
    registrationFee: '1',
    otherTaxName: '',
    otherTaxRate: '',
    graceAsDiscount: true,
    deposit: decimal(unit?.depositMinor ?? unit?.rentMinor, digits),
    depositItems: [],
    chequeBankName: '',
    chequeAccountName: '',
    rentBankAccountId: '',
    schedule: [],
    vatChequeNumbers: [],
    adjustments: [],
    electricityReading: '',
    waterReading: '',
    notes: '',
  };
}

type SectionTone =
  | 'main'
  | 'tenant'
  | 'docs'
  | 'unit'
  | 'rent'
  | 'tax'
  | 'extra'
  | 'deposit'
  | 'schedule'
  | 'notes'
  | 'summary';

type WizardStepId =
  | 'main'
  | 'tenant'
  | 'docs'
  | 'unit'
  | 'rent'
  | 'taxes'
  | 'extras'
  | 'deposit'
  | 'schedule'
  | 'notes'
  | 'summary';

const STEP_GAP_CODES: Record<WizardStepId, readonly string[]> = {
  main: ['unit'],
  tenant: ['tenant_name', 'civil_id', 'phone', 'cr_number', 'cr_expiry', 'signatory'],
  docs: [],
  unit: ['electricity', 'water'],
  rent: ['monthly_rent', 'area', 'rent_sqm', 'handover', 'starts', 'ends', 'payment_day'],
  taxes: [],
  extras: [],
  deposit: ['deposit'],
  schedule: [
    'schedule',
    'schedule_rows',
    'rent_bank',
    'cheque_bank',
    'cheque_name',
    'cheque_numbers',
  ],
  notes: [],
  summary: [],
};

function Section({
  title,
  tone,
  active,
  children,
}: {
  title: string;
  tone: SectionTone;
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <fieldset className={`lcf-section lcf-section--${tone}`}>
      <legend>
        <span className="lcf-section__swatch" aria-hidden="true" />
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  wide,
  required,
  missing,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  wide?: boolean;
  required?: boolean | undefined;
  missing?: boolean | undefined;
  children: ReactNode;
}) {
  const classes = [
    'field',
    wide ? 'span-2' : '',
    required ? 'field--required-mark' : '',
    required && missing ? 'field--missing' : '',
    required && !missing ? 'field--ok' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cleanLabel = label.replace(/\s*\*\s*$/, '');
  return (
    <div className={classes}>
      <label htmlFor={id}>
        {cleanLabel}
        {required ? (
          <span
            className={missing ? 'field__required' : 'field__ok-mark'}
            title={missing ? 'مطلوب' : 'مكتمل'}
          >
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="field__hint muted">{hint}</p> : null}
    </div>
  );
}

const MONEY_PATTERN = '\\d{1,12}(\\.\\d{1,3})?';

/**
 * Manual lease contract, modelled on the BHD-OM contract screen: main data, tenant
 * (person or company), unit and meters, rent and term, VAT and fees, deposit,
 * payment schedule with cheques, VAT cheques, extra charges / discounts and summary.
 */
export type LeaseBankAccountOption = {
  id: string;
  labelAr: string;
  labelEn: string;
  bankName: string;
  accountHolderName: string;
  accountHolderNameEn?: string;
  defaultForRent?: boolean;
  active?: boolean;
  propertyIds?: string[];
};

export function LeaseContractForm({
  units,
  tenants,
  canSign,
  locale,
  busy,
  onSubmit,
  onCancel,
  initialTenant,
  initialTerms,
  termsSeed,
  heading,
  submitLabel,
  footnote,
  bankAccounts = [],
  propertyId = null,
  deferUntilHandover = [],
  municipalAfterHandover = false,
  requirements,
  onRequirementsChange,
  documentRules = DEFAULT_LEASE_DOCUMENT_RULES,
  requirementsLocked = false,
  lead = null,
}: {
  units: PropertyRecordUnit[];
  tenants: PropertyRecordTenant[];
  canSign: boolean;
  locale: 'ar' | 'en';
  busy: boolean;
  onSubmit: (payload: LeaseContractPayload) => void;
  onCancel: () => void;
  /** Prefilled tenant, e.g. the customer of a website booking. */
  initialTenant?: Partial<LeaseTenantDraft> | undefined;
  /** Terms saved earlier, to edit instead of starting over. */
  initialTerms?: LeaseTermsDraft | undefined;
  /** Contract type and term the customer asked for, used when there is no saved draft yet. */
  termsSeed?: { contractType?: ContractUse; months?: number } | undefined;
  heading?: string | undefined;
  submitLabel?: string | undefined;
  /** Replaces the note on who approves the contract. */
  footnote?: string | undefined;
  /** Org bank accounts from accounting settings — bind rent receipts. */
  bankAccounts?: LeaseBankAccountOption[] | undefined;
  /** Property for auto-selecting a linked rent bank account. */
  propertyId?: string | null | undefined;
  /** From approval policy: fields filled after tenant sign / at handover. */
  deferUntilHandover?: ReadonlyArray<'meters' | 'handoverOn'> | undefined;
  /**
   * Website bookings: hide municipal form/contract numbers here; they are required
   * on the booking page after premises handover.
   */
  municipalAfterHandover?: boolean | undefined;
  /** When set with onRequirementsChange, shows the smart documents picker. */
  requirements?: DocumentRequirementPick[] | undefined;
  onRequirementsChange?: ((next: DocumentRequirementPick[]) => void) | undefined;
  documentRules?: LeaseDocumentRules | undefined;
  /** True when a saved requirements list should not be auto-replaced. */
  requirementsLocked?: boolean | undefined;
  /** Shown under the step progress (e.g. collapsible client request on bookings). */
  lead?: ReactNode | undefined;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const [wizardStep, setWizardStep] = useState<WizardStepId>('main');
  const unit = units.find((item) => item.id === unitId);
  const currency = unit?.currency ?? 'OMR';
  const digits = minorDigitsFor(currency);
  const [tenant, setTenant] = useState<LeaseTenantDraft>(() => ({
    ...EMPTY_TENANT,
    ...initialTenant,
  }));
  const [draft, setDraft] = useState<LeaseTermsDraft>(() => {
    if (initialTerms) return initialTerms;
    const base = initialDraft(units[0]);
    return {
      ...base,
      ...(termsSeed?.contractType
        ? { contractType: termsSeed.contractType, usageType: termsSeed.contractType }
        : {}),
      ...(termsSeed?.months ? { endsOn: endDateForMonths(base.startsOn, termsSeed.months) } : {}),
    };
  });
  const [months, setMonths] = useState(() =>
    !initialTerms && termsSeed?.months ? String(termsSeed.months) : '12',
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [localBanks, setLocalBanks] = useState(bankAccounts);
  const [editingBankLink, setEditingBankLink] = useState(false);
  const [addingBank, setAddingBank] = useState(false);
  const [newBank, setNewBank] = useState({
    bankName: OMAN_BANKS[0] ?? '',
    accountHolderName: '',
    accountHolderNameEn: '',
  });
  const [savingBank, setSavingBank] = useState(false);

  const set = <K extends keyof LeaseTermsDraft>(key: K, value: LeaseTermsDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setTenantField = <K extends keyof LeaseTenantDraft>(key: K, value: LeaseTenantDraft[K]) =>
    setTenant((current) => ({ ...current, [key]: value }));
  const money = (minor: number) => (
    <span dir="ltr">{formatMoney(String(Math.round(minor)), currency, locale)}</span>
  );

  useEffect(() => {
    setLocalBanks(bankAccounts);
  }, [bankAccounts]);

  const activeBankAccounts = useMemo(
    () => localBanks.filter((row) => row.active !== false),
    [localBanks],
  );
  const selectedBank = activeBankAccounts.find((row) => row.id === draft.rentBankAccountId);
  const selectedPayee = selectedBank
    ? (selectedBank.accountHolderNameEn || selectedBank.accountHolderName).trim()
    : '';

  function bindBankAccount(id: string, accounts: LeaseBankAccountOption[] = activeBankAccounts) {
    const account = accounts.find((row) => row.id === id);
    const payee = account
      ? (account.accountHolderNameEn || account.accountHolderName).trim()
      : '';
    setDraft((current) => ({
      ...current,
      rentBankAccountId: id,
      ...(account
        ? {
            chequeBankName: account.bankName,
            chequeAccountName: payee,
          }
        : { chequeBankName: '', chequeAccountName: '' }),
    }));
    setEditingBankLink(false);
  }

  async function saveNewBankAccount() {
    const bankName = newBank.bankName.trim();
    const accountHolderName = newBank.accountHolderName.trim();
    const accountHolderNameEn = newBank.accountHolderNameEn.trim();
    if (bankName.length < 2 || accountHolderName.length < 2) {
      setLocalError(
        t(
          'أدخل اسم البنك واسم صاحب الحساب لإضافة الحساب.',
          'Enter the bank and account holder to add an account.',
        ),
      );
      return;
    }
    setSavingBank(true);
    setLocalError(null);
    try {
      const current = await fetch('/api/owner/accounting/settings', {
        credentials: 'same-origin',
      }).then(async (response) => {
        if (!response.ok) throw new Error(t('تعذر تحميل الحسابات.', 'Could not load accounts.'));
        return (await response.json()) as { settings: AccountingSettings };
      });
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `bank-${Date.now().toString(36)}`;
      const nextSettings: AccountingSettings = {
        ...current.settings,
        bankAccounts: [
          ...current.settings.bankAccounts,
          {
            id,
            labelAr: accountHolderName.slice(0, 120),
            labelEn: (accountHolderNameEn || accountHolderName).slice(0, 120),
            bankName: bankName.slice(0, 160),
            accountHolderName: accountHolderName.slice(0, 160),
            accountHolderNameEn: accountHolderNameEn.slice(0, 160),
            iban: '',
            accountNumber: '',
            currency: current.settings.baseCurrency || currency,
            active: true,
            defaultForRent: current.settings.bankAccounts.every((row) => !row.defaultForRent),
            propertyIds: propertyId ? [propertyId] : [],
            ledgerAccountId: null,
          },
        ],
      };
      const saved = await browserNextMutation<{ settings: AccountingSettings }>(
        '/api/owner/accounting/settings',
        { method: 'PUT', body: JSON.stringify(nextSettings) },
      );
      const mapped: LeaseBankAccountOption[] = saved.settings.bankAccounts.map((row) => ({
        id: row.id,
        labelAr: row.labelAr,
        labelEn: row.labelEn,
        bankName: row.bankName,
        accountHolderName: row.accountHolderName,
        accountHolderNameEn: row.accountHolderNameEn,
        defaultForRent: row.defaultForRent,
        active: row.active,
        propertyIds: row.propertyIds,
      }));
      setLocalBanks(mapped);
      bindBankAccount(id, mapped);
      setAddingBank(false);
      setNewBank({
        bankName: OMAN_BANKS[0] ?? '',
        accountHolderName: '',
        accountHolderNameEn: '',
      });
    } catch (error) {
      setLocalError(
        error instanceof Error
          ? error.message
          : t('تعذّر حفظ الحساب البنكي.', 'Could not save the bank account.'),
      );
    } finally {
      setSavingBank(false);
    }
  }

  useEffect(() => {
    if ((draft.rentBankAccountId ?? '').trim()) return;
    if (!activeBankAccounts.length) return;
    const linked = propertyId
      ? activeBankAccounts.find((row) => row.propertyIds?.includes(propertyId))
      : undefined;
    const picked =
      linked ?? activeBankAccounts.find((row) => row.defaultForRent) ?? activeBankAccounts[0];
    if (!picked) return;
    bindBankAccount(picked.id);
    // Auto-bind once when bank accounts / property become available.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot seed
  }, [activeBankAccounts, propertyId]);

  const scheduleRentMinor = useMemo(() => {
    if (draft.rentCalcMode === 'per_meter') {
      const area = Number(draft.rentAreaSqm);
      const rate = parseMoney(draft.rentPerSqm, digits);
      return area > 0 && rate ? Math.round(area * rate) : 0;
    }
    return parseMoney(draft.monthlyRent, digits) ?? 0;
  }, [draft.rentCalcMode, draft.rentAreaSqm, draft.rentPerSqm, draft.monthlyRent, digits]);

  const paymentDay = Number(draft.paymentDay);
  const basisValid =
    scheduleRentMinor > 0 &&
    Number.isInteger(paymentDay) &&
    paymentDay >= 1 &&
    paymentDay <= 31 &&
    isIsoDate(draft.startsOn) &&
    isIsoDate(draft.endsOn) &&
    draft.endsOn > draft.startsOn;

  const defaultSchedule = useMemo(
    () =>
      basisValid
        ? buildRentSchedule({
            startsOn: draft.startsOn,
            endsOn: draft.endsOn,
            monthlyRentMinor: scheduleRentMinor,
            paymentDay,
            frequency: draft.paymentFrequency,
          })
        : [],
    [
      basisValid,
      draft.startsOn,
      draft.endsOn,
      scheduleRentMinor,
      paymentDay,
      draft.paymentFrequency,
    ],
  );

  // Base inputs changed: rebuild dates/amounts, keep cheque numbers already typed.
  useEffect(() => {
    setDraft((current) => ({
      ...current,
      schedule: defaultSchedule.map((row, index) => ({
        dueOn: row.dueOn,
        rent: formatMinor(row.rentMinor, digits),
        chequeNumber: current.schedule[index]?.chequeNumber ?? '',
        bankName: current.schedule[index]?.bankName ?? '',
      })),
    }));
  }, [defaultSchedule, digits]);

  const deferMeters = deferUntilHandover.includes('meters');
  const deferHandover = deferUntilHandover.includes('handoverOn');
  const result = useMemo(
    () => computeLeaseTerms(draft, currency, digits, { deferUntilHandover }),
    [draft, currency, digits, deferUntilHandover],
  );
  const terms = result.ok ? result.terms : null;
  const missingFields = useMemo(
    () =>
      missingLeaseContractFields({
        unitId,
        tenant,
        draft,
        digits,
        deferMeters,
        deferHandover,
      }),
    [unitId, tenant, draft, digits, deferMeters, deferHandover],
  );
  const missingCodes = useMemo(
    () => new Set(missingFields.map((field) => field.code)),
    [missingFields],
  );
  const gap = (code: string) => missingCodes.has(code);

  /**
   * Fill path: only steps that need input. Optional taxes / extras / notes appear
   * on the final review step (research-backed progressive disclosure + review).
   */
  const wizardSteps = useMemo((): WizardStepId[] => {
    const steps: WizardStepId[] = ['main', 'tenant'];
    if (requirements && onRequirementsChange) steps.push('docs');
    steps.push('unit', 'rent', 'deposit', 'schedule', 'summary');
    return steps;
  }, [requirements, onRequirementsChange]);

  useEffect(() => {
    if (!wizardSteps.includes(wizardStep)) {
      setWizardStep(wizardSteps[0] ?? 'main');
    }
  }, [wizardSteps, wizardStep]);

  const stepIndex = Math.max(0, wizardSteps.indexOf(wizardStep));
  const isFirstStep = stepIndex <= 0;
  const isLastStep = stepIndex >= wizardSteps.length - 1;
  const reviewMode = wizardStep === 'summary';
  const stepActive = (id: WizardStepId) => reviewMode || wizardStep === id;

  const stepTitles: Record<WizardStepId, [string, string]> = {
    main: ['📝 بيانات العقد الرئيسية', '📝 Main contract data'],
    tenant: ['👤 المستأجر', '👤 Tenant'],
    docs: ['📎 مستندات المستأجر', '📎 Tenant documents'],
    unit: ['🏢 الوحدة والعدادات', '🏢 Unit & meters'],
    rent: ['💰 الإيجار والمدة', '💰 Rent & term'],
    taxes: ['🧾 الضرائب والرسوم', '🧾 Taxes & fees'],
    extras: ['➕ مبالغ إضافية / خصومات', '➕ Extra charges & discounts'],
    deposit: ['🛡️ التأمين (الوديعة)', '🛡️ Insurance (deposit)'],
    schedule: ['📅 جدول الدفع', '📅 Payment schedule'],
    notes: ['🗒️ ملاحظات', '🗒️ Notes'],
    summary: ['✅ مراجعة والتحقق', '✅ Review & confirm'],
  };

  const currentStepGaps = useMemo(
    () =>
      missingFields.filter((field) =>
        (STEP_GAP_CODES[wizardStep] ?? []).includes(field.code),
      ),
    [missingFields, wizardStep],
  );

  function goNext() {
    if (currentStepGaps.length) {
      setLocalError(
        t(
          `أكمل حقول هذا القسم أولاً (${currentStepGaps.length} ناقص).`,
          `Complete this section first (${currentStepGaps.length} missing).`,
        ),
      );
      return;
    }
    setLocalError(null);
    const next = wizardSteps[stepIndex + 1];
    if (next) setWizardStep(next);
  }

  function goBack() {
    setLocalError(null);
    const prev = wizardSteps[stepIndex - 1];
    if (prev) setWizardStep(prev);
  }
  const period =
    isIsoDate(draft.startsOn) && isIsoDate(draft.endsOn) && draft.endsOn > draft.startsOn
      ? contractPeriod(draft.startsOn, draft.endsOn)
      : null;
  const graceDays = isIsoDate(draft.handoverOn ?? '')
    ? graceDaysBetween(draft.handoverOn ?? null, draft.startsOn)
    : 0;
  const isCheque = draft.paymentMethod === 'cheque';
  const vatWithRent = draft.vatEnabled && draft.vatMode === 'with_rent';

  function changeUnit(nextId: string) {
    const next = units.find((item) => item.id === nextId);
    setUnitId(nextId);
    if (!next) return;
    const nextDigits = minorDigitsFor(next.currency);
    setDraft((current) => ({
      ...current,
      monthlyRent: decimal(next.rentMinor, nextDigits),
      deposit: decimal(next.depositMinor ?? next.rentMinor, nextDigits),
      rentAreaSqm: next.areaSquareMeters ?? current.rentAreaSqm,
    }));
  }

  function changeStart(value: string) {
    const count = Number(months);
    setDraft((current) => ({
      ...current,
      startsOn: value,
      endsOn:
        isIsoDate(value) && Number.isInteger(count) && count > 0
          ? endDateForMonths(value, count)
          : current.endsOn,
    }));
  }

  function changeMonths(value: string) {
    setMonths(value);
    const count = Number(value);
    if (isIsoDate(draft.startsOn) && Number.isInteger(count) && count > 0 && count <= 120) {
      set('endsOn', endDateForMonths(draft.startsOn, count));
    }
  }

  function changeEnd(value: string) {
    set('endsOn', value);
    if (isIsoDate(draft.startsOn) && isIsoDate(value) && value > draft.startsOn) {
      setMonths(String(contractPeriod(draft.startsOn, value).months));
    }
  }

  function pickTenant(partyId: string) {
    const party = tenants.find((item) => item.id === partyId);
    if (!party) {
      setTenantField('partyId', '');
      return;
    }
    setTenant((current) => ({
      ...current,
      partyId: party.id,
      entityType: party.type,
      nameAr: party.displayName,
      email: party.email ?? '',
      phone: party.phone ?? '',
    }));
  }

  function updateScheduleRow(index: number, patch: Partial<LeaseTermsDraft['schedule'][number]>) {
    setDraft((current) => ({
      ...current,
      schedule: current.schedule.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function autoNumberCheques() {
    setDraft((current) => {
      const first = current.schedule[0]?.chequeNumber?.trim() ?? '';
      if (!first) return current;
      return {
        ...current,
        schedule: current.schedule.map((row, index) =>
          index === 0 ? row : { ...row, chequeNumber: nextChequeNumber(first, index) },
        ),
      };
    });
  }

  function updateAdjustment(index: number, patch: Partial<LeaseAdjustmentDraft>) {
    setDraft((current) => ({
      ...current,
      adjustments: current.adjustments.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  function updateDepositItem(index: number, patch: Partial<LeaseDepositItemDraft>) {
    setDraft((current) => ({
      ...current,
      depositItems: current.depositItems.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (missingFields.length) {
      setLocalError(
        t(
          `أكمل ${missingFields.length} حقلاً إلزامياً ناقصاً قبل الحفظ.`,
          `Complete ${missingFields.length} required field${missingFields.length === 1 ? '' : 's'} before saving.`,
        ),
      );
      return;
    }
    if (!result.ok) {
      setLocalError(pick(ERROR_TEXT[result.error], ar));
      return;
    }
    setLocalError(null);
    const { partyId, ...rest } = tenant;
    onSubmit({
      unitId,
      tenant: partyId ? { ...rest, partyId } : rest,
      terms: draft,
    });
  }

  return (
    <form className="psr-form lcf lcf--wizard lcf--focus" onSubmit={submit}>
      {heading ? <h3 className="lcf__heading">{heading}</h3> : null}

      <nav className="lcf-wizard-progress" aria-label={t('أقسام العقد', 'Contract sections')}>
        <p className="lcf-wizard-progress__meta">
          {reviewMode
            ? t('مراجعة كل الحقول — عدّل ما يلزم ثم احفظ', 'Review all fields — edit if needed, then save')
            : t(
                `القسم ${stepIndex + 1} من ${wizardSteps.length}`,
                `Step ${stepIndex + 1} of ${wizardSteps.length}`,
              )}
        </p>
        <ol className="lcf-wizard-progress__list">
          {wizardSteps.map((id, index) => {
            const done = index < stepIndex;
            const current = index === stepIndex;
            const tone =
              id === 'taxes' ? 'tax' : id === 'extras' ? 'extra' : (id as SectionTone);
            return (
              <li key={id} className={current ? 'lcf-wizard-chip-wrap--current' : undefined}>
                <button
                  type="button"
                  className={`lcf-wizard-chip lcf-wizard-chip--${tone}${
                    current ? ' lcf-wizard-chip--current' : ''
                  }${done ? ' lcf-wizard-chip--done' : ''}`}
                  onClick={() => {
                    if (reviewMode || index <= stepIndex) {
                      setLocalError(null);
                      setWizardStep(id);
                    }
                  }}
                  disabled={!reviewMode && index > stepIndex}
                  title={pick(stepTitles[id], ar)}
                >
                  <span className="lcf-wizard-chip__dot" aria-hidden="true" />
                  <span className="lcf-wizard-chip__label">{pick(stepTitles[id], ar)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {lead}

      {reviewMode ? (
        <p className="notice notice--info lcf-review-note" role="status">
          {t(
            'هذه صفحة التحقق: كل الأقسام ظاهرة وقابلة للتعديل (بما فيها الضرائب والإضافات والملاحظات).',
            'Review page: every section is visible and editable (including taxes, extras, and notes).',
          )}
        </p>
      ) : null}

      {(isLastStep ? missingFields : currentStepGaps).length > 0 ? (
        <MissingFieldsBanner
          locale={locale}
          fields={isLastStep ? missingFields : currentStepGaps}
          title={t(
            `${(isLastStep ? missingFields : currentStepGaps).length} حقل إلزامي ناقص${isLastStep ? '' : ' في هذا القسم'}`,
            `${(isLastStep ? missingFields : currentStepGaps).length} required field(s) missing${isLastStep ? '' : ' in this section'}`,
          )}
        />
      ) : null}

      <Section
        tone="main"
        active={stepActive('main')}
        title={t('📝 بيانات العقد الرئيسية', '📝 Main contract data')}
      >
        <div className="form-grid">
          <Field
            id="lcf-unit"
            label={t('الوحدة', 'Unit')}
            required
            missing={gap('unit')}
          >
            <select
              id="lcf-unit"
              className="select"
              required
              value={unitId}
              onChange={(event) => changeUnit(event.target.value)}
            >
              {units.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </select>
          </Field>
          <Field id="lcf-type" label={t('نوع العقد', 'Contract type')}>
            <select
              id="lcf-type"
              className="select"
              value={draft.contractType}
              onChange={(event) => {
                const value = event.target.value as LeaseTermsDraft['contractType'];
                setDraft((current) => ({ ...current, contractType: value, usageType: value }));
              }}
            >
              <option value="residential">{t('سكني', 'Residential')}</option>
              <option value="commercial">{t('تجاري', 'Commercial')}</option>
            </select>
          </Field>
          <Field id="lcf-usage" label={t('نوع الاستعمال', 'Usage type')}>
            <select
              id="lcf-usage"
              className="select"
              value={draft.usageType}
              onChange={(event) =>
                set('usageType', event.target.value as LeaseTermsDraft['usageType'])
              }
            >
              <option value="residential">{t('سكني', 'Residential')}</option>
              <option value="commercial">{t('تجاري', 'Commercial')}</option>
            </select>
          </Field>
          {municipalAfterHandover ? (
            <p className="muted span-2">
              {t(
                'رقم استمارة العقد البلدي ورقم العقد البلدي يُدخلان بعد تسليم العقار من صفحة الحجز.',
                'Municipal form and contract numbers are entered after handover on the booking page.',
              )}
            </p>
          ) : (
            <>
              <Field id="lcf-mform" label={t('رقم استمارة العقد البلدي', 'Municipal form no.')}>
                <input
                  id="lcf-mform"
                  className="input"
                  dir="ltr"
                  maxLength={80}
                  value={draft.municipalFormNo ?? ''}
                  onChange={(event) => set('municipalFormNo', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-mcontract"
                label={t('رقم العقد البلدي', 'Municipal contract no.')}
              >
                <input
                  id="lcf-mcontract"
                  className="input"
                  dir="ltr"
                  maxLength={80}
                  value={draft.municipalContractNo ?? ''}
                  onChange={(event) => set('municipalContractNo', event.target.value)}
                />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section tone="tenant" active={stepActive('tenant')} title={t('👤 المستأجر', '👤 Tenant')}>
        <div className="form-grid">
          {tenants.length ? (
            <Field
              id="lcf-book"
              label={t('استيراد المستأجر من دفتر العناوين', 'Import tenant from address book')}
              wide
              hint={
                tenant.partyId
                  ? t(
                      'سيُربط العقد بهذا المستأجر الموجود في دفتر العناوين.',
                      'The contract will use this existing address-book party.',
                    )
                  : t(
                      'أو أدخل بيانات مستأجر جديد ليُضاف إلى دفتر العناوين.',
                      'Or enter a new tenant; it is added to the address book.',
                    )
              }
            >
              <select
                id="lcf-book"
                className="select"
                value={tenant.partyId}
                onChange={(event) => pickTenant(event.target.value)}
              >
                <option value="">{t('— مستأجر جديد —', '— New tenant —')}</option>
                {tenants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                    {item.phone ? ` · ${item.phone}` : item.email ? ` · ${item.email}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field id="lcf-entity" label={t('نوع الجهة المستأجرة', 'Lessee type')}>
            <select
              id="lcf-entity"
              className="select"
              value={tenant.entityType}
              onChange={(event) =>
                setTenantField('entityType', event.target.value as LeaseTenantDraft['entityType'])
              }
            >
              <option value="person">{t('شخص', 'Person')}</option>
              <option value="company">{t('شركة', 'Company')}</option>
            </select>
          </Field>
          <Field
            id="lcf-name-ar"
            label={t('اسم المستأجر (عربي)', 'Tenant name (Arabic)')}
            required
            missing={gap('tenant_name')}
          >
            <div className="lcf-name-with-nationality">
              <input
                id="lcf-name-ar"
                className="input"
                required
                minLength={2}
                maxLength={200}
                value={tenant.nameAr}
                onChange={(event) => setTenantField('nameAr', event.target.value)}
              />
              {tenant.entityType === 'person' && tenant.nationality.trim() ? (
                <span
                  className={`party-nationality${
                    isOmaniNationality(tenant.nationality)
                      ? ' party-nationality--omani'
                      : ' party-nationality--foreign'
                  }`}
                >
                  ({tenant.nationality.trim()})
                </span>
              ) : null}
            </div>
          </Field>
          <Field id="lcf-name-en" label={t('اسم المستأجر بالإنجليزية', 'Tenant name (English)')}>
            <input
              id="lcf-name-en"
              className="input"
              dir="ltr"
              maxLength={200}
              value={tenant.nameEn}
              onChange={(event) => setTenantField('nameEn', event.target.value)}
            />
          </Field>
          {tenant.entityType === 'person' ? (
            <>
              <Field
                id="lcf-civil"
                label={t('الرقم المدني', 'Civil ID no.')}
                required
                missing={gap('civil_id')}
              >
                <input
                  id="lcf-civil"
                  className="input"
                  dir="ltr"
                  maxLength={40}
                  value={tenant.civilId}
                  onChange={(event) => setTenantField('civilId', event.target.value)}
                />
              </Field>
              <Field id="lcf-passport" label={t('رقم الجواز', 'Passport no.')}>
                <input
                  id="lcf-passport"
                  className="input"
                  dir="ltr"
                  maxLength={40}
                  value={tenant.passport}
                  onChange={(event) => setTenantField('passport', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-nationality"
                label={t('الجنسية', 'Nationality')}
                hint={t(
                  'مواطن: البطاقة الشخصية. وافد: البطاقة والجواز.',
                  'Citizen: civil ID. Resident: ID and passport.',
                )}
              >
                <input
                  id="lcf-nationality"
                  className="input"
                  maxLength={80}
                  list="lcf-nationalities"
                  value={tenant.nationality}
                  onChange={(event) => setTenantField('nationality', event.target.value)}
                />
                <datalist id="lcf-nationalities">
                  <option value={t('عماني', 'Omani')} />
                  <option value={t('هندي', 'Indian')} />
                  <option value={t('باكستاني', 'Pakistani')} />
                  <option value={t('بنغلاديشي', 'Bangladeshi')} />
                  <option value={t('مصري', 'Egyptian')} />
                  <option value={t('فلبيني', 'Filipino')} />
                </datalist>
              </Field>
            </>
          ) : (
            <>
              <Field
                id="lcf-cr"
                label={t('السجل التجاري', 'Commercial registration no.')}
                required
                missing={gap('cr_number')}
              >
                <input
                  id="lcf-cr"
                  className="input"
                  dir="ltr"
                  maxLength={40}
                  value={tenant.crNumber}
                  onChange={(event) => setTenantField('crNumber', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-cr-exp"
                label={t('انتهاء السجل التجاري', 'CR expiry date')}
                required
                missing={gap('cr_expiry')}
              >
                <input
                  id="lcf-cr-exp"
                  className="input"
                  type="date"
                  value={tenant.crExpiry}
                  onChange={(event) => setTenantField('crExpiry', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-sign-name"
                label={t('المفوض بالتوقيع', 'Authorized signatory')}
                required
                missing={gap('signatory')}
              >
                <input
                  id="lcf-sign-name"
                  className="input"
                  maxLength={200}
                  value={tenant.signatoryName}
                  onChange={(event) => setTenantField('signatoryName', event.target.value)}
                />
              </Field>
              <Field id="lcf-sign-id" label={t('الرقم المدني للمفوض', 'Signatory civil ID')}>
                <input
                  id="lcf-sign-id"
                  className="input"
                  dir="ltr"
                  maxLength={40}
                  value={tenant.signatoryCivilId}
                  onChange={(event) => setTenantField('signatoryCivilId', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-sign-nationality"
                label={t('جنسية المفوض', 'Signatory nationality')}
                hint={t(
                  'تحدد مستندات المفوض: عماني (بطاقة) أو وافد (جواز وإقامة).',
                  'Drives signatory docs: Omani (civil ID) or expatriate (passport & residence).',
                )}
              >
                <input
                  id="lcf-sign-nationality"
                  className="input"
                  maxLength={80}
                  list="lcf-sign-nationalities"
                  value={tenant.signatoryNationality}
                  onChange={(event) =>
                    setTenantField('signatoryNationality', event.target.value)
                  }
                />
                <datalist id="lcf-sign-nationalities">
                  <option value={t('عماني', 'Omani')} />
                  <option value={t('هندي', 'Indian')} />
                  <option value={t('باكستاني', 'Pakistani')} />
                  <option value={t('بنغلاديشي', 'Bangladeshi')} />
                  <option value={t('مصري', 'Egyptian')} />
                  <option value={t('فلبيني', 'Filipino')} />
                </datalist>
              </Field>
            </>
          )}
          <Field
            id="lcf-phone"
            label={t('رقم الجوال', 'Mobile')}
            required
            missing={gap('phone')}
          >
            <input
              id="lcf-phone"
              className="input"
              type="tel"
              dir="ltr"
              maxLength={40}
              value={tenant.phone}
              onChange={(event) => setTenantField('phone', event.target.value)}
            />
          </Field>
          <Field id="lcf-email" label={t('البريد الإلكتروني', 'Email')}>
            <input
              id="lcf-email"
              className="input"
              type="email"
              dir="ltr"
              maxLength={320}
              value={tenant.email}
              onChange={(event) => setTenantField('email', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      {requirements && onRequirementsChange ? (
        <Section
          tone="docs"
          active={stepActive('docs')}
          title={t('📎 مستندات المستأجر', '📎 Tenant documents')}
        >
          <LeaseRequirementsPicker
            ar={ar}
            sale={false}
            value={requirements}
            onChange={onRequirementsChange}
            rules={documentRules}
            lockInitial={requirementsLocked}
            context={{
              entityType: tenant.entityType,
              nationality: tenant.nationality,
              signatoryNationality: tenant.signatoryNationality,
            }}
          />
        </Section>
      ) : null}

      <Section
        tone="unit"
        active={stepActive('unit')}
        title={t('🏢 الوحدة والعدادات', '🏢 Unit & meters')}
      >
        <dl className="lcf-facts">
          <div>
            <dt>{t('الطابق', 'Floor')}</dt>
            <dd>{unit?.floor || '—'}</dd>
          </div>
          <div>
            <dt>{t('المساحة (م²)', 'Area (m²)')}</dt>
            <dd dir="ltr">{unit?.areaSquareMeters || '—'}</dd>
          </div>
          <div>
            <dt>{t('عداد الكهرباء', 'Electricity meter')}</dt>
            <dd dir="ltr">{unit?.electricityMeter || '—'}</dd>
          </div>
          <div>
            <dt>{t('عداد الماء', 'Water meter')}</dt>
            <dd dir="ltr">{unit?.waterMeter || '—'}</dd>
          </div>
        </dl>
        <div className="form-grid">
          <Field
            id="lcf-elec"
            label={
              deferMeters
                ? t('قراءة عداد الكهرباء (مؤجّل للتسليم)', 'Electricity reading (deferred to handover)')
                : t('قراءة عداد الكهرباء', 'Electricity meter reading')
            }
            required={!deferMeters}
            missing={gap('electricity')}
          >
            <input
              id="lcf-elec"
              className="input"
              dir="ltr"
              inputMode="decimal"
              required={!deferMeters}
              maxLength={40}
              value={draft.electricityReading ?? ''}
              onChange={(event) => set('electricityReading', event.target.value)}
            />
          </Field>
          <Field
            id="lcf-water"
            label={
              deferMeters
                ? t('قراءة عداد الماء (مؤجّل للتسليم)', 'Water reading (deferred to handover)')
                : t('قراءة عداد الماء', 'Water meter reading')
            }
            required={!deferMeters}
            missing={gap('water')}
          >
            <input
              id="lcf-water"
              className="input"
              dir="ltr"
              inputMode="decimal"
              required={!deferMeters}
              maxLength={40}
              value={draft.waterReading ?? ''}
              onChange={(event) => set('waterReading', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section tone="rent" active={stepActive('rent')} title={t('💰 الإيجار والمدة', '💰 Rent & term')}>
        <div className="form-grid">
          <Field id="lcf-calc" label={t('طريقة احتساب الإيجار', 'Rent calculation mode')}>
            <select
              id="lcf-calc"
              className="select"
              value={draft.rentCalcMode}
              onChange={(event) =>
                set('rentCalcMode', event.target.value as LeaseTermsDraft['rentCalcMode'])
              }
            >
              <option value="full">{t('إيجار كامل', 'Full rent')}</option>
              <option value="per_meter">{t('إيجار بالمتر', 'Per meter')}</option>
            </select>
          </Field>
          {draft.rentCalcMode === 'per_meter' ? (
            <>
              <Field
                id="lcf-area"
                label={t('عدد الأمتار (م²)', 'Area (m²)')}
                required
                missing={gap('area')}
              >
                <input
                  id="lcf-area"
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  required
                  pattern="\d{1,7}(\.\d{1,2})?"
                  value={draft.rentAreaSqm ?? ''}
                  onChange={(event) => set('rentAreaSqm', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-rate"
                label={t(`قيمة المتر (${currency})`, `Rate per m² (${currency})`)}
                required
                missing={gap('rent_sqm')}
              >
                <input
                  id="lcf-rate"
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  required
                  pattern={MONEY_PATTERN}
                  value={draft.rentPerSqm ?? ''}
                  onChange={(event) => set('rentPerSqm', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-rent-calc"
                label={t('الإيجار الشهري (محسوب)', 'Monthly rent (computed)')}
              >
                <output id="lcf-rent-calc" className="input lcf-output">
                  {scheduleRentMinor ? money(scheduleRentMinor) : '—'}
                </output>
              </Field>
            </>
          ) : (
            <Field
              id="lcf-rent"
              label={t(`الإيجار الشهري (${currency})`, `Monthly rent (${currency})`)}
              required
              missing={gap('monthly_rent')}
            >
              <input
                id="lcf-rent"
                className="input"
                dir="ltr"
                inputMode="decimal"
                required
                pattern={MONEY_PATTERN}
                value={draft.monthlyRent}
                onChange={(event) => set('monthlyRent', event.target.value)}
              />
            </Field>
          )}
          <Field id="lcf-months" label={t('مدة العقد (شهور)', 'Contract period (months)')}>
            <input
              id="lcf-months"
              className="input"
              type="number"
              min={1}
              max={120}
              value={months}
              onChange={(event) => changeMonths(event.target.value)}
            />
          </Field>
          <Field
            id="lcf-period"
            label={t('المدة الفعلية (شهور وأيام)', 'Actual period (months & days)')}
          >
            <output id="lcf-period" className="input lcf-output">
              {period ? periodText(period.months, period.extraDays, ar) : '—'}
            </output>
          </Field>
          <Field
            id="lcf-handover"
            label={
              deferHandover
                ? t('تاريخ استلام الوحدة (مؤجّل للتسليم)', 'Unit handover date (deferred to handover)')
                : t('تاريخ استلام الوحدة', 'Unit handover date')
            }
            required={!deferHandover}
            missing={gap('handover')}
            hint={
              deferHandover
                ? t(
                    'حسب ضبط الاعتماد: يُستكمل عند التسليم بعد توقيع المستأجر.',
                    'Per approval settings: completed at handover after the tenant signs.',
                  )
                : t(
                    'إلزامي لحساب فترة السماح من الاستلام إلى البداية.',
                    'Required to compute the grace period from handover to start.',
                  )
            }
          >
            <input
              id="lcf-handover"
              className="input"
              type="date"
              required={!deferHandover}
              max={draft.startsOn}
              value={draft.handoverOn ?? ''}
              onChange={(event) => set('handoverOn', event.target.value)}
            />
          </Field>
          <Field
            id="lcf-start"
            label={t('تاريخ البداية', 'Start date')}
            required
            missing={gap('starts')}
          >
            <input
              id="lcf-start"
              className="input"
              type="date"
              required
              value={draft.startsOn}
              onChange={(event) => changeStart(event.target.value)}
            />
          </Field>
          <Field
            id="lcf-end"
            label={t('تاريخ النهاية', 'End date')}
            required
            missing={gap('ends')}
            hint={t(
              'تُحسب من المدة تلقائياً ويمكن تعديلها.',
              'Computed from the period; editable.',
            )}
          >
            <input
              id="lcf-end"
              className="input"
              type="date"
              required
              min={draft.startsOn}
              value={draft.endsOn}
              onChange={(event) => changeEnd(event.target.value)}
            />
          </Field>
          <Field
            id="lcf-grace"
            label={
              deferHandover
                ? t('فترة السماح (بعد تاريخ الاستلام)', 'Grace period (after handover date)')
                : t('فترة السماح *', 'Grace period *')
            }
            hint={t(
              'تُحسب تلقائياً من تاريخ الاستلام إلى تاريخ البداية. مبلغ السماح = (الإيجار ÷ 30) × الأيام.',
              'Auto from handover to start. Grace amount = (rent ÷ 30) × days.',
            )}
          >
            <output id="lcf-grace" className="input lcf-output" aria-live="polite">
              {(draft.handoverOn ?? '').trim()
                ? graceDays
                  ? `${graceDays} ${t('يوم', 'days')} · ${formatMoney(
                      String(Math.round((scheduleRentMinor / 30) * graceDays)),
                      currency,
                      locale,
                    )}`
                  : t('٠ يوم (الاستلام يوم البداية)', '0 days (handover on start date)')
                : deferHandover
                  ? t('تُحسب عند إدخال تاريخ الاستلام / التسليم', 'Computed when handover date is entered')
                  : t('أدخل تاريخ الاستلام أولاً', 'Enter the handover date first')}
            </output>
          </Field>
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              checked={draft.graceAsDiscount}
              onChange={(event) => set('graceAsDiscount', event.target.checked)}
            />
            <span>
              {t('خصم مبلغ السماح من إجمالي العقد', 'Deduct the grace amount from the total')}
            </span>
          </label>
          <Field
            id="lcf-day"
            label={t('يوم دفع الإيجار المتفق عليه (1–31)', 'Agreed rent payment day (1–31)')}
            required
            missing={gap('payment_day')}
          >
            <input
              id="lcf-day"
              className="input"
              type="number"
              min={1}
              max={31}
              required
              value={draft.paymentDay}
              onChange={(event) => set('paymentDay', event.target.value)}
            />
          </Field>
          <Field id="lcf-method" label={t('طريقة الدفع', 'Payment method')}>
            <select
              id="lcf-method"
              className="select"
              value={draft.paymentMethod}
              onChange={(event) => {
                const method = event.target.value as LeaseTermsDraft['paymentMethod'];
                set('paymentMethod', method);
                if (method === 'cheque' && draft.rentBankAccountId) {
                  bindBankAccount(draft.rentBankAccountId);
                  setEditingBankLink(false);
                }
              }}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {pick(PAYMENT_METHOD_LABELS[method], ar)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="lcf-freq" label={t('دورية الدفع', 'Payment frequency')}>
            <select
              id="lcf-freq"
              className="select"
              value={draft.paymentFrequency}
              onChange={(event) =>
                set('paymentFrequency', event.target.value as LeaseTermsDraft['paymentFrequency'])
              }
            >
              {PAYMENT_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {pick(FREQUENCY_LABELS[frequency], ar)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section tone="tax" active={stepActive('taxes')} title={t('🧾 الضرائب والرسوم', '🧾 Taxes & fees')}>
        <div className="form-grid">
          <Field
            id="lcf-vat"
            label={t('هل العقد مشمول بالضريبة المضافة؟', 'Is the contract subject to VAT?')}
          >
            <select
              id="lcf-vat"
              className="select"
              value={draft.vatEnabled ? 'yes' : 'no'}
              onChange={(event) => set('vatEnabled', event.target.value === 'yes')}
            >
              <option value="no">{t('لا', 'No')}</option>
              <option value="yes">{t('نعم', 'Yes')}</option>
            </select>
          </Field>
          {draft.vatEnabled ? (
            <>
              <Field id="lcf-vat-rate" label={t('نسبة الضريبة المضافة (%)', 'VAT rate (%)')}>
                <input
                  id="lcf-vat-rate"
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  pattern="\d{1,3}(\.\d{1,2})?"
                  value={draft.vatRate}
                  onChange={(event) => set('vatRate', event.target.value)}
                />
              </Field>
              <Field
                id="lcf-vat-mode"
                label={t(
                  'هل الضريبة مع الإيجار الشهري أم منفصلة؟',
                  'VAT with monthly rent or separate?',
                )}
              >
                <select
                  id="lcf-vat-mode"
                  className="select"
                  value={draft.vatMode}
                  onChange={(event) =>
                    set('vatMode', event.target.value as LeaseTermsDraft['vatMode'])
                  }
                >
                  <option value="with_rent">{t('مع الإيجار الشهري', 'With monthly rent')}</option>
                  <option value="separate">
                    {t('منفصلة (شيكات إضافية)', 'Separate (additional cheques)')}
                  </option>
                </select>
              </Field>
              {draft.vatMode === 'with_rent' ? (
                <Field
                  id="lcf-vat-monthly"
                  label={t('الإيجار الشهري شامل الضريبة', 'Monthly rent incl. VAT')}
                >
                  <output id="lcf-vat-monthly" className="input lcf-output">
                    {terms ? money(terms.totals.monthlyRentInclVatMinor) : '—'}
                  </output>
                </Field>
              ) : (
                <Field
                  id="lcf-vat-count"
                  label={t('عدد شيكات الضريبة المضافة', 'Number of VAT cheques')}
                >
                  <input
                    id="lcf-vat-count"
                    className="input"
                    type="number"
                    min={1}
                    max={24}
                    value={draft.vatChequeCount}
                    onChange={(event) => set('vatChequeCount', event.target.value)}
                  />
                </Field>
              )}
            </>
          ) : null}
          <label className="checkbox-row span-2">
            <input
              type="checkbox"
              checked={draft.municipalityFeeEnabled}
              onChange={(event) => set('municipalityFeeEnabled', event.target.checked)}
            />
            <span>
              {t(
                'إظهار رسوم البلدية 3% في العقد',
                'Show municipality fee 3% on the contract',
              )}
              {terms?.totals.municipalityFeeMinor ? (
                <> · {money(terms.totals.municipalityFeeMinor)}</>
              ) : null}
            </span>
          </label>
          {draft.municipalityFeeEnabled ? (
            <Field
              id="lcf-muni-payer"
              label={t('من يتحمّل رسوم البلدية؟', 'Who pays the municipality fee?')}
            >
              <select
                id="lcf-muni-payer"
                className="select"
                value={draft.municipalityFeePayer ?? 'owner'}
                onChange={(event) =>
                  set(
                    'municipalityFeePayer',
                    event.target.value === 'tenant' ? 'tenant' : 'owner',
                  )
                }
              >
                <option value="owner">{t('المالك (افتراضي)', 'Owner (default)')}</option>
                <option value="tenant">{t('المستأجر', 'Tenant')}</option>
              </select>
            </Field>
          ) : null}
          <Field
            id="lcf-reg"
            label={t(
              `رسوم تسجيل العقد في البلدية (${currency})`,
              `Municipal registration fee (${currency})`,
            )}
          >
            <input
              id="lcf-reg"
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern={MONEY_PATTERN}
              value={draft.registrationFee}
              onChange={(event) => set('registrationFee', event.target.value)}
            />
          </Field>
          <Field id="lcf-tax-name" label={t('ضريبة / رسوم أخرى (الاسم)', 'Other tax / fee (name)')}>
            <input
              id="lcf-tax-name"
              className="input"
              maxLength={80}
              value={draft.otherTaxName ?? ''}
              onChange={(event) => set('otherTaxName', event.target.value)}
            />
          </Field>
          <Field
            id="lcf-tax-rate"
            label={t('نسبتها من إجمالي الإيجار (%)', 'Rate on total rent (%)')}
          >
            <input
              id="lcf-tax-rate"
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern="\d{1,3}(\.\d{1,2})?"
              value={draft.otherTaxRate ?? ''}
              onChange={(event) => set('otherTaxRate', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section
        tone="extra"
        active={stepActive('extras')}
        title={t('➕ مبالغ إضافية / خصومات', '➕ Extra charges & discounts')}
      >
        <p className="muted lcf-help">
          {t(
            'حدّد هل المبلغ يُدفع مرة واحدة أو مع التجديد أو كل 3 أشهر أو شهرياً، وحتى نهاية العقد أو سنة أو مدة مخصصة.',
            'Choose whether the amount is paid once, with renewal, every 3 months or monthly — until contract end, one year or a custom period.',
          )}
        </p>
        <datalist id="lcf-extra-suggestions">
          {EXTRA_SUGGESTIONS.map(([arText, enText]) => (
            <option key={enText} value={ar ? arText : enText} />
          ))}
        </datalist>
        {draft.adjustments.map((item, index) => {
          const line = terms?.adjustments[index];
          return (
            <div key={index} className="lcf-line">
              <select
                className="select"
                aria-label={t('النوع', 'Type')}
                value={item.kind}
                onChange={(event) =>
                  updateAdjustment(index, {
                    kind: event.target.value as LeaseAdjustmentDraft['kind'],
                  })
                }
              >
                <option value="add">{t('إضافة', 'Charge')}</option>
                <option value="discount">{t('خصم', 'Discount')}</option>
              </select>
              <input
                className="input"
                required
                maxLength={120}
                list="lcf-extra-suggestions"
                aria-label={t('البند', 'Item')}
                placeholder={t('البند (مثال: إنترنت، مواقف)', 'Item (e.g. internet, parking)')}
                value={item.title}
                onChange={(event) => updateAdjustment(index, { title: event.target.value })}
              />
              <input
                className="input"
                dir="ltr"
                inputMode="decimal"
                required
                pattern={MONEY_PATTERN}
                aria-label={t('المبلغ', 'Amount')}
                placeholder={t('المبلغ', 'Amount')}
                value={item.amount}
                onChange={(event) => updateAdjustment(index, { amount: event.target.value })}
              />
              <select
                className="select"
                aria-label={t('التكرار', 'Recurrence')}
                value={item.recurrence}
                onChange={(event) =>
                  updateAdjustment(index, {
                    recurrence: event.target.value as LeaseAdjustmentDraft['recurrence'],
                  })
                }
              >
                {ADJUSTMENT_RECURRENCES.map((value) => (
                  <option key={value} value={value}>
                    {pick(RECURRENCE_LABELS[value], ar)}
                  </option>
                ))}
              </select>
              <select
                className="select"
                aria-label={t('المدة', 'Scope')}
                value={item.scope}
                onChange={(event) =>
                  updateAdjustment(index, {
                    scope: event.target.value as LeaseAdjustmentDraft['scope'],
                  })
                }
              >
                {ADJUSTMENT_SCOPES.map((value) => (
                  <option key={value} value={value}>
                    {pick(SCOPE_LABELS[value], ar)}
                  </option>
                ))}
              </select>
              {item.scope === 'custom_months' ? (
                <input
                  className="input lcf-short"
                  type="number"
                  min={1}
                  max={240}
                  required
                  aria-label={t('عدد الأشهر', 'Months')}
                  placeholder={t('أشهر', 'Months')}
                  value={item.months ?? ''}
                  onChange={(event) => updateAdjustment(index, { months: event.target.value })}
                />
              ) : null}
              <span className="lcf-line__total">
                {line
                  ? line.recurrence === 'with_renewal'
                    ? t('يُحصَّل عند التجديد', 'Charged at renewal')
                    : `${line.kind === 'discount' ? '− ' : ''}${formatMoney(
                        String(line.lineTotalMinor),
                        currency,
                        locale,
                      )}`
                  : ''}
              </span>
              <button
                type="button"
                className="button button--quiet psr-action"
                onClick={() =>
                  set(
                    'adjustments',
                    draft.adjustments.filter((_, i) => i !== index),
                  )
                }
              >
                {t('حذف', 'Remove')}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="button button--quiet psr-action"
          onClick={() =>
            set('adjustments', [
              ...draft.adjustments,
              {
                kind: 'add',
                title: '',
                amount: '',
                recurrence: 'monthly',
                scope: 'contract_end',
                months: '',
              },
            ])
          }
        >
          {t('＋ إضافة بند', '＋ Add item')}
        </button>
      </Section>

      <Section
        tone="deposit"
        active={stepActive('deposit')}
        title={t('🛡️ التأمين (الوديعة)', '🛡️ Insurance (deposit)')}
      >
        <div className="form-grid">
          <Field
            id="lcf-deposit"
            label={t(`مبلغ التأمين (${currency})`, `Deposit amount (${currency})`)}
            required
            missing={gap('deposit')}
          >
            <input
              id="lcf-deposit"
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern={MONEY_PATTERN}
              value={draft.deposit}
              onChange={(event) => set('deposit', event.target.value)}
            />
          </Field>
        </div>
        <p className="muted lcf-help">
          {t(
            'تفاصيل دفع التأمين: شيك أو نقداً أو تحويل — مع رقم الشيك أو الإيصال.',
            'Deposit payment lines: cheque, cash or transfer — with the cheque or receipt number.',
          )}
        </p>
        {draft.depositItems.map((item, index) => (
          <div key={index} className="lcf-line">
            <select
              className="select"
              aria-label={t('طريقة دفع التأمين', 'Deposit method')}
              value={item.method}
              onChange={(event) =>
                updateDepositItem(index, {
                  method: event.target.value as LeaseDepositItemDraft['method'],
                })
              }
            >
              {DEPOSIT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {pick(DEPOSIT_METHOD_LABELS[method], ar)}
                </option>
              ))}
            </select>
            <input
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern={MONEY_PATTERN}
              required
              aria-label={t('المبلغ', 'Amount')}
              placeholder={t('المبلغ', 'Amount')}
              value={item.amount}
              onChange={(event) => updateDepositItem(index, { amount: event.target.value })}
            />
            <input
              className="input"
              dir="ltr"
              maxLength={80}
              aria-label={t('رقم الشيك / الإيصال', 'Cheque / receipt no.')}
              placeholder={t('رقم الشيك / الإيصال', 'Cheque / receipt no.')}
              value={item.reference ?? ''}
              onChange={(event) => updateDepositItem(index, { reference: event.target.value })}
            />
            <input
              className="input"
              maxLength={160}
              aria-label={t('البنك', 'Bank')}
              placeholder={t('البنك', 'Bank')}
              value={item.bankName ?? ''}
              onChange={(event) => updateDepositItem(index, { bankName: event.target.value })}
            />
            <input
              className="input"
              type="date"
              aria-label={t('التاريخ', 'Date')}
              value={item.dueOn ?? ''}
              onChange={(event) => updateDepositItem(index, { dueOn: event.target.value })}
            />
            <button
              type="button"
              className="button button--quiet psr-action"
              onClick={() =>
                set(
                  'depositItems',
                  draft.depositItems.filter((_, i) => i !== index),
                )
              }
            >
              {t('حذف', 'Remove')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button button--quiet psr-action"
          onClick={() =>
            set('depositItems', [
              ...draft.depositItems,
              { method: 'cheque', amount: draft.deposit, reference: '', bankName: '', dueOn: '' },
            ])
          }
        >
          {t('＋ إضافة بند', '＋ Add line')}
        </button>
      </Section>

      <Section
        tone="schedule"
        active={stepActive('schedule')}
        title={t('📅 جدول الدفع', '📅 Payment schedule')}
      >
        <p className="muted lcf-help">
          {t(
            'تُحسب التواريخ من «يوم دفع الإيجار» ودورية الدفع، والمبالغ من الإيجار الشهري. يمكن تعديل أي تاريخ أو مبلغ (إيجارات مخصصة). تغيير الإيجار أو المدة يعيد بناء الجدول مع الإبقاء على أرقام الشيكات.',
            'Dates follow the payment day and frequency; amounts follow the monthly rent. Any row can be edited (custom rent). Changing rent or term rebuilds the table but keeps cheque numbers.',
          )}
        </p>
        <div className="lcf-bank-bind">
          <Field
            id="lcf-rent-bank"
            label={
              isCheque
                ? t('الشيكات تكتب باسم من؟', 'Cheques payable to')
                : t('حساب استلام الإيجار (محاسبي)', 'Rent receipt bank account')
            }
            required={isCheque}
            missing={gap('rent_bank')}
          >
            {isCheque && selectedBank && selectedPayee && !editingBankLink && !addingBank ? (
              <div className="lcf-payee-locked">
                <output id="lcf-rent-bank" className="input lcf-output" aria-live="polite">
                  <strong>{selectedPayee}</strong>
                  <small dir="auto">{selectedBank.bankName}</small>
                </output>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setEditingBankLink(true)}
                >
                  {t('تعديل الربط', 'Edit link')}
                </button>
              </div>
            ) : (
              <select
                id="lcf-rent-bank"
                className="select"
                required={isCheque}
                value={draft.rentBankAccountId ?? ''}
                onChange={(event) => bindBankAccount(event.target.value)}
              >
                <option value="">
                  {isCheque
                    ? t('— اختر الحساب البنكي —', '— Select bank account —')
                    : t('— بدون ربط —', '— Not linked —')}
                </option>
                {activeBankAccounts.map((account) => {
                  const payee = (account.accountHolderNameEn || account.accountHolderName).trim();
                  const forProperty =
                    propertyId && account.propertyIds?.includes(propertyId)
                      ? t(' · مرتبط بالعقار', ' · linked to property')
                      : '';
                  return (
                    <option key={account.id} value={account.id}>
                      {payee || (ar ? account.labelAr : account.labelEn || account.labelAr)}
                      {forProperty ||
                        (account.defaultForRent ? t(' · افتراضي', ' · default') : '')}
                    </option>
                  );
                })}
              </select>
            )}
          </Field>
          {isCheque ? (
            <p className="muted lcf-help">
              {t(
                'الاسم يظهر للمستأجر كما هو من الحساب البنكي — لا يُكتب يدوياً. اختر حساباً أو أضف حساباً جديداً.',
                'The tenant sees this name from the bank account — it is not typed by hand. Pick an account or add a new one.',
              )}
            </p>
          ) : null}
          <div className="lcf-bank-bind__actions">
            <button
              type="button"
              className="button button--quiet button--sm"
              onClick={() => {
                setAddingBank((open) => !open);
                setEditingBankLink(true);
              }}
            >
              {addingBank
                ? t('إلغاء إضافة حساب', 'Cancel new account')
                : t('＋ إضافة حساب بنكي جديد', '＋ Add new bank account')}
            </button>
          </div>
          {addingBank ? (
            <div className="lcf-bank-new form-grid">
              <Field id="lcf-new-bank" label={t('اسم البنك *', 'Bank name *')}>
                <select
                  id="lcf-new-bank"
                  className="select"
                  required
                  value={newBank.bankName}
                  onChange={(event) =>
                    setNewBank((current) => ({ ...current, bankName: event.target.value }))
                  }
                >
                  {OMAN_BANKS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="lcf-new-holder-ar"
                label={t('اسم صاحب الحساب (عربي) *', 'Account holder (Arabic) *')}
              >
                <input
                  id="lcf-new-holder-ar"
                  className="input"
                  required
                  maxLength={160}
                  value={newBank.accountHolderName}
                  onChange={(event) =>
                    setNewBank((current) => ({
                      ...current,
                      accountHolderName: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                id="lcf-new-holder-en"
                label={t('اسم صاحب الحساب (إنجليزي)', 'Account holder (English)')}
              >
                <input
                  id="lcf-new-holder-en"
                  className="input"
                  dir="ltr"
                  maxLength={160}
                  value={newBank.accountHolderNameEn}
                  onChange={(event) =>
                    setNewBank((current) => ({
                      ...current,
                      accountHolderNameEn: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="form-actions" style={{ gridColumn: '1 / -1' }}>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={savingBank}
                  onClick={() => void saveNewBankAccount()}
                >
                  {savingBank
                    ? t('جارٍ الحفظ…', 'Saving…')
                    : t('حفظ الحساب وربطه', 'Save account & link')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {draft.schedule.length ? (
          <div className="data-table-wrap">
            <table className="data-table lcf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('الفترة', 'Period')}</th>
                  <th>{t('تاريخ الاستحقاق', 'Due date')}</th>
                  <th>{t('الإيجار', 'Rent')}</th>
                  {vatWithRent ? <th>{t('الضريبة', 'VAT')}</th> : null}
                  {vatWithRent ? <th>{t('الإجمالي', 'Total')}</th> : null}
                  {isCheque ? <th>{t('رقم الشيك', 'Cheque no.')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {draft.schedule.map((row, index) => {
                  const base =
                    defaultSchedule.length === draft.schedule.length
                      ? defaultSchedule[index]
                      : undefined;
                  const computedRow = terms?.schedule[index];
                  return (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td dir="ltr" className="lcf-period">
                        {base ? `${base.periodFrom} → ${base.periodTo}` : '—'}
                        {base?.extraDays ? t(' (أيام إضافية)', ' (extra days)') : ''}
                      </td>
                      <td>
                        <input
                          className="input lcf-cell"
                          type="date"
                          required
                          aria-label={t('تاريخ الاستحقاق', 'Due date')}
                          value={row.dueOn}
                          onChange={(event) =>
                            updateScheduleRow(index, { dueOn: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input lcf-cell"
                          dir="ltr"
                          inputMode="decimal"
                          required
                          pattern={MONEY_PATTERN}
                          aria-label={t('الإيجار', 'Rent')}
                          value={row.rent}
                          onChange={(event) =>
                            updateScheduleRow(index, { rent: event.target.value })
                          }
                        />
                      </td>
                      {vatWithRent ? (
                        <td>{computedRow ? money(computedRow.vatMinor) : '—'}</td>
                      ) : null}
                      {vatWithRent ? (
                        <td>{computedRow ? money(computedRow.totalMinor) : '—'}</td>
                      ) : null}
                      {isCheque ? (
                        <td>
                          <input
                            className={`input lcf-cell${
                              !row.chequeNumber?.trim() ? ' lcf-cell--missing' : ' lcf-cell--ok'
                            }`}
                            dir="ltr"
                            maxLength={80}
                            required
                            aria-label={t('رقم الشيك', 'Cheque no.')}
                            value={row.chequeNumber ?? ''}
                            onChange={(event) =>
                              updateScheduleRow(index, { chequeNumber: event.target.value })
                            }
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            {t(
              'أدخل الإيجار الشهري والتواريخ ويوم الدفع لبناء الجدول.',
              'Enter rent, dates and payment day to build the schedule.',
            )}
          </p>
        )}
        {isCheque && draft.schedule.length > 1 ? (
          <button
            type="button"
            className="button button--quiet psr-action"
            onClick={autoNumberCheques}
            disabled={!draft.schedule[0]?.chequeNumber?.trim()}
          >
            {t('ترقيم الشيكات تلقائياً من الشيك الأول', 'Auto-number cheques from the first')}
          </button>
        ) : null}
      </Section>

      {terms?.vatCheques.length && stepActive('schedule') ? (
        <Section
          tone="schedule"
          active
          title={t('🧾 شيكات الضريبة المضافة (إضافية)', '🧾 Additional VAT cheques')}
        >
          <div className="data-table-wrap">
            <table className="data-table lcf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('تاريخ الاستحقاق', 'Due date')}</th>
                  <th>{t('المبلغ', 'Amount')}</th>
                  <th>{t('رقم الشيك', 'Cheque no.')}</th>
                </tr>
              </thead>
              <tbody>
                {terms.vatCheques.map((row, index) => (
                  <tr key={row.index}>
                    <td>{row.index}</td>
                    <td dir="ltr">{row.dueOn}</td>
                    <td>{money(row.amountMinor)}</td>
                    <td>
                      <input
                        className="input lcf-cell"
                        dir="ltr"
                        maxLength={80}
                        aria-label={t('رقم الشيك', 'Cheque no.')}
                        value={draft.vatChequeNumbers[index] ?? ''}
                        onChange={(event) => {
                          const next = [...draft.vatChequeNumbers];
                          next[index] = event.target.value;
                          set('vatChequeNumbers', next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      <Section tone="notes" active={stepActive('notes')} title={t('🗒️ ملاحظات', '🗒️ Notes')}>
        <textarea
          className="textarea"
          rows={3}
          maxLength={2000}
          aria-label={t('ملاحظات', 'Notes')}
          value={draft.notes ?? ''}
          onChange={(event) => set('notes', event.target.value)}
        />
        <NoteTranslateBar
          value={draft.notes ?? ''}
          onChange={(next) => set('notes', next)}
          locale={locale}
          max={2000}
          disabled={busy}
        />
      </Section>

      <Section
        tone="summary"
        active={stepActive('summary')}
        title={t('📊 الملخص المالي', '📊 Financial summary')}
      >
        {terms ? (
          <LeaseTotalsSummary terms={terms} locale={locale} />
        ) : (
          <p className="muted">
            {pick(ERROR_TEXT[result.ok ? 'invalid_terms' : result.error], ar)}
          </p>
        )}
        {isLastStep ? (
          <p className="muted">
            {footnote ??
              (canSign
                ? t(
                    'سيُعتمد العقد فوراً ويوقّعه النظام باسمك نيابة عن المالك، وتُسجَّل الشيكات للمراجعة المحاسبية.',
                    'The contract is approved at once and system-signed in your name; cheques go to accounting review.',
                  )
                : t(
                    'لا تملك صلاحية اعتماد العقود، لذلك سيُرسل العقد إلى المدير لاعتماده.',
                    'You cannot approve contracts, so it will be sent to the manager for approval.',
                  ))}
          </p>
        ) : null}
      </Section>

      {localError ? (
        <div className="notice notice--error" role="alert">
          {localError}
        </div>
      ) : null}

      <div className="form-actions lcf-wizard-actions">
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || isFirstStep}
          onClick={goBack}
        >
          {t('← رجوع', '← Back')}
        </button>
        {!isLastStep ? (
          <button type="button" className="button button--primary" disabled={busy} onClick={goNext}>
            {t('التالي →', 'Next →')}
          </button>
        ) : (
          <button type="submit" className="button button--primary" disabled={busy || !units.length}>
            {busy
              ? t('جارٍ الحفظ…', 'Saving…')
              : (submitLabel ?? t('إنشاء عقد الإيجار', 'Create lease contract'))}
          </button>
        )}
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {t('إلغاء', 'Cancel')}
        </button>
      </div>
    </form>
  );
}
