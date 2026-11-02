import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { parties, users } from '@bhd-r/db';
import type {
  BookingPartyIdentitySeed,
  BookingPartySeed,
} from '@/lib/booking-party-draft';
import {
  ensureProspectParty,
  getDatabase,
  withElevatedRead,
  type Tx,
} from '@/lib/public-booking-neon';
import type { ReservationParty } from '@/lib/reservation-party';
import type { PartyForm } from '@/lib/reservation-party-form-state';

export type { BookingPartySeed };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function identityFromMeta(meta: Record<string, unknown>): BookingPartyIdentitySeed | null {
  const identity = asObject(meta.identityAccount);
  if (!identity) return null;
  return {
    nameAr: typeof identity.nameAr === 'string' ? identity.nameAr : null,
    nameEn: typeof identity.nameEn === 'string' ? identity.nameEn : null,
    phone: typeof identity.phone === 'string' ? identity.phone : null,
    altPhone: typeof identity.phone2 === 'string' ? identity.phone2 : null,
    email: typeof identity.email === 'string' ? identity.email : null,
    nationality: typeof identity.nationality === 'string' ? identity.nationality : null,
    civilId: typeof identity.civilId === 'string' ? identity.civilId : null,
    civilIdExpires: typeof identity.civilIdExpires === 'string' ? identity.civilIdExpires : null,
    passport: typeof identity.passportNumber === 'string' ? identity.passportNumber : null,
    passportExpires:
      typeof identity.passportExpires === 'string' ? identity.passportExpires : null,
    accountKind: identity.accountKind === 'company' ? 'company' : 'person',
    companyNameAr: typeof identity.companyNameAr === 'string' ? identity.companyNameAr : null,
    companyNameEn: typeof identity.companyNameEn === 'string' ? identity.companyNameEn : null,
    crNumber: typeof identity.crNumber === 'string' ? identity.crNumber : null,
    crExpiry: typeof identity.crExpires === 'string' ? identity.crExpires : null,
    crAddress: typeof identity.address === 'string' ? identity.address : null,
  };
}

function bookingPartyFromMeta(meta: Record<string, unknown>): ReservationParty | null {
  const raw = asObject(meta.bookingParty);
  if (!raw) return null;
  if (raw.entityType !== 'person' && raw.entityType !== 'company') return null;
  return raw as unknown as ReservationParty;
}

function draftFromMeta(meta: Record<string, unknown>): PartyForm | null {
  const raw = asObject(meta.bookingPartyDraft);
  if (!raw || !asObject(raw.person) || !asObject(raw.company)) return null;
  return raw as unknown as PartyForm;
}

/**
 * Prefill seed for the contract-party step: Identity snapshot, last completed
 * bookingParty, and any in-progress draft on the booker's prospect card in the
 * property organization.
 */
export async function loadBookingPartySeed(input: {
  claims: SessionClaims;
  organizationId: string;
}): Promise<BookingPartySeed> {
  const empty: BookingPartySeed = {
    identity: null,
    bookingParty: null,
    serverDraft: null,
    bookingFor: null,
  };
  const { db } = getDatabase();
  try {
    return await db.transaction(async (transaction) => {
      const party = await ensureProspectParty(transaction, input.organizationId, input.claims);
      const meta =
        party.metadata && typeof party.metadata === 'object' && !Array.isArray(party.metadata)
          ? { ...(party.metadata as Record<string, unknown>) }
          : {};
      const draftWrapper = asObject(meta.bookingPartyDraftEnvelope);
      return {
        identity: identityFromMeta(meta),
        bookingParty: bookingPartyFromMeta(meta),
        serverDraft: draftFromMeta(meta),
        bookingFor:
          draftWrapper?.bookingFor === 'other'
            ? 'other'
            : draftWrapper?.bookingFor === 'self'
              ? 'self'
              : meta.holder === 'other'
                ? 'other'
                : 'self',
      };
    });
  } catch (error) {
    console.error('booking party seed load failed', error);
    return empty;
  }
}

/** Persist an incomplete contract-party form onto the booker's prospect party. */
export async function saveBookingPartyDraft(
  claims: SessionClaims,
  input: {
    organizationId: string;
    bookingFor: 'self' | 'other';
    form: PartyForm;
  },
): Promise<{ saved: true }> {
  const { db } = getDatabase();
  await db.transaction(async (transaction: Tx) => {
    const user = await withElevatedRead(transaction, () =>
      transaction.query.users.findFirst({
        where: eq(users.id, claims.sub),
        columns: { id: true, email: true },
      }),
    );
    if (!user?.email) throw new Error('unauthorized');

    const party = await ensureProspectParty(transaction, input.organizationId, claims);
    const meta =
      party.metadata && typeof party.metadata === 'object' && !Array.isArray(party.metadata)
        ? { ...(party.metadata as Record<string, unknown>) }
        : {};

    const person = input.form.person;
    const company = input.form.company;
    const displayName =
      input.form.entityType === 'company'
        ? (company.nameAr || company.nameEn || party.displayName).trim()
        : (person.nameAr || person.nameEn || party.displayName).trim();
    const phone =
      input.form.entityType === 'company'
        ? company.phone.trim() || party.phone
        : person.phone.trim() || party.phone;
    const email =
      input.form.entityType === 'company'
        ? company.email.trim().toLowerCase() || party.email
        : person.email.trim().toLowerCase() || party.email;

    await transaction
      .update(parties)
      .set({
        type: input.form.entityType,
        displayName: displayName.slice(0, 200) || party.displayName,
        phone: phone?.slice(0, 40) || party.phone,
        email: email || party.email,
        metadata: {
          ...meta,
          userId: claims.sub,
          holder: input.bookingFor,
          bookingPartyDraft: input.form,
          bookingPartyDraftEnvelope: {
            bookingFor: input.bookingFor,
            updatedAt: new Date().toISOString(),
          },
          // Keep flat identity-ish fields filled for the address book even mid-form.
          ...(input.form.entityType === 'person'
            ? {
                nameEn: person.nameEn.trim() || meta.nameEn || null,
                nationality: person.nationality || meta.nationality || null,
                civilId: person.civilId.trim() || meta.civilId || null,
                passport: person.passport.trim() || meta.passport || null,
                civilIdExpiresOn: person.civilIdExpiresOn || meta.civilIdExpiresOn || null,
                passportExpiresOn: person.passportExpiresOn || meta.passportExpiresOn || null,
                altPhone: person.altPhone.trim() || meta.altPhone || null,
              }
            : {
                nameEn: company.nameEn.trim() || meta.nameEn || null,
                crNumber: company.crNumber.trim() || meta.crNumber || null,
                crExpiry: company.crExpiry || meta.crExpiry || null,
                crAddress: company.crAddress.trim() || meta.crAddress || null,
                activity: company.activity.trim() || meta.activity || null,
              }),
        },
        updatedAt: new Date(),
      })
      .where(and(eq(parties.id, party.id), eq(parties.organizationId, input.organizationId)));
  });
  return { saved: true };
}
