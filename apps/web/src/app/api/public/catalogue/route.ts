import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  asPublicListingCategory,
  searchPublicListingsFromNeon,
} from '@/lib/search-public-listings-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/public/catalogue — Neon catalogue for /properties (and diagnostics).
 * ?debug=1 includes error text when the query fails.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { data: [], pagination: { nextCursor: null, hasMore: false }, error: 'db_unconfigured' },
      { status: 503 },
    );
  }

  try {
    const bedroomsRaw = url.searchParams.get('bedrooms');
    const bedrooms =
      bedroomsRaw && bedroomsRaw !== '' && Number.isFinite(Number(bedroomsRaw))
        ? Number(bedroomsRaw)
        : undefined;
    const search = {
      limit: Number(url.searchParams.get('limit') ?? 24) || 24,
      ...(url.searchParams.get('countryCode')
        ? { countryCode: url.searchParams.get('countryCode')! }
        : {}),
      ...(url.searchParams.get('governorate')
        ? { governorate: url.searchParams.get('governorate')! }
        : {}),
      ...(asPublicListingCategory(url.searchParams.get('category'))
        ? { category: asPublicListingCategory(url.searchParams.get('category'))! }
        : {}),
      ...(bedrooms !== undefined ? { bedrooms } : {}),
      ...(url.searchParams.get('currency')
        ? {
            currency: url.searchParams.get(
              'currency',
            ) as NonNullable<Parameters<typeof searchPublicListingsFromNeon>[0]>['currency'],
          }
        : {}),
    };
    const payload = await searchPublicListingsFromNeon(search);
    return NextResponse.json({
      ...payload,
      count: payload.data.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'catalogue_failed';
    return NextResponse.json(
      {
        data: [],
        pagination: { nextCursor: null, hasMore: false },
        count: 0,
        error: 'catalogue_failed',
        ...(debug ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
