'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  CIVIL_ID_MIN_REMAINING_DAYS,
  CR_MIN_VALID_MONTHS,
  MAX_LEASE_MONTHS,
  civilIdExpiryWarningText,
  civilIdExpiryWarnsRent,
  civilIdMinExpiryOn,
  partyErrorText,
  reservationPartyError,
  reservationPartySchema,
  type ReservationParty,
} from '@/lib/reservation-party';
import {
  EMPTY_SIGNATORY,
  emptyPartyForm,
  type PartyForm,
  type SignatoryForm,
} from '@/lib/reservation-party-form-state';
import {
  isInternationalPhone,
  isSamePhone,
  sortedCountries,
} from '@/lib/world-countries';

export type { PartyForm, SignatoryForm } from '@/lib/reservation-party-form-state';
export { emptyPartyForm } from '@/lib/reservation-party-form-state';

type PartyStep = {
  id: string;
  label: string;
  done: boolean;
  focusId?: string;
  body: ReactNode;
};

function filled(value: string | null | undefined, min = 2): boolean {
  return Boolean(value && value.trim().length >= min);
}

function focusStepField(id: string | undefined) {
  if (!id || typeof document === 'undefined') return;
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLElement)) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

export function muscatToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

/** The form as the API expects it, or the first problem in the customer's language. */
export function buildReservationParty(
  form: PartyForm,
  options: {
    holder: 'self' | 'other';
    mode: 'rent' | 'sale';
    minMonths: number;
    ar: boolean;
    /** Owner invite: skip OTP / ID copies / alternate phone until the tenant continues. */
    deferTenantCompletion?: boolean;
  },
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
    ...(options.deferTenantCompletion ? { deferTenantCompletion: true } : {}),
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
 * Progressive contract-party form: one field (or small group) at a time.
 * By default, completing a step auto-advances. Set `autoAdvance={false}` (owner invite)
 * to keep the current field until the user presses Next/Continue.
 */
export function ReservationPartyForm({
  value,
  onChange,
  holder,
  mode,
  minMonths,
  locale,
  autoAdvance = true,
  deferTenantCompletion = false,
}: {
  value: PartyForm;
  onChange: (next: PartyForm) => void;
  holder: 'self' | 'other';
  mode: 'rent' | 'sale';
  minMonths: number;
  locale: 'ar' | 'en';
  /** When false, stay on the completed field until the user presses Next. */
  autoAdvance?: boolean;
  /** Owner invite: tenant attaches ID copies, alt phone, and OTP later. */
  deferTenantCompletion?: boolean;
}) {
  const ar = locale === 'ar';
  const sale = mode === 'sale';
  const defer = deferTenantCompletion;
  const role = sale ? (ar ? 'المشتري' : 'buyer') : ar ? 'المستأجر' : 'tenant';
  const entityType = holder === 'self' ? 'person' : value.entityType;
  const countries = useMemo(() => sortedCountries(locale), [locale]);
  const person = value.person;
  const company = value.company;
  const omani = person.nationality === 'OM';
  const today = muscatToday();
  const civilIdMin = useMemo(
    () => (sale ? today : civilIdMinExpiryOn(today)),
    [sale, today],
  );
  const crMin = useMemo(() => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + CR_MIN_VALID_MONTHS);
    return date.toISOString().slice(0, 10);
  }, [today]);
  const termOptions = useMemo(
    () =>
      [...new Set([minMonths, 12, 24, 36, 48, 60].filter((months) => months >= minMonths))].sort(
        (a, b) => a - b,
      ),
    [minMonths],
  );

  const valueRef = useRef(value);
  valueRef.current = value;

  const setPerson = (patch: Partial<PartyForm['person']>) => {
    const current = valueRef.current;
    onChange({ ...current, person: { ...current.person, ...patch } });
  };
  const setCompany = (patch: Partial<PartyForm['company']>) => {
    const current = valueRef.current;
    onChange({ ...current, company: { ...current.company, ...patch } });
  };
  const setSignatory = (index: number, patch: Partial<SignatoryForm>) => {
    const current = valueRef.current;
    onChange({
      ...current,
      company: {
        ...current.company,
        signatories: current.company.signatories.map((row, at) =>
          at === index ? { ...row, ...patch } : row,
        ),
      },
    });
  };

  const [nationalityConfirmed, setNationalityConfirmed] = useState(
    () => filled(person.civilId, 4) || filled(person.nameAr) || filled(person.nameEn),
  );
  const [unlocked, setUnlocked] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const lastFocused = useRef<string | null>(null);

  const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const firstSig = company.signatories[0] ?? EMPTY_SIGNATORY;
  const personCivilIdWarn =
    !sale && civilIdExpiryWarnsRent(person.civilIdExpiresOn || null, today);
  const signatoryCivilIdWarn =
    !sale &&
    entityType === 'company' &&
    civilIdExpiryWarnsRent(firstSig.civilIdExpiresOn || null, today);
  const civilIdWarn = personCivilIdWarn || signatoryCivilIdWarn;

  const steps = useMemo((): PartyStep[] => {
    const list: PartyStep[] = [];

    if (!sale) {
      list.push({
        id: 'contractType',
        label: ar ? 'نوع الاستخدام' : 'Usage type',
        done: Boolean(value.contractType),
        focusId: 'party-contract-type',
        body: (
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
        ),
      });
      list.push({
        id: 'termMonths',
        label: ar ? 'مدة العقد' : 'Contract term',
        done: Number(value.termMonths) >= minMonths,
        focusId: 'party-term',
        body: (
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
                ? `أقل مدة يقبلها المالك ${minMonths} شهراً.`
                : `Owner minimum: ${minMonths} months.`}
            </p>
          </div>
        ),
      });
    }

    if (holder === 'other') {
      list.push({
        id: 'entityType',
        label: ar ? 'شخصي أو شركة' : 'Personal or company',
        done: value.entityType === 'person' || value.entityType === 'company',
        body: (
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
                {option === 'person' ? (ar ? 'شخصي' : 'Personal') : ar ? 'شركة' : 'Company'}
              </button>
            ))}
          </div>
        ),
      });
    }

    if (entityType === 'person') {
      list.push(
        {
          id: 'personName',
          label: ar ? `اسم ${role}` : `${role} name`,
          done: filled(person.nameAr) && filled(person.nameEn),
          focusId: 'party-person-name-ar',
          body: (
            <BilingualNameField
              idPrefix="party-person-name"
              labelAr={ar ? `اسم ${role} (عربي)` : 'Name (Arabic)'}
              labelEn={ar ? `اسم ${role} بالإنجليزية` : 'Name (English)'}
              valueAr={person.nameAr}
              valueEn={person.nameEn}
              onChange={setPerson}
              locale={locale}
            />
          ),
        },
        {
          id: 'nationality',
          label: ar ? 'الجنسية' : 'Nationality',
          done: nationalityConfirmed && Boolean(person.nationality),
          focusId: 'party-nationality',
          body: (
            <div className="field">
              <label htmlFor="party-nationality">
                {ar ? 'الجنسية' : 'Nationality'}
                <span aria-hidden="true"> *</span>
              </label>
              <select
                id="party-nationality"
                className="select"
                value={person.nationality}
                onChange={(event) => {
                  setNationalityConfirmed(true);
                  setPerson({ nationality: event.target.value });
                }}
              >
                {countries.map((row) => (
                  <option key={row.code} value={row.code}>
                    {ar ? row.nameAr : row.nameEn}
                  </option>
                ))}
              </select>
              {!nationalityConfirmed ? (
                <button
                  type="button"
                  className="button button--primary party-form__next"
                  onClick={() => setNationalityConfirmed(true)}
                >
                  {ar ? 'تأكيد والمتابعة' : 'Confirm & continue'}
                </button>
              ) : null}
            </div>
          ),
        },
        {
          id: 'civilId',
          label: ar ? 'الرقم المدني' : 'Civil ID',
          done: filled(person.civilId, 4),
          focusId: 'party-civil',
          body: (
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
          ),
        },
        {
          id: 'civilExpiry',
          label: ar ? 'انتهاء البطاقة' : 'Civil ID expiry',
          done: Boolean(person.civilIdExpiresOn && person.civilIdExpiresOn >= civilIdMin),
          focusId: 'party-civil-expiry',
          body: (
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
                min={civilIdMin}
                value={person.civilIdExpiresOn}
                onChange={(event) => setPerson({ civilIdExpiresOn: event.target.value })}
              />
              {!sale ? (
                <p className="field__hint muted">
                  {ar
                    ? `لا يُقبل تسجيل عقد إيجار إذا تبقت أقل من ${CIVIL_ID_MIN_REMAINING_DAYS} يوماً على انتهاء البطاقة — جدّدها أولاً ثم واصل.`
                    : `A lease cannot be registered if the ID expires in under ${CIVIL_ID_MIN_REMAINING_DAYS} days — renew it first, then continue.`}
                </p>
              ) : null}
              {personCivilIdWarn ? (
                <p className="field__hint" role="status">
                  {civilIdExpiryWarningText(ar)}
                </p>
              ) : null}
            </div>
          ),
        },
      );
      if (!defer) {
        list.push({
          id: 'civilCopy',
          label: ar ? 'نسخة البطاقة' : 'Civil ID copy',
          done: Boolean(person.civilIdCopy),
          focusId: 'party-civil-copy',
          body: (
            <PartyDocAttachField
              id="party-civil-copy"
              label={ar ? 'نسخة البطاقة' : 'Civil ID copy'}
              locale={locale}
              required
              value={person.civilIdCopy}
              onChange={(civilIdCopy) => setPerson({ civilIdCopy })}
            />
          ),
        });
      }

      if (!omani) {
        list.push(
          {
            id: 'passport',
            label: ar ? 'رقم الجواز' : 'Passport number',
            done: filled(person.passport, 4),
            focusId: 'party-passport',
            body: (
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
            ),
          },
          {
            id: 'passportExpiry',
            label: ar ? 'انتهاء الجواز' : 'Passport expiry',
            done: Boolean(person.passportExpiresOn && person.passportExpiresOn >= today),
            focusId: 'party-passport-expiry',
            body: (
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
                  min={today}
                  value={person.passportExpiresOn}
                  onChange={(event) => setPerson({ passportExpiresOn: event.target.value })}
                />
              </div>
            ),
          },
        );
        if (!defer) {
          list.push({
            id: 'passportCopy',
            label: ar ? 'نسخة الجواز' : 'Passport copy',
            done: Boolean(person.passportCopy),
            focusId: 'party-passport-copy',
            body: (
              <PartyDocAttachField
                id="party-passport-copy"
                label={ar ? 'نسخة الجواز' : 'Passport copy'}
                locale={locale}
                required
                value={person.passportCopy}
                onChange={(passportCopy) => setPerson({ passportCopy })}
              />
            ),
          });
        }
      }

      list.push({
        id: 'phone',
        label: ar ? 'رقم الجوال' : 'Mobile',
        done: isInternationalPhone(person.phone),
        focusId: 'party-phone',
        body: (
          <InternationalPhoneField
            id="party-phone"
            label={ar ? 'رقم الجوال' : 'Mobile'}
            value={person.phone}
            onChange={(phone) => setPerson({ phone })}
            locale={locale}
            required
          />
        ),
      });
      if (!defer) {
        list.push({
          id: 'altPhone',
          label: ar ? 'رقم هاتف بديل' : 'Alternate phone',
          done:
            isInternationalPhone(person.altPhone) &&
            !isSamePhone(person.altPhone, person.phone),
          focusId: 'party-alt-phone',
          body: (
            <InternationalPhoneField
              id="party-alt-phone"
              label={ar ? 'رقم هاتف بديل' : 'Alternate phone'}
              value={person.altPhone}
              onChange={(altPhone) => setPerson({ altPhone })}
              locale={locale}
              required
              hint={
                ar
                  ? 'رقم مختلف للتواصل عند الضرورة — 8 أو 9 أرقام محلية.'
                  : 'A different number for urgent contact — 8 or 9 local digits.'
              }
              error={
                isSamePhone(person.altPhone, person.phone)
                  ? ar
                    ? 'يجب أن يختلف عن رقم الجوال الأساسي.'
                    : 'Must differ from the primary mobile number.'
                  : null
              }
            />
          ),
        });
      }
      list.push({
        id: 'email',
        label: ar ? 'البريد الإلكتروني' : 'Email',
        done: emailOk(person.email),
        focusId: 'party-email',
        body: (
          <div className="field">
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
              onChange={(event) =>
                setPerson({ email: event.target.value, emailVerified: false })
              }
            />
            {defer ? (
              <p className="field__hint muted">
                {ar
                  ? 'سيصل المستأجر رابط الدعوة على هذا البريد لإكمال الدفع والمستندات — دون رمز OTP هنا.'
                  : 'The tenant gets the invite on this email to finish payment and documents — no OTP here.'}
              </p>
            ) : null}
          </div>
        ),
      });
      if (!defer) {
        list.push({
          id: 'emailOtp',
          label: ar ? 'تأكيد البريد' : 'Verify email',
          done: person.emailVerified,
          body: (
            <EmailOtpField
              email={person.email}
              verified={person.emailVerified}
              locale={locale}
              onVerified={(emailVerified) => setPerson({ emailVerified })}
            />
          ),
        });
      }
    } else {
      list.push(
        {
          id: 'companyName',
          label: ar ? 'اسم الشركة' : 'Company name',
          done: filled(company.nameAr) && filled(company.nameEn),
          focusId: 'party-company-name-ar',
          body: (
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
          ),
        },
        {
          id: 'crNumber',
          label: ar ? 'رقم السجل' : 'CR number',
          done: filled(company.crNumber, 3),
          focusId: 'party-cr',
          body: (
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
          ),
        },
        {
          id: 'crIssued',
          label: ar ? 'تاريخ التأسيس' : 'Established on',
          done: Boolean(company.crIssuedOn && company.crIssuedOn <= today),
          focusId: 'party-cr-issued',
          body: (
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
                max={today}
                value={company.crIssuedOn}
                onChange={(event) => setCompany({ crIssuedOn: event.target.value })}
              />
            </div>
          ),
        },
        {
          id: 'crExpiry',
          label: ar ? 'انتهاء السجل' : 'CR expiry',
          done: Boolean(company.crExpiry && company.crExpiry >= crMin),
          focusId: 'party-cr-expiry',
          body: (
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
                  ? 'لا يُقبل سجل ينتهي خلال أقل من شهرين.'
                  : 'Must remain valid for at least two months.'}
              </p>
            </div>
          ),
        },
      );
      if (!defer) {
        list.push({
          id: 'crCopy',
          label: ar ? 'نسخة السجل' : 'CR copy',
          done: Boolean(company.crCopy),
          focusId: 'party-cr-copy',
          body: (
            <PartyDocAttachField
              id="party-cr-copy"
              label={ar ? 'نسخة السجل التجاري' : 'CR document copy'}
              locale={locale}
              required
              value={company.crCopy}
              onChange={(crCopy) => setCompany({ crCopy })}
            />
          ),
        });
      }
      list.push(
        {
          id: 'companyEmail',
          label: ar ? 'بريد الشركة' : 'Company email',
          done: emailOk(company.email),
          focusId: 'party-company-email',
          body: (
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
              {defer ? (
                <p className="field__hint muted">
                  {ar
                    ? 'سيصل المستأجر رابط الدعوة على هذا البريد لإكمال الدفع والمستندات — دون رمز OTP هنا.'
                    : 'The tenant gets the invite on this email to finish payment and documents — no OTP here.'}
                </p>
              ) : null}
            </div>
          ),
        },
      );
      if (!defer) {
        list.push({
          id: 'companyEmailOtp',
          label: ar ? 'تأكيد البريد' : 'Verify email',
          done: company.emailVerified,
          body: (
            <EmailOtpField
              email={company.email}
              verified={company.emailVerified}
              locale={locale}
              onVerified={(emailVerified) => setCompany({ emailVerified })}
            />
          ),
        });
      }
      list.push({
        id: 'companyPhone',
        label: ar ? 'هاتف الشركة' : 'Company phone',
        done: isInternationalPhone(company.phone),
        focusId: 'party-company-phone',
        body: (
          <InternationalPhoneField
            id="party-company-phone"
            label={ar ? 'رقم التواصل' : 'Contact number'}
            value={company.phone}
            onChange={(phone) => setCompany({ phone })}
            locale={locale}
            required
          />
        ),
      });
      if (!defer) {
        list.push({
          id: 'companyAltPhone',
          label: ar ? 'هاتف بديل' : 'Alternate phone',
          done:
            isInternationalPhone(company.altPhone) &&
            !isSamePhone(company.altPhone, company.phone),
          focusId: 'party-company-alt-phone',
          body: (
            <InternationalPhoneField
              id="party-company-alt-phone"
              label={ar ? 'رقم هاتف بديل' : 'Alternate phone'}
              value={company.altPhone}
              onChange={(altPhone) => setCompany({ altPhone })}
              locale={locale}
              required
              hint={
                ar
                  ? 'رقم مختلف للتواصل عند الضرورة — 8 أو 9 أرقام محلية.'
                  : 'A different number for urgent contact — 8 or 9 local digits.'
              }
              error={
                isSamePhone(company.altPhone, company.phone)
                  ? ar
                    ? 'يجب أن يختلف عن هاتف الشركة الأساسي.'
                    : 'Must differ from the company phone number.'
                  : null
              }
            />
          ),
        });
      }
      list.push(
        {
          id: 'crAddress',
          label: ar ? 'عنوان السجل' : 'CR address',
          done: filled(company.crAddress),
          focusId: 'party-cr-address',
          body: (
            <div className="field">
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
          ),
        },
        {
          id: 'activity',
          label: ar ? 'النشاط' : 'Activity',
          done: filled(company.activity),
          focusId: 'party-activity',
          body: (
            <div className="field">
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
          ),
        },
        {
          id: 'signingMode',
          label: ar ? 'نوع التوقيع' : 'Signing mode',
          done: company.signingMode === 'single' || company.signingMode === 'joint',
          body: (
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
          ),
        },
        {
          id: 'signatory',
          label: ar ? 'المفوّض بالتوقيع' : 'Signatory',
          done:
            filled(firstSig.name) &&
            filled(firstSig.civilId, 4) &&
            Boolean(firstSig.civilIdExpiresOn) &&
            (defer || Boolean(firstSig.civilIdCopy)) &&
            (company.signingMode !== 'single' || isInternationalPhone(firstSig.phone)) &&
            (firstSig.nationality === 'OM' ||
              (filled(firstSig.passport || '', 4) &&
                Boolean(firstSig.passportExpiresOn) &&
                (defer || Boolean(firstSig.passportCopy)))),
          focusId: 'party-sig-name-0',
          body: (
            <div className="party-form__signatory party-form__signatory--solo">
              <div className="field">
                <label htmlFor="party-sig-name-0">
                  {ar ? 'اسم المفوّض' : 'Signatory name'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-sig-name-0"
                  className="input"
                  required
                  maxLength={160}
                  value={firstSig.name}
                  onChange={(event) => setSignatory(0, { name: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="party-sig-nationality-0">
                  {ar ? 'الجنسية' : 'Nationality'}
                </label>
                <select
                  id="party-sig-nationality-0"
                  className="select"
                  value={firstSig.nationality || 'OM'}
                  onChange={(event) => setSignatory(0, { nationality: event.target.value })}
                >
                  {countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {ar ? country.nameAr : country.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="party-sig-civil-0">
                  {ar ? 'الرقم المدني' : 'Civil ID'}
                  <span aria-hidden="true"> *</span>
                </label>
                <input
                  id="party-sig-civil-0"
                  className="input"
                  dir="ltr"
                  maxLength={32}
                  required
                  value={firstSig.civilId}
                  onChange={(event) => setSignatory(0, { civilId: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="party-sig-civil-expiry-0">
                  {ar ? 'انتهاء البطاقة' : 'ID expiry'}
                </label>
                <input
                  id="party-sig-civil-expiry-0"
                  className="input"
                  type="date"
                  required
                  min={civilIdMin}
                  value={firstSig.civilIdExpiresOn}
                  onChange={(event) =>
                    setSignatory(0, { civilIdExpiresOn: event.target.value })
                  }
                />
                {!sale ? (
                  <p className="field__hint muted">
                    {ar
                      ? `لا يُقبل تسجيل عقد إيجار إذا تبقت أقل من ${CIVIL_ID_MIN_REMAINING_DAYS} يوماً على انتهاء البطاقة — جدّدها أولاً ثم واصل.`
                      : `A lease cannot be registered if the ID expires in under ${CIVIL_ID_MIN_REMAINING_DAYS} days — renew it first, then continue.`}
                  </p>
                ) : null}
                {signatoryCivilIdWarn ? (
                  <p className="field__hint" role="status">
                    {civilIdExpiryWarningText(ar)}
                  </p>
                ) : null}
              </div>
              {!defer ? (
                <PartyDocAttachField
                  id="party-sig-civil-copy-0"
                  label={ar ? 'نسخة البطاقة' : 'ID copy'}
                  locale={locale}
                  required
                  value={firstSig.civilIdCopy}
                  onChange={(civilIdCopy) => setSignatory(0, { civilIdCopy })}
                />
              ) : null}
              {firstSig.nationality && firstSig.nationality !== 'OM' ? (
                <>
                  <div className="field">
                    <label htmlFor="party-sig-passport-0">
                      {ar ? 'رقم الجواز' : 'Passport'}
                    </label>
                    <input
                      id="party-sig-passport-0"
                      className="input"
                      dir="ltr"
                      required
                      maxLength={32}
                      value={firstSig.passport}
                      onChange={(event) => setSignatory(0, { passport: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="party-sig-passport-expiry-0">
                      {ar ? 'انتهاء الجواز' : 'Passport expiry'}
                    </label>
                    <input
                      id="party-sig-passport-expiry-0"
                      className="input"
                      type="date"
                      required
                      min={today}
                      value={firstSig.passportExpiresOn}
                      onChange={(event) =>
                        setSignatory(0, { passportExpiresOn: event.target.value })
                      }
                    />
                  </div>
                  {!defer ? (
                    <PartyDocAttachField
                      id="party-sig-passport-copy-0"
                      label={ar ? 'نسخة الجواز' : 'Passport copy'}
                      locale={locale}
                      required
                      value={firstSig.passportCopy}
                      onChange={(passportCopy) => setSignatory(0, { passportCopy })}
                    />
                  ) : null}
                </>
              ) : null}
              <InternationalPhoneField
                id="party-sig-phone-0"
                label={ar ? 'رقم الهاتف' : 'Phone'}
                value={firstSig.phone}
                onChange={(phone) => setSignatory(0, { phone })}
                locale={locale}
                required={company.signingMode === 'single'}
              />
              {company.signingMode === 'joint' ? (
                <p className="muted stays-checkout__hint">
                  {ar
                    ? 'بعد المتابعة يمكنك إضافة بقية الموقّعين من مراجعة العقد أو عبر المالك.'
                    : 'After continue, additional joint signatories can be completed with the owner if needed.'}
                </p>
              ) : null}
            </div>
          ),
        },
      );
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field-driven rebuild
  }, [
    ar,
    sale,
    holder,
    entityType,
    role,
    value,
    person,
    company,
    omani,
    today,
    civilIdMin,
    personCivilIdWarn,
    signatoryCivilIdWarn,
    crMin,
    minMonths,
    termOptions,
    countries,
    locale,
    nationalityConfirmed,
    defer,
  ]);

  const firstIncomplete = steps.findIndex((step) => !step.done);
  const frontier =
    firstIncomplete === -1
      ? Math.max(steps.length - 1, 0)
      : Math.min(Math.max(unlocked, firstIncomplete), Math.max(steps.length - 1, 0));
  const prevFrontier = useRef(frontier);

  useEffect(() => {
    setUnlocked(0);
    setViewIndex(0);
    lastFocused.current = null;
    prevFrontier.current = 0;
    setNationalityConfirmed(
      filled(person.civilId, 4) || filled(person.nameAr) || filled(person.nameEn),
    );
    // Reset progressive cursor when switching person/company.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entity switch only
  }, [entityType]);

  // Auto mode: jump forward when a new step unlocks. Manual mode waits for Next.
  useEffect(() => {
    if (!autoAdvance) {
      prevFrontier.current = frontier;
      return;
    }
    if (frontier > prevFrontier.current) setViewIndex(frontier);
    prevFrontier.current = frontier;
  }, [frontier, autoAdvance]);

  useEffect(() => {
    if (!autoAdvance) return;
    const current = steps[frontier];
    if (!current?.done || frontier >= steps.length - 1) return;
    const timer = window.setTimeout(() => {
      const next = frontier + 1;
      setUnlocked((currentUnlock) => Math.max(currentUnlock, next));
      setViewIndex(next);
      const nextStep = steps[next];
      if (nextStep?.focusId) {
        lastFocused.current = nextStep.focusId;
        focusStepField(nextStep.focusId);
      }
    }, current.id.toLowerCase().includes('copy') ? 650 : 240);
    return () => window.clearTimeout(timer);
  }, [frontier, steps, autoAdvance]);

  useEffect(() => {
    if (!autoAdvance) return;
    const current = steps[viewIndex];
    if (!current?.focusId || current.done) return;
    if (lastFocused.current === `${viewIndex}:${current.focusId}`) return;
    lastFocused.current = `${viewIndex}:${current.focusId}`;
    focusStepField(current.focusId);
  }, [viewIndex, steps, autoAdvance]);

  const missing =
    entityType === 'person'
      ? missingPersonFields(person, { deferTenantCompletion: defer })
      : missingCompanyFields(company, { deferTenantCompletion: defer });
  const progressDone = steps.filter((step) => step.done).length;
  const safeIndex = Math.min(Math.max(viewIndex, 0), frontier);
  const currentStep = steps[safeIndex];
  const canGoBack = safeIndex > 0;
  const canGoNext =
    Boolean(currentStep?.done) &&
    safeIndex < steps.length - 1 &&
    (autoAdvance ? safeIndex < frontier : true);

  function goBack() {
    if (!canGoBack) return;
    lastFocused.current = null;
    setViewIndex(safeIndex - 1);
  }

  function goNext() {
    if (!canGoNext) return;
    lastFocused.current = null;
    const next = safeIndex + 1;
    setUnlocked((currentUnlock) => Math.max(currentUnlock, next));
    setViewIndex(next);
    const nextStep = steps[next];
    if (nextStep?.focusId) {
      lastFocused.current = `${next}:${nextStep.focusId}`;
      focusStepField(nextStep.focusId);
    }
  }

  return (
    <div className="party-form party-form--progressive party-form--current-only">
      <div className="party-form__progress" aria-live="polite">
        <strong>
          {ar
            ? `خطوة ${Math.min(safeIndex + 1, steps.length)} من ${steps.length}`
            : `Step ${Math.min(safeIndex + 1, steps.length)} of ${steps.length}`}
        </strong>
        <span>
          {ar
            ? autoAdvance
              ? `${progressDone} مكتملة — عبّئ حقلاً واحداً في كل مرة`
              : `${progressDone} مكتملة — أكمل الحقل ثم اضغط التالي`
            : autoAdvance
              ? `${progressDone} done — fill one field at a time`
              : `${progressDone} done — finish the field, then press Next`}
        </span>
        <div className="party-form__progress-track" aria-hidden="true">
          <div
            className="party-form__progress-bar"
            style={{ width: `${steps.length ? (progressDone / steps.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {progressDone > 0 && missing.length ? (
        <MissingFieldsBanner locale={locale} fields={missing} />
      ) : null}

      {civilIdWarn ? (
        <p className="tenant-alert tenant-alert--warn" role="status">
          {civilIdExpiryWarningText(ar)}
        </p>
      ) : null}

      {currentStep ? (
        <div
          className={`party-form__step is-current${currentStep.done ? ' is-done' : ''}`}
          key={currentStep.id}
        >
          <div className="party-form__step-head" aria-current="step">
            <span className="party-form__step-index" aria-hidden="true">
              {currentStep.done ? '✓' : safeIndex + 1}
            </span>
            <span>{currentStep.label}</span>
            <em>{ar ? 'الآن' : 'Now'}</em>
          </div>
          <div className="party-form__step-body">{currentStep.body}</div>
          <div className="party-form__step-nav">
            {canGoBack ? (
              <button type="button" className="button button--quiet" onClick={goBack}>
                {ar ? 'رجوع' : 'Back'}
              </button>
            ) : (
              <span />
            )}
            {canGoNext ? (
              <button type="button" className="button button--primary" onClick={goNext}>
                {ar ? 'التالي' : 'Next'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="muted stays-checkout__hint">
        {ar
          ? `بعد إكمال الحقول تنتقل البيانات مباشرةً إلى ${sale ? 'عقد البيع' : 'عقد الإيجار'}.`
          : `When complete, these details go straight into the ${sale ? 'sale' : 'lease'} contract.`}
      </p>
    </div>
  );
}
