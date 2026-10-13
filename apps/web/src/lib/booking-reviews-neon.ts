import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  bookingReviewPhotos,
  bookingReviews,
  createDatabase,
  organizations,
  properties,
  units,
  reviewProfiles,
  stayBookingGuests,
  stayBookings,
  users,
  type Database,
} from '@bhd-r/db';
import { applySessionSettings } from '@/lib/db-session-settings';
import { withTimeoutFallback } from '@/lib/with-timeout';
import { ownerPartyScope } from '@/lib/portal-ops-data';
import { analyzeProfile, analyzeReview } from '@/lib/review-ai';
import { RECEIPT_CONFIRM_HOURS } from '@/lib/stay-deposit-claims';
import {
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN_WHEN_LOW,
  REVIEW_PHOTO_DATA_URL,
  REVIEW_PHOTO_MAX,
  REVIEW_PHOTOS_MAX,
  blendScore,
  groupLabel,
  needsComment,
  publicPersonName,
  reviewTags,
  rubricFor,
  scoreAnswers,
  TRAVELLER_TYPES,
  travellerTypeOf,
  validAnswers,
  type GuestStanding,
  type PublicReview,
  type Reputation,
  type ReputationSubject,
  type ReviewAnswers,
  type ReviewDirection,
  type ReviewText,
} from '@/lib/review-rubric';
import type { StayReviewPending } from '@/lib/stay-reviews-types';

type DbHandle = { db: Database };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type AiContext = { oidcToken: string | null };

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

const DEPARTED = new Set(['checked_out', 'closed']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_KEY = /^e[0-9a-f]{32}$/;
const HIDDEN_COMMENT_FLAGS = new Set(['abusive', 'personal_data']);

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 3 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb.db;
}

/** Every query filters explicitly: the app's database role bypasses RLS. */
async function elevated<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '8000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

function fail(code: string): never {
  throw new Error(code);
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emailHash(email: string): string {
  return createHash('sha256')
    .update(`bhd-r:guest:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

/** Public profile key of a guest: their account when the booking is linked, else their email. */
export function guestKeyOf(userId: string | null, email: string | null): string | null {
  if (userId) return userId;
  return email?.includes('@') ? `e${emailHash(email)}` : null;
}

export function validGuestKey(key: string): boolean {
  return UUID.test(key) || EMAIL_KEY.test(key);
}

/**
 * The guest's deposit is settled: no deposit, the refund was declined, or the transfer arrived
 * (confirmed, or 24 hours without an answer); and no request or complaint is still open.
 */
function depositSettled(bookingId: SQLWrapper): SQL {
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM stay_deposit_claims dc
      WHERE dc.booking_id = ${bookingId} AND dc.status IN ('open', 'escalated')
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM stay_bookings db
        JOIN stay_profiles dp ON dp.id = db.stay_profile_id
        WHERE db.id = ${bookingId} AND dp.deposit_minor > 0
      )
      OR EXISTS (
        SELECT 1 FROM stay_refunds dr
        WHERE dr.booking_id = ${bookingId}
          AND dr.idempotency_key = 'deposit:' || ${bookingId}::text
          AND (
            dr.status = 'rejected'
            OR (
              dr.status = 'executed'
              AND (
                dr.guest_receipt IS NOT NULL
                OR dr.transfer_recorded_at IS NULL
                OR dr.transfer_recorded_at < now() - make_interval(hours => ${RECEIPT_CONFIRM_HOURS})
              )
            )
          )
      )
    )
  )`;
}

/**
 * Review released to everyone: the host's review of a guest at once; the guest's review of the
 * stay only once their deposit is settled, so the host cannot hold the deposit against it.
 */
const released: SQL = sql`(
  ${bookingReviews.direction} = 'host_to_guest' OR ${depositSettled(bookingReviews.bookingId)}
)`;

const contactEmail = sql<
  string | null
>`${stayBookings.pricingSnapshotJson}->'guestContact'->>'email'`;
const contactName = sql<
  string | null
>`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`;

/** Party size as booked; null when the snapshot has no clean whole number. */
function snapshotCount(field: 'adults' | 'children') {
  const value = sql`${stayBookings.pricingSnapshotJson}->>${field}`;
  return sql<number | null>`case when ${value} ~ '^[0-9]{1,3}$' then (${value})::int end`;
}

export type ReviewSubmission = {
  answers: ReviewAnswers;
  comment?: string | undefined;
  recommend?: boolean | null | undefined;
  tags?: string[] | undefined;
  photos?: string[] | undefined;
};

export type SubmittedReview = {
  id: string;
  bookingId: string;
  score: number;
  criteriaScore: number;
  engine: string;
  summaryAr: string | null;
};

type Prepared = Awaited<ReturnType<typeof prepareReview>>;

async function prepareReview(
  direction: ReviewDirection,
  input: ReviewSubmission,
  context: AiContext,
) {
  if (!validAnswers(direction, input.answers)) fail('review_invalid');
  const comment = input.comment?.trim().slice(0, REVIEW_COMMENT_MAX) || null;
  if (
    needsComment(direction, input.answers) &&
    (comment?.length ?? 0) < REVIEW_COMMENT_MIN_WHEN_LOW
  ) {
    fail('review_comment_required');
  }
  const photos = input.photos ?? [];
  if (photos.length > REVIEW_PHOTOS_MAX) fail('review_photo_invalid');
  for (const photo of photos) {
    if (photo.length > REVIEW_PHOTO_MAX || !REVIEW_PHOTO_DATA_URL.test(photo)) {
      fail('review_photo_invalid');
    }
  }
  const scores = scoreAnswers(direction, input.answers);
  const recommend = typeof input.recommend === 'boolean' ? input.recommend : null;
  const analysis = await analyzeReview(context, {
    direction,
    answers: input.answers,
    scores,
    comment,
    recommend,
    tags: reviewTags(direction, input.tags),
  });
  return {
    direction,
    answers: input.answers,
    comment,
    recommend,
    photos,
    scores,
    analysis,
    score: blendScore(scores.criteria, analysis.textScore),
  };
}

type ReviewBooking = {
  id: string;
  organizationId: string;
  propertyId: string;
  unitId: string;
  status: string;
  userId: string | null;
  email: string | null;
  contactName: string | null;
};

const bookingColumns = {
  id: stayBookings.id,
  organizationId: stayBookings.organizationId,
  propertyId: stayBookings.propertyId,
  unitId: stayBookings.unitId,
  status: stayBookings.status,
  userId: stayBookings.userId,
  email: contactEmail,
  contactName,
};

async function guestName(tx: Tx, booking: ReviewBooking): Promise<string | null> {
  const [primary] = await tx
    .select({ name: stayBookingGuests.displayName })
    .from(stayBookingGuests)
    .where(and(eq(stayBookingGuests.bookingId, booking.id), eq(stayBookingGuests.isPrimary, true)))
    .limit(1);
  if (primary?.name?.trim()) return primary.name.trim();
  if (booking.contactName?.trim()) return booking.contactName.trim();
  if (!booking.userId) return null;
  const [user] = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, booking.userId))
    .limit(1);
  return user?.name ?? null;
}

