import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createDatabase, reviews, type Database } from '@bhd-r/db';
import type { PublicReview, ReviewSummary, ReviewTargetType } from '@/lib/reviews-types';

export type { PublicReview, ReviewSummary, ReviewTargetType } from '@/lib/reviews-types';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRReviewsDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRReviewsDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRReviewsDb = { db };
  }
  return globalForDb.__bhdRReviewsDb;
}

async function withAdmin<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await tx.execute(sql`select set_config('app.public', 'false', true)`);
    return fn(tx as unknown as Database);
  });
}

export async function getReviewSummary(
  targetType: ReviewTargetType,
  targetId: string,
): Promise<ReviewSummary> {
  return withAdmin(async (db) => {
    const rows = await db
      .select({
        avg: sql<string>`avg(${reviews.rating})`,
        count: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${reviews.verifiedStay})`,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
          eq(reviews.status, 'published'),
        ),
      );
    const row = rows[0];
    const count = Number(row?.count ?? 0);
    const avg =
      count > 0 && row?.avg !== null && row?.avg !== undefined
        ? Math.round(Number(row.avg) * 10) / 10
        : null;
    return {
      avgRating: avg,
      reviewCount: count,
      verifiedCount: Number(row?.verified ?? 0),
    };
  });
}

export async function listPublishedReviews(
  targetType: ReviewTargetType,
  targetId: string,
  limit = 40,
): Promise<PublicReview[]> {
  return withAdmin(async (db) => {
    const rows = await db
      .select({
        id: reviews.id,
        targetType: reviews.targetType,
        targetId: reviews.targetId,
        rating: reviews.rating,
        body: reviews.body,
        verifiedStay: reviews.verifiedStay,
        verifiedRole: reviews.verifiedRole,
        authorPartyId: reviews.authorPartyId,
        createdAt: reviews.createdAt,
        authorUserId: reviews.authorUserId,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.targetType, targetType),
          eq(reviews.targetId, targetId),
          eq(reviews.status, 'published'),
        ),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      rating: row.rating,
      body: row.body,
      verifiedStay: row.verifiedStay,
      verifiedRole: row.verifiedRole,
      authorPartyId: row.authorPartyId,
      authorLabel: row.authorPartyId
        ? `Party ${row.authorPartyId.slice(0, 8)}`
        : `User ${row.authorUserId.slice(0, 8)}`,
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export type VerifiedContext = {
  verifiedStay: boolean;
  verifiedRole: 'tenant' | 'buyer' | 'owner' | null;
  organizationId: string;
};

/** Resolve org + verification badge for a review target. */
export async function resolveReviewContext(input: {
  targetType: ReviewTargetType;
  targetId: string;
  authorUserId: string;
  authorPartyId?: string | null;
}): Promise<VerifiedContext> {
  return withAdmin(async (db) => {
    if (input.targetType === 'organization') {
      return {
        verifiedStay: false,
        verifiedRole: null,
        organizationId: input.targetId,
      };
    }

    if (input.targetType === 'property') {
      const prop = await db.execute(sql`
        select organization_id::text as organization_id, owner_party_id::text as owner_party_id
        from properties where id = ${input.targetId}::uuid limit 1
      `);
      const row = (Array.isArray(prop) ? prop[0] : (prop as { rows?: unknown[] }).rows?.[0]) as
        | { organization_id?: string; owner_party_id?: string }
        | undefined;
      if (!row?.organization_id) throw new Error('target_not_found');

      let verifiedRole: VerifiedContext['verifiedRole'] = null;
      if (input.authorPartyId && row.owner_party_id === input.authorPartyId) {
        verifiedRole = 'owner';
      } else if (input.authorPartyId) {
        const lease = await db.execute(sql`
          select 1 from leases le
          join units u on u.id = le.unit_id
          where u.property_id = ${input.targetId}::uuid
            and le.tenant_party_id = ${input.authorPartyId}::uuid
            and le.status::text in ('active', 'ended', 'clearance_pending', 'cancel_requested')
          limit 1
        `);
        const leaseHit = Array.isArray(lease)
          ? lease[0]
          : (lease as { rows?: unknown[] }).rows?.[0];
        if (leaseHit) verifiedRole = 'tenant';
        else {
          const sale = await db.execute(sql`
            select 1 from sales_deals sd
            join units u on u.id = sd.unit_id
            where u.property_id = ${input.targetId}::uuid
              and sd.buyer_party_id = ${input.authorPartyId}::uuid
              and sd.status::text = 'closed_won'
            limit 1
          `);
          const saleHit = Array.isArray(sale)
            ? sale[0]
            : (sale as { rows?: unknown[] }).rows?.[0];
          if (saleHit) verifiedRole = 'buyer';
        }
      }
      return {
        verifiedStay: verifiedRole === 'tenant' || verifiedRole === 'buyer' || verifiedRole === 'owner',
        verifiedRole,
        organizationId: row.organization_id,
      };
    }

    // party target — owner reviewing tenant or reverse
    const party = await db.execute(sql`
      select organization_id::text as organization_id from parties where id = ${input.targetId}::uuid limit 1
    `);
    const partyRow = (
      Array.isArray(party) ? party[0] : (party as { rows?: unknown[] }).rows?.[0]
    ) as { organization_id?: string } | undefined;
    if (!partyRow?.organization_id) throw new Error('target_not_found');

    let verifiedRole: VerifiedContext['verifiedRole'] = null;
    if (input.authorPartyId) {
      const leaseAsOwner = await db.execute(sql`
        select 1 from leases
        where owner_party_id = ${input.authorPartyId}::uuid
          and tenant_party_id = ${input.targetId}::uuid
          and status::text in ('active', 'ended', 'clearance_pending', 'cancel_requested')
        limit 1
      `);
      const ownerHit = Array.isArray(leaseAsOwner)
        ? leaseAsOwner[0]
        : (leaseAsOwner as { rows?: unknown[] }).rows?.[0];
      if (ownerHit) verifiedRole = 'owner';
      else {
        const leaseAsTenant = await db.execute(sql`
          select 1 from leases
          where tenant_party_id = ${input.authorPartyId}::uuid
            and owner_party_id = ${input.targetId}::uuid
            and status::text in ('active', 'ended', 'clearance_pending', 'cancel_requested')
          limit 1
        `);
        const tenantHit = Array.isArray(leaseAsTenant)
          ? leaseAsTenant[0]
          : (leaseAsTenant as { rows?: unknown[] }).rows?.[0];
        if (tenantHit) verifiedRole = 'tenant';
      }
    }

    return {
      verifiedStay: Boolean(verifiedRole),
      verifiedRole,
      organizationId: partyRow.organization_id,
    };
  });
}

export async function upsertReview(input: {
  targetType: ReviewTargetType;
  targetId: string;
  authorUserId: string;
  authorPartyId?: string | null;
  rating: number;
  body?: string | null;
}): Promise<PublicReview> {
  const ctx = await resolveReviewContext(input);
  return withAdmin(async (db) => {
    await db
      .insert(reviews)
      .values({
        organizationId: ctx.organizationId,
        authorUserId: input.authorUserId,
        authorPartyId: input.authorPartyId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        rating: input.rating,
        body: input.body?.trim() || null,
        verifiedStay: ctx.verifiedStay,
        verifiedRole: ctx.verifiedRole,
        status: 'published',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [reviews.authorUserId, reviews.targetType, reviews.targetId],
        set: {
          rating: input.rating,
          body: input.body?.trim() || null,
          verifiedStay: ctx.verifiedStay,
          verifiedRole: ctx.verifiedRole,
          status: 'published',
          updatedAt: new Date(),
        },
      });

    const [row] = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.authorUserId, input.authorUserId),
          eq(reviews.targetType, input.targetType),
          eq(reviews.targetId, input.targetId),
        ),
      )
      .limit(1);
    if (!row) throw new Error('review_failed');
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      rating: row.rating,
      body: row.body,
      verifiedStay: row.verifiedStay,
      verifiedRole: row.verifiedRole,
      authorPartyId: row.authorPartyId,
      authorLabel: 'You',
      createdAt: row.createdAt.toISOString(),
    };
  });
}
