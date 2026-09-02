import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  createDatabase,
  reviews,
  stayBookings,
  stayReviews,
  type Database,
} from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRStayReviewsDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStayReviewsDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStayReviewsDb = { db };
  }
  return globalForDb.__bhdRStayReviewsDb;
}

async function withAdmin<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await tx.execute(sql`select set_config('app.public', 'false', true)`);
    return fn(tx as unknown as Database);
  });
}

const REVIEW_WINDOW_DAYS = 90;

import type {
  StayReviewPending,
  StayReviewPublic,
  StayReviewSubmitInput,
} from '@/lib/stay-reviews-types';

export type { StayReviewPending, StayReviewPublic, StayReviewSubmitInput };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function isReviewEligible(status: string, checkOutOn: string): boolean {
  const today = todayIso();
  if (checkOutOn > today) return false;
  if (daysBetween(checkOutOn, today) > REVIEW_WINDOW_DAYS) return false;
  return [
    'confirmed',
    'paid',
    'checked_in',
    'checked_out',
    'closed',
  ].includes(status);
}

function scoreLabel(ten: number, ar: boolean): string {
  if (ten >= 9) return ar ? 'رائع' : 'Superb';
  if (ten >= 8) return ar ? 'ممتاز' : 'Fabulous';
  if (ten >= 7) return ar ? 'جيد جداً' : 'Very good';
  if (ten >= 6) return ar ? 'مرضي' : 'Satisfactory';
  return ar ? 'مقبول' : 'OK';
}

export { scoreLabel, isReviewEligible, REVIEW_WINDOW_DAYS };

export async function listPublishedStayReviewsForProperty(
  propertyId: string,
  limit = 40,
): Promise<StayReviewPublic[]> {
  return withAdmin(async (db) => {
    const result = await db.execute(sql`
      SELECT
        sr.id,
        sr.rating,
        sr.title,
        sr.body,
        sr.pros_text,
        sr.cons_text,
        sr.cleanliness,
        sr.location_score,
        sr.value_score,
        sr.communication,
        sr.accuracy,
        sr.check_in_score,
        sr.created_at,
        coalesce(spl.title_ar, p.name_ar) AS title_ar,
        coalesce(spl.title_en, p.name_en) AS title_en,
        (
          SELECT '/api/public/media/' || ma.id::text
          FROM unit_media um
          INNER JOIN media_assets ma ON ma.id = um.media_asset_id
          INNER JOIN units bu ON bu.id = um.unit_id
          WHERE bu.property_id = sb.property_id
            AND ma.processing_status = 'ready'
            AND ma.scan_status = 'clean'
            AND ma.mime_type LIKE 'image/%'
          ORDER BY um.position ASC
          LIMIT 1
        ) AS cover_image_url
      FROM stay_reviews sr
      INNER JOIN stay_bookings sb ON sb.id = sr.booking_id
      INNER JOIN properties p ON p.id = sb.property_id
      LEFT JOIN stay_public_listings spl
        ON spl.property_id = sb.property_id
       AND spl.organization_id = sb.organization_id
       AND spl.enabled = true
      WHERE sb.property_id = ${propertyId}::uuid
        AND sr.status = 'published'
      ORDER BY sr.created_at DESC
      LIMIT ${limit}
    `);
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      id: string;
      rating: number;
      title: string | null;
      body: string | null;
      pros_text: string | null;
      cons_text: string | null;
      cleanliness: number | null;
      location_score: number | null;
      value_score: number | null;
      communication: number | null;
      accuracy: number | null;
      check_in_score: number | null;
      created_at: Date | string;
      title_ar: string | null;
      title_en: string | null;
      cover_image_url: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      prosText: row.pros_text,
      consText: row.cons_text,
      cleanliness: row.cleanliness,
      locationScore: row.location_score,
      valueScore: row.value_score,
      communication: row.communication,
      accuracy: row.accuracy,
      checkInScore: row.check_in_score,
      createdAt:
        typeof row.created_at === 'string'
          ? row.created_at
          : new Date(row.created_at).toISOString(),
      authorLabel: 'Guest',
      propertyTitleAr: row.title_ar,
      propertyTitleEn: row.title_en,
      coverImageUrl: row.cover_image_url,
    }));
  });
}

