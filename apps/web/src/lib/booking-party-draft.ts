import type { ContractUse } from '@/lib/lease-terms';
import type { ReservationParty } from '@/lib/reservation-party';
import { emptyPartyForm, type PartyForm } from '@/lib/reservation-party-form-state';

const STORAGE_PREFIX = 'bhd-r.booking-party-draft.v1:';

export type BookingPartyDraftPayload = {
  version: 1;
  updatedAt: string;
  bookingFor: 'self' | 'other';
  form: PartyForm;
};

export type BookingPartyIdentitySeed = {
  nameAr?: string | null;
  nameEn?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  nationality?: string | null;
  civilId?: string | null;
  civilIdExpires?: string | null;
  passport?: string | null;
  passportExpires?: string | null;
  accountKind?: 'person' | 'company' | null;
  companyNameAr?: string | null;
  companyNameEn?: string | null;
  crNumber?: string | null;
  crExpiry?: string | null;
  crAddress?: string | null;
};

/** Prefill payload for the contract-party step (safe for client props). */
export type BookingPartySeed = {
  identity: BookingPartyIdentitySeed | null;
  bookingParty: ReservationParty | null;
  serverDraft: PartyForm | null;
  bookingFor: 'self' | 'other' | null;
};

function filled(value: string | null | undefined): boolean {
  return Boolean(value && String(value).trim());
}

function pickText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (filled(value)) return String(value).trim();
  }
  return '';
}

/** Prefer non-empty fields from `next` over `base`. */
export function mergePartyForm(base: PartyForm, next: Partial<PartyForm> | null | undefined): PartyForm {
  if (!next) return base;
  const person = next.person
    ? {
        ...base.person,
        nameAr: pickText(next.person.nameAr, base.person.nameAr),
        nameEn: pickText(next.person.nameEn, base.person.nameEn),
        nationality: pickText(next.person.nationality, base.person.nationality) || 'OM',
        civilId: pickText(next.person.civilId, base.person.civilId),
        passport: pickText(next.person.passport, base.person.passport),
        phone: pickText(next.person.phone, base.person.phone),
        altPhone: pickText(next.person.altPhone, base.person.altPhone),
        email: pickText(next.person.email, base.person.email),
        civilIdExpiresOn: pickText(next.person.civilIdExpiresOn, base.person.civilIdExpiresOn),
        passportExpiresOn: pickText(next.person.passportExpiresOn, base.person.passportExpiresOn),
        civilIdCopy: next.person.civilIdCopy ?? base.person.civilIdCopy,
        passportCopy: next.person.passportCopy ?? base.person.passportCopy,
        emailVerified: Boolean(next.person.emailVerified || base.person.emailVerified),
      }
    : base.person;
  const company = next.company
    ? {
        ...base.company,
        nameAr: pickText(next.company.nameAr, base.company.nameAr),
        nameEn: pickText(next.company.nameEn, base.company.nameEn),
        crNumber: pickText(next.company.crNumber, base.company.crNumber),
        crIssuedOn: pickText(next.company.crIssuedOn, base.company.crIssuedOn),
        crExpiry: pickText(next.company.crExpiry, base.company.crExpiry),
        email: pickText(next.company.email, base.company.email),
        phone: pickText(next.company.phone, base.company.phone),
        altPhone: pickText(next.company.altPhone, base.company.altPhone),
        crAddress: pickText(next.company.crAddress, base.company.crAddress),
        activity: pickText(next.company.activity, base.company.activity),
        signingMode: next.company.signingMode || base.company.signingMode,
        signatories:
          next.company.signatories?.length ? next.company.signatories : base.company.signatories,
        crCopy: next.company.crCopy ?? base.company.crCopy,
        emailVerified: Boolean(next.company.emailVerified || base.company.emailVerified),
      }
    : base.company;
  return {
    contractType: next.contractType || base.contractType,
    termMonths: pickText(next.termMonths, base.termMonths) || base.termMonths,
    entityType: next.entityType || base.entityType,
    person,
    company,
  };
}

