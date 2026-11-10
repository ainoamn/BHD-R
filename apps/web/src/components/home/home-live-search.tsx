'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { ListingCatalogueCard } from '@/components/listing-catalogue-card';
import { StayCatalogueCard } from '@/components/stays/stay-catalogue-card';
import type { CatalogueListing } from '@/lib/listing-market-status';
import {
  applyBrowseFilters,
  EMPTY_BROWSE_FILTERS,
  type BrowseCategory,
} from '@/lib/properties-browse-filters';
import {
  applyStayBrowseFilters,
  EMPTY_STAY_BROWSE_FILTERS,
} from '@/lib/stays-browse-filters';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';

export type HomeLiveStayQuery = {
  kind: 'stay';
  destination: string;
  checkInOn: string;
  checkOutOn: string;
  adults: string;
  children: string;
};

export type HomeLivePropertyQuery = {
  kind: 'property';
  purpose: 'rent' | 'sale';
  countryCode?: string;
  governorate?: string;
  category?: string;
  bedrooms?: string;
  currency?: string;
};

export type HomeLiveQuery = HomeLiveStayQuery | HomeLivePropertyQuery;

type HomeLiveSearchContextValue = {
  locale: string;
  query: HomeLiveQuery | null;
  setQuery: (next: HomeLiveQuery | null) => void;
  clearQuery: () => void;
  listingsUniverse: CatalogueListing[];
  staysUniverse: StayCatalogueListing[];
  seedCatalogues: (input: {
    listings?: CatalogueListing[];
    stays?: StayCatalogueListing[];
  }) => void;
};

const HomeLiveSearchContext = createContext<HomeLiveSearchContextValue | null>(null);

export function useHomeLiveSearch(): HomeLiveSearchContextValue | null {
  return useContext(HomeLiveSearchContext);
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (!incoming.length) return current;
  if (!current.length) return incoming;
  const map = new Map<string, T>();
  for (const row of current) map.set(row.id, row);
  let grew = false;
  for (const row of incoming) {
    if (!map.has(row.id)) grew = true;
    map.set(row.id, row);
  }
  if (!grew && map.size === current.length) return current;
  return [...map.values()];
}

async function fetchJsonData<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const payload = (await res.json()) as { data?: T[] };
  return payload.data ?? [];
}

export function HomeLiveSearchProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const [query, setQueryState] = useState<HomeLiveQuery | null>(null);
  const [listingsUniverse, setListingsUniverse] = useState<CatalogueListing[]>([]);
  const [staysUniverse, setStaysUniverse] = useState<StayCatalogueListing[]>([]);

  const setQuery = useCallback((next: HomeLiveQuery | null) => {
    setQueryState(next);
  }, []);
  const clearQuery = useCallback(() => setQueryState(null), []);

  const seedCatalogues = useCallback(
    (input: { listings?: CatalogueListing[]; stays?: StayCatalogueListing[] }) => {
      if (input.listings?.length) {
        setListingsUniverse((prev) => mergeById(prev, input.listings!));
      }
      if (input.stays?.length) {
        setStaysUniverse((prev) => mergeById(prev, input.stays!));
      }
    },
    [],
  );

  // Warm the full catalogues once in the background so filters are instant.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [listings, stays] = await Promise.all([
          fetchJsonData<CatalogueListing>(
            '/api/public/catalogue?limit=100&countryCode=OM',
            controller.signal,
          ),
          fetchJsonData<StayCatalogueListing>(
            '/api/public/stays/catalogue?limit=100&countryCode=OM',
            controller.signal,
          ),
        ]);
        if (controller.signal.aborted) return;
        if (listings.length) setListingsUniverse((prev) => mergeById(prev, listings));
        if (stays.length) setStaysUniverse((prev) => mergeById(prev, stays));
      } catch {
        /* keep seeded SSR rows */
      }
    })();
    return () => controller.abort();
  }, []);

  const value = useMemo(
    () => ({
      locale,
      query,
      setQuery,
      clearQuery,
      listingsUniverse,
      staysUniverse,
      seedCatalogues,
    }),
    [
      locale,
      query,
      setQuery,
      clearQuery,
      listingsUniverse,
      staysUniverse,
      seedCatalogues,
    ],
  );

  return <HomeLiveSearchContext.Provider value={value}>{children}</HomeLiveSearchContext.Provider>;
}

