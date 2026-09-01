import 'server-only';
import { cookies } from 'next/headers';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { verifySessionToken } from '@bhd-r/authz';
import type { StaySetupContext } from '@bhd-r/contracts';
import {
  createDatabase,
  properties,
  stayProfiles,
  stayPublicListings,
  stayUnitTypes,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import { ApiError, apiFetch } from '@/lib/server-api';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRStaySetupDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStaySetupDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStaySetupDb = { db };
  }
  return globalForDb.__bhdRStaySetupDb;
}

async function readClaims() {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token, requireSessionSecret());
  } catch {
    return null;
  }
}

/** Read-only Neon fallback when Nest setup context is unavailable. */
async function loadStaySetupContextFromNeon(propertyId: string): Promise<StaySetupContext> {
  const claims = await readClaims();
  const organizationId = claims?.organizationId;
  if (!organizationId) throw new Error('organization_required');

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${organizationId}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    const [property] = await transaction
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        nameEn: properties.nameEn,
        defaultCurrency: properties.defaultCurrency,
      })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);
    if (!property) throw new Error('property_not_found');

    const unitRows = await transaction
      .select({
        id: units.id,
        code: units.code,
        nameAr: units.nameAr,
        nameEn: units.nameEn,
        bedrooms: units.bedrooms,
        bathrooms: units.bathrooms,
      })
      .from(units)
      .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)))
      .orderBy(asc(units.code));

    const profileRows =
      unitRows.length === 0
        ? []
        : await transaction
            .select({
              unitId: stayProfiles.unitId,
              id: stayProfiles.id,
              publishStatus: stayProfiles.publishStatus,
            })
            .from(stayProfiles)
            .where(
              and(
                eq(stayProfiles.organizationId, organizationId),
                inArray(
                  stayProfiles.unitId,
                  unitRows.map((row) => row.id),
                ),
              ),
            );

    const profileByUnit = new Map(profileRows.map((row) => [row.unitId, row]));

    const unitTypeRows = await transaction
      .select({
        id: stayUnitTypes.id,
        code: stayUnitTypes.code,
        nameAr: stayUnitTypes.nameAr,
        nameEn: stayUnitTypes.nameEn,
        maxGuests: stayUnitTypes.maxGuests,
      })
      .from(stayUnitTypes)
      .where(
        and(
          eq(stayUnitTypes.propertyId, propertyId),
          eq(stayUnitTypes.organizationId, organizationId),
        ),
      )
      .orderBy(asc(stayUnitTypes.code));

    const listingRows = await transaction
      .select({
        id: stayPublicListings.id,
        unitTypeId: stayPublicListings.unitTypeId,
        slug: stayPublicListings.slug,
        titleAr: stayPublicListings.titleAr,
        titleEn: stayPublicListings.titleEn,
        enabled: stayPublicListings.enabled,
        publishedAt: stayPublicListings.publishedAt,
      })
      .from(stayPublicListings)
      .where(
        and(
          eq(stayPublicListings.propertyId, propertyId),
          eq(stayPublicListings.organizationId, organizationId),
        ),
      );

    return {
      propertyId: property.id,
      propertyNameAr: property.nameAr,
      propertyNameEn: property.nameEn,
      defaultCurrency: property.defaultCurrency,
      units: unitRows.map((unit) => {
        const profile = profileByUnit.get(unit.id);
        return {
          id: unit.id,
          code: unit.code,
          nameAr: unit.nameAr,
          nameEn: unit.nameEn,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          profileId: profile?.id ?? null,
          publishStatus:
            (profile?.publishStatus as StaySetupContext['units'][number]['publishStatus']) ?? null,
        };
      }),
      unitTypes: unitTypeRows,
      listings: listingRows.map((listing) => ({
        id: listing.id,
        unitTypeId: listing.unitTypeId,
        slug: listing.slug,
        titleAr: listing.titleAr,
        titleEn: listing.titleEn,
        enabled: listing.enabled,
        publishedAt: listing.publishedAt?.toISOString() ?? null,
      })),
    };
  });
}

export type StaySetupLoadResult = {
  context: StaySetupContext | null;
  apiAvailable: boolean;
  apiHint: string | null;
  source: 'nest' | 'neon' | 'none';
};

export async function loadStaySetupPageData(
  propertyId: string | null | undefined,
  locale: 'ar' | 'en',
): Promise<StaySetupLoadResult> {
  let apiAvailable = false;
  let apiHint: string | null = null;

  try {
    const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health');
    apiAvailable = Boolean(health?.ok ?? health);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        apiHint =
          locale === 'ar'
            ? 'Nest يرفض المؤسسة (STAYS_ORG_ALLOWLIST). ضع * أو أعد نشر Nest 0.4.20+.'
            : 'Nest rejected this organization (STAYS_ORG_ALLOWLIST).';
      } else if (error.status === 401) {
        apiHint =
          locale === 'ar'
            ? 'الجلسة غير مقبولة لدى Nest — سجّل الخروج ثم الدخول.'
            : 'Nest rejected the session — sign out and back in.';
      } else if (error.status === 404) {
        apiHint =
          locale === 'ar'
            ? 'STAYS_PLATFORM_ENABLED مغلق على Render.'
            : 'STAYS_PLATFORM_ENABLED is off on Render.';
      } else {
        apiHint =
          locale === 'ar'
            ? `Nest غير جاهز (${error.status}).`
            : `Nest unavailable (${error.status}).`;
      }
    } else {
      apiHint = locale === 'ar' ? 'تعذر الوصول إلى Nest.' : 'Could not reach Nest.';
    }
  }

  if (!propertyId) {
    return { context: null, apiAvailable, apiHint, source: 'none' };
  }

  try {
    const context = await apiFetch<StaySetupContext>(
      `/v1/stays/setup/context?propertyId=${encodeURIComponent(propertyId)}`,
    );
    return { context, apiAvailable: true, apiHint: null, source: 'nest' };
  } catch (error) {
    const nestDetail =
      error instanceof ApiError
        ? `${error.status}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'unknown';

    if (hasDatabaseUrl()) {
      try {
        const context = await loadStaySetupContextFromNeon(propertyId);
        return {
          context,
          apiAvailable,
          apiHint: apiAvailable
            ? locale === 'ar'
              ? `تم التحميل من قاعدة البيانات (Nest: ${nestDetail}). الحفظ يتطلب Nest.`
              : `Loaded from database (Nest: ${nestDetail}). Saving still needs Nest.`
            : apiHint,
          source: 'neon',
        };
      } catch (neonError) {
        const neonMsg = neonError instanceof Error ? neonError.message : 'neon_failed';
        return {
          context: null,
          apiAvailable,
          apiHint:
            locale === 'ar'
              ? `تعذر تحميل بيانات العقار — Nest: ${nestDetail} · Neon: ${neonMsg}`
              : `Could not load property — Nest: ${nestDetail} · Neon: ${neonMsg}`,
          source: 'none',
        };
      }
    }

    return {
      context: null,
      apiAvailable,
      apiHint:
        locale === 'ar'
          ? `تعذر تحميل بيانات العقار — ${nestDetail}`
          : `Could not load property — ${nestDetail}`,
      source: 'none',
    };
  }
}
