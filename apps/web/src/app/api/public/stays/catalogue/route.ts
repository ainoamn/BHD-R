import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  asPublicListingCategory,
  searchStaysCatalogueFromNeon,
  type StayCatalogueSearchInput,
} from '@/lib/search-stays-catalogue-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseMajor(value: string | null): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** GET /api/public/stays/catalogue — Neon catalogue for /stays browse. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  const rate = assertRouteRateLimit({
    key: hashRateKey(['stays-catalogue', clientIp(request)]),
    limit: 60,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { data: [], pagination: { nextCursor: null, hasMore: false }, error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rate.retryAfterSec) } },
    );
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { data: [], pagination: { nextCursor: null, hasMore: false }, error: 'db_unconfigured' },
      { status: 503 },
    );
  }

  try {
    const bedroomsMinRaw = url.searchParams.get('bedroomsMin');
    const bedroomsMin =
      bedroomsMinRaw && Number.isFinite(Number(bedroomsMinRaw))
        ? Number(bedroomsMinRaw)
        : undefined;
    const bathroomsMinRaw = url.searchParams.get('bathroomsMin');
    const bathroomsMin =
      bathroomsMinRaw && Number.isFinite(Number(bathroomsMinRaw))
        ? Number(bathroomsMinRaw)
        : undefined;
    const search: StayCatalogueSearchInput = {
      limit: Number(url.searchParams.get('limit') ?? 100) || 100,
    };
    const countryCode = url.searchParams.get('countryCode');
    const governorate = url.searchParams.get('governorate');
    const wilayat = url.searchParams.get('wilayat');
    const village = url.searchParams.get('village');
    const category = asPublicListingCategory(url.searchParams.get('category'));
    const categories = (url.searchParams.get('categories') ?? '')
      .split(',')
      .map((item) => asPublicListingCategory(item.trim()))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const currency = url.searchParams.get('currency');
    const priceMin = parseMajor(url.searchParams.get('priceMin'));
    const priceMax = parseMajor(url.searchParams.get('priceMax'));
    const amenities = (url.searchParams.get('amenities') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const q = url.searchParams.get('q')?.trim();
    const hasPool =
      url.searchParams.get('hasPool') === '1' || url.searchParams.get('hasPool') === 'true';
    const hasParking =
      url.searchParams.get('hasParking') === '1' ||
      url.searchParams.get('hasParking') === 'true';

    if (countryCode) search.countryCode = countryCode;
    if (governorate) search.governorate = governorate;
    if (wilayat) search.wilayat = wilayat;
    if (village) search.village = village;
    if (categories.length) search.categories = categories;
    else if (category) search.category = category;
    if (bedroomsMin !== undefined) search.bedroomsMin = bedroomsMin;
    if (bathroomsMin !== undefined) search.bathroomsMin = bathroomsMin;
    if (currency) search.currency = currency;
    if (priceMin !== undefined) search.priceMin = priceMin;
    if (priceMax !== undefined) search.priceMax = priceMax;
    if (hasPool) search.hasPool = true;
    if (hasParking) search.hasParking = true;
    if (amenities.length) search.amenities = amenities;
    if (q) search.q = q;

    const payload = await searchStaysCatalogueFromNeon(search);
    return NextResponse.json({
      ...payload,
      count: payload.data.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'stays_catalogue_failed';
    return NextResponse.json(
      {
        data: [],
        pagination: { nextCursor: null, hasMore: false },
        count: 0,
        error: 'stays_catalogue_failed',
        ...(debug && process.env.NODE_ENV !== 'production' ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
