import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import {
  BROWSE_AMENITIES,
  BROWSE_CATEGORIES,
  categoryLabel,
  type BrowseCategory,
  type BrowseSort,
} from '@/lib/properties-browse-filters';

export { BROWSE_AMENITIES, BROWSE_CATEGORIES, categoryLabel };
export type { BrowseCategory, BrowseSort };

export type StayBrowseFilterState = {
  countryCode: string;
  governorate: string;
  wilayat: string;
  village: string;
  categories: BrowseCategory[];
  bedroomsMin: number;
  bathroomsMin: number;
  currency: string;
  priceMin: string;
  priceMax: string;
  amenities: string[];
  hasPool: boolean;
  hasParking: boolean;
  q: string;
  sort: BrowseSort;
};

export const EMPTY_STAY_BROWSE_FILTERS: StayBrowseFilterState = {
  countryCode: 'OM',
  governorate: '',
  wilayat: '',
  village: '',
  categories: [],
  bedroomsMin: 0,
  bathroomsMin: 0,
  currency: 'OMR',
  priceMin: '',
  priceMax: '',
  amenities: [],
  hasPool: false,
  hasParking: false,
  q: '',
  sort: 'newest',
};

const RECENT_KEY = 'bhd-r-stays-recent-filters';

export type StayRecentFilterChip = {
  id: string;
  labelAr: string;
  labelEn: string;
  patch: Partial<StayBrowseFilterState>;
};

function listingPriceMajor(listing: StayCatalogueListing): number {
  const minor = Number(listing.nightlyMinor ?? 0);
  return minor / 1000;
}

function hasAmenity(listing: StayCatalogueListing, code: string): boolean {
  if (code === 'pool') return Boolean(listing.hasPool) || (listing.amenities ?? []).includes('pool');
  if (code === 'parking') {
    return (listing.parkingSpaces ?? 0) > 0 || (listing.amenities ?? []).includes('parking');
  }
  return (listing.amenities ?? []).includes(code);
}

