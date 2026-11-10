'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from '@/i18n/navigation';
import { ListingCatalogueCard } from '@/components/listing-catalogue-card';
import { StayCatalogueCard } from '@/components/stays/stay-catalogue-card';
import type { CatalogueListing } from '@/lib/listing-market-status';
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
};

const HomeLiveSearchContext = createContext<HomeLiveSearchContextValue | null>(null);

export function useHomeLiveSearch(): HomeLiveSearchContextValue | null {
  return useContext(HomeLiveSearchContext);
}

export function HomeLiveSearchProvider({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const [query, setQueryState] = useState<HomeLiveQuery | null>(null);
  const setQuery = useCallback((next: HomeLiveQuery | null) => {
    setQueryState(next);
  }, []);
  const clearQuery = useCallback(() => setQueryState(null), []);
  const value = useMemo(
    () => ({ locale, query, setQuery, clearQuery }),
    [locale, query, setQuery, clearQuery],
  );

  return <HomeLiveSearchContext.Provider value={value}>{children}</HomeLiveSearchContext.Provider>;
}

/** Hides SSR featured strips while a live home search is active (keeps them mounted). */
export function HomeFeaturedGate({ children }: { children: ReactNode }) {
  const live = useHomeLiveSearch();
  const active = Boolean(live?.query);
  return (
    <div hidden={active} aria-hidden={active}>
      {children}
    </div>
  );
}

function queryKey(query: HomeLiveQuery): string {
  return JSON.stringify(query);
}

export function HomeLiveResults() {
  const live = useHomeLiveSearch();
  const locale = live?.locale ?? 'ar';
  const ar = locale !== 'en';
  const query = live?.query ?? null;
  const sectionRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(false);
  const [stays, setStays] = useState<StayCatalogueListing[]>([]);
  const [listings, setListings] = useState<CatalogueListing[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setStays([]);
      setListings([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    async function load() {
      try {
        if (query!.kind === 'stay') {
          const params = new URLSearchParams({ limit: '24' });
          if (query!.destination) params.set('governorate', query!.destination);
          const res = await fetch(`/api/public/stays/catalogue?${params}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`stays_${res.status}`);
          const payload = (await res.json()) as { data?: StayCatalogueListing[] };
          if (controller.signal.aborted) return;
          setStays(payload.data ?? []);
          setListings([]);
        } else {
          const params = new URLSearchParams({
            purpose: query!.purpose,
            limit: '24',
          });
          if (query!.countryCode) params.set('countryCode', query!.countryCode);
          if (query!.governorate) params.set('governorate', query!.governorate);
          if (query!.category) params.set('category', query!.category);
          if (query!.bedrooms) params.set('bedrooms', query!.bedrooms);
          if (query!.currency) params.set('currency', query!.currency);
          const res = await fetch(`/api/public/catalogue?${params}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`catalogue_${res.status}`);
          const payload = (await res.json()) as { data?: CatalogueListing[] };
          if (controller.signal.aborted) return;
          setListings(payload.data ?? []);
          setStays([]);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(ar ? 'تعذّر تحميل النتائج الآن.' : 'Could not load results right now.');
        setStays([]);
        setListings([]);
        void err;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures query identity
  }, [query ? queryKey(query) : '', ar]);

  useEffect(() => {
    if (!query || !sectionRef.current) return;
    sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query ? queryKey(query) : '']);

  if (!live || !query) return null;

  const count = query.kind === 'stay' ? stays.length : listings.length;
  const title =
    query.kind === 'stay'
      ? ar
        ? 'نتائج الإقامة اليومية'
        : 'Daily stay results'
      : query.purpose === 'sale'
        ? ar
          ? 'نتائج البيع'
          : 'Sale results'
        : ar
          ? 'نتائج الإيجار'
          : 'Rent results';

  const browseHref =
    query.kind === 'stay'
      ? (() => {
          const params = new URLSearchParams();
          if (query.destination) params.set('destination', query.destination);
          params.set('checkInOn', query.checkInOn);
          params.set('checkOutOn', query.checkOutOn);
          params.set('adults', query.adults);
          params.set('children', query.children);
          return `/stays?${params}`;
        })()
      : (() => {
          const params = new URLSearchParams({ purpose: query.purpose });
          if (query.countryCode) params.set('countryCode', query.countryCode);
          if (query.governorate) params.set('governorate', query.governorate);
          if (query.category) params.set('category', query.category);
          if (query.bedrooms) params.set('bedrooms', query.bedrooms);
          if (query.currency) params.set('currency', query.currency);
          return `/properties?${params}`;
        })();

  const stayDates =
    query.kind === 'stay'
      ? {
          checkInOn: query.checkInOn,
          checkOutOn: query.checkOutOn,
          adults: query.adults,
          children: query.children,
        }
      : undefined;

  return (
    <section
      ref={sectionRef}
      className="home-section home-live-results"
      aria-busy={loading}
      aria-live="polite"
    >
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">{ar ? 'نتائج مباشرة' : 'Live results'}</span>
            <h2>{title}</h2>
            <p>
              {loading
                ? ar
                  ? 'جاري التصفية…'
                  : 'Filtering…'
                : error
                  ? error
                  : ar
                    ? count
                      ? `${count} نتيجة على الصفحة الرئيسية.`
                      : 'لا توجد نتائج مطابقة حالياً.'
                    : count
                      ? `${count} result${count === 1 ? '' : 's'} on the home page.`
                      : 'No matching results right now.'}
            </p>
          </div>
          <div className="home-live-results__actions">
            <button type="button" className="home-head__link" onClick={() => live.clearQuery()}>
              {ar ? 'مسح التصفية' : 'Clear filter'}
            </button>
            <Link className="home-head__link" href={browseHref} prefetch={false}>
              {ar ? 'عرض الكل' : 'View all'}
            </Link>
          </div>
        </header>

        {loading ? (
          <div className="listing-grid home-listings home-live-results__skeleton" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="home-live-results__skel-card" />
            ))}
          </div>
        ) : null}

        {!loading && !error && query.kind === 'stay' && stays.length ? (
          <div className="listing-grid home-listings">
            {stays.map((listing) => (
              <StayCatalogueCard
                key={listing.id}
                listing={listing}
                locale={locale}
                compact
                {...(stayDates ? { stayDates } : {})}
              />
            ))}
          </div>
        ) : null}

        {!loading && !error && query.kind === 'property' && listings.length ? (
          <div className="listing-grid home-listings">
            {listings.map((listing) => (
              <ListingCatalogueCard key={listing.id} listing={listing} locale={locale} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