export function partyFormFromReservationParty(
  party: ReservationParty | null | undefined,
  base: PartyForm,
): PartyForm {
  if (!party) return base;
  const next: Partial<PartyForm> = {
    contractType: (party.contractType as ContractUse | null) || base.contractType,
    termMonths: party.termMonths ? String(party.termMonths) : base.termMonths,
    entityType: party.entityType,
  };
  if (party.person) {
    next.person = {
      ...base.person,
      nameAr: party.person.nameAr,
      nameEn: party.person.nameEn,
      nationality: party.person.nationality || 'OM',
      civilId: party.person.civilId,
      passport: party.person.passport || '',
      phone: party.person.phone,
      altPhone: party.person.altPhone || '',
      email: party.person.email,
      civilIdExpiresOn: party.person.civilIdExpiresOn || '',
      passportExpiresOn: party.person.passportExpiresOn || '',
      civilIdCopy: party.person.civilIdCopy,
      passportCopy: party.person.passportCopy,
      emailVerified: Boolean(party.person.emailVerified),
    };
  }
  if (party.company) {
    next.company = {
      ...base.company,
      nameAr: party.company.nameAr,
      nameEn: party.company.nameEn,
      crNumber: party.company.crNumber,
      crIssuedOn: party.company.crIssuedOn,
      crExpiry: party.company.crExpiry,
      email: party.company.email,
      phone: party.company.phone,
      altPhone: party.company.altPhone || '',
      crAddress: party.company.crAddress,
      activity: party.company.activity,
      signingMode: party.company.signingMode,
      signatories: party.company.signatories.map((row) => ({
        name: row.name,
        civilId: row.civilId,
        phone: row.phone,
        nationality: row.nationality || 'OM',
        passport: row.passport || '',
        civilIdExpiresOn: row.civilIdExpiresOn || '',
        passportExpiresOn: row.passportExpiresOn || '',
        civilIdCopy: row.civilIdCopy,
        passportCopy: row.passportCopy,
      })),
      crCopy: party.company.crCopy,
      emailVerified: Boolean(party.company.emailVerified),
    };
  }
  return mergePartyForm(base, next);
}

export function partyFormFromIdentitySeed(
  identity: BookingPartyIdentitySeed | null | undefined,
  base: PartyForm,
): PartyForm {
  if (!identity) return base;
  if (identity.accountKind === 'company') {
    return mergePartyForm(base, {
      entityType: 'company',
      company: {
        ...base.company,
        nameAr: pickText(identity.companyNameAr, identity.nameAr),
        nameEn: pickText(identity.companyNameEn, identity.nameEn),
        crNumber: pickText(identity.crNumber),
        crExpiry: pickText(identity.crExpiry),
        crAddress: pickText(identity.crAddress),
        email: pickText(identity.email),
        phone: pickText(identity.phone),
        altPhone: pickText(identity.altPhone),
      },
    });
  }
  return mergePartyForm(base, {
    entityType: 'person',
    person: {
      ...base.person,
      nameAr: pickText(identity.nameAr),
      nameEn: pickText(identity.nameEn),
      nationality: pickText(identity.nationality) || 'OM',
      civilId: pickText(identity.civilId),
      civilIdExpiresOn: pickText(identity.civilIdExpires),
      passport: pickText(identity.passport),
      passportExpiresOn: pickText(identity.passportExpires),
      phone: pickText(identity.phone),
      altPhone: pickText(identity.altPhone),
      email: pickText(identity.email),
    },
  });
}

export function buildInitialPartyForm(input: {
  minMonths: number;
  contractType: ContractUse;
  identity?: BookingPartyIdentitySeed | null;
  bookingParty?: ReservationParty | null;
  serverDraft?: PartyForm | null;
  localDraft?: PartyForm | null;
}): PartyForm {
  let form = emptyPartyForm(input.minMonths, input.contractType);
  form = partyFormFromIdentitySeed(input.identity, form);
  form = partyFormFromReservationParty(input.bookingParty, form);
  form = mergePartyForm(form, input.serverDraft);
  form = mergePartyForm(form, input.localDraft);
  return form;
}

export function bookingPartyDraftKey(ownerId: string): string {
  return `${STORAGE_PREFIX}${ownerId}`;
}

export function readBookingPartyDraft(ownerId: string): BookingPartyDraftPayload | null {
  if (typeof window === 'undefined' || !ownerId) return null;
  try {
    const raw = window.localStorage.getItem(bookingPartyDraftKey(ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingPartyDraftPayload;
    if (!parsed || parsed.version !== 1 || !parsed.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBookingPartyDraft(
  ownerId: string,
  payload: Omit<BookingPartyDraftPayload, 'version' | 'updatedAt'> & { updatedAt?: string },
): void {
  if (typeof window === 'undefined' || !ownerId) return;
  try {
    const body: BookingPartyDraftPayload = {
      version: 1,
      updatedAt: payload.updatedAt ?? new Date().toISOString(),
      bookingFor: payload.bookingFor,
      form: payload.form,
    };
    window.localStorage.setItem(bookingPartyDraftKey(ownerId), JSON.stringify(body));
  } catch {
    /* quota / private mode */
  }
}
