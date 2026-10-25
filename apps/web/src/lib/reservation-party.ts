import { z } from 'zod';
import { CONTRACT_USES, type ContractUse } from '@/lib/lease-terms';
import { countryName, isCountryCode, isInternationalPhone } from '@/lib/world-countries';

/**
 * The tenant or buyer the customer fills in while booking. It is stored on the reservation
 * and carried into the lease or sale contract so the owner never re-types it.
 */
export const DEFAULT_MIN_LEASE_MONTHS = 12;
export const MAX_LEASE_MONTHS = 120;
/** A commercial registration must stay valid at least this long after booking. */
export const CR_MIN_VALID_MONTHS = 2;

export type PartySignatory = {
  name: string;
  civilId: string;
  phone: string;
  nationality?: string | undefined;
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
  | 'cr_expired'
  | 'cr_expiring_soon'
  | 'term_too_short';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(2).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const phone = z.string().trim().refine(isInternationalPhone);
const email = z.string().trim().max(254).email();

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
  })
  .strict();

const signatorySchema = z
  .object({
    name: required(160),
    civilId: text(32),
    phone: z.string().trim().max(20),
    /** ISO country code; older bookings may omit it. */
    nationality: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().length(2).refine(isCountryCode).optional(),
    ),
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

/**
 * Business rules on top of the shape: passport for non-Omanis, a commercial registration that
 * is valid for at least two more months, signatories that match the signing mode, and a lease
 * term no shorter than the owner's minimum (one year by default).
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
    if (person.phone === person.altPhone) return 'tenant_details_invalid';
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
  if (company.phone === company.altPhone) return 'tenant_details_invalid';
  if (company.signingMode === 'joint' && company.signatories.length < 2) {
    return 'tenant_details_invalid';
  }
  if (
    company.signingMode === 'single' &&
    company.signatories.some(
      (row) => row.civilId.trim().length < 4 || !isInternationalPhone(row.phone),
    )
  ) {
    return 'tenant_details_invalid';
  }
  return null;
}

export function partyErrorText(code: string, ar: boolean): string {
  switch (code) {
    case 'passport_required':
      return ar
        ? 'رقم الجواز إلزامي لغير العمانيين.'
        : 'A passport number is required for non-Omanis.';
    case 'cr_expired':
      return ar
        ? 'السجل التجاري منتهٍ — يجب تجديده أولاً.'
        : 'The commercial registration has expired — renew it first.';
    case 'cr_expiring_soon':
      return ar
        ? 'السجل التجاري ينتهي خلال أقل من شهرين — يجب تجديده أولاً.'
        : 'The commercial registration expires in under two months — renew it first.';
    case 'term_too_short':
      return ar
        ? 'مدة العقد أقل من الحد الأدنى الذي حدده المالك.'
        : 'The contract term is shorter than the owner’s minimum.';
    default:
      return ar
        ? 'أكمل بيانات المستأجر أو المشتري بشكل صحيح.'
        : 'Complete the tenant or buyer details correctly.';
  }
}

export function parseReservationParty(value: unknown): ReservationParty | null {
  const parsed = reservationPartySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Display name of the contracting party (Arabic first). */
export function partyDisplayName(party: ReservationParty, ar = true): string {
  const row = party.entityType === 'company' ? party.company : party.person;
  if (!row) return '';
  return ar ? row.nameAr : row.nameEn || row.nameAr;
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
      signatoryNationality: first?.nationality
        ? countryName(first.nationality, 'ar')
        : '',
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