export async function listPendingStayReviewsForUser(
  userId: string,
): Promise<StayReviewPending[]> {
  return withAdmin(async (db) => {
    const result = await db.execute(sql`
      SELECT
        sb.id AS booking_id,
        sb.reference_code,
        sb.check_in_on::text AS check_in_on,
        sb.check_out_on::text AS check_out_on,
        sb.property_id,
        sb.unit_id,
        sb.status,
        spl.slug AS slug,
        coalesce(spl.title_ar, p.name_ar) AS title_ar,
        coalesce(spl.title_en, p.name_en) AS title_en,
        (
          SELECT '/api/public/media/' || ma.id::text
          FROM unit_media um
          INNER JOIN media_assets ma ON ma.id = um.media_asset_id
          INNER JOIN units bu ON bu.id = um.unit_id
          WHERE bu.property_id = sb.property_id
            AND ma.processing_status = 'ready'
            AND ma.scan_status = 'clean'
            AND ma.mime_type LIKE 'image/%'
          ORDER BY um.position ASC
          LIMIT 1
        ) AS cover_image_url
      FROM stay_bookings sb
      INNER JOIN properties p ON p.id = sb.property_id
      LEFT JOIN stay_public_listings spl
        ON spl.property_id = sb.property_id
       AND spl.organization_id = sb.organization_id
       AND spl.enabled = true
      LEFT JOIN stay_reviews sr ON sr.booking_id = sb.id
      WHERE sb.user_id = ${userId}::uuid
        AND sr.id IS NULL
        AND sb.check_out_on <= CURRENT_DATE
        AND sb.check_out_on >= (CURRENT_DATE - (${REVIEW_WINDOW_DAYS} || ' days')::interval)
        AND sb.status IN ('confirmed', 'paid', 'checked_in', 'checked_out', 'closed')
      ORDER BY sb.check_out_on DESC
      LIMIT 40
    `);
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as Array<{
      booking_id: string;
      reference_code: string;
      check_in_on: string;
      check_out_on: string;
      property_id: string;
      unit_id: string;
      slug: string | null;
      title_ar: string;
      title_en: string;
      cover_image_url: string | null;
    }>;
    const today = todayIso();
    return rows.map((row) => ({
      bookingId: row.booking_id,
      referenceCode: row.reference_code,
      checkInOn: row.check_in_on,
      checkOutOn: row.check_out_on,
      propertyId: row.property_id,
      unitId: row.unit_id,
      slug: row.slug,
      titleAr: row.title_ar,
      titleEn: row.title_en,
      coverImageUrl: row.cover_image_url,
      daysLeft: Math.max(0, REVIEW_WINDOW_DAYS - daysBetween(row.check_out_on, today)),
    }));
  });
}

