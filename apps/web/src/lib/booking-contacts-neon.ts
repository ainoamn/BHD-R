import 'server-only';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { parties, partyRoles, users } from '@bhd-r/db';
import {
  applyMemberScope,
  getDatabase,
  withElevatedRead,
  type Tx,
} from '@/lib/public-booking-neon';

/** A person the user saved for future bookings — stored as a tenant contact in their own organization. */
export type BookingContact = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
};

export type BookingContactsForViewer = {
  self: { fullName: string; phone: string | null; email: string | null };
  saved: BookingContact[];
  canSave: boolean;
};

export type BookingFor = 'self' | 'other';

const MAX_SAVED = 30;

type PartyRow = typeof parties.$inferSelect;

function metadataOf(row: PartyRow): Record<string, unknown> {
  return row.metadata && typeof row.metadata === 'object'
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function canWriteContacts(scope: { roles?: readonly string[]; permissions?: readonly string[] }) {
  return (
    !(scope.roles ?? []).includes('tenant') && (scope.permissions ?? []).includes('party.write')
  );
}

async function findSelfParty(
  transaction: Tx,
  organizationId: string,
  partyId: string | null | undefined,
  email: string | null | undefined,
): Promise<PartyRow | null> {
  if (partyId) {
    const byId = await transaction.query.parties.findFirst({
      where: and(eq(parties.id, partyId), eq(parties.organizationId, organizationId)),
    });
    if (byId) return byId;
  }
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    (await transaction.query.parties.findFirst({
      where: and(eq(parties.organizationId, organizationId), eq(parties.email, normalized)),
    })) ?? null
  );
}

export async function loadBookingContacts(viewer: {
  userId: string;
  organizationId: string | null;
  partyId: string | null;
  roles: readonly string[];
  permissions: readonly string[];
  email: string | null;
  displayName: string | null;
}): Promise<BookingContactsForViewer> {
  const fallback: BookingContactsForViewer = {
    self: {
      fullName: viewer.displayName?.trim() ?? '',
      phone: null,
      email: viewer.email?.trim() || null,
    },
    saved: [],
    canSave: false,
  };
  const organizationId = viewer.organizationId;
  if (!organizationId) return fallback;

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyMemberScope(transaction, {
      organizationId,
      userId: viewer.userId,
      partyId: viewer.partyId,
      roles: viewer.roles,
    });
    const self = await findSelfParty(transaction, organizationId, viewer.partyId, viewer.email);
    const savedRows = await transaction
      .select({
        id: parties.id,
        fullName: parties.displayName,
        phone: parties.phone,
        email: parties.email,
      })
      .from(parties)
      .where(
        and(
          eq(parties.organizationId, organizationId),
          eq(parties.status, 'active'),
          sql`${parties.metadata}->>'bookingContact' = 'true'`,
          sql`${parties.metadata}->>'savedByUserId' = ${viewer.userId}`,
          ...(self ? [ne(parties.id, self.id)] : []),
        ),
      )
      .orderBy(desc(parties.updatedAt))
      .limit(MAX_SAVED);

    return {
      self: {
        fullName: viewer.displayName?.trim() || self?.displayName || '',
        phone: self?.phone ?? null,
        email: viewer.email?.trim() || self?.email || null,
      },
      saved: savedRows,
      canSave: canWriteContacts(viewer),
    };
  });
}

/**
 * Best-effort save into the booker's own organization: their own phone for `self`,
 * or a reusable tenant contact for `other`.
 */
export async function saveBookingContact(
  claims: SessionClaims,
  input: {
    bookingFor: BookingFor;
    contactId?: string | null;
    fullName: string;
    phone: string;
    email: string | null;
  },
): Promise<{ saved: boolean; contactId: string | null }> {
  const organizationId = claims.organizationId;
  if (!organizationId || !canWriteContacts(claims)) return { saved: false, contactId: null };

  const fullName = input.fullName.trim().slice(0, 200);
  const phone = input.phone.trim().slice(0, 40);
  const email = input.email?.trim().toLowerCase() || null;

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const user = await withElevatedRead(transaction, () =>
      transaction.query.users.findFirst({
        where: eq(users.id, claims.sub),
        columns: { email: true },
      }),
    );
    await applyMemberScope(transaction, {
      organizationId,
      userId: claims.sub,
      partyId: claims.partyId,
      roles: claims.roles,
    });
    const self = await findSelfParty(transaction, organizationId, claims.partyId, user?.email);

    if (input.bookingFor === 'self') {
      if (!self) return { saved: false, contactId: null };
      if (self.phone !== phone) {
        await transaction
          .update(parties)
          .set({ phone, updatedAt: new Date() })
          .where(eq(parties.id, self.id));
      }
      return { saved: true, contactId: self.id };
    }

    if (email && self?.email && email === self.email.toLowerCase()) {
      return { saved: false, contactId: null };
    }

    let target: PartyRow | null = null;
    if (input.contactId) {
      const owned = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.contactId),
          eq(parties.organizationId, organizationId),
          sql`${parties.metadata}->>'savedByUserId' = ${claims.sub}`,
        ),
      });
      target = owned ?? null;
    }
    if (!target && email) {
      target =
        (await transaction.query.parties.findFirst({
          where: and(eq(parties.organizationId, organizationId), eq(parties.email, email)),
        })) ?? null;
    }
    if (target && self && target.id === self.id) return { saved: false, contactId: null };

    const now = new Date();
    let contactId: string;
    if (target) {
      let nextEmail = target.email;
      if (email && email !== target.email) {
        const clash = await transaction.query.parties.findFirst({
          where: and(eq(parties.organizationId, organizationId), eq(parties.email, email)),
          columns: { id: true },
        });
        if (!clash) nextEmail = email;
      }
      await transaction
        .update(parties)
        .set({
          displayName: fullName,
          phone,
          email: nextEmail,
          metadata: { ...metadataOf(target), bookingContact: true, savedByUserId: claims.sub },
          updatedAt: now,
        })
        .where(eq(parties.id, target.id));
      contactId = target.id;
    } else {
      const [inserted] = await transaction
        .insert(parties)
        .values({
          organizationId,
          type: 'person',
          displayName: fullName,
          email,
          phone,
          metadata: { source: 'booking_contact', bookingContact: true, savedByUserId: claims.sub },
        })
        .returning({ id: parties.id });
      contactId = inserted!.id;
    }

    await transaction
      .insert(partyRoles)
      .values({ organizationId, partyId: contactId, roleKey: 'tenant' })
      .onConflictDoNothing();

    return { saved: true, contactId };
  });
}