async function reviewExists(tx: Tx, bookingId: string, direction: ReviewDirection) {
  const [row] = await tx
    .select({ id: bookingReviews.id })
    .from(bookingReviews)
    .where(and(eq(bookingReviews.bookingId, bookingId), eq(bookingReviews.direction, direction)))
    .limit(1);
  return Boolean(row);
}

/** Gate for the deposit refund: has this side reviewed the stay? Runs in the caller's transaction. */
export async function hasBookingReview(
  tx: Tx,
  bookingId: string,
  direction: ReviewDirection,
): Promise<boolean> {
  return reviewExists(tx, bookingId, direction);
}

async function insertReview(
  booking: ReviewBooking,
  prepared: Prepared,
  people: {
    authorUserId: string | null;
    authorName: string | null;
    subjectUserId: string | null;
    subjectEmailHash: string | null;
    subjectName: string | null;
  },
): Promise<SubmittedReview> {
  return elevated(async (tx) => {
    const { analysis, scores } = prepared;
    const [row] = await tx
      .insert(bookingReviews)
      .values({
        organizationId: booking.organizationId,
        bookingId: booking.id,
        propertyId: booking.propertyId,
        unitId: booking.unitId,
        direction: prepared.direction,
        ...people,
        criteria: prepared.answers,
        criteriaScore: scores.criteria.toFixed(2),
        aiTextScore: analysis.textScore === null ? null : analysis.textScore.toFixed(2),
        score: prepared.score.toFixed(2),
        propertyScore: scores.property === null ? null : scores.property.toFixed(2),
        hostScore: scores.host === null ? null : scores.host.toFixed(2),
        recommend: prepared.recommend,
        comment: prepared.comment,
        aiSummaryAr: analysis.summary?.ar ?? null,
        aiSummaryEn: analysis.summary?.en ?? null,
        aiHighlights: analysis.highlights,
        aiConcerns: analysis.concerns,
        aiFlags: analysis.flags,
        aiEngine: analysis.engine,
        photoCount: prepared.photos.length,
      })
      .onConflictDoNothing({ target: [bookingReviews.bookingId, bookingReviews.direction] })
      .returning({ id: bookingReviews.id });
    if (!row) fail('review_exists');
    if (prepared.photos.length) {
      await tx.insert(bookingReviewPhotos).values(
        prepared.photos.map((dataUrl, position) => ({
          organizationId: booking.organizationId,
          reviewId: row.id,
          position,
          dataUrl,
        })),
      );
    }
    return {
      id: row.id,
      bookingId: booking.id,
      score: prepared.score,
      criteriaScore: scores.criteria,
      engine: analysis.engine,
      summaryAr: analysis.summary?.ar ?? null,
    };
  });
}

