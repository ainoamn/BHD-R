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
import { formatMoney } from '@/lib/format';
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
  type LeaseAdjustmentDraft,
  type LeaseDepositItemDraft,
  type LeaseTermsDraft,
  type LeaseTermsError,
} from '@/lib/lease-terms';
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
    registrationFee: '1',
    otherTaxName: '',
    otherTaxRate: '',
    graceAsDiscount: true,
    deposit: decimal(unit?.depositMinor ?? unit?.rentMinor, digits),
    depositItems: [],
    chequeBankName: '',
    chequeAccountName: '',
    schedule: [],
    vatChequeNumbers: [],
    adjustments: [],
    electricityReading: '',
    waterReading: '',
    notes: '',
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lcf-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'field span-2' : 'field'}>
      <label htmlFor={id}>{label}</label>
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
export function LeaseContractForm({
  units,
  tenants,
  canSign,
  locale,
  busy,
  onSubmit,
  onCancel,
}: {
  units: PropertyRecordUnit[];
  tenants: PropertyRecordTenant[];
  canSign: boolean;
  locale: 'ar' | 'en';
  busy: boolean;
  onSubmit: (payload: LeaseContractPayload) => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const unit = units.find((item) => item.id === unitId);
  const currency = unit?.currency ?? 'OMR';
  const digits = minorDigitsFor(currency);
  const [tenant, setTenant] = useState<LeaseTenantDraft>(EMPTY_TENANT);
  const [draft, setDraft] = useState<LeaseTermsDraft>(() => initialDraft(units[0]));
  const [months, setMonths] = useState('12');
  const [localError, setLocalError] = useState<string | null>(null);

  const set = <K extends keyof LeaseTermsDraft>(key: K, value: LeaseTermsDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setTenantField = <K extends keyof LeaseTenantDraft>(key: K, value: LeaseTenantDraft[K]) =>
    setTenant((current) => ({ ...current, [key]: value }));
  const money = (minor: number) => (
    <span dir="ltr">{formatMoney(String(Math.round(minor)), currency, locale)}</span>
  );

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

  const result = useMemo(
    () => computeLeaseTerms(draft, currency, digits),
    [draft, currency, digits],
  );
  const terms = result.ok ? result.terms : null;
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
    <form className="psr-form lcf" onSubmit={submit}>
      <h3>{t('عقد تأجير يدوي', 'Manual lease contract')}</h3>

      <Section title={t('📝 بيانات العقد الرئيسية', '📝 Main contract data')}>
        <div className="form-grid">
          <Field id="lcf-unit" label={t('الوحدة', 'Unit')}>
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
          <Field id="lcf-mcontract" label={t('رقم العقد البلدي', 'Municipal contract no.')}>
            <input
              id="lcf-mcontract"
              className="input"
              dir="ltr"
              maxLength={80}
              value={draft.municipalContractNo ?? ''}
              onChange={(event) => set('municipalContractNo', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('👤 المستأجر', '👤 Tenant')}>
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
          <Field id="lcf-name-ar" label={t('اسم المستأجر (عربي) *', 'Tenant name (Arabic) *')}>
            <input
              id="lcf-name-ar"
              className="input"
              required
              minLength={2}
              maxLength={200}
              value={tenant.nameAr}
              onChange={(event) => setTenantField('nameAr', event.target.value)}
            />
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
              <Field id="lcf-civil" label={t('الرقم المدني', 'Civil ID no.')}>
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
              <Field id="lcf-cr" label={t('السجل التجاري', 'Commercial registration no.')}>
                <input
                  id="lcf-cr"
                  className="input"
                  dir="ltr"
                  maxLength={40}
                  value={tenant.crNumber}
                  onChange={(event) => setTenantField('crNumber', event.target.value)}
                />
              </Field>
              <Field id="lcf-cr-exp" label={t('انتهاء السجل التجاري', 'CR expiry date')}>
                <input
                  id="lcf-cr-exp"
                  className="input"
                  type="date"
                  value={tenant.crExpiry}
                  onChange={(event) => setTenantField('crExpiry', event.target.value)}
                />
              </Field>
              <Field id="lcf-sign-name" label={t('المفوض بالتوقيع', 'Authorized signatory')}>
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
            </>
          )}
          <Field id="lcf-phone" label={t('رقم الجوال', 'Mobile')}>
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

      <Section title={t('🏢 الوحدة والعدادات', '🏢 Unit & meters')}>
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
          <Field id="lcf-elec" label={t('قراءة عداد الكهرباء', 'Electricity meter reading')}>
            <input
              id="lcf-elec"
              className="input"
              dir="ltr"
              inputMode="decimal"
              maxLength={40}
              value={draft.electricityReading ?? ''}
              onChange={(event) => set('electricityReading', event.target.value)}
            />
          </Field>
          <Field id="lcf-water" label={t('قراءة عداد الماء', 'Water meter reading')}>
            <input
              id="lcf-water"
              className="input"
              dir="ltr"
              inputMode="decimal"
              maxLength={40}
              value={draft.waterReading ?? ''}
              onChange={(event) => set('waterReading', event.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title={t('💰 الإيجار والمدة', '💰 Rent & term')}>
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
              <Field id="lcf-area" label={t('عدد الأمتار (م²)', 'Area (m²)')}>
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
              label={t(`الإيجار الشهري (${currency}) *`, `Monthly rent (${currency}) *`)}
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
          <Field id="lcf-handover" label={t('تاريخ استلام الوحدة', 'Unit handover date')}>
            <input
              id="lcf-handover"
              className="input"
              type="date"
              max={draft.startsOn}
              value={draft.handoverOn ?? ''}
              onChange={(event) => set('handoverOn', event.target.value)}
            />
          </Field>
          <Field id="lcf-start" label={t('تاريخ البداية *', 'Start date *')}>
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
            label={t('تاريخ النهاية *', 'End date *')}
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
            label={t('فترة السماح', 'Grace period')}
            hint={t(
              'تُحسب تلقائياً: من تاريخ الاستلام إلى تاريخ البداية. مبلغ السماح = (الإيجار ÷ 30) × الأيام.',
              'Auto: handover to start. Grace amount = (rent ÷ 30) × days.',
            )}
          >
            <output id="lcf-grace" className="input lcf-output">
              {graceDays
                ? `${graceDays} ${t('يوم', 'days')} · ${formatMoney(
                    String(Math.round((scheduleRentMinor / 30) * graceDays)),
                    currency,
                    locale,
                  )}`
                : t('لا يوجد', 'None')}
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
              onChange={(event) =>
                set('paymentMethod', event.target.value as LeaseTermsDraft['paymentMethod'])
              }
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

      <Section title={t('🧾 الضرائب والرسوم', '🧾 Taxes & fees')}>
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
              {t('رسوم البلدية 3% من إجمالي الإيجار', 'Municipality fee: 3% of the total rent')}
              {terms?.totals.municipalityFeeMinor ? (
                <> · {money(terms.totals.municipalityFeeMinor)}</>
              ) : null}
            </span>
          </label>
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

      <Section title={t('🛡️ التأمين (الوديعة)', '🛡️ Insurance (deposit)')}>
        <div className="form-grid">
          <Field
            id="lcf-deposit"
            label={t(`مبلغ التأمين (${currency})`, `Deposit amount (${currency})`)}
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

      <Section title={t('📅 جدول الدفع', '📅 Payment schedule')}>
        <p className="muted lcf-help">
          {t(
            'تُحسب التواريخ من «يوم دفع الإيجار» ودورية الدفع، والمبالغ من الإيجار الشهري. يمكن تعديل أي تاريخ أو مبلغ (إيجارات مخصصة). تغيير الإيجار أو المدة يعيد بناء الجدول مع الإبقاء على أرقام الشيكات.',
            'Dates follow the payment day and frequency; amounts follow the monthly rent. Any row can be edited (custom rent). Changing rent or term rebuilds the table but keeps cheque numbers.',
          )}
        </p>
        {isCheque ? (
          <div className="form-grid">
            <Field id="lcf-bank" label={t('بنك الشيكات', 'Cheques bank')}>
              <input
                id="lcf-bank"
                className="input"
                maxLength={160}
                value={draft.chequeBankName ?? ''}
                onChange={(event) => set('chequeBankName', event.target.value)}
              />
            </Field>
            <Field id="lcf-account" label={t('اسم صاحب الحساب', 'Account holder name')}>
              <input
                id="lcf-account"
                className="input"
                maxLength={160}
                value={draft.chequeAccountName ?? ''}
                onChange={(event) => set('chequeAccountName', event.target.value)}
              />
            </Field>
          </div>
        ) : null}
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
                            className="input lcf-cell"
                            dir="ltr"
                            maxLength={80}
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

      {terms?.vatCheques.length ? (
        <Section title={t('🧾 شيكات الضريبة المضافة (إضافية)', '🧾 Additional VAT cheques')}>
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

      <Section title={t('➕ مبالغ إضافية / خصومات', '➕ Extra charges & discounts')}>
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

      <Section title={t('🗒️ ملاحظات', '🗒️ Notes')}>
        <textarea
          className="textarea"
          rows={3}
          maxLength={2000}
          aria-label={t('ملاحظات', 'Notes')}
          value={draft.notes ?? ''}
          onChange={(event) => set('notes', event.target.value)}
        />
      </Section>

      <Section title={t('📊 الملخص المالي', '📊 Financial summary')}>
        {terms ? (
          <LeaseTotalsSummary terms={terms} locale={locale} />
        ) : (
          <p className="muted">
            {pick(ERROR_TEXT[result.ok ? 'invalid_terms' : result.error], ar)}
          </p>
        )}
      </Section>

      {localError ? (
        <div className="notice notice--error" role="alert">
          {localError}
        </div>
      ) : null}
      <p className="muted">
        {canSign
          ? t(
              'سيُعتمد العقد فوراً ويوقّعه النظام باسمك نيابة عن المالك، وتُسجَّل الشيكات للمراجعة المحاسبية.',
              'The contract is approved at once and system-signed in your name; cheques go to accounting review.',
            )
          : t(
              'لا تملك صلاحية اعتماد العقود، لذلك سيُرسل العقد إلى المدير لاعتماده.',
              'You cannot approve contracts, so it will be sent to the manager for approval.',
            )}
      </p>
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={busy || !units.length}>
          {busy ? t('جارٍ الحفظ…', 'Saving…') : t('إنشاء عقد الإيجار', 'Create lease contract')}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {t('إلغاء', 'Cancel')}
        </button>
      </div>
    </form>
  );
}
