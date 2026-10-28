'use client';

import { useMemo } from 'react';
import { BilingualNameField } from '@/components/bilingual-name-field';
import { EmailOtpField } from '@/components/email-otp-field';
import { InternationalPhoneField } from '@/components/international-phone-field';
import { MissingFieldsBanner } from '@/components/missing-fields-banner';
import { PartyDocAttachField } from '@/components/party-doc-attach';
import type { ContractUse } from '@/lib/lease-terms';
import {
  missingCompanyFields,
  missingPersonFields,
  type PartyDocAttach,
} from '@/lib/profile-completeness';
import {
  CR_MIN_VALID_MONTHS,
  MAX_LEASE_MONTHS,
  partyErrorText,
  reservationPartyError,
  reservationPartySchema,
  type ReservationParty,
} from '@/lib/reservation-party';
import { sortedCountries } from '@/lib/world-countries';

type SignatoryForm = {
  name: string;
  civilId: string;
  phone: string;
  nationality: string;
  passport: string;
  civilIdExpiresOn: string;
  passportExpiresOn: string;
  civilIdCopy?: PartyDocAttach | undefined;
  passportCopy?: PartyDocAttach | undefined;
};

export type PartyForm = {
  contractType: ContractUse;
  termMonths: string;
  entityType: 'person' | 'company';
  person: {
    nameAr: string;
    nameEn: string;
    nationality: string;
    civilId: string;
    passport: string;
    phone: string;
    altPhone: string;
    email: string;
    civilIdExpiresOn: string;
    passportExpiresOn: string;
    civilIdCopy?: PartyDocAttach | undefined;
    passportCopy?: PartyDocAttach | undefined;
    emailVerified: boolean;
  };
  company: {
    nameAr: string;
    nameEn: string;
    crNumber: string;
    crIssuedOn: string;
    crExpiry: string;
    email: string;
    phone: string;
    altPhone: string;
    crAddress: string;
    activity: string;
    signingMode: 'single' | 'joint';
    signatories: SignatoryForm[];
    crCopy?: PartyDocAttach | undefined;
    emailVerified: boolean;
  };
};

const EMPTY_SIGNATORY: SignatoryForm = {
  name: '',
  civilId: '',
  phone: '',
  nationality: 'OM',
  passport: '',
  civilIdExpiresOn: '',
  passportExpiresOn: '',
};

export function emptyPartyForm(
  minMonths: number,
  contractType: ContractUse = 'residential',
): PartyForm {
  return {
    contractType,
    termMonths: String(Math.max(minMonths, 12)),
    entityType: 'person',
    person: {
      nameAr: '',
      nameEn: '',
      nationality: 'OM',
      civilId: '',
      passport: '',
      phone: '',
      altPhone: '',
      email: '',
      civilIdExpiresOn: '',
      passportExpiresOn: '',
      emailVerified: false,
    },
    company: {
      nameAr: '',
      nameEn: '',
      crNumber: '',
      crIssuedOn: '',
      crExpiry: '',
      email: '',
      phone: '',
      altPhone: '',
      crAddress: '',
      activity: '',
      signingMode: 'single',
      signatories: [{ ...EMPTY_SIGNATORY }],
      emailVerified: false,
    },
  };
}

export function muscatToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

/** The form as the API expects it, or the first problem in the customer's language. */
export function buildReservationParty(
  form: PartyForm,
  options: { holder: 'self' | 'other'; mode: 'rent' | 'sale'; minMonths: number; ar: boolean },
): { party: ReservationParty } | { error: string } {
  const entityType = options.holder === 'self' ? 'person' : form.entityType;
  const draft = {
    contractType: options.mode === 'rent' ? form.contractType : null,
    termMonths: options.mode === 'rent' ? Number(form.termMonths) || 0 : null,
    holder: options.holder,
    entityType,
    person: entityType === 'person' ? { ...form.person } : null,
    company:
      entityType === 'company'
        ? {
            ...form.company,
            signatories: form.company.signatories.filter((row) => row.name.trim()),
          }
        : null,
  };
  if (options.mode === 'rent' && (draft.termMonths ?? 0) < options.minMonths) {
    return { error: partyErrorText('term_too_short', options.ar) };
  }
  const parsed = reservationPartySchema.safeParse(draft);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join('.') ?? '';
    return { error: fieldHint(path, options.ar) };
  }
  const code = reservationPartyError(parsed.data, {
    mode: options.mode,
    minMonths: options.minMonths,
    today: muscatToday(),
  });
  return code ? { error: partyErrorText(code, options.ar) } : { party: parsed.data };
}