export type HostSummary = {
  id: string;
  name: ReviewText;
  /** individual = the owner himself; company = a management company; developer = a developer. */
  type: 'individual' | 'company' | 'developer';
  memberSince: string;
  properties: number;
  units: number;
  /** Guests' average rating of the host's management, on 10. */
  score: number | null;
  reviews: number;
};

/** Public card of the account that owns or manages a property: who it is and how guests rate it. */
export async function loadHostSummary(organizationId: string): Promise<HostSummary | null> {
  if (!UUID.test(organizationId)) return null;
  return elevated(async (tx) => {
    const [org] = await tx
      .select({
        ar: organizations.displayNameAr,
        en: organizations.displayNameEn,
        type: organizations.type,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.status, 'active')))
      .limit(1);
    if (!org) return null;
    const [stock] = await tx
      .select({
        properties: sql<number>`count(distinct ${properties.id})::int`,
        units: sql<number>`count(${units.id})::int`,
      })
      .from(properties)
      .leftJoin(units, eq(units.propertyId, properties.id))
      .where(and(eq(properties.organizationId, organizationId), eq(properties.status, 'active')));
    const [rating] = await tx
      .select({
        score: sql<string | null>`avg(${bookingReviews.hostScore})`,
        count: sql<number>`count(*)::int`,
      })
      .from(bookingReviews)
      .where(
        and(
          eq(bookingReviews.organizationId, organizationId),
          eq(bookingReviews.direction, 'guest_to_host'),
          eq(bookingReviews.status, 'published'),
          released,
        ),
      );
    const score = num(rating?.score);
    return {
      id: organizationId,
      name: { ar: org.ar, en: org.en },
      type: org.type,
      memberSince: org.createdAt.toISOString(),
      properties: Number(stock?.properties ?? 0),
      units: Number(stock?.units ?? 0),
      score: score === null ? null : round1(score),
      reviews: Number(rating?.count ?? 0),
    };
  });
}

/** For public pages: never blocks the page longer than 2.5 seconds, and never throws. */
export function loadHostSummarySafe(organizationId?: string | null): Promise<HostSummary | null> {
  if (!organizationId) return Promise.resolve(null);
  return withTimeoutFallback(loadHostSummary(organizationId), 2_500, null, 'host-summary');
}

export type UnitRating = { score: number; count: number };

/**
 * Average guest score on 10 and review count per unit, from released published guest reviews
 * (the same rule as the property page), for the stay cards in search.
 */
export async function loadUnitRatings(unitIds: string[]): Promise<Map<string, UnitRating>> {
  const ids = [...new Set(unitIds.filter((id) => UUID.test(id)))];
  if (!ids.length) return new Map();
  return elevated(async (tx) => {
    const rows = await tx
      .select({
        unitId: bookingReviews.unitId,
        score: sql<string>`avg(${bookingReviews.score})`,
        count: sql<number>`count(*)::int`,
      })
      .from(bookingReviews)
      .where(
        and(
          inArray(bookingReviews.unitId, ids),
          eq(bookingReviews.direction, 'guest_to_host'),
          eq(bookingReviews.status, 'published'),
          released,
        ),
      )
      .groupBy(bookingReviews.unitId);
    const ratings = new Map<string, UnitRating>();
    for (const row of rows) {
      const score = num(row.score);
      if (row.unitId && score !== null && row.count > 0) {
        ratings.set(row.unitId, { score: round1(score), count: Number(row.count) });
      }
    }
    return ratings;
  });
}

/** The guest may still review this stay: it exists, has checked out, and has no guest review. */
export async function assertGuestReviewOpen(referenceCode: string): Promise<void> {
  const reference = referenceCode.trim().toUpperCase();
  await elevated(async (tx) => {
    const [found] = await tx
      .select({ id: stayBookings.id, status: stayBookings.status })
      .from(stayBookings)
      .where(eq(stayBookings.referenceCode, reference))
      .limit(1);
    if (!found) fail('booking_not_found');
    if (!DEPARTED.has(found.status)) fail('review_not_open');
    if (await reviewExists(tx, found.id, 'guest_to_host')) fail('review_exists');
  });
}

const GUEST_REVIEW_REMINDER_DAYS = 90;

