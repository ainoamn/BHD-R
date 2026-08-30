import 'server-only';
import { createHash } from 'node:crypto';
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

/** Scope writes to the listing org — never leave platform_admin=true for the whole txn (P1-04). */
async function applyOrgScope(
  transaction: Tx,
  input: { organizationId: string; userId: string },
) {
  await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
  await transaction.execute(sql`select set_config('app.public', 'true', true)`);
  await transaction.execute(
    sql`select set_config('app.organization_id', ${input.organizationId}, true)`,
  );
  await transaction.execute(sql`select set_config('app.user_id', ${input.userId}, true)`);
  await transaction.execute(sql`select set_config('app.is_tenant', 'false', true)`);
}

async function withElevatedRead<T>(transaction: Tx, work: () => Promise<T>): Promise<T> {
  await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
  await transaction.execute(sql`select set_config('app.public', 'true', true)`);
  try {
    return await work();
  } finally {
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
  }
}

async function expireTimedOutLocks(transaction: Tx, unitId?: string) {
  if (unitId) {
    await transaction.execute(sql`
      update holds
      set status = 'expired', updated_at = now()
      where status = 'active' and expires_at <= now() and unit_id = ${unitId}::uuid
    `);
    await transaction.execute(sql`
      update reservations
      set status = 'expired', updated_at = now()
      where status in ('pending', 'confirmed') and expires_at <= now() and unit_id = ${unitId}::uuid
    `);
    return;
  }
  await transaction.execute(sql`
    update holds
    set status = 'expired', updated_at = now()
    where status = 'active' and expires_at <= now()
  `);
  await transaction.execute(sql`
    update reservations
    set status = 'expired', updated_at = now()
    where status in ('pending', 'confirmed') and expires_at <= now()
  `);
}