function fieldHint(path: string, ar: boolean): string {
  const field = path.split('.').pop() ?? '';
  const labels: Record<string, [string, string]> = {
    nameAr: ['الاسم بالعربية', 'the Arabic name'],
    nameEn: ['الاسم بالإنجليزية', 'the English name'],
    nationality: ['الجنسية', 'the nationality'],
    civilId: ['الرقم المدني', 'the civil ID'],
    phone: ['رقم الهاتف (مع رمز الدولة)', 'the phone number (with country code)'],
    altPhone: ['رقم الهاتف البديل', 'the alternate phone number'],
    email: ['البريد الإلكتروني', 'the email'],
    crNumber: ['رقم السجل التجاري', 'the CR number'],
    crIssuedOn: ['تاريخ التأسيس', 'the establishment date'],
    crExpiry: ['تاريخ انتهاء السجل', 'the CR expiry date'],
    crAddress: ['عنوان السجل', 'the CR address'],
    activity: ['النشاط المراد الاستئجار لأجله', 'the intended activity'],
    name: ['اسم المفوّض بالتوقيع', 'the signatory name'],
    signatories: ['المفوّضين بالتوقيع', 'the signatories'],
    termMonths: ['مدة العقد', 'the contract term'],
  };
  const label = labels[field];
  if (!label) return partyErrorText('tenant_details_invalid', ar);
  return ar ? `تحقّق من ${label[0]}.` : `Check ${label[1]}.`;
}

/**
 * Who the contract is with: contract type and term (lease), then an individual (bilingual name,
 * nationality, civil ID, passport for non-Omanis, two phones, email) or a company (CR data,
 * address, activity, and its single or joint signatories).
 */