export function applyStayBrowseFilters(
  items: StayCatalogueListing[],
  filters: StayBrowseFilterState,
): StayCatalogueListing[] {
  const priceMin = filters.priceMin.trim() === '' ? null : Number(filters.priceMin);
  const priceMax = filters.priceMax.trim() === '' ? null : Number(filters.priceMax);
  const q = filters.q.trim().toLowerCase();

  let next = items.filter((listing) => {
    if (filters.categories.length && !filters.categories.includes(listing.category as BrowseCategory)) {
      return false;
    }
    if (filters.bedroomsMin > 0 && listing.bedrooms < filters.bedroomsMin) return false;
    if (filters.bathroomsMin > 0 && listing.bathrooms < filters.bathroomsMin) return false;
    if (filters.currency && listing.currency !== filters.currency) return false;
    if (filters.governorate) {
      const g = filters.governorate.toLowerCase();
      if (!listing.governorate.toLowerCase().includes(g)) return false;
    }
    if (filters.wilayat) {
      const w = filters.wilayat.toLowerCase();
      if (!listing.wilayat.toLowerCase().includes(w)) return false;
    }
    if (filters.village) {
      const v = filters.village.toLowerCase();
      const hayLoc = `${listing.governorate} ${listing.wilayat} ${listing.city ?? ''} ${listing.propertyNameAr} ${listing.propertyNameEn}`.toLowerCase();
      if (!hayLoc.includes(v)) return false;
    }
    if (filters.hasPool && !hasAmenity(listing, 'pool')) return false;
    if (filters.hasParking && !hasAmenity(listing, 'parking')) return false;
    for (const code of filters.amenities) {
      if (!hasAmenity(listing, code)) return false;
    }
    if (priceMin !== null && Number.isFinite(priceMin)) {
      if (listingPriceMajor(listing) < priceMin) return false;
    }
    if (priceMax !== null && Number.isFinite(priceMax)) {
      if (listingPriceMajor(listing) > priceMax) return false;
    }
    if (q) {
      const hay = [
        listing.propertyNameAr,
        listing.propertyNameEn,
        listing.unitNameAr,
        listing.unitNameEn,
        listing.governorate,
        listing.wilayat,
        listing.city ?? '',
        listing.category,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  next = [...next].sort((a, b) => {
    if (filters.sort === 'price_asc') {
      return listingPriceMajor(a) - listingPriceMajor(b);
    }
    if (filters.sort === 'price_desc') {
      return listingPriceMajor(b) - listingPriceMajor(a);
    }
    if (filters.sort === 'beds_desc') {
      return b.bedrooms - a.bedrooms;
    }
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return next;
}

export function countStayAmenity(items: StayCatalogueListing[], code: string): number {
  return items.filter((item) => hasAmenity(item, code)).length;
}

export function countStayCategory(items: StayCatalogueListing[], category: string): number {
  return items.filter((item) => item.category === category).length;
}

export function stayFacetUniverse(
  items: StayCatalogueListing[],
  filters: StayBrowseFilterState,
  omit: Partial<
    Record<'categories' | 'amenities' | 'hasPool' | 'hasParking' | 'bedrooms' | 'bathrooms' | 'price', boolean>
  > = {},
): StayCatalogueListing[] {
  const softened: StayBrowseFilterState = {
    ...filters,
    categories: omit.categories ? [] : filters.categories,
    amenities: omit.amenities ? [] : filters.amenities,
    hasPool: omit.hasPool ? false : filters.hasPool,
    hasParking: omit.hasParking ? false : filters.hasParking,
    bedroomsMin: omit.bedrooms ? 0 : filters.bedroomsMin,
    bathroomsMin: omit.bathrooms ? 0 : filters.bathroomsMin,
    priceMin: omit.price ? '' : filters.priceMin,
    priceMax: omit.price ? '' : filters.priceMax,
  };
  return applyStayBrowseFilters(items, softened);
}

export function stayPriceHistogram(
  items: StayCatalogueListing[],
  bucketCount = 18,
): { min: number; max: number; buckets: number[] } {
  const prices = items.map((item) => listingPriceMajor(item)).filter((n) => n > 0);
  if (!prices.length) return { min: 0, max: 100, buckets: Array(bucketCount).fill(0) };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1);
  const buckets = Array(bucketCount).fill(0) as number[];
  for (const price of prices) {
    const idx = Math.min(bucketCount - 1, Math.floor(((price - min) / span) * bucketCount));
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  return { min: Math.floor(min), max: Math.ceil(max), buckets };
}

export function parseStaySmartFilterQuery(raw: string): Partial<StayBrowseFilterState> {
  const text = raw.trim().toLowerCase();
  if (!text) return {};
  const patch: Partial<StayBrowseFilterState> = {};
  const amenities = new Set<string>();

  if (/فيلا|villa/.test(text)) patch.categories = ['villa'];
  if (/شقة|apartment|flat/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'apartment'] as BrowseCategory[];
  }
  if (/مكتب|office|معرض|showroom/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'office'] as BrowseCategory[];
  }
  if (/محل|shop/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'shop'] as BrowseCategory[];
  }
  if (/مسبح|pool/.test(text)) {
    patch.hasPool = true;
    amenities.add('pool');
  }
  if (/موقف|مواقف|parking/.test(text)) {
    patch.hasParking = true;
    amenities.add('parking');
  }
  if (/واي\s*فاي|wifi|wi-fi|إنترنت|internet/.test(text)) amenities.add('wifi');
  if (/شرفة|balcony/.test(text)) amenities.add('balcony');
  if (/مكيف|تكييف|air\s*cond|ac\b/.test(text)) amenities.add('central_ac');
  if (/مصعد|elevator|lift/.test(text)) amenities.add('elevator');
  if (/حديقة|garden/.test(text)) amenities.add('garden');
  if (/بحر|sea\s*view/.test(text)) amenities.add('sea_view');
  if (/مسقط|muscat/.test(text)) patch.governorate = 'Muscat';

  const beds =
    text.match(/(\d+)\s*(غرف|غرفة|bedrooms?|beds?)/) ??
    text.match(/(غرف|غرفة|bedrooms?)\s*(\d+)/);
  if (beds) {
    const n = Number(beds[1] && /\d/.test(beds[1]) ? beds[1] : beds[2]);
    if (Number.isFinite(n) && n > 0) patch.bedroomsMin = n;
  }
  const baths =
    text.match(/(\d+)\s*(حمام|bathrooms?|baths?)/) ??
    text.match(/(حمام|bathrooms?)\s*(\d+)/);
  if (baths) {
    const n = Number(baths[1] && /\d/.test(baths[1]) ? baths[1] : baths[2]);
    if (Number.isFinite(n) && n > 0) patch.bathroomsMin = n;
  }

  if (amenities.size) patch.amenities = [...amenities];
  if (!patch.q && !Object.keys(patch).length) patch.q = raw.trim();
  else if (!patch.categories && !patch.amenities && !patch.hasPool && !patch.hasParking) {
    patch.q = raw.trim();
  }
  return patch;
}

export function stayFiltersToSearchParams(
  filters: StayBrowseFilterState,
  stayDates?: Record<string, string | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.countryCode) params.set('countryCode', filters.countryCode);
  if (filters.governorate) params.set('governorate', filters.governorate);
  if (filters.wilayat) params.set('wilayat', filters.wilayat);
  if (filters.village) params.set('village', filters.village);
  if (filters.categories.length === 1) params.set('category', filters.categories[0]!);
  if (filters.categories.length > 1) params.set('categories', filters.categories.join(','));
  if (filters.bedroomsMin > 0) params.set('bedroomsMin', String(filters.bedroomsMin));
  if (filters.bathroomsMin > 0) params.set('bathroomsMin', String(filters.bathroomsMin));
  if (filters.currency) params.set('currency', filters.currency);
  if (filters.priceMin) params.set('priceMin', filters.priceMin);
  if (filters.priceMax) params.set('priceMax', filters.priceMax);
  if (filters.hasPool) params.set('hasPool', '1');
  if (filters.hasParking) params.set('hasParking', '1');
  if (filters.amenities.length) params.set('amenities', filters.amenities.join(','));
  if (filters.q) params.set('q', filters.q);
  if (filters.sort !== 'newest') params.set('sort', filters.sort);
  if (stayDates?.destination) params.set('destination', stayDates.destination);
  if (stayDates?.checkInOn) params.set('checkInOn', stayDates.checkInOn);
  if (stayDates?.checkOutOn) params.set('checkOutOn', stayDates.checkOutOn);
  if (stayDates?.adults) params.set('adults', stayDates.adults);
  if (stayDates?.children) params.set('children', stayDates.children);
  return params;
}

export function stayFiltersFromSearchRecord(
  raw: Record<string, string | undefined>,
): StayBrowseFilterState {
  const categoriesRaw = raw.categories ?? raw.category ?? '';
  const categories = categoriesRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is BrowseCategory =>
      (BROWSE_CATEGORIES as readonly string[]).includes(item),
    );
  const bedroomsMin = raw.bedroomsMin ? Number(raw.bedroomsMin) : 0;
  const bathroomsMin = raw.bathroomsMin ? Number(raw.bathroomsMin) : 0;
  const amenities = (raw.amenities ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const sort =
    raw.sort === 'price_asc' || raw.sort === 'price_desc' || raw.sort === 'beds_desc'
      ? raw.sort
      : 'newest';

  return {
    countryCode: raw.countryCode ?? 'OM',
    governorate: raw.governorate ?? raw.destination ?? '',
    wilayat: raw.wilayat ?? '',
    village: raw.village ?? '',
    categories,
    bedroomsMin: Number.isFinite(bedroomsMin) ? bedroomsMin : 0,
    bathroomsMin: Number.isFinite(bathroomsMin) ? bathroomsMin : 0,
    currency: raw.currency ?? 'OMR',
    priceMin: raw.priceMin ?? '',
    priceMax: raw.priceMax ?? '',
    amenities,
    hasPool: raw.hasPool === '1' || raw.hasPool === 'true',
    hasParking: raw.hasParking === '1' || raw.hasParking === 'true',
    q: raw.q ?? '',
    sort,
  };
}

export function loadStayRecentFilters(): StayRecentFilterChip[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StayRecentFilterChip[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushStayRecentFilter(chip: StayRecentFilterChip): StayRecentFilterChip[] {
  if (typeof window === 'undefined') return [];
  const prev = loadStayRecentFilters().filter((item) => item.id !== chip.id);
  const next = [chip, ...prev].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function stayAsCardListing(listing: StayCatalogueListing) {
  return {
    unitCode: listing.unitCode,
    unitNameAr: listing.unitNameAr,
    unitNameEn: listing.unitNameEn,
    propertyNameAr: listing.propertyNameAr,
    propertyNameEn: listing.propertyNameEn,
    propertyKind: listing.propertyKind,
    governorate: listing.governorate,
    wilayat: listing.wilayat,
    city: listing.city ?? '',
    area: listing.area ?? null,
    street: listing.street ?? null,
    unitSerial: listing.unitSerial,
    category: listing.category,
  };
}

export function stayDetailHref(
  listing: StayCatalogueListing,
  stayDates?: Record<string, string | undefined>,
): string {
  const qs = new URLSearchParams();
  if (listing.unitId) qs.set('unit', listing.unitId);
  if (stayDates?.checkInOn) qs.set('checkInOn', stayDates.checkInOn);
  if (stayDates?.checkOutOn) qs.set('checkOutOn', stayDates.checkOutOn);
  if (stayDates?.adults) qs.set('adults', stayDates.adults);
  if (stayDates?.children) qs.set('children', stayDates.children);
  const suffix = qs.toString();
  return `/stays/${encodeURIComponent(listing.slug)}${suffix ? `?${suffix}` : ''}`;
}
