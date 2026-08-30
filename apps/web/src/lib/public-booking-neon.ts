import 'server-only';
import { and, eq, gt, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  holds,
  leases,
  listings,
  parties,
  partyRoles,
  properties,
  reservations,
  units,
  users,
  viewingRequests,
  type Database,
} from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicBookingDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicBookingDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicBookingDb = { db };
  }
  return globalForDb.__bhdRPublicBookingDb;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function assertUnitBookable(transaction: Tx, unitId: string) {
  const now = new Date();
  const rows = await transaction
    .select({
      organizationId: listings.organizationId,
      unitId: units.id,
      depositMinor: units.depositMinor,
      rentMinor: units.rentMinor,
      currency: units.currency,
      listingPurpose: units.listingPurpose,
    })
    .from(listings)
    .innerJoin(units, eq(units.id, listings.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(units.id, unitId),
        eq(listings.enabled, true),
        isNotNull(listings.publishedAt),
        eq(units.publishWhenAvailable, true),
        eq(units.status, 'active'),
        eq(properties.status, 'active'),
        notExists(
          transaction
            .select({ id: holds.id })
            .from(holds)
            .where(
              and(eq(holds.unitId, units.id), eq(holds.status, 'active'), gt(holds.expiresAt, now)),
            ),
        ),
        notExists(
          transaction
            .select({ id: reservations.id })
            .from(reservations)
            .where(
              and(
                eq(reservations.unitId, units.id),
                inArray(reservations.status, ['pending', 'confirmed']),
                gt(reservations.expiresAt, now),
              ),
            ),
        ),
        notExists(
          transaction
            .select({ id: leases.id })
            .from(leases)
            .where(
              and(
                eq(leases.unitId, units.id),
                inArray(leases.status, [
                  'draft',
                  'active',
                  'cancel_requested',
                  'clearance_pending',
                ]),
              ),
            ),
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('unit_unavailable');
  return row;
}

async function ensureProspectParty(transaction: Tx, organizationId: string, claims: SessionClaims) {
  const user = await transaction.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { id: true, email: true, displayName: true },
  });
  if (!user?.email) throw new Error('unauthorized');
  const email = user.email.trim().toLowerCase();
  const existing = await transaction.query.parties.findFirst({
    where: and(eq(parties.organizationId, organizationId), eq(parties.email, email)),
  });
  if (existing) return existing;
  const inserted = await transaction
    .insert(parties)
    .values({
      organizationId,
      type: 'person',
      displayName: user.displayName || email,
      email,
      metadata: { source: 'authenticated_public', userId: user.id },
    })
    .returning();
  const party = inserted[0]!;
  await transaction.insert(partyRoles).values({
    organizationId,
    partyId: party.id,
    roleKey: 'prospect',
  });
  return party;
}

export async function createAuthenticatedViewingRequest(
  claims: SessionClaims,
  unitId: string,
  locale: 'ar' | 'en',
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    const unit = await assertUnitBookable(transaction, unitId);
    const party = await ensureProspectParty(transaction, unit.organizationId, claims);
    const reference = `AUTH-${claims.sub.slice(0, 8)}-${unitId.slice(0, 8)}-${Date.now().toString(36)}`;
    const inserted = await transaction
      .insert(viewingRequests)
      .values({
        organizationId: unit.organizationId,
        reference,
        unitId,
        prospectPartyId: party.id,
        channel: 'website',
        status: 'requested',
        notes: locale === 'ar' ? 'طلب معاينة من مستخدم مسجّل' : 'Viewing request from signed-in user',
      })
      .returning({ reference: viewingRequests.reference, status: viewingRequests.status });
    return {
      accepted: true as const,
      reference: inserted[0]!.reference,
      status: inserted[0]!.status,
    };
  });
}

export async function createPublicBookingCheckout(claims: SessionClaims, unitId: string) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    const unit = await assertUnitBookable(transaction, unitId);
    if (!unit.depositMinor || unit.depositMinor <= 0n) throw new Error('deposit_not_set');
    const party = await ensureProspectParty(transaction, unit.organizationId, claims);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const sessionReference = `bk_${crypto.randomUUID().replaceAll('-', '').slice(0, 28)}`;

    await transaction.insert(holds).values({
      organizationId: unit.organizationId,
      unitId,
      prospectPartyId: party.id,
      status: 'active',
      expiresAt,
      note: 'Public booking checkout hold',
    });

    const reservationRows = await transaction
      .insert(reservations)
      .values({
        organizationId: unit.organizationId,
        unitId,
        tenantPartyId: party.id,
        status: 'pending',
        expiresAt,
        rentMinor: unit.rentMinor,
        currency: unit.currency,
        termsSnapshot: {
          listingPurpose: unit.listingPurpose,
          depositMinor: unit.depositMinor.toString(),
          currency: unit.currency,
          checkoutSessionReference: sessionReference,
          awaitingPublicDepositPayment: true,
          capturedAt: new Date().toISOString(),
        },
      })
      .returning({ id: reservations.id });

    return {
      reservationId: reservationRows[0]!.id,
      sessionReference,
      amountMinor: unit.depositMinor.toString(),
      currency: unit.currency,
      expiresAt: expiresAt.toISOString(),
    };
  });
}

export async function completePublicBookingPayment(
  claims: SessionClaims,
  sessionReference: string,
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    const rows = await transaction
      .select({
        id: reservations.id,
        organizationId: reservations.organizationId,
        unitId: reservations.unitId,
        tenantPartyId: reservations.tenantPartyId,
        status: reservations.status,
        termsSnapshot: reservations.termsSnapshot,
      })
      .from(reservations)
      .where(eq(reservations.status, 'pending'))
      .limit(80);

    const match = rows.find((row) => {
      const snap = (row.termsSnapshot ?? {}) as Record<string, unknown>;
      return snap.checkoutSessionReference === sessionReference;
    });
    if (!match) throw new Error('not_found');

    const party = await ensureProspectParty(transaction, match.organizationId, claims);
    if (party.id !== match.tenantPartyId) throw new Error('forbidden');

    await transaction
      .update(reservations)
      .set({
        status: 'confirmed',
        termsSnapshot: {
          ...((match.termsSnapshot ?? {}) as Record<string, unknown>),
          publicDepositPaidAt: new Date().toISOString(),
          awaitingPublicDepositPayment: false,
        },
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, match.id));

    return {
      completed: true as const,
      reservationId: match.id,
      unitId: match.unitId,
    };
  });
}

export async function loadPublicUnitDeposit(unitId: string) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    const rows = await transaction
      .select({
        unitId: units.id,
        propertyId: units.propertyId,
        depositMinor: units.depositMinor,
        currency: units.currency,
        nameAr: units.nameAr,
        nameEn: units.nameEn,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
      })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .innerJoin(listings, eq(listings.unitId, units.id))
      .where(
        and(
          eq(units.id, unitId),
          eq(listings.enabled, true),
          isNotNull(listings.publishedAt),
          eq(units.status, 'active'),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
}
