import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { parties, partyRoles, users, type Database } from '@bhd-r/db';
import { partyDisplayName, type ReservationParty } from '@/lib/reservation-party';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type PersistedOwnerParty = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  type: 'person' | 'company';
};

function metaOf(row: { metadata: unknown }): Record<string, unknown> {
  return row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? { ...(row.metadata as Record<string, unknown>) }
    : {};
}

/** Flatten contract-step party into owner address-book columns + metadata. */
export function ownerPartyFieldsFromReservation(party: ReservationParty): {
  type: 'person' | 'company';
  displayName: string;
  email: string | null;
  phone: string | null;
  metadataPatch: Record<string, unknown>;
} {
  if (party.entityType === 'company' && party.company) {
    const company = party.company;
    return {
      type: 'company',
      displayName: (company.nameAr || company.nameEn).trim().slice(0, 200),
      email: company.email.trim().toLowerCase() || null,
      phone: company.phone.trim().slice(0, 40) || null,
      metadataPatch: {
        nameEn: company.nameEn.trim() || null,
        source: 'lease_booking_party',
        bookingParty: party,
        bookingPartySyncedAt: new Date().toISOString(),
        crNumber: company.crNumber,
        crExpiry: company.crExpiry,
        crAddress: company.crAddress,
        activity: company.activity,
      },
    };
  }
  const person = party.person;
  if (!person) {
    return {
      type: 'person',
      displayName: '—',
      email: null,
      phone: null,
      metadataPatch: { source: 'lease_booking_party', bookingParty: party },
    };
  }
  return {
    type: 'person',
    displayName: (person.nameAr || person.nameEn).trim().slice(0, 200),
    email: person.email.trim().toLowerCase() || null,
    phone: person.phone.trim().slice(0, 40) || null,
    metadataPatch: {
      nameEn: person.nameEn.trim() || null,
      source: 'lease_booking_party',
      bookingParty: party,
      bookingPartySyncedAt: new Date().toISOString(),
      nationality: person.nationality,
      civilId: person.civilId,
      passport: person.passport || null,
      civilIdExpiresOn: person.civilIdExpiresOn ?? null,
      passportExpiresOn: person.passportExpiresOn ?? null,
      altPhone: person.altPhone || null,
    },
  };
}

/**
 * Upsert the contracting party into the property owner's address book.
 * `self`: refresh the booker's prospect party with the form. `other`: create/update
 * a separate person/company contact and return it for `tenantPartyId`.
 */
export async function upsertOwnerPartyFromReservation(
  transaction: Tx,
  input: {
    organizationId: string;
    party: ReservationParty;
    bookingFor: 'self' | 'other';
    bookerPartyId: string;
    bookerUserId: string;
  },
): Promise<PersistedOwnerParty> {
  const fields = ownerPartyFieldsFromReservation(input.party);
  const now = new Date();
  const roleKey = input.bookingFor === 'self' ? 'prospect' : 'tenant';

  if (input.bookingFor === 'self') {
    const [existing] = await transaction
      .select()
      .from(parties)
      .where(
        and(eq(parties.id, input.bookerPartyId), eq(parties.organizationId, input.organizationId)),
      )
      .limit(1);
    if (!existing) {
      throw new Error('party_not_found');
    }
    const nextMeta = {
      ...metaOf(existing),
      ...fields.metadataPatch,
      userId: input.bookerUserId,
      holder: 'self',
    };
    const [updated] = await transaction
      .update(parties)
      .set({
        type: fields.type,
        displayName: fields.displayName || existing.displayName,
        phone: fields.phone || existing.phone,
        email: fields.email || existing.email,
        metadata: nextMeta,
        updatedAt: now,
      })
      .where(eq(parties.id, existing.id))
      .returning({
        id: parties.id,
        displayName: parties.displayName,
        email: parties.email,
        phone: parties.phone,
        type: parties.type,
      });
    await transaction
      .insert(partyRoles)
      .values({
        organizationId: input.organizationId,
        partyId: existing.id,
        roleKey: 'tenant',
      })
      .onConflictDoNothing();

    if (fields.displayName) {
      await transaction
        .update(users)
        .set({ displayName: fields.displayName.slice(0, 160), updatedAt: now })
        .where(eq(users.id, input.bookerUserId));
    }
    return {
      id: updated!.id,
      displayName: updated!.displayName,
      email: updated!.email,
      phone: updated!.phone,
      type: updated!.type === 'company' ? 'company' : 'person',
    };
  }

  let targetId: string | null = null;
  if (fields.email) {
    const [byEmail] = await transaction
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.organizationId, input.organizationId),
          sql`lower(${parties.email}) = ${fields.email}`,
        ),
      )
      .limit(1);
    targetId = byEmail?.id ?? null;
  }

  if (targetId) {
    const [existing] = await transaction
      .select()
      .from(parties)
      .where(eq(parties.id, targetId))
      .limit(1);
    const nextMeta = {
      ...metaOf(existing!),
      ...fields.metadataPatch,
      holder: 'other',
      bookedByUserId: input.bookerUserId,
    };
    const [updated] = await transaction
      .update(parties)
      .set({
        type: fields.type,
        displayName: fields.displayName || existing!.displayName,
        phone: fields.phone || existing!.phone,
        email: fields.email || existing!.email,
        metadata: nextMeta,
        updatedAt: now,
      })
      .where(eq(parties.id, targetId))
      .returning({
        id: parties.id,
        displayName: parties.displayName,
        email: parties.email,
        phone: parties.phone,
        type: parties.type,
      });
    await transaction
      .insert(partyRoles)
      .values({ organizationId: input.organizationId, partyId: targetId, roleKey })
      .onConflictDoNothing();
    return {
      id: updated!.id,
      displayName: updated!.displayName,
      email: updated!.email,
      phone: updated!.phone,
      type: updated!.type === 'company' ? 'company' : 'person',
    };
  }

  const [created] = await transaction
    .insert(parties)
    .values({
      organizationId: input.organizationId,
      type: fields.type,
      displayName: fields.displayName || partyDisplayName(input.party, true) || '—',
      email: fields.email,
      phone: fields.phone,
      metadata: {
        ...fields.metadataPatch,
        holder: 'other',
        bookedByUserId: input.bookerUserId,
      },
    })
    .returning({
      id: parties.id,
      displayName: parties.displayName,
      email: parties.email,
      phone: parties.phone,
      type: parties.type,
    });
  await transaction.insert(partyRoles).values({
    organizationId: input.organizationId,
    partyId: created!.id,
    roleKey,
  });
  return {
    id: created!.id,
    displayName: created!.displayName,
    email: created!.email,
    phone: created!.phone,
    type: created!.type === 'company' ? 'company' : 'person',
  };
}