export async function submitStayReview(
  userId: string,
  input: StayReviewSubmitInput,
): Promise<{ id: string }> {
  return withAdmin(async (db) => {
    const [booking] = await db
      .select({
        id: stayBookings.id,
        organizationId: stayBookings.organizationId,
        propertyId: stayBookings.propertyId,
        userId: stayBookings.userId,
        status: stayBookings.status,
        checkOutOn: stayBookings.checkOutOn,
      })
      .from(stayBookings)
      .where(eq(stayBookings.id, input.bookingId))
      .limit(1);
    if (!booking || booking.userId !== userId) {
      throw new Error('stay_review_forbidden');
    }
    if (!isReviewEligible(booking.status, booking.checkOutOn)) {
      throw new Error('stay_review_not_eligible');
    }

    const [existing] = await db
      .select({ id: stayReviews.id })
      .from(stayReviews)
      .where(eq(stayReviews.bookingId, input.bookingId))
      .limit(1);
    if (existing) throw new Error('stay_review_exists');

    const [created] = await db
      .insert(stayReviews)
      .values({
        organizationId: booking.organizationId,
        bookingId: booking.id,
        authorUserId: userId,
        rating: input.rating,
        title: input.title?.trim() || null,
        body: input.body?.trim() || null,
        prosText: input.prosText?.trim() || null,
        consText: input.consText?.trim() || null,
        cleanliness: input.cleanliness ?? null,
        locationScore: input.locationScore ?? null,
        valueScore: input.valueScore ?? null,
        communication: input.communication ?? null,
        accuracy: input.accuracy ?? null,
        checkInScore: input.checkInScore ?? null,
        status: 'published',
      })
      .returning({ id: stayReviews.id });

    if (!created) throw new Error('stay_review_failed');

    // Dual-write into property reviews so Property 360 score chip stays in sync.
    const bodyParts = [
      input.prosText?.trim() ? `+ ${input.prosText.trim()}` : '',
      input.consText?.trim() ? `- ${input.consText.trim()}` : '',
      input.body?.trim() || '',
    ].filter(Boolean);
    await db
      .insert(reviews)
      .values({
        organizationId: booking.organizationId,
        authorUserId: userId,
        targetType: 'property',
        targetId: booking.propertyId,
        rating: input.rating,
        body: bodyParts.join('\n') || null,
        verifiedStay: true,
        verifiedRole: 'tenant',
        status: 'published',
      })
      .onConflictDoUpdate({
        target: [reviews.authorUserId, reviews.targetType, reviews.targetId],
        set: {
          rating: input.rating,
          body: bodyParts.join('\n') || null,
          verifiedStay: true,
          verifiedRole: 'tenant',
          status: 'published',
          updatedAt: new Date(),
        },
      });

    return { id: created.id };
  });
}

/** Deterministic AI-style draft from category scores + keywords (no external LLM required). */
export function draftStayReviewCopy(input: {
  locale: 'ar' | 'en';
  rating: number;
  propertyName: string;
  cleanliness?: number | null;
  locationScore?: number | null;
  valueScore?: number | null;
  communication?: number | null;
  keywords?: string;
}): { title: string; prosText: string; consText: string; body: string } {
  const ar = input.locale === 'ar';
  const high: string[] = [];
  const low: string[] = [];
  const push = (score: number | null | undefined, good: string, bad: string) => {
    if (score == null) return;
    if (score >= 4) high.push(good);
    else if (score <= 2) low.push(bad);
  };
  push(
    input.cleanliness,
    ar ? 'النظافة ممتازة' : 'Excellent cleanliness',
    ar ? 'النظافة تحتاج تحسيناً' : 'Cleanliness needs improvement',
  );
  push(
    input.locationScore,
    ar ? 'الموقع مناسب وسهل الوصول' : 'Convenient location',
    ar ? 'الموقع كان أقل من التوقعات' : 'Location was below expectations',
  );
  push(
    input.valueScore,
    ar ? 'قيمة جيدة مقابل السعر' : 'Good value for money',
    ar ? 'السعر أعلى من الخدمة المقدمة' : 'Price felt high for the service',
  );
  push(
    input.communication,
    ar ? 'التواصل مع المضيف سريع وواضح' : 'Host communication was clear and fast',
    ar ? 'التواصل مع المضيف يحتاج تحسيناً' : 'Host communication needs improvement',
  );
  if (input.keywords?.trim()) {
    if (input.rating >= 4) high.push(input.keywords.trim());
    else low.push(input.keywords.trim());
  }
  if (!high.length && input.rating >= 4) {
    high.push(
      ar
        ? `إقامة مريحة في ${input.propertyName}`
        : `A comfortable stay at ${input.propertyName}`,
    );
  }
  if (!low.length && input.rating <= 3) {
    low.push(ar ? 'بعض التفاصيل تحتاج متابعة' : 'Some details need follow-up');
  }
  const title =
    input.rating >= 4
      ? ar
        ? `تجربة جيدة في ${input.propertyName}`
        : `Good stay at ${input.propertyName}`
      : ar
        ? `ملاحظات حول الإقامة في ${input.propertyName}`
        : `Notes about the stay at ${input.propertyName}`;
  return {
    title,
    prosText: high.join(ar ? '، ' : '. '),
    consText: low.join(ar ? '، ' : '. '),
    body: ar
      ? `تقييم عام ${input.rating}/5 بناءً على تجربة الضيف.`
      : `Overall guest rating ${input.rating}/5 based on this stay.`,
  };
}