/** The account's departed stays it has not reviewed yet, newest check-out first (My trips). */
export async function listPendingGuestReviews(userId: string): Promise<StayReviewPending[]> {
  return elevated(async (tx) => {
    const rows = await tx
      .select({
        bookingId: stayBookings.id,
        referenceCode: stayBookings.referenceCode,
        checkOutOn: sql<string>`${stayBookings.checkOutOn}::text`,
        titleAr: properties.nameAr,
        titleEn: properties.nameEn,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        daysLeft: sql<number>`greatest(0, ${GUEST_REVIEW_REMINDER_DAYS}::int - (current_date - ${stayBookings.checkOutOn}))::int`,
        coverImageUrl: sql<string | null>`(
          select '/api/public/media/' || ma.id::text
          from unit_media um
          inner join media_assets ma on ma.id = um.media_asset_id
          inner join units bu on bu.id = um.unit_id
          where bu.property_id = ${stayBookings.propertyId}
            and ma.processing_status = 'ready'
            and ma.scan_status = 'clean'
            and ma.mime_type like 'image/%'
          order by um.position asc
          limit 1
        )`,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .leftJoin(units, eq(units.id, stayBookings.unitId))
      .where(
        and(
          eq(stayBookings.userId, userId),
          inArray(stayBookings.status, [...DEPARTED]),
          sql`${stayBookings.checkOutOn} >= current_date - ${GUEST_REVIEW_REMINDER_DAYS}::int`,
          sql`not exists (
            select 1 from ${bookingReviews}
            where ${bookingReviews.bookingId} = ${stayBookings.id}
              and ${bookingReviews.direction} = 'guest_to_host'
          )`,
        ),
      )
      .orderBy(desc(stayBookings.checkOutOn))
      .limit(20);
    const title = (property: string, unit: string | null) =>
      !unit ? property : unit.includes(property) ? unit : `${property} · ${unit}`;
    return rows.map((row) => ({
      bookingId: row.bookingId,
      referenceCode: row.referenceCode,
      checkOutOn: row.checkOutOn,
      titleAr: title(row.titleAr, row.unitNameAr),
      titleEn: title(row.titleEn ?? row.titleAr, row.unitNameEn ?? row.unitNameAr),
      coverImageUrl: row.coverImageUrl,
      daysLeft: row.daysLeft,
    }));
  });
}

/** Guest rates the property and its management (reference-code access, after check-out). */
export async function submitGuestReview(
  referenceCode: string,
  input: ReviewSubmission,
  context: AiContext,
): Promise<SubmittedReview & { subjects: Array<[ReputationSubject, string]> }> {
  const reference = referenceCode.trim().toUpperCase();
  const { booking, name } = await elevated(async (tx) => {
    const [found] = await tx
      .select(bookingColumns)
      .from(stayBookings)
      .where(eq(stayBookings.referenceCode, reference))
      .limit(1);
    if (!found) fail('booking_not_found');
    if (!DEPARTED.has(found.status)) fail('review_not_open');
    if (await reviewExists(tx, found.id, 'guest_to_host')) fail('review_exists');
    return { booking: found, name: await guestName(tx, found) };
  });
  const prepared = await prepareReview('guest_to_host', input, context);
  const saved = await insertReview(booking, prepared, {
    authorUserId: booking.userId,
    authorName: name,
    subjectUserId: null,
    subjectEmailHash: null,
    subjectName: null,
  });
  return {
    ...saved,
    subjects: [
      ['property', booking.propertyId],
      ['host', booking.organizationId],
    ],
  };
}

export function canReviewGuests(claims: SessionClaims): boolean {
  return (
    hasPermission(claims, 'stay.booking.manage') || hasPermission(claims, 'stay.refund.approve')
  );
}

/** Host rates the guest after check-out (property hub, bookings tab). */
export async function submitHostReview(
  claims: SessionClaims,
  propertyId: string,
  bookingId: string,
  input: ReviewSubmission,
  context: AiContext,
): Promise<SubmittedReview & { subjects: Array<[ReputationSubject, string]> }> {
  if (!canReviewGuests(claims)) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');
  const ownerPartyId = ownerPartyScope(claims);
  const { booking, name, authorName } = await elevated(async (tx) => {
    const [found] = await tx
      .select(bookingColumns)
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          eq(stayBookings.propertyId, propertyId),
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!found) fail('booking_not_found');
    if (!DEPARTED.has(found.status)) fail('review_not_open');
    if (await reviewExists(tx, found.id, 'host_to_guest')) fail('review_exists');
    const [author] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    return { booking: found, name: await guestName(tx, found), authorName: author?.name ?? null };
  });
  const prepared = await prepareReview('host_to_guest', input, context);
  const saved = await insertReview(booking, prepared, {
    authorUserId: claims.sub,
    authorName,
    subjectUserId: booking.userId,
    subjectEmailHash: booking.email?.includes('@') ? emailHash(booking.email) : null,
    subjectName: name,
  });
  const guestKey = guestKeyOf(booking.userId, booking.email);
  return {
    ...saved,
    subjects: [
      ['property', booking.propertyId],
      ['host', booking.organizationId],
      ...(guestKey ? [['guest', guestKey] as [ReputationSubject, string]] : []),
    ],
  };
}

export type GuestReviewState = {
  /** The guest still owes the review (blocks the deposit refund request). */
  required: boolean;
  /** `published`: public and visible to the host (only once the deposit is settled). */
  mine: { score: number; createdAt: string; published: boolean } | null;
  /** The host's review of the guest, shown to the guest as soon as it is written. */
  fromHost: {
    score: number;
    recommend: boolean | null;
    summary: ReviewText | null;
    comment: string | null;
  } | null;
  hostWrote: boolean;
  guestKey: string | null;
};

export async function loadGuestReviewState(bookingId: string): Promise<GuestReviewState> {
  return elevated(async (tx) => {
    const [booking] = await tx
      .select(bookingColumns)
      .from(stayBookings)
      .where(eq(stayBookings.id, bookingId))
      .limit(1);
    if (!booking) fail('booking_not_found');
    const rows = await tx
      .select({
        direction: bookingReviews.direction,
        score: bookingReviews.score,
        recommend: bookingReviews.recommend,
        comment: bookingReviews.comment,
        flags: bookingReviews.aiFlags,
        summaryAr: bookingReviews.aiSummaryAr,
        summaryEn: bookingReviews.aiSummaryEn,
        createdAt: bookingReviews.createdAt,
      })
      .from(bookingReviews)
      .where(eq(bookingReviews.bookingId, bookingId));
    const mine = rows.find((row) => row.direction === 'guest_to_host');
    const host = rows.find((row) => row.direction === 'host_to_guest');
    const [settled] = mine
      ? await tx
          .select({ value: sql<boolean>`${depositSettled(stayBookings.id)}` })
          .from(stayBookings)
          .where(eq(stayBookings.id, bookingId))
      : [];
    const published = settled?.value === true;
    return {
      required: DEPARTED.has(booking.status) && !mine,
      mine: mine
        ? { score: num(mine.score) ?? 0, createdAt: mine.createdAt.toISOString(), published }
        : null,
      fromHost: host
        ? {
            score: num(host.score) ?? 0,
            recommend: host.recommend,
            summary:
              host.summaryAr && host.summaryEn ? { ar: host.summaryAr, en: host.summaryEn } : null,
            comment: host.flags.some((flag) => HIDDEN_COMMENT_FLAGS.has(flag))
              ? null
              : host.comment,
          }
        : null,
      hostWrote: Boolean(host),
      guestKey: guestKeyOf(booking.userId, booking.email),
    };
  });
}

/** Released host reviews of a guest, by account or by booking email. */
function guestCondition(key: string): SQL {
  if (UUID.test(key)) return eq(stayBookings.userId, key);
  return eq(bookingReviews.subjectEmailHash, key.slice(1));
}

export type BookingReviewFacts = {
  /** Only once the guest's review is released (deposit settled): the host is not told before. */
  guestReviewed: boolean;
  hostScore: number | null;
  standing: GuestStanding | null;
};

/**
 * For the host's bookings tab: whether each side reviewed, and the guest's standing from all
 * hosts on the platform (released reviews only), shown when deciding on a booking request.
 */
export async function loadBookingReviewFacts(
  tx: Tx,
  bookings: Array<{ id: string; userId: string | null; email: string | null }>,
): Promise<Map<string, BookingReviewFacts>> {
  const facts = new Map<string, BookingReviewFacts>();
  if (!bookings.length) return facts;
  const own = await tx
    .select({
      bookingId: bookingReviews.bookingId,
      direction: bookingReviews.direction,
      score: bookingReviews.score,
      released: sql<boolean>`${released}`,
    })
    .from(bookingReviews)
    .where(
      inArray(
        bookingReviews.bookingId,
        bookings.map((row) => row.id),
      ),
    );
  const keys = new Map(bookings.map((row) => [row.id, guestKeyOf(row.userId, row.email)]));
  const userIds = [...new Set(bookings.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const hashes = [
    ...new Set(bookings.flatMap((row) => (row.email?.includes('@') ? [emailHash(row.email)] : []))),
  ];
  const history =
    userIds.length || hashes.length
      ? await tx
          .select({
            score: bookingReviews.score,
            userId: stayBookings.userId,
            hash: bookingReviews.subjectEmailHash,
          })
          .from(bookingReviews)
          .innerJoin(stayBookings, eq(stayBookings.id, bookingReviews.bookingId))
          .where(
            and(
              eq(bookingReviews.direction, 'host_to_guest'),
              eq(bookingReviews.status, 'published'),
              released,
              or(
                ...(userIds.length ? [inArray(stayBookings.userId, userIds)] : []),
                ...(hashes.length ? [inArray(bookingReviews.subjectEmailHash, hashes)] : []),
              ),
            ),
          )
          .limit(2000)
      : [];
  for (const booking of bookings) {
    const hash = booking.email?.includes('@') ? emailHash(booking.email) : null;
    const scores = history
      .filter(
        (row) =>
          (booking.userId && row.userId === booking.userId) || (hash !== null && row.hash === hash),
      )
      .flatMap((row) => {
        const value = num(row.score);
        return value === null ? [] : [value];
      });
    const key = keys.get(booking.id) ?? null;
    const mine = own.filter((row) => row.bookingId === booking.id);
    const hostRow = mine.find((row) => row.direction === 'host_to_guest');
    facts.set(booking.id, {
      guestReviewed: mine.some((row) => row.direction === 'guest_to_host' && row.released),
      hostScore: hostRow ? num(hostRow.score) : null,
      standing: key
        ? {
            key,
            count: scores.length,
            score: scores.length
              ? round1(scores.reduce((sum, value) => sum + value, 0) / scores.length)
              : null,
          }
        : null,
    });
  }
  return facts;
}

function subjectCondition(subject: ReputationSubject, key: string): SQL {
  if (subject === 'property') {
    return and(
      eq(bookingReviews.propertyId, key),
      eq(bookingReviews.direction, 'guest_to_host'),
    ) as SQL;
  }
  if (subject === 'unit') {
    return and(
      eq(bookingReviews.unitId, key),
      eq(bookingReviews.direction, 'guest_to_host'),
    ) as SQL;
  }
  if (subject === 'host') {
    return and(
      eq(bookingReviews.organizationId, key),
      eq(bookingReviews.direction, 'guest_to_host'),
    ) as SQL;
  }
  return and(eq(bookingReviews.direction, 'host_to_guest'), guestCondition(key)) as SQL;
}

async function subjectName(
  tx: Tx,
  subject: ReputationSubject,
  key: string,
  latestGuestName: string | null,
  hasReviews: boolean,
): Promise<ReviewText | null | undefined> {
  if (subject === 'property') {
    const [row] = await tx
      .select({ ar: properties.nameAr, en: properties.nameEn })
      .from(properties)
      .where(eq(properties.id, key))
      .limit(1);
    return row ? { ar: row.ar, en: row.en } : undefined;
  }
  if (subject === 'unit') {
    const [row] = await tx
      .select({ ar: units.nameAr, en: units.nameEn })
      .from(units)
      .where(eq(units.id, key))
      .limit(1);
    return row ? { ar: row.ar, en: row.en } : undefined;
  }
  if (subject === 'host') {
    const [row] = await tx
      .select({ ar: organizations.displayNameAr, en: organizations.displayNameEn })
      .from(organizations)
      .where(eq(organizations.id, key))
      .limit(1);
    return row ? { ar: row.ar, en: row.en } : undefined;
  }
  if (UUID.test(key)) {
    const [row] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, key))
      .limit(1);
    if (!row) return undefined;
    const name = publicPersonName(row.name);
    return name ? { ar: name, en: name } : null;
  }
  if (!hasReviews) {
    // No host has rated this guest yet: the profile still exists if they wrote a review.
    const [own] = await tx
      .select({ name: bookingReviews.authorName })
      .from(bookingReviews)
      .innerJoin(stayBookings, eq(stayBookings.id, bookingReviews.bookingId))
      .where(
        and(
          eq(bookingReviews.direction, 'guest_to_host'),
          eq(bookingReviews.status, 'published'),
          released,
          sql`left(encode(sha256(convert_to('bhd-r:guest:' || lower(btrim(${contactEmail})), 'UTF8')), 'hex'), 32) = ${key.slice(1)}`,
        ),
      )
      .orderBy(desc(bookingReviews.createdAt))
      .limit(1);
    if (!own) return undefined;
    const ownName = publicPersonName(own.name);
    return ownName ? { ar: ownName, en: ownName } : null;
  }
  const name = publicPersonName(latestGuestName);
  return name ? { ar: name, en: name } : null;
}

function averageBy<T>(rows: T[], pick: (row: T) => number | null): number | null {
  const values = rows.flatMap((row) => {
    const value = pick(row);
    return value === null ? [] : [value];
  });
  return values.length
    ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

/**
 * Public reputation of a property, a host organization or a guest: average on 10, criteria
 * breakdown, the AI profile summary (cached) and the latest reviews. `stale` asks the caller
 * to refresh the AI summary in the background. Null when the subject does not exist.
 */
export async function loadReputation(
  subject: ReputationSubject,
  key: string,
  limit = 20,
): Promise<{ reputation: Reputation; stale: boolean } | null> {
  if (subject === 'guest' ? !validGuestKey(key) : !UUID.test(key)) return null;
  return elevated(async (tx) => {
    const rows = await tx
      .select({
        id: bookingReviews.id,
        createdAt: bookingReviews.createdAt,
        direction: bookingReviews.direction,
        organizationId: bookingReviews.organizationId,
        propertyId: bookingReviews.propertyId,
        authorName: bookingReviews.authorName,
        subjectName: bookingReviews.subjectName,
        subjectHash: bookingReviews.subjectEmailHash,
        criteria: bookingReviews.criteria,
        score: bookingReviews.score,
        propertyScore: bookingReviews.propertyScore,
        hostScore: bookingReviews.hostScore,
        recommend: bookingReviews.recommend,
        comment: bookingReviews.comment,
        summaryAr: bookingReviews.aiSummaryAr,
        summaryEn: bookingReviews.aiSummaryEn,
        highlights: bookingReviews.aiHighlights,
        concerns: bookingReviews.aiConcerns,
        flags: bookingReviews.aiFlags,
        engine: bookingReviews.aiEngine,
        photoCount: bookingReviews.photoCount,
        checkInOn: stayBookings.checkInOn,
        nights: sql<number>`(${stayBookings.checkOutOn} - ${stayBookings.checkInOn})::int`,
        adults: snapshotCount('adults'),
        children: snapshotCount('children'),
        bookingUserId: stayBookings.userId,
        bookingEmail: contactEmail,
        hostAr: organizations.displayNameAr,
        hostEn: organizations.displayNameEn,
        propertyAr: properties.nameAr,
        propertyEn: properties.nameEn,
        unitAr: units.nameAr,
        unitEn: units.nameEn,
      })
      .from(bookingReviews)
      .innerJoin(stayBookings, eq(stayBookings.id, bookingReviews.bookingId))
      .innerJoin(organizations, eq(organizations.id, bookingReviews.organizationId))
      .innerJoin(properties, eq(properties.id, bookingReviews.propertyId))
      .leftJoin(units, eq(units.id, stayBookings.unitId))
      .where(and(subjectCondition(subject, key), eq(bookingReviews.status, 'published'), released))
      .orderBy(desc(bookingReviews.createdAt))
      .limit(300);

    const name = await subjectName(tx, subject, key, rows[0]?.subjectName ?? null, rows.length > 0);
    if (name === undefined) return null;

    const direction: ReviewDirection = subject === 'guest' ? 'host_to_guest' : 'guest_to_host';
    const rubric = rubricFor(direction);
    const perReview = rows.map((row) => scoreAnswers(direction, row.criteria));
    const groups = rubric.map((group) => ({
      key: group.key,
      score: averageBy(
        perReview,
        (scores) => scores.groups.find((item) => item.key === group.key)?.score ?? null,
      ),
    }));
    const criteria = rubric.flatMap((group) =>
      group.criteria.map((item) => {
        const values = rows.flatMap((row) =>
          row.criteria[item.key] ? [row.criteria[item.key]! * 2] : [],
        );
        return {
          key: item.key,
          count: values.length,
          score: values.length
            ? round1(values.reduce((sum, value) => sum + value, 0) / values.length)
            : null,
        };
      }),
    );
    const score = averageBy(rows, (row) =>
      subject === 'host' ? num(row.hostScore) : num(row.score),
    );
    const recommended = rows.filter((row) => row.recommend !== null);
    const recommendRate = recommended.length
      ? Math.round((recommended.filter((row) => row.recommend).length / recommended.length) * 100)
      : null;

    const fromGuests = direction === 'guest_to_host';
    const typeOf = (row: (typeof rows)[number]) =>
      fromGuests ? travellerTypeOf(row.adults, row.children) : null;
    const travellers = TRAVELLER_TYPES.map((type) => ({
      type,
      count: rows.filter((row) => typeOf(row) === type).length,
    }));
    const reviewers = new Set(
      rows.map((row) =>
        fromGuests
          ? (guestKeyOf(row.bookingUserId, row.bookingEmail) ?? row.id)
          : row.organizationId,
      ),
    ).size;

    const shown = rows.slice(0, limit);
    const photos = shown.some((row) => row.photoCount > 0)
      ? await tx
          .select({
            id: bookingReviewPhotos.id,
            reviewId: bookingReviewPhotos.reviewId,
            position: bookingReviewPhotos.position,
          })
          .from(bookingReviewPhotos)
          .where(
            inArray(
              bookingReviewPhotos.reviewId,
              shown.filter((row) => row.photoCount > 0).map((row) => row.id),
            ),
          )
      : [];

    const reviews: PublicReview[] = shown.map((row) => {
      const hidden = row.flags.some((flag) => HIDDEN_COMMENT_FLAGS.has(flag));
      const guestKey =
        row.direction === 'guest_to_host'
          ? guestKeyOf(row.bookingUserId, row.bookingEmail)
          : (row.bookingUserId ?? (row.subjectHash ? `e${row.subjectHash}` : null));
      return {
        id: row.id,
        direction: row.direction as ReviewDirection,
        createdAt: row.createdAt.toISOString(),
        stayMonth: String(row.checkInOn).slice(0, 7),
        authorName: row.direction === 'guest_to_host' ? publicPersonName(row.authorName) : null,
        guestKey,
        guestName: publicPersonName(
          row.direction === 'guest_to_host' ? row.authorName : row.subjectName,
        ),
        hostKey: row.organizationId,
        hostName: { ar: row.hostAr, en: row.hostEn },
        propertyId: row.propertyId,
        propertyName: { ar: row.propertyAr, en: row.propertyEn },
        score: num(row.score) ?? 0,
        propertyScore: num(row.propertyScore),
        hostScore: num(row.hostScore),
        groups: scoreAnswers(row.direction as ReviewDirection, row.criteria).groups,
        recommend: row.recommend,
        comment: hidden ? null : row.comment,
        commentHidden: hidden && Boolean(row.comment),
        summary: row.summaryAr && row.summaryEn ? { ar: row.summaryAr, en: row.summaryEn } : null,
        highlights: row.highlights,
        concerns: row.concerns,
        photoIds: photos
          .filter((photo) => photo.reviewId === row.id)
          .sort((a, b) => a.position - b.position)
          .map((photo) => photo.id),
        aiEngine: row.engine,
        unitName:
          fromGuests && row.unitAr && row.unitEn ? { ar: row.unitAr, en: row.unitEn } : null,
        nights: fromGuests && row.nights > 0 ? row.nights : null,
        guests: fromGuests && row.adults !== null ? row.adults + (row.children ?? 0) : null,
        traveller: typeOf(row),
      };
    });

    const [profile] =
      subject === 'unit'
        ? []
        : await tx
            .select()
            .from(reviewProfiles)
            .where(and(eq(reviewProfiles.subjectType, subject), eq(reviewProfiles.subjectKey, key)))
            .limit(1);

    return {
      stale:
        subject !== 'unit' && rows.length > 0 && (!profile || profile.reviewCount !== rows.length),
      reputation: {
        subject,
        key,
        name,
        score,
        count: rows.length,
        reviewers,
        travellers,
        recommendRate,
        groups,
        criteria,
        profile:
          profile && rows.length
            ? {
                summary:
                  profile.summaryAr && profile.summaryEn
                    ? { ar: profile.summaryAr, en: profile.summaryEn }
                    : null,
                strengths: profile.strengths,
                watchouts: profile.watchouts,
                engine: profile.engine,
                updatedAt: profile.updatedAt.toISOString(),
              }
            : null,
        reviews,
      },
    };
  });
}

/** Re-reads a subject's published reviews and stores the AI profile summary. */
export async function refreshReviewProfile(
  subject: ReputationSubject,
  key: string,
  context: AiContext,
): Promise<void> {
  if (subject === 'unit') return;
  const loaded = await loadReputation(subject, key, 30);
  if (!loaded || !loaded.reputation.count) return;
  const { reputation } = loaded;
  const direction: ReviewDirection = subject === 'guest' ? 'host_to_guest' : 'guest_to_host';
  const analysis = await analyzeProfile(context, {
    subject,
    score: reputation.score,
    groups: reputation.groups.map((group) => ({
      label: groupLabel(direction, group.key, false),
      score: group.score,
    })),
    reviews: reputation.reviews.map((review) => ({
      score: review.score,
      comment: review.comment,
      highlights: review.highlights,
      concerns: review.concerns,
    })),
  });
  const values = {
    reviewCount: reputation.count,
    summaryAr: analysis.summary?.ar ?? null,
    summaryEn: analysis.summary?.en ?? null,
    strengths: analysis.strengths,
    watchouts: analysis.watchouts,
    engine: analysis.engine,
    updatedAt: new Date(),
  };
  await elevated((tx) =>
    tx
      .insert(reviewProfiles)
      .values({ subjectType: subject, subjectKey: key, ...values })
      .onConflictDoUpdate({
        target: [reviewProfiles.subjectType, reviewProfiles.subjectKey],
        set: values,
      }),
  );
}

/** A review photo, only once its review is public. */
export async function loadReviewPhoto(photoId: string): Promise<string | null> {
  if (!UUID.test(photoId)) return null;
  return elevated(async (tx) => {
    const [row] = await tx
      .select({ dataUrl: bookingReviewPhotos.dataUrl })
      .from(bookingReviewPhotos)
      .innerJoin(bookingReviews, eq(bookingReviews.id, bookingReviewPhotos.reviewId))
      .where(
        and(eq(bookingReviewPhotos.id, photoId), eq(bookingReviews.status, 'published'), released),
      )
      .limit(1);
    return row?.dataUrl ?? null;
  });
}