export function ReservationPartyForm({
  value,
  onChange,
  holder,
  mode,
  minMonths,
  locale,
}: {
  value: PartyForm;
  onChange: (next: PartyForm) => void;
  holder: 'self' | 'other';
  mode: 'rent' | 'sale';
  minMonths: number;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const sale = mode === 'sale';
  const role = sale ? (ar ? 'المشتري' : 'buyer') : ar ? 'المستأجر' : 'tenant';
  const entityType = holder === 'self' ? 'person' : value.entityType;
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const person = value.person;
  const company = value.company;
  const omani = person.nationality === 'OM';
  const crMin = useMemo(() => {
    const date = new Date(`${muscatToday()}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + CR_MIN_VALID_MONTHS);
    return date.toISOString().slice(0, 10);
  }, []);
  const termOptions = useMemo(
    () =>
      [...new Set([minMonths, 12, 24, 36, 48, 60].filter((months) => months >= minMonths))].sort(
        (a, b) => a - b,
      ),
    [minMonths],
  );

  const setPerson = (patch: Partial<PartyForm['person']>) =>
    onChange({ ...value, person: { ...person, ...patch } });
  const setCompany = (patch: Partial<PartyForm['company']>) =>
    onChange({ ...value, company: { ...company, ...patch } });
  const setSignatory = (index: number, patch: Partial<SignatoryForm>) =>
    setCompany({
      signatories: company.signatories.map((row, at) =>
        at === index ? { ...row, ...patch } : row,
      ),
    });

  const missing =
    entityType === 'person' ? missingPersonFields(person) : missingCompanyFields(company);

  return (
    <div className="party-form">
      <MissingFieldsBanner locale={locale} fields={missing} />
      {!sale ? (
        <fieldset className="party-form__section">
          <legend>{ar ? 'العقد' : 'Contract'}</legend>
          <div className="stays-checkout__grid">
            <div className="field">
              <label htmlFor="party-contract-type">
                {ar ? 'نوع الاستخدام (العقد)' : 'Usage type (contract)'}
              </label>
              <select
                id="party-contract-type"
                className="select"
                value={value.contractType}
                onChange={(event) =>
                  onChange({ ...value, contractType: event.target.value as ContractUse })
                }
              >
                <option value="residential">{ar ? 'سكني' : 'Residential'}</option>
                <option value="commercial">{ar ? 'تجاري' : 'Commercial'}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="party-term">
                {ar ? 'مدة العقد (بالأشهر)' : 'Contract term (months)'}
              </label>
              <input
                id="party-term"
                className="input"
                type="number"
                inputMode="numeric"
                list="party-term-options"
                min={minMonths}
                max={MAX_LEASE_MONTHS}
                dir="ltr"
                required
                value={value.termMonths}
                onChange={(event) => onChange({ ...value, termMonths: event.target.value })}
              />
              <datalist id="party-term-options">
                {termOptions.map((months) => (
                  <option key={months} value={months} />
                ))}
              </datalist>
              <p className="field__hint muted">
                {ar
                  ? `إلزامي — أقل مدة يقبلها المالك ${minMonths} شهراً.`
                  : `Required — the owner accepts at least ${minMonths} months.`}
              </p>
            </div>
          </div>
        </fieldset>
      ) : null}

      {holder === 'other' ? (
        <fieldset className="party-form__section">
          <legend>{ar ? `نوع الجهة ${sale ? 'المشترية' : 'المستأجرة'}` : `${role} type`}</legend>
          <div className="lease-checkout__modes" role="radiogroup">
            {(['person', 'company'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={entityType === option}
                className={`button ${entityType === option ? 'button--primary' : 'button--quiet'}`}
                onClick={() => onChange({ ...value, entityType: option })}
              >
                {option === 'person' ? (ar ? 'فرد' : 'Individual') : ar ? 'شركة' : 'Company'}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {entityType === 'person' ? (
        <fieldset className="party-form__section">
          <legend>{ar ? `بيانات ${role}` : `The ${role}`}</legend>
          <div className="stays-checkout__grid">
            <BilingualNameField
              idPrefix="party-person-name"
              labelAr={ar ? `اسم ${role} (عربي)` : 'Name (Arabic)'}
              labelEn={ar ? `اسم ${role} بالإنجليزية` : 'Name (English)'}
              valueAr={person.nameAr}
              valueEn={person.nameEn}
              onChange={setPerson}
              locale={locale}
            />
            <div className="field">
              <label htmlFor="party-nationality">
                {ar ? 'الجنسية' : 'Nationality'}
                <span aria-hidden="true"> *</span>
              </label>
              <select
                id="party-nationality"
                className="select"
                value={person.nationality}
                onChange={(event) => setPerson({ nationality: event.target.value })}
              >
                {countries.map((row) => (
                  <option key={row.code} value={row.code}>
                    {ar ? row.nameAr : row.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="party-civil">
                {ar ? 'الرقم المدني' : 'Civil ID'}
                <span aria-hidden="true"> *</span>
              </label>
              <input
                id="party-civil"
                className="input"
                dir="ltr"
                required
                maxLength={32}
                value={person.civilId}
                onChange={(event) => setPerson({ civilId: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="party-civil-expiry">
                {ar ? 'انتهاء البطاقة' : 'Civil ID expiry'}
                <span aria-hidden="true"> *</span>
              </label>
              <input
                id="party-civil-expiry"
                className="input"
                type="date"
                required
                min={muscatToday()}
                value={person.civilIdExpiresOn}
                onChange={(event) => setPerson({ civilIdExpiresOn: event.target.value })}
              />
            </div>
            <PartyDocAttachField
              id="party-civil-copy"
              label={ar ? 'نسخة البطاقة' : 'Civil ID copy'}
              locale={locale}
              required
              value={person.civilIdCopy}
              onChange={(civilIdCopy) => setPerson({ civilIdCopy })}
            />
            {!omani ? (
              <>
                <div className="field">
                  <label htmlFor="party-passport">
                    {ar ? 'رقم الجواز' : 'Passport number'}
                    <span aria-hidden="true"> *</span>
                  </label>
                  <input
                    id="party-passport"
                    className="input"
                    dir="ltr"
                    required
                    maxLength={32}
                    value={person.passport}
                    onChange={(event) => setPerson({ passport: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="party-passport-expiry">
                    {ar ? 'انتهاء الجواز' : 'Passport expiry'}
                    <span aria-hidden="true"> *</span>
                  </label>
                  <input
                    id="party-passport-expiry"
                    className="input"
                    type="date"
                    required
                    min={muscatToday()}
                    value={person.passportExpiresOn}
                    onChange={(event) => setPerson({ passportExpiresOn: event.target.value })}
                  />
                </div>
                <PartyDocAttachField
                  id="party-passport-copy"
                  label={ar ? 'نسخة الجواز' : 'Passport copy'}
                  locale={locale}
                  required
                  value={person.passportCopy}
                  onChange={(passportCopy) => setPerson({ passportCopy })}
                />
              </>
            ) : null}
            <InternationalPhoneField
              id="party-phone"
              label={ar ? 'رقم الجوال' : 'Mobile'}
              value={person.phone}
              onChange={(phone) => setPerson({ phone })}
              locale={locale}
              required
            />
            <InternationalPhoneField
              id="party-alt-phone"
              label={ar ? 'رقم هاتف بديل' : 'Alternate phone'}
              value={person.altPhone}
              onChange={(altPhone) => setPerson({ altPhone })}
              locale={locale}
              required
              hint={
                ar ? 'رقم مختلف للتواصل عند الضرورة.' : 'A different number for urgent contact.'
              }
            />
            <div className="field span-2">
              <label htmlFor="party-email">
                {ar ? 'البريد الإلكتروني' : 'Email'}
                <span aria-hidden="true"> *</span>
              </label>
              <input
                id="party-email"
                className="input"
                type="email"
                dir="ltr"
                required
                maxLength={254}
                value={person.email}
                onChange={(event) => setPerson({ email: event.target.value, emailVerified: false })}
              />
            </div>
            <EmailOtpField
              email={person.email}
              verified={person.emailVerified}
              locale={locale}
              onVerified={(emailVerified) => setPerson({ emailVerified })}
            />
          </div>
        </fieldset>
      ) : (
        <>
          <fieldset className="party-form__section">
            <legend>{ar ? 'بيانات الشركة' : 'Company'}</legend>
            <div className="stays-checkout__grid">
              <BilingualNameField
                idPrefix="party-company-name"
                labelAr={ar ? 'اسم الشركة (عربي)' : 'Company name (Arabic)'}
                labelEn={ar ? 'اسم الشركة بالإنجليزية' : 'Company name (English)'}
                valueAr={company.nameAr}
                valueEn={company.nameEn}
                onChange={setCompany}
                locale={locale}
                kind="company"
              />
              <div className="field">
                <label htmlFor="party-cr">
                  {ar ? 'رقم السجل التجاري' : 'CR number'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-cr"
                  className="input"
                  dir="ltr"
                  required
                  maxLength={32}
                  value={company.crNumber}
                  onChange={(event) => setCompany({ crNumber: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="party-cr-issued">
                  {ar ? 'تاريخ التأسيس' : 'Established on'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-cr-issued"
                  className="input"
                  type="date"
                  required
                  max={muscatToday()}
                  value={company.crIssuedOn}
                  onChange={(event) => setCompany({ crIssuedOn: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="party-cr-expiry">
                  {ar ? 'تاريخ انتهاء السجل' : 'CR expiry'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-cr-expiry"
                  className="input"
                  type="date"
                  required
                  min={crMin}
                  value={company.crExpiry}
                  onChange={(event) => setCompany({ crExpiry: event.target.value })}
                />
                <p className="field__hint muted">
                  {ar
                    ? 'لا يُقبل سجل منتهٍ أو ينتهي خلال أقل من شهرين — جدّده أولاً.'
                    : 'Expired or expiring within two months is not accepted — renew first.'}
                </p>
              </div>
              <PartyDocAttachField
                id="party-cr-copy"
                label={ar ? 'نسخة السجل التجاري' : 'CR document copy'}
                locale={locale}
                required
                value={company.crCopy}
                onChange={(crCopy) => setCompany({ crCopy })}
              />
              <div className="field">
                <label htmlFor="party-company-email">
                  {ar ? 'البريد الإلكتروني' : 'Email'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-company-email"
                  className="input"
                  type="email"
                  dir="ltr"
                  required
                  maxLength={254}
                  value={company.email}
                  onChange={(event) =>
                    setCompany({ email: event.target.value, emailVerified: false })
                  }
                />
              </div>
              <EmailOtpField
                email={company.email}
                verified={company.emailVerified}
                locale={locale}
                onVerified={(emailVerified) => setCompany({ emailVerified })}
              />
              <InternationalPhoneField
                id="party-company-phone"
                label={ar ? 'رقم التواصل' : 'Contact number'}
                value={company.phone}
                onChange={(phone) => setCompany({ phone })}
                locale={locale}
                required
              />
              <InternationalPhoneField
                id="party-company-alt-phone"
                label={ar ? 'رقم هاتف بديل' : 'Alternate phone'}
                value={company.altPhone}
                onChange={(altPhone) => setCompany({ altPhone })}
                locale={locale}
                required
              />
              <div className="field span-2">
                <label htmlFor="party-cr-address">
                  {ar ? 'العنوان حسب السجل' : 'Address per the CR'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-cr-address"
                  className="input"
                  required
                  maxLength={300}
                  value={company.crAddress}
                  onChange={(event) => setCompany({ crAddress: event.target.value })}
                />
              </div>
              <div className="field span-2">
                <label htmlFor="party-activity">
                  {sale
                    ? ar
                      ? 'النشاط المراد الشراء لأجله'
                      : 'Intended activity'
                    : ar
                      ? 'النشاط المراد الاستئجار لأجله'
                      : 'Activity the premises are rented for'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-activity"
                  className="input"
                  required
                  maxLength={200}
                  value={company.activity}
                  onChange={(event) => setCompany({ activity: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="party-form__section">
            <legend>{ar ? 'التوقيع حسب السجل التجاري' : 'Signing per the CR'}</legend>
            <div className="lease-checkout__modes" role="radiogroup">
              {(['single', 'joint'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={company.signingMode === option}
                  className={`button ${company.signingMode === option ? 'button--primary' : 'button--quiet'}`}
                  onClick={() =>
                    setCompany({
                      signingMode: option,
                      signatories:
                        option === 'joint' && company.signatories.length < 2
                          ? [...company.signatories, { ...EMPTY_SIGNATORY }]
                          : company.signatories,
                    })
                  }
                >
                  {option === 'single'
                    ? ar
                      ? 'منفرد'
                      : 'Individual'
                    : ar
                      ? 'متحد (مجتمعين)'
                      : 'Joint'}
                </button>
              ))}
            </div>
            <p className="muted stays-checkout__hint">
              {company.signingMode === 'single'
                ? ar
                  ? 'أدخل المفوّض بالتوقيع (يمكن إضافة أكثر من مفوّض).'
                  : 'Enter the authorised signatory (you can add more than one).'
                : ar
                  ? 'أدخل أسماء الأشخاص الذين يوقّعون مجتمعين حسب بيانات السجل التجاري.'
                  : 'Enter everyone who signs jointly per the CR.'}
            </p>
            <ol className="party-form__signatories">
              {company.signatories.map((row, index) => (
                <li key={index} className="party-form__signatory">
                  <div className="field">
                    <label htmlFor={`party-sig-name-${index}`}>
                      {ar ? 'الاسم' : 'Name'}
                      <span aria-hidden="true"> *</span>
                    </label>
                    <input
                      id={`party-sig-name-${index}`}
                      className="input"
                      required
                      maxLength={160}
                      value={row.name}
                      onChange={(event) => setSignatory(index, { name: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`party-sig-nationality-${index}`}>
                      {ar ? 'الجنسية' : 'Nationality'}
                      <span aria-hidden="true"> *</span>
                    </label>
                    <select
                      id={`party-sig-nationality-${index}`}
                      className="select"
                      value={row.nationality || 'OM'}
                      onChange={(event) => setSignatory(index, { nationality: event.target.value })}
                    >
                      {countries.map((country) => (
                        <option key={country.code} value={country.code}>
                          {ar ? country.nameAr : country.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`party-sig-civil-${index}`}>
                      {ar ? 'الرقم المدني' : 'Civil ID'}
                      {company.signingMode === 'single' ? <span aria-hidden="true"> *</span> : null}
                    </label>
                    <input
                      id={`party-sig-civil-${index}`}
                      className="input"
                      dir="ltr"
                      maxLength={32}
                      required={company.signingMode === 'single'}
                      value={row.civilId}
                      onChange={(event) => setSignatory(index, { civilId: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`party-sig-civil-expiry-${index}`}>
                      {ar ? 'انتهاء البطاقة' : 'ID expiry'}
                      <span aria-hidden="true"> *</span>
                    </label>
                    <input
                      id={`party-sig-civil-expiry-${index}`}
                      className="input"
                      type="date"
                      required
                      min={muscatToday()}
                      value={row.civilIdExpiresOn}
                      onChange={(event) =>
                        setSignatory(index, { civilIdExpiresOn: event.target.value })
                      }
                    />
                  </div>
                  <PartyDocAttachField
                    id={`party-sig-civil-copy-${index}`}
                    label={ar ? 'نسخة البطاقة' : 'ID copy'}
                    locale={locale}
                    required
                    value={row.civilIdCopy}
                    onChange={(civilIdCopy) => setSignatory(index, { civilIdCopy })}
                  />
                  {row.nationality && row.nationality !== 'OM' ? (
                    <>
                      <div className="field">
                        <label htmlFor={`party-sig-passport-${index}`}>
                          {ar ? 'رقم الجواز' : 'Passport'}
                          <span aria-hidden="true"> *</span>
                        </label>
                        <input
                          id={`party-sig-passport-${index}`}
                          className="input"
                          dir="ltr"
                          required
                          maxLength={32}
                          value={row.passport}
                          onChange={(event) =>
                            setSignatory(index, { passport: event.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`party-sig-passport-expiry-${index}`}>
                          {ar ? 'انتهاء الجواز' : 'Passport expiry'}
                          <span aria-hidden="true"> *</span>
                        </label>
                        <input
                          id={`party-sig-passport-expiry-${index}`}
                          className="input"
                          type="date"
                          required
                          min={muscatToday()}
                          value={row.passportExpiresOn}
                          onChange={(event) =>
                            setSignatory(index, { passportExpiresOn: event.target.value })
                          }
                        />
                      </div>
                      <PartyDocAttachField
                        id={`party-sig-passport-copy-${index}`}
                        label={ar ? 'نسخة الجواز' : 'Passport copy'}
                        locale={locale}
                        required
                        value={row.passportCopy}
                        onChange={(passportCopy) => setSignatory(index, { passportCopy })}
                      />
                    </>
                  ) : null}
                  <InternationalPhoneField
                    id={`party-sig-phone-${index}`}
                    label={ar ? 'رقم الهاتف' : 'Phone'}
                    value={row.phone}
                    onChange={(phone) => setSignatory(index, { phone })}
                    locale={locale}
                    required={company.signingMode === 'single'}
                  />
                  {company.signatories.length > 1 ? (
                    <button
                      type="button"
                      className="button button--quiet party-form__remove"
                      onClick={() =>
                        setCompany({
                          signatories: company.signatories.filter((_, at) => at !== index),
                        })
                      }
                    >
                      {ar ? 'حذف' : 'Remove'}
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
            {company.signatories.length < 10 ? (
              <button
                type="button"
                className="button button--quiet"
                onClick={() =>
                  setCompany({ signatories: [...company.signatories, { ...EMPTY_SIGNATORY }] })
                }
              >
                {company.signingMode === 'single'
                  ? ar
                    ? '+ إضافة مفوّض آخر'
                    : '+ Add another signatory'
                  : ar
                    ? '+ إضافة شخص'
                    : '+ Add a person'}
              </button>
            ) : null}
          </fieldset>
        </>
      )}
      <p className="muted stays-checkout__hint">
        {ar
          ? `تنتقل هذه البيانات مباشرةً إلى ${sale ? 'عقد البيع' : 'عقد الإيجار'} دون حاجة لإعادة إدخالها من المالك.`
          : `These details go straight into the ${sale ? 'sale' : 'lease'} contract — the owner does not re-enter them.`}
      </p>
    </div>
  );
}
