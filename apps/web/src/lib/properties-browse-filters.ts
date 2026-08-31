import type { CatalogueListing } from '@/lib/listing-market-status';

export const BROWSE_CATEGORIES = [
  'apartment',
  'villa',
  'building',
  'office',
  'shop',
  'warehouse',
  'land',
] as const;

export type BrowseCategory = (typeof BROWSE_CATEGORIES)[number];

export const BROWSE_AMENITIES = [
  { code: 'parking', ar: 'موقف سيارات', en: 'Parking' },
  { code: 'pool', ar: 'مسبح', en: 'Pool' },
  { code: 'wifi', ar: 'واي فاي', en: 'Wi‑Fi' },
  { code: 'gym', ar: 'نادي صحي', en: 'Gym' },
  { code: 'elevator', ar: 'مصعد', en: 'Elevator' },
  { code: 'security', ar: 'حراسة', en: 'Security' },
  { code: 'garden', ar: 'حديقة', en: 'Garden' },
  { code: 'central_ac', ar: 'مكيف هواء', en: 'Air conditioning' },
  { code: 'balcony', ar: 'شرفة', en: 'Balcony' },
  { code: 'sea_view', ar: 'إطلالة على البحر', en: 'Sea view' },
  { code: 'kids_area', ar: 'ملعب للأطفال', en: 'Kids area' },
  { code: 'accessible', ar: 'مناسب لذوي الاحتياجات', en: 'Accessible' },
  { code: 'laundry', ar: 'غسيل ملابس', en: 'Laundry' },
  { code: 'storage', ar: 'مخزن', en: 'Storage' },
  { code: 'cctv', ar: 'كاميرات مراقبة', en: 'CCTV' },
] as const;

export const POPULAR_FILTER_KEYS = [
  'villa',
  'apartment',
  'pool',
  'parking',
  'wifi',
  'balcony',
] as const;

export type BrowseSort = 'newest' | 'price_asc' | 'price_desc' | 'beds_desc';