function filterListings(
  universe: CatalogueListing[],
  query: HomeLivePropertyQuery,
): CatalogueListing[] {
  const bedrooms = query.bedrooms ? Number(query.bedrooms) : 0;
  return applyBrowseFilters(universe, {
    ...EMPTY_BROWSE_FILTERS,
    purpose: query.purpose,
    countryCode: query.countryCode || 'OM',
    governorate: query.governorate || '',
    currency: query.currency || '',
    bedroomsMin: Number.isFinite(bedrooms) ? bedrooms : 0,
    categories: query.category ? [query.category as BrowseCategory] : [],
  });
}

function filterStays(
  universe: StayCatalogueListing[],
  query: HomeLiveStayQuery,
): StayCatalogueListing[] {
  return applyStayBrowseFilters(universe, {
    ...EMPTY_STAY_BROWSE_FILTERS,
    countryCode: 'OM',
    governorate: query.destination || '',
    currency: '',
  });
}

/**
 * Featured units on home — same DOM when filtering; swaps rows from the
 * prefetched universe with no network round-trip and no skeleton flash.
 */
export function HomeFeaturedPanel({
  locale,
  rent,
  sale,
  stays,
  showStays,
}: {
  locale: string;
  rent: CatalogueListing[];
  sale: CatalogueListing[];
  stays: StayCatalogueListing[];
  showStays: boolean;
}) {
  const live = useHomeLiveSearch();
  const ar = locale !== 'en';
  const query = live?.query ?? null;

  const seedCatalogues = live?.seedCatalogues;
  useEffect(() => {
    seedCatalogues?.({
      listings: [...rent, ...sale],
      stays,
    });
  }, [seedCatalogues, rent, sale, stays]);

  const filteredListings = useMemo(() => {
    if (!query || query.kind !== 'property' || !live) return null;
    return filterListings(live.listingsUniverse, query).slice(0, 24);
  }, [query, live]);

  const filteredStays = useMemo(() => {
    if (!query || query.kind !== 'stay' || !live) return null;
    return filterStays(live.staysUniverse, query).slice(0, 24);
  }, [query, live]);

  const stayDates =
    query?.kind === 'stay'
      ? {
          checkInOn: query.checkInOn,
          checkOutOn: query.checkOutOn,
          adults: query.adults,
          children: query.children,
        }
      : undefined;

  if (query?.kind === 'property' && filteredListings) {
    const title =
      query.purpose === 'sale'
        ? ar
          ? 'نتائج البيع'
          : 'Sale results'
        : ar
          ? 'نتائج الإيجار'
          : 'Rent results';
    const params = new URLSearchParams({ purpose: query.purpose });
    if (query.countryCode) params.set('countryCode', query.countryCode);
    if (query.governorate) params.set('governorate', query.governorate);
    if (query.category) params.set('category', query.category);
    if (query.bedrooms) params.set('bedrooms', query.bedrooms);
    if (query.currency) params.set('currency', query.currency);
    return (
      <FilteredSection
        locale={locale}
        title={title}
        count={filteredListings.length}
        browseHref={`/properties?${params}`}
        onClear={() => live?.clearQuery()}
      >
        {filteredListings.map((listing) => (
          <ListingCatalogueCard key={listing.id} listing={listing} locale={locale} />
        ))}
      </FilteredSection>
    );
  }

  if (query?.kind === 'stay' && filteredStays) {
    const params = new URLSearchParams();
    if (query.destination) params.set('destination', query.destination);
    params.set('checkInOn', query.checkInOn);
    params.set('checkOutOn', query.checkOutOn);
    params.set('adults', query.adults);
    params.set('children', query.children);
    return (
      <FilteredSection
        locale={locale}
        title={ar ? 'نتائج الإقامة اليومية' : 'Daily stay results'}
        count={filteredStays.length}
        browseHref={`/stays?${params}`}
        onClear={() => live?.clearQuery()}
      >
        {filteredStays.map((listing) => (
          <StayCatalogueCard
            key={listing.id}
            listing={listing}
            locale={locale}
            compact
            {...(stayDates ? { stayDates } : {})}
          />
        ))}
      </FilteredSection>
    );
  }

  const strips = [
    {
      key: 'rent' as const,
      titleAr: 'للإيجار',
      titleEn: 'For rent',
      hintAr: 'عقود شهرية وسنوية من الوحدات المتاحة الآن.',
      hintEn: 'Monthly and yearly leases from units available now.',
      href: '/properties?purpose=rent',
      listings: rent,
    },
    {
      key: 'sale' as const,
      titleAr: 'للبيع',
      titleEn: 'For sale',
      hintAr: 'عقارات معروضة للتملك مباشرة.',
      hintEn: 'Properties listed for purchase.',
      href: '/properties?purpose=sale',
      listings: sale,
    },
    ...(showStays
      ? [
          {
            key: 'stay' as const,
            titleAr: 'إقامة يومية',
            titleEn: 'Daily stays',
            hintAr: 'وحدات جاهزة للحجز بالليلة.',
            hintEn: 'Units ready for nightly booking.',
            href: '/stays',
            stays,
          },
        ]
      : []),
  ];

  const anyRows = strips.some(
    (strip) =>
      ('listings' in strip && (strip.listings?.length ?? 0) > 0) ||
      ('stays' in strip && ((strip as { stays?: StayCatalogueListing[] }).stays?.length ?? 0) > 0),
  );

  return (
    <section className="home-section home-featured" aria-labelledby="featured-title">
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">{ar ? 'متاح الآن' : 'Available now'}</span>
            <h2 id="featured-title">{ar ? 'وحدات مختارة' : 'Featured units'}</h2>
            <p>
              {ar
                ? 'نعرض الإيجار والبيع والإقامة اليومية كلٌّ في مساره.'
                : 'Rent, sale and daily stays each get their own lane.'}
            </p>
          </div>
          <Link className="home-head__link" href="/properties">
            {ar ? 'عرض الكل' : 'View all'}
          </Link>
        </header>

        {!anyRows ? (
          <EmptyState
            title={ar ? 'لا توجد وحدات منشورة حالياً' : 'No published units yet'}
            description={
              ar
                ? 'نظهر هنا فقط الوحدات المنشورة والمتاحة فعلياً.'
                : 'Only published, actually available units appear here.'
            }
          />
        ) : (
          <div className="home-featured__strips">
            {strips.map((strip) => {
              const listingRows = 'listings' in strip ? strip.listings ?? [] : [];
              const stayRows = 'stays' in strip ? strip.stays ?? [] : [];
              if (!listingRows.length && !stayRows.length) return null;
              return (
                <div key={strip.key} className="home-featured__strip">
                  <header className="home-featured__strip-head">
                    <div>
                      <h3>{ar ? strip.titleAr : strip.titleEn}</h3>
                      <p>{ar ? strip.hintAr : strip.hintEn}</p>
                    </div>
                    <Link className="home-head__link" href={strip.href} prefetch={false}>
                      {ar ? 'المزيد' : 'More'}
                    </Link>
                  </header>
                  <div className="listing-grid home-listings">
                    {listingRows.map((listing) => (
                      <ListingCatalogueCard key={listing.id} listing={listing} locale={locale} />
                    ))}
                    {stayRows.map((listing) => (
                      <StayCatalogueCard
                        key={listing.id}
                        listing={listing}
                        locale={locale}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FilteredSection({
  locale,
  title,
  count,
  browseHref,
  onClear,
  children,
}: {
  locale: string;
  title: string;
  count: number;
  browseHref: string;
  onClear: () => void;
  children: ReactNode;
}) {
  const ar = locale !== 'en';
  return (
    <section className="home-section home-featured home-live-results" aria-live="polite">
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">{ar ? 'تصفية فورية' : 'Instant filter'}</span>
            <h2>{title}</h2>
            <p>
              {ar
                ? count
                  ? `${count} نتيجة من البيانات المحمّلة.`
                  : 'لا توجد نتائج مطابقة حالياً.'
                : count
                  ? `${count} result${count === 1 ? '' : 's'} from loaded data.`
                  : 'No matching results right now.'}
            </p>
          </div>
          <div className="home-live-results__actions">
            <button type="button" className="home-head__link" onClick={onClear}>
              {ar ? 'مسح التصفية' : 'Clear filter'}
            </button>
            <Link className="home-head__link" href={browseHref} prefetch={false}>
              {ar ? 'عرض الكل' : 'View all'}
            </Link>
          </div>
        </header>
        {count ? <div className="listing-grid home-listings">{children}</div> : null}
      </div>
    </section>
  );
}