async function assertUnitBookable(transaction: Tx, unitId: string) {
  await expireTimedOutLocks(transaction, unitId);
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
                sql`${leases.status}::text in ('draft', 'active', 'cancel_requested', 'clearance_pending')`,
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
  options: { idempotencyKey?: string | null } = {},
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const preview = await withElevatedRead(transaction, async () => {
      const rows = await transaction
        .select({ organizationId: listings.organizationId })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .where(and(eq(units.id, unitId), eq(listings.enabled, true)))
        .limit(1);
      return rows[0];
    });
    if (!preview) throw new Error('unit_unavailable');
    await applyOrgScope(transaction, {
      organizationId: preview.organizationId,
      userId: claims.sub,
    });

    const idemKey =
      typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length >= 8
        ? options.idempotencyKey.trim().slice(0, 200)
        : null;
    if (idemKey) {
      const reference = `IDEM-${idemKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
      const existing = await transaction.query.viewingRequests.findFirst({
        where: and(
          eq(viewingRequests.organizationId, preview.organizationId),
          eq(viewingRequests.reference, reference),
        ),
        columns: { reference: true, status: true },
      });
      if (existing) {
        return {
          accepted: true as const,
          reference: existing.reference,
          status: existing.status,
        };
      }
      const unit = await assertUnitBookable(transaction, unitId);
      const party = await ensureProspectParty(transaction, unit.organizationId, claims);
      const inserted = await transaction
        .insert(viewingRequests)
        .values({
          organizationId: unit.organizationId,
          reference,
          unitId,
          prospectPartyId: party.id,
          channel: 'website',
          status: 'requested',
          notes:
            locale === 'ar' ? 'طلب معاينة من مستخدم مسجّل' : 'Viewing request from signed-in user',
        })
        .returning({ reference: viewingRequests.reference, status: viewingRequests.status });
      return {
        accepted: true as const,
        reference: inserted[0]!.reference,
        status: inserted[0]!.status,
      };
    }

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

export async function createPublicBookingCheckout(
  claims: SessionClaims,
  unitId: string,
  options: { idempotencyKey?: string | null } = {},
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const preview = await withElevatedRead(transaction, async () => {
      const rows = await transaction
        .select({ organizationId: listings.organizationId })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .where(and(eq(units.id, unitId), eq(listings.enabled, true)))
        .limit(1);
      return rows[0];
    });
    if (!preview) throw new Error('unit_unavailable');
    await applyOrgScope(transaction, {
      organizationId: preview.organizationId,
      userId: claims.sub,
    });
    const unit = await assertUnitBookable(transaction, unitId);
    if (!unit.depositMinor || unit.depositMinor <= 0n) throw new Error('deposit_not_set');
    const party = await ensureProspectParty(transaction, unit.organizationId, claims);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const idemKey =
      typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length >= 8
        ? options.idempotencyKey.trim().slice(0, 200)
        : null;
    const sessionReference = idemKey
      ? `bk_${createHash('sha256').update(`${claims.sub}:${unitId}:${idemKey}`).digest('hex').slice(0, 28)}`
      : `bk_${crypto.randomUUID().replaceAll('-', '').slice(0, 28)}`;

    if (idemKey) {
      const existingRows = await transaction
        .select({
          id: reservations.id,
          termsSnapshot: reservations.termsSnapshot,
          rentMinor: reservations.rentMinor,
          currency: reservations.currency,
          expiresAt: reservations.expiresAt,
        })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, unit.organizationId),
            eq(reservations.unitId, unitId),
            eq(reservations.status, 'pending'),
          ),
        )
        .limit(40);
      const existing = existingRows.find((row) => {
        const snap = (row.termsSnapshot ?? {}) as Record<string, unknown>;
        return snap.checkoutSessionReference === sessionReference;
      });
      if (existing) {
        return {
          reservationId: existing.id,
          sessionReference,
          amountMinor: unit.depositMinor.toString(),
          currency: unit.currency,
          expiresAt: existing.expiresAt.toISOString(),
        };
      }
    }

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
          ...(idemKey ? { idempotencyKey: idemKey } : {}),
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

export async function updatePropertyDepositOnNeon(
  claims: SessionClaims,
  propertyId: string,
  body: { amountMinor: string; currency?: string },
): Promise<{ ok: true; unitCount: number }> {
  if (!claims.organizationId) throw new Error('organization_required');
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await applyOrgScope(transaction, {
      organizationId: claims.organizationId!,
      userId: claims.sub,
    });
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );

    const property = await transaction.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), eq(properties.organizationId, claims.organizationId!)),
    });
    if (!property) throw new Error('not_found');
    if (property.status === 'archived') throw new Error('property_archived');

    const unitRows = await transaction
      .select({ id: units.id })
      .from(units)
      .where(
        and(eq(units.propertyId, propertyId), eq(units.organizationId, claims.organizationId!)),
      );
    if (!unitRows.length) throw new Error('no_units');

    await transaction
      .update(units)
      .set({
        depositMinor: BigInt(body.amountMinor),
        ...(body.currency
          ? { currency: body.currency as typeof units.$inferSelect.currency }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        inArray(
          units.id,
          unitRows.map((row) => row.id),
        ),
      );

    return { ok: true as const, unitCount: unitRows.length };
  });
}

export async function completePublicBookingPayment(
  claims: SessionClaims,
  sessionReference: string,
) {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    const match = await withElevatedRead(transaction, async () => {
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

      return (
        rows.find((row) => {
          const snap = (row.termsSnapshot ?? {}) as Record<string, unknown>;
          return snap.checkoutSessionReference === sessionReference;
        }) ?? null
      );
    });
    if (!match) throw new Error('not_found');

    await applyOrgScope(transaction, {
      organizationId: match.organizationId,
      userId: claims.sub,
    });

    const party = await ensureProspectParty(transaction, match.organizationId, claims);
    if (party.id !== match.tenantPartyId) throw new Error('forbidden');

    await transaction
      .update(reservations)
      .set({
        status: 'confirmed',
        updatedAt: new Date(),
        termsSnapshot: {
          ...((match.termsSnapshot ?? {}) as Record<string, unknown>),
          publicDepositPaidAt: new Date().toISOString(),
          awaitingPublicDepositPayment: false,
        },
      })
      .where(eq(reservations.id, match.id));

    await transaction
      .update(holds)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(
        and(eq(holds.unitId, match.unitId), eq(holds.status, 'active'), eq(holds.prospectPartyId, party.id)),
      );

    return {
      reservationId: match.id,
      status: 'confirmed' as const,
      sessionReference,
      completed: true as const,
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
