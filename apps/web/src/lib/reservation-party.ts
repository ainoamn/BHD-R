import { z } from 'zod';
import { CONTRACT_USES, type ContractUse } from '@/lib/lease-terms';
import {
  missingCompanyFields,
  missingPersonFields,
  type PartyDocAttach,
} from '@/lib/profile-completeness';
import {
  countryName,
  isCountryCode,
  isInternationalPhone,
  isSamePhone,
} from '@/lib/world-countries';

/**
 * The tenant or buyer the customer fills in while booking. It is stored on the reservation
 * and carried into the lease or sale contract so the owner never re-types it.
 */
export const DEFAULT_MIN_LEASE_MONTHS = 12;
export const MAX_LEASE_MONTHS = 120;
/** A commercial registration must stay valid at least this long after booking. */
export const CR_MIN_VALID_MONTHS = 2;
/** Rent bookings: civil ID must remain valid at least this many days (hard block below). */
export const CIVIL_ID_MIN_REMAINING_DAYS = 30;
/** Rent bookings: soft warning when civil ID validity drops below this many days. */
export const CIVIL_ID_WARN_REMAINING_DAYS = 90;

const docAttachSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    mime: z.string().trim().min(3).max(120),
    size: z.number().int().positive().max(1_200_000),
    dataUrl: z.string().max(1_600_000).optional(),
  })
  .strict();

export type PartySignatory = {
  name: string;
  civilId: string;
  phone: string;
  nationality?: string | undefined;
  passport?: string | undefined;
  civilIdExpiresOn?: string | undefined;
  passportExpiresOn?: string | undefined;
  civilIdCopy?: PartyDocAttach | undefined;
  passportCopy?: PartyDocAttach | undefined;
};

export type ReservationPerson = {
  nameAr: string;
  nameEn: string;
  nationality: string;
  civilId: string;
  passport: string;
  phone: string;
  altPhone: string;
  email: string;
  civilIdExpiresOn?: string | undefined;
  passportExpiresOn?: string | undefined;
  civilIdCopy?: PartyDocAttach | undefined;
  passportCopy?: PartyDocAttach | undefined;
  emailVerified?: boolean | undefined;
};

export type ReservationCompany = {
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
  signatories: PartySignatory[];
  crCopy?: PartyDocAttach | undefined;
  emailVerified?: boolean | undefined;
};

export type ReservationParty = {
  /** Lease only: residential or commercial use. */
  contractType: ContractUse | null;
  /** Lease only: requested term in whole months. */
  termMonths: number | null;
  /** The booker is the tenant / buyer, or books for someone else. */
  holder: 'self' | 'other';
  entityType: 'person' | 'company';
  person: ReservationPerson | null;
  company: ReservationCompany | null;
};

export type ReservationPartyError =
  | 'tenant_details_invalid'
  | 'passport_required'
  | 'civil_id_expiring_soon'
  | 'cr_expired'
  | 'cr_expiring_soon'
  | 'term_too_short'
  | 'email_unverified'
  | 'documents_incomplete';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(2).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalIso = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  isoDate.optional(),
);
const phone = z.string().trim().refine(isInternationalPhone);
const email = z.string().trim().max(254).email();
const optionalDoc = docAttachSchema.optional();

const personSchema = z
  .object({
    nameAr: required(160),
    nameEn: required(160),
    nationality: z.string().length(2).refine(isCountryCode),
    civilId: z.string().trim().min(4).max(32),
    passport: text(32),
    phone,
    altPhone: phone,
    email,
    civilIdExpiresOn: optionalIso,
    passportExpiresOn: optionalIso,
    civilIdCopy: optionalDoc,
    passportCopy: optionalDoc,
    emailVerified: z.boolean().optional(),
  })
  .strict();

const signatorySchema = z
  .object({
    name: required(160),
    civilId: text(32),
    phone: z.string().trim().max(20),
    nationality: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().length(2).refine(isCountryCode).optional(),
    ),
    passport: text(32).optional(),
    civilIdExpiresOn: optionalIso,
    passportExpiresOn: optionalIso,
    civilIdCopy: optionalDoc,
    passportCopy: optionalDoc,
  })
  .strict();

const companySchema = z
  .object({
    nameAr: required(200),
    nameEn: required(200),
    crNumber: z.string().trim().min(3).max(32),
    crIssuedOn: isoDate,
    crExpiry: isoDate,
    email,
    phone,
    altPhone: phone,
    crAddress: required(300),
    activity: required(200),
    signingMode: z.enum(['single', 'joint']),
    signatories: z.array(signatorySchema).min(1).max(10),
    crCopy: optionalDoc,
    emailVerified: z.boolean().optional(),
  })
  .strict();