export type BrowseFilterState = {
  purpose: '' | 'rent' | 'sale';
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

export const EMPTY_BROWSE_FILTERS: BrowseFilterState = {
  purpose: '',
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

const RECENT_KEY = 'bhd-r-props-recent-filters';

export type RecentFilterChip = {
  id: string;
  labelAr: string;
  labelEn: string;
  patch: Partial<BrowseFilterState>;
};

function listingPriceMajor(listing: CatalogueListing, purpose: '' | 'rent' | 'sale'): number {
  const useSale =
    purpose === 'sale' ||
    (purpose === '' && listing.listingPurpose === 'sale' && listing.salePrice);
  const minor = useSale
    ? Number(listing.salePrice?.amountMinor ?? 0)
    : Number(listing.rent.amountMinor ?? 0);
  return minor / 1000;
}

function hasAmenity(listing: CatalogueListing, code: string): boolean {
  if (code === 'pool') return Boolean(listing.hasPool) || (listing.amenities ?? []).includes('pool');
  if (code === 'parking') {
    return (listing.parkingSpaces ?? 0) > 0 || (listing.amenities ?? []).includes('parking');
  }
  return (listing.amenities ?? []).includes(code);
}

export function applyBrowseFilters(
  items: CatalogueListing[],
  filters: BrowseFilterState,
): CatalogueListing[] {
  const priceMin = filters.priceMin.trim() === '' ? null : Number(filters.priceMin);
  const priceMax = filters.priceMax.trim() === '' ? null : Number(filters.priceMax);
  const q = filters.q.trim().toLowerCase();

  let next = items.filter((listing) => {
    if (filters.purpose === 'rent' && !['rent', 'both'].includes(listing.listingPurpose)) {
      return false;
    }
    if (filters.purpose === 'sale' && !['sale', 'both'].includes(listing.listingPurpose)) {
      return false;
    }
    if (filters.categories.length && !filters.categories.includes(listing.category as BrowseCategory)) {
      return false;
    }
    if (filters.bedroomsMin > 0 && listing.bedrooms < filters.bedroomsMin) return false;
    if (filters.bathroomsMin > 0 && listing.bathrooms < filters.bathroomsMin) return false;
    if (filters.currency && listing.rent.currency !== filters.currency) return false;
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
      if (listingPriceMajor(listing, filters.purpose) < priceMin) return false;
    }
    if (priceMax !== null && Number.isFinite(priceMax)) {
      if (listingPriceMajor(listing, filters.purpose) > priceMax) return false;
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
      return listingPriceMajor(a, filters.purpose) - listingPriceMajor(b, filters.purpose);
    }
    if (filters.sort === 'price_desc') {
      return listingPriceMajor(b, filters.purpose) - listingPriceMajor(a, filters.purpose);
    }
    if (filters.sort === 'beds_desc') {
      return b.bedrooms - a.bedrooms;
    }
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return next;
}

export function countAmenity(items: CatalogueListing[], code: string): number {
  return items.filter((item) => hasAmenity(item, code)).length;
}

export function countCategory(items: CatalogueListing[], category: string): number {
  return items.filter((item) => item.category === category).length;
}

/** Facet counts ignore the dimension being counted (Booking-style). */
export function facetUniverse(
  items: CatalogueListing[],
  filters: BrowseFilterState,
  omit: Partial<Record<'categories' | 'amenities' | 'hasPool' | 'hasParking' | 'bedrooms' | 'bathrooms' | 'price', boolean>> = {},
): CatalogueListing[] {
  const softened: BrowseFilterState = {
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
  return applyBrowseFilters(items, softened);
}

export function priceHistogram(
  items: CatalogueListing[],
  purpose: '' | 'rent' | 'sale',
  bucketCount = 18,
): { min: number; max: number; buckets: number[] } {
  const prices = items.map((item) => listingPriceMajor(item, purpose)).filter((n) => n > 0);
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

export function parseSmartFilterQuery(raw: string): Partial<BrowseFilterState> {
  const text = raw.trim().toLowerCase();
  if (!text) return {};
  const patch: Partial<BrowseFilterState> = {};
  const amenities = new Set<string>();

  if (/فيلا|villa/.test(text)) patch.categories = ['villa'];
  if (/شقة|apartment|flat/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'apartment'] as BrowseCategory[];
  }
  if (/مكتب|office/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'office'] as BrowseCategory[];
  }
  if (/أرض|land/.test(text)) {
    patch.categories = [...(patch.categories ?? []), 'land'] as BrowseCategory[];
  }
  if (/إيجار|للايجار|rent/.test(text)) patch.purpose = 'rent';
  if (/بيع|للبيع|sale/.test(text)) patch.purpose = 'sale';
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
  if (/أطفال|kids|children/.test(text)) amenities.add('kids_area');
  if (/إعاقة|accessible|wheelchair|ذوي/.test(text)) amenities.add('accessible');

  const beds = text.match(/(\d+)\s*(غرف|غرفة|bedrooms?|beds?)/) ?? text.match(/(غرف|غرفة|bedrooms?)\s*(\d+)/);
  if (beds) {
    const n = Number(beds[1] && /\d/.test(beds[1]) ? beds[1] : beds[2]);
    if (Number.isFinite(n) && n > 0) patch.bedroomsMin = n;
  }
  const baths = text.match(/(\d+)\s*(حمام|bathrooms?|baths?)/) ?? text.match(/(حمام|bathrooms?)\s*(\d+)/);
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

export function filtersToSearchParams(filters: BrowseFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.purpose) params.set('purpose', filters.purpose);
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
  return params;
}

export function filtersFromSearchRecord(
  raw: Record<string, string | undefined>,
): BrowseFilterState {
  const purpose = raw.purpose === 'rent' || raw.purpose === 'sale' ? raw.purpose : '';
  const categoriesRaw = raw.categories ?? raw.category ?? '';
  const categories = categoriesRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is BrowseCategory =>
      (BROWSE_CATEGORIES as readonly string[]).includes(item),
    );
  const bedroomsLegacy = raw.bedrooms ? Number(raw.bedrooms) : 0;
  const bedroomsMin = raw.bedroomsMin
    ? Number(raw.bedroomsMin)
    : Number.isFinite(bedroomsLegacy) && bedroomsLegacy > 0
      ? bedroomsLegacy
      : 0;
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
    purpose,
    countryCode: raw.countryCode ?? 'OM',
    governorate: raw.governorate ?? '',
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

export function loadRecentFilters(): RecentFilterChip[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentFilterChip[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushRecentFilter(chip: RecentFilterChip): RecentFilterChip[] {
  if (typeof window === 'undefined') return [];
  const prev = loadRecentFilters().filter((item) => item.id !== chip.id);
  const next = [chip, ...prev].slice(0, 8);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}

export function categoryLabel(category: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    apartment: ['شقق', 'Apartments'],
    villa: ['فيلات', 'Villas'],
    building: ['مبانٍ', 'Buildings'],
    office: ['مكاتب', 'Offices'],
    shop: ['محلات', 'Shops'],
    warehouse: ['مستودعات', 'Warehouses'],
    land: ['أراضٍ', 'Land'],
    other: ['أخرى', 'Other'],
  };
  const hit = map[category];
  return hit ? (ar ? hit[0] : hit[1]) : category;
}

export function mapSearchUrl(filters: BrowseFilterState, locale: string): string {
  const parts = [
    filters.village,
    filters.wilayat,
    filters.governorate,
    filters.countryCode === 'OM' ? (locale === 'ar' ? 'عمان' : 'Oman') : filters.countryCode,
  ].filter(Boolean);
  const query = parts.join(' ') || (locale === 'ar' ? 'مسقط عمان' : 'Muscat Oman');
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}
