import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  asPublicListingCategory,
  searchPublicListingsFromNeon,
  type PublicListingSearchInput,
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
    const search: PublicListingSearchInput = {
      limit: Number(url.searchParams.get('limit') ?? 24) || 24,
    };
    const countryCode = url.searchParams.get('countryCode');
    const governorate = url.searchParams.get('governorate');
    const category = asPublicListingCategory(url.searchParams.get('category'));
    const currency = url.searchParams.get('currency');
    if (countryCode) search.countryCode = countryCode;
    if (governorate) search.governorate = governorate;
    if (category) search.category = category;
    if (bedrooms !== undefined) search.bedrooms = bedrooms;
    if (currency) {
      search.currency = currency as NonNullable<PublicListingSearchInput['currency']>;
    }
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