export const reservationPartySchema = z
  .object({
    contractType: z.enum(CONTRACT_USES).nullable(),
    termMonths: z.number().int().min(1).max(MAX_LEASE_MONTHS).nullable(),
    holder: z.enum(['self', 'other']),
    entityType: z.enum(['person', 'company']),
    person: personSchema.nullable(),
    company: companySchema.nullable(),
  })
  .strict();

function addMonthsIso(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Earliest civil ID expiry date allowed for a new rent booking (today + 30 days). */
export function civilIdMinExpiryOn(today: string): string {
  return addDaysIso(today, CIVIL_ID_MIN_REMAINING_DAYS);
}

/** Soft-warn threshold date for rent civil ID expiry (today + 90 days). */
export function civilIdWarnExpiryBefore(today: string): string {
  return addDaysIso(today, CIVIL_ID_WARN_REMAINING_DAYS);
}

/**
 * Hard block for rent: missing dates are handled as documents_incomplete;
 * expired or under 30 days remaining cannot start a lease.
 */
export function civilIdExpiryBlocksRent(
  expiresOn: string | null | undefined,
  today: string,
): boolean {
  if (!expiresOn) return false;
  return expiresOn < civilIdMinExpiryOn(today);
}

/** Soft warning for rent when 30–89 days of civil ID validity remain. */
export function civilIdExpiryWarnsRent(
  expiresOn: string | null | undefined,
  today: string,
): boolean {
  if (!expiresOn || civilIdExpiryBlocksRent(expiresOn, today)) return false;
  return expiresOn < civilIdWarnExpiryBefore(today);
}

export function civilIdExpiryWarningText(ar: boolean): string {
  return ar
    ? 'بطاقة المستأجر تنتهي خلال أقل من 90 يوماً — جدّدها لتأكيد استمرار الخدمات بعد التعاقد.'
    : 'The tenant ID expires in less than 90 days — renew it to keep services continuous after contracting.';
}

function rentCivilIdError(
  expiresOn: string | null | undefined,
  today: string,
): ReservationPartyError | null {
  return civilIdExpiryBlocksRent(expiresOn, today) ? 'civil_id_expiring_soon' : null;
}

/**
 * Business rules on top of the shape: passport for non-Omanis, CR validity, signatories,
 * email OTP verification, and identity document copies with expiry dates.
 */
export function reservationPartyError(
  party: ReservationParty,
  options: { mode: 'rent' | 'sale'; minMonths: number; today: string },
): ReservationPartyError | null {
  if (options.mode === 'rent') {
    if (!party.contractType || !party.termMonths) return 'tenant_details_invalid';
    if (party.termMonths < options.minMonths) return 'term_too_short';
  }
  if (party.holder === 'self' && party.entityType !== 'person') return 'tenant_details_invalid';
  if (party.entityType === 'person') {
    const person = party.person;
    if (!person) return 'tenant_details_invalid';
    if (person.nationality !== 'OM' && person.passport.trim().length < 4) {
      return 'passport_required';
    }
    if (isSamePhone(person.phone, person.altPhone)) return 'tenant_details_invalid';
    if (!person.emailVerified) return 'email_unverified';
    if (missingPersonFields(person).length) return 'documents_incomplete';
    if (options.mode === 'rent') {
      const civilError = rentCivilIdError(person.civilIdExpiresOn, options.today);
      if (civilError) return civilError;
    }
    return null;
  }
  const company = party.company;
  if (!company) return 'tenant_details_invalid';
  if (company.crExpiry <= options.today) return 'cr_expired';
  if (company.crExpiry < addMonthsIso(options.today, CR_MIN_VALID_MONTHS)) {
    return 'cr_expiring_soon';
  }
  if (company.crIssuedOn >= company.crExpiry || company.crIssuedOn > options.today) {
    return 'tenant_details_invalid';
  }
  if (isSamePhone(company.phone, company.altPhone)) return 'tenant_details_invalid';
  if (company.signingMode === 'joint' && company.signatories.length < 2) {
    return 'tenant_details_invalid';
  }
  if (!company.emailVerified) return 'email_unverified';
  if (missingCompanyFields(company).length) return 'documents_incomplete';
  if (options.mode === 'rent') {
    for (const row of company.signatories) {
      const civilError = rentCivilIdError(row.civilIdExpiresOn, options.today);
      if (civilError) return civilError;
    }
  }
  return null;
}

export function partyErrorText(code: string, ar: boolean): string {
  switch (code) {
    case 'passport_required':
      return ar
        ? 'رقم الجواز إلزامي لغير العمانيين.'
        : 'Passport number is required for non-Omani tenants.';
    case 'civil_id_expiring_soon':
      return ar
        ? 'مدة انتهاء البطاقة أقل من شهر — جدّد بطاقتك أولاً ثم واصل تسجيل عقد الإيجار.'
        : 'Your ID card expires in less than a month — renew it first, then continue with the lease.';
    case 'cr_expired':
      return ar ? 'السجل التجاري منتهٍ.' : 'The commercial registration has expired.';
    case 'cr_expiring_soon':
      return ar
        ? 'السجل التجاري ينتهي خلال أقل من شهرين.'
        : 'The commercial registration expires in less than two months.';
    case 'term_too_short':
      return ar
        ? 'مدة العقد أقصر من الحد الأدنى للعقار.'
        : 'The term is shorter than the property minimum.';
    case 'email_unverified':
      return ar
        ? 'أكّد البريد الإلكتروني برمز التحقق المرسل إلى بريدك.'
        : 'Verify the email with the OTP sent to your inbox.';
    case 'documents_incomplete':
      return ar
        ? 'أكمل الحقول والمستندات الناقصة (نسخ البطاقات/الجواز وتواريخ الانتهاء).'
        : 'Complete the missing fields and documents (ID/passport copies and expiry dates).';
    default:
      return ar ? 'تحقّق من بيانات الطرف المتعاقد.' : 'Check the contracting party details.';
  }
}

export function parseReservationParty(value: unknown): ReservationParty | null {
  const parsed = reservationPartySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function attachWithoutBytes(attach: PartyDocAttach | undefined): PartyDocAttach | undefined {
  if (!attach) return undefined;
  return { name: attach.name, mime: attach.mime, size: attach.size };
}

/**
 * Keep file metadata for UI (name / mime / size) but drop embedded `dataUrl` bytes so booking
 * pages and RSC payloads stay small — bytes are served from `/files/…` on demand.
 */
export function partyWithoutEmbeddedFiles(party: ReservationParty | null): ReservationParty | null {
  if (!party) return null;
  if (party.entityType === 'company' && party.company) {
    return {
      ...party,
      company: {
        ...party.company,
        crCopy: attachWithoutBytes(party.company.crCopy),
        signatories: party.company.signatories.map((row) => ({
          ...row,
          civilIdCopy: attachWithoutBytes(row.civilIdCopy),
          passportCopy: attachWithoutBytes(row.passportCopy),
        })),
      },
    };
  }
  if (party.entityType === 'person' && party.person) {
    return {
      ...party,
      person: {
        ...party.person,
        civilIdCopy: attachWithoutBytes(party.person.civilIdCopy),
        passportCopy: attachWithoutBytes(party.person.passportCopy),
      },
    };
  }
  return party;
}

/** Display name of the contracting party (Arabic first). */
export function partyDisplayName(party: ReservationParty, ar = true): string {
  const row = party.entityType === 'company' ? party.company : party.person;
  if (!row) return '';
  return ar ? row.nameAr : row.nameEn || row.nameAr;
}

/** ISO nationality: person, or first company signatory. */
export function partyNationalityCode(party: ReservationParty): string | null {
  if (party.entityType === 'person') {
    const code = party.person?.nationality?.trim().toUpperCase();
    return code || null;
  }
  const code = party.company?.signatories[0]?.nationality?.trim().toUpperCase();
  return code || null;
}

/** Tenant fields the lease contract form and the printed contract understand. */
export function partyToLeaseTenant(party: ReservationParty) {
  if (party.entityType === 'company' && party.company) {
    const company = party.company;
    const first = company.signatories[0];
    return {
      entityType: 'company' as const,
      nameAr: company.nameAr,
      nameEn: company.nameEn,
      civilId: '',
      passport: '',
      nationality: '',
      crNumber: company.crNumber,
      crExpiry: company.crExpiry,
      signatoryName:
        company.signingMode === 'joint'
          ? company.signatories.map((row) => row.name).join('، ')
          : (first?.name ?? ''),
      signatoryCivilId: company.signingMode === 'joint' ? '' : (first?.civilId ?? ''),
      signatoryNationality: first?.nationality ? countryName(first.nationality, 'ar') : '',
      phone: company.phone,
      email: company.email,
    };
  }
  const person = party.person;
  return {
    entityType: 'person' as const,
    nameAr: person?.nameAr ?? '',
    nameEn: person?.nameEn ?? '',
    civilId: person?.civilId ?? '',
    passport: person?.passport ?? '',
    nationality: person ? countryName(person.nationality, 'ar') : '',
    crNumber: '',
    crExpiry: '',
    signatoryName: '',
    signatoryCivilId: '',
    signatoryNationality: '',
    phone: person?.phone ?? '',
    email: person?.email ?? '',
  };
}
