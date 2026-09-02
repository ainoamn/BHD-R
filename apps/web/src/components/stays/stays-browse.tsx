'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { supportedCurrencyCodes } from '@bhd-r/contracts';
import { countryPacks } from '@bhd-r/country-packs';
import { EmptyState } from '@bhd-r/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { CatalogueListing } from '@/lib/listing-market-status';
import { omanLocations } from '@/lib/oman-locations';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import {
  BROWSE_AMENITIES,
  BROWSE_CATEGORIES,
  type BrowseSort,
  applyStayBrowseFilters,
  categoryLabel,
  countStayAmenity,
  countStayCategory,
  loadStayRecentFilters,
  parseStaySmartFilterQuery,
  pushStayRecentFilter,
  stayFacetUniverse,
  stayFiltersToSearchParams,
  stayPriceHistogram,
  type StayBrowseFilterState,
  type StayRecentFilterChip,
} from '@/lib/stays-browse-filters';
import { PropertiesMapPanel } from '@/components/properties-map-panel';
import { StayCatalogueCard } from '@/components/stays/stay-catalogue-card';
import { StayResultRow } from '@/components/stays/stay-result-row';
import { StaysListingsTable } from '@/components/stays/stays-listings-table';

type BrowseViewMode = 'list' | 'grid' | 'table';
const VIEW_STORAGE_KEY = 'bhd-r-stays-view';

function parseViewMode(raw: string | null): BrowseViewMode {
  if (raw === 'grid' || raw === 'table' || raw === 'list') return raw;
  return 'list';
}

function stayToMapListing(listing: StayCatalogueListing): CatalogueListing {
  const base: CatalogueListing = {
    id: listing.id,
    slug: listing.slug,
    propertyId: listing.propertyId,
    unitId: listing.unitId,
    propertyNameAr: listing.propertyNameAr,
    propertyNameEn: listing.propertyNameEn,
    unitNameAr: listing.unitNameAr,
    unitNameEn: listing.unitNameEn,
    category: listing.category,
    governorate: listing.governorate,
    wilayat: listing.wilayat,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    areaSquareMeters:
      listing.areaSquareMeters != null ? String(listing.areaSquareMeters) : null,
    listingPurpose: 'rent',
    rent: {
      amountMinor: listing.nightlyMinor ?? '0',
      currency: listing.currency as CatalogueListing['rent']['currency'],
    },
    salePrice: null,
    coverImageUrl: listing.coverImageUrl,
    available: true,
    publishedAt: listing.publishedAt,
    marketStatus: 'available_rent',
    city: listing.city ?? '',
  };
  if (listing.hasPool != null) base.hasPool = listing.hasPool;
  if (listing.parkingSpaces != null) base.parkingSpaces = listing.parkingSpaces;
  if (listing.amenities) base.amenities = listing.amenities;
  if (listing.area != null) base.area = listing.area;
  if (listing.street != null) base.street = listing.street;
  if (listing.latitude != null) base.latitude = listing.latitude;
  if (listing.longitude != null) base.longitude = listing.longitude;
  if (listing.mapsUrl != null) base.mapsUrl = listing.mapsUrl;
  if (listing.propertyKind != null) base.propertyKind = listing.propertyKind;
  if (listing.unitCode != null) base.unitCode = listing.unitCode;
  if (listing.unitSerial != null) base.unitSerial = listing.unitSerial;
  return base;
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="props-stepper">
      <span className="props-stepper__label">{label}</span>
      <div className="props-stepper__controls">
        <button
          type="button"
          className="props-stepper__btn"
          aria-label="-"
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </button>
        <span className="props-stepper__value">{value}</span>
        <button
          type="button"
          className="props-stepper__btn"
          aria-label="+"
          disabled={value >= 10}
          onClick={() => onChange(Math.min(10, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function FilterCheckbox({
  checked,
  label,
  count,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  count: number;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={disabled && !checked ? 'props-check is-muted' : 'props-check'}>
      <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={onChange} />
      <span className="props-check__label">{label}</span>
      <span className="props-check__count">{count}</span>
    </label>
  );
}

export function StaysBrowse({
  locale,
  heading,
  hint,
  initialFilters,
  initialListings,
  stayDates,
  searchBar,
}: {
  locale: string;
  heading: string;
  hint: string;
  initialFilters: StayBrowseFilterState;
  initialListings: StayCatalogueListing[];
  stayDates?: Record<string, string | undefined>;
  searchBar?: ReactNode;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<StayBrowseFilterState>(initialFilters);
  const [universe, setUniverse] = useState<StayCatalogueListing[]>(initialListings);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [viewMode, setViewMode] = useState<BrowseViewMode>('list');
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false);
  const [smartDraft, setSmartDraft] = useState('');
  const [recent, setRecent] = useState<StayRecentFilterChip[]>([]);
  const [loadingUniverse, setLoadingUniverse] = useState(false);
  const [, startTransition] = useTransition();
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRecent(loadStayRecentFilters());
    try {
      setViewMode(parseViewMode(window.localStorage.getItem(VIEW_STORAGE_KEY)));
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('map') === '1' || window.location.hash === '#map_opened') {
        setMapOpen(true);
      }
    }
  }, []);

  function changeViewMode(next: BrowseViewMode) {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadingUniverse(true);
    const params = new URLSearchParams({ limit: '100' });
    if (filters.countryCode) params.set('countryCode', filters.countryCode);
    fetch(`/api/public/stays/catalogue?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { data?: StayCatalogueListing[] };
      })
      .then((payload) => {
        if (cancelled || !payload?.data?.length) return;
        setUniverse(payload.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingUniverse(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.countryCode]);

  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const qs = stayFiltersToSearchParams(filters, stayDates).toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    }, 220);
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, [filters, pathname, router, stayDates]);

  const results = useMemo(() => applyStayBrowseFilters(universe, filters), [universe, filters]);
  const mapListings = useMemo(() => results.map(stayToMapListing), [results]);
  const typeUniverse = useMemo(
    () => stayFacetUniverse(universe, filters, { categories: true }),
    [universe, filters],
  );
  const amenityUniverse = useMemo(
    () => stayFacetUniverse(universe, filters, { amenities: true, hasPool: true, hasParking: true }),
    [universe, filters],
  );
  const priceUniverse = useMemo(
    () => stayFacetUniverse(universe, filters, { price: true }),
    [universe, filters],
  );
  const hist = useMemo(() => stayPriceHistogram(priceUniverse), [priceUniverse]);

  const selectedGov = useMemo(
    () =>
      omanLocations.find(
        (item) => item.en === filters.governorate || item.ar === filters.governorate,
      ) ?? null,
    [filters.governorate],
  );
  const selectedState = useMemo(() => {
    if (!selectedGov) return null;
    return (
      selectedGov.states.find(
        (state) => state.en === filters.wilayat || state.ar === filters.wilayat,
      ) ?? null
    );
  }, [selectedGov, filters.wilayat]);

  const patch = (partial: Partial<StayBrowseFilterState>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  };

  const toggleCategory = (category: (typeof BROWSE_CATEGORIES)[number]) => {
    setFilters((prev) => {
      const has = prev.categories.includes(category);
      const categories = has
        ? prev.categories.filter((item) => item !== category)
        : [...prev.categories, category];
      return { ...prev, categories };
    });
  };

  const toggleAmenity = (code: string) => {
    setFilters((prev) => {
      const has = prev.amenities.includes(code);
      const amenities = has
        ? prev.amenities.filter((item) => item !== code)
        : [...prev.amenities, code];
      const next = { ...prev, amenities };
      if (code === 'pool') next.hasPool = !has;
      if (code === 'parking') next.hasParking = !has;
      const meta = BROWSE_AMENITIES.find((item) => item.code === code);
      if (meta && !has) {
        setRecent(
          pushStayRecentFilter({
            id: `amenity:${code}`,
            labelAr: meta.ar,
            labelEn: meta.en,
            patch: {
              amenities: [...amenities],
              hasPool: code === 'pool' ? true : prev.hasPool,
              hasParking: code === 'parking' ? true : prev.hasParking,
            },
          }),
        );
      }
      return next;
    });
  };

  const applySmart = () => {
    const next = parseStaySmartFilterQuery(smartDraft);
    setFilters((prev) => ({
      ...prev,
      ...next,
      categories: next.categories ?? prev.categories,
      amenities: next.amenities
        ? Array.from(new Set([...prev.amenities, ...next.amenities]))
        : prev.amenities,
    }));
  };

  const clearFilters = () => {
    setFilters((prev) => ({
      ...prev,
      governorate: '',
      wilayat: '',
      village: '',
      categories: [],
      bedroomsMin: 0,
      bathroomsMin: 0,
      priceMin: '',
      priceMax: '',
      amenities: [],
      hasPool: false,
      hasParking: false,
      q: '',
      sort: 'newest',
    }));
    setSmartDraft('');
  };

  const activeFilterCount =
    (filters.categories.length ? 1 : 0) +
    (filters.bedroomsMin ? 1 : 0) +
    (filters.bathroomsMin ? 1 : 0) +
    (filters.priceMin || filters.priceMax ? 1 : 0) +
    (filters.amenities.length ? 1 : 0) +
    (filters.hasPool ? 1 : 0) +
    (filters.hasParking ? 1 : 0) +
    (filters.governorate ? 1 : 0) +
    (filters.q ? 1 : 0);

  const visibleAmenities = amenitiesExpanded ? BROWSE_AMENITIES : BROWSE_AMENITIES.slice(0, 6);
  const maxHist = Math.max(1, ...hist.buckets);

  const sidebar = (
    <aside className="props-sidebar" aria-label={ar ? 'التصفية حسب' : 'Filter by'}>
      <button type="button" className="props-map-btn" onClick={() => setMapOpen(true)}>
        {ar ? 'اعرض على الخريطة' : 'Show on map'}
      </button>

      <div className="props-sidebar__block">
        <h2>{ar ? 'التصفية حسب:' : 'Filter by:'}</h2>
      </div>

      {recent.length ? (
        <div className="props-sidebar__block">
          <h3>{ar ? 'المصفيات التي استخدمتها سابقاً' : 'Filters you used before'}</h3>
          <div className="props-check-list">
            {recent.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="props-recent-chip"
                onClick={() => patch(chip.patch)}
              >
                {ar ? chip.labelAr : chip.labelEn}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="props-sidebar__block">
        <h3>{ar ? 'ميزانيتك (لليلة)' : 'Your budget (per night)'}</h3>
        <div className="props-hist" aria-hidden="true">
          {hist.buckets.map((count, index) => (
            <span key={index} style={{ height: `${Math.max(8, (count / maxHist) * 100)}%` }} />
          ))}
        </div>
        <div className="props-price-row">
          <input
            className="input"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder={String(hist.min)}
            value={filters.priceMin}
            onChange={(event) => patch({ priceMin: event.target.value })}
            aria-label={ar ? 'الحد الأدنى' : 'Minimum'}
          />
          <span>—</span>
          <input
            className="input"
            type="number"
            min={0}
            inputMode="decimal"
            placeholder={`${hist.max}+`}
            value={filters.priceMax}
            onChange={(event) => patch({ priceMax: event.target.value })}
            aria-label={ar ? 'الحد الأعلى' : 'Maximum'}
          />
        </div>
        <p className="props-price-hint">
          {filters.priceMin || hist.min} {filters.currency} –{' '}
          {filters.priceMax || `${hist.max}+`} {filters.currency}
        </p>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'مصفيات رائجة' : 'Popular filters'}</h3>
        <div className="props-check-list">
          <FilterCheckbox
            checked={filters.categories.includes('villa')}
            label={categoryLabel('villa', ar)}
            count={countStayCategory(typeUniverse, 'villa')}
            onChange={() => toggleCategory('villa')}
          />
          <FilterCheckbox
            checked={filters.categories.includes('apartment')}
            label={categoryLabel('apartment', ar)}
            count={countStayCategory(typeUniverse, 'apartment')}
            onChange={() => toggleCategory('apartment')}
          />
          <FilterCheckbox
            checked={filters.hasPool || filters.amenities.includes('pool')}
            label={ar ? 'مسبح' : 'Pool'}
            count={countStayAmenity(amenityUniverse, 'pool')}
            onChange={() => toggleAmenity('pool')}
          />
          <FilterCheckbox
            checked={filters.hasParking || filters.amenities.includes('parking')}
            label={ar ? 'موقف سيارات' : 'Parking'}
            count={countStayAmenity(amenityUniverse, 'parking')}
            onChange={() => toggleAmenity('parking')}
          />
          <FilterCheckbox
            checked={filters.amenities.includes('wifi')}
            label={ar ? 'واي فاي' : 'Wi‑Fi'}
            count={countStayAmenity(amenityUniverse, 'wifi')}
            onChange={() => toggleAmenity('wifi')}
          />
          <FilterCheckbox
            checked={filters.bedroomsMin >= 3}
            label={ar ? '3 غرف فأكثر' : '3+ bedrooms'}
            count={stayFacetUniverse(universe, filters, { bedrooms: true }).filter(
              (item) => item.bedrooms >= 3,
            ).length}
            onChange={() => patch({ bedroomsMin: filters.bedroomsMin >= 3 ? 0 : 3 })}
          />
        </div>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'المصفيات الذكية' : 'Smart filters'}</h3>
        <p className="props-smart-hint">{ar ? 'ما الذي تبحث عنه؟' : 'What are you looking for?'}</p>
        <textarea
          className="props-smart-input"
          rows={3}
          value={smartDraft}
          onChange={(event) => setSmartDraft(event.target.value)}
          placeholder={
            ar
              ? 'مثال: أريد شقة بمسبح وموقف سيارات في مسقط'
              : 'e.g. I want an apartment with a pool and parking in Muscat'
          }
        />
        <button type="button" className="button button--secondary props-smart-apply" onClick={applySmart}>
          {ar ? 'تطبيق' : 'Apply'}
        </button>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'ابحث عن أماكن إقامة' : 'Search places'}</h3>
        <input
          className="input"
          value={filters.q}
          onChange={(event) => patch({ q: event.target.value })}
          placeholder={ar ? 'اسم العقار أو المنطقة…' : 'Property or area name…'}
        />
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'نوع مكان الإقامة' : 'Property type'}</h3>
        <div className="props-check-list">
          {BROWSE_CATEGORIES.map((category) => (
            <FilterCheckbox
              key={category}
              checked={filters.categories.includes(category)}
              label={categoryLabel(category, ar)}
              count={countStayCategory(typeUniverse, category)}
              onChange={() => toggleCategory(category)}
              disabled={countStayCategory(typeUniverse, category) === 0}
            />
          ))}
        </div>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'غرف النوم والحمّامات' : 'Bedrooms and bathrooms'}</h3>
        <Stepper
          label={ar ? 'غرف النوم' : 'Bedrooms'}
          value={filters.bedroomsMin}
          onChange={(bedroomsMin) => patch({ bedroomsMin })}
        />
        <Stepper
          label={ar ? 'الحمّامات' : 'Bathrooms'}
          value={filters.bathroomsMin}
          onChange={(bathroomsMin) => patch({ bathroomsMin })}
        />
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'الموقع' : 'Location'}</h3>
        <div className="props-loc-fields">
          <label className="field">
            <span>{ar ? 'الدولة' : 'Country'}</span>
            <select
              className="select"
              value={filters.countryCode}
              onChange={(event) =>
                patch({ countryCode: event.target.value, governorate: '', wilayat: '', village: '' })
              }
            >
              <option value="">{ar ? 'كل الدول' : 'All countries'}</option>
              {Object.values(countryPacks).map((pack) => (
                <option key={pack.countryCode} value={pack.countryCode}>
                  {ar ? pack.name.ar : pack.name.en}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'المحافظة' : 'Governorate'}</span>
            <select
              className="select"
              value={filters.governorate}
              onChange={(event) =>
                patch({ governorate: event.target.value, wilayat: '', village: '' })
              }
            >
              <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
              {omanLocations.map((item) => (
                <option key={item.en} value={item.en}>
                  {ar ? item.ar : item.en}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'الولاية' : 'Wilayat'}</span>
            <select
              className="select"
              value={filters.wilayat}
              disabled={!selectedGov}
              onChange={(event) => patch({ wilayat: event.target.value, village: '' })}
            >
              <option value="">{ar ? 'كل الولايات' : 'All wilayats'}</option>
              {(selectedGov?.states ?? []).map((state) => (
                <option key={state.en} value={state.en}>
                  {ar ? state.ar : state.en}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'القرية / المنطقة' : 'Village / area'}</span>
            <select
              className="select"
              value={filters.village}
              disabled={!selectedState}
              onChange={(event) => patch({ village: event.target.value })}
            >
              <option value="">{ar ? 'كل القرى' : 'All villages'}</option>
              {(selectedState?.villages ?? []).map((item) => (
                <option key={item.ar} value={item.ar}>
                  {item.ar}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{ar ? 'العملة' : 'Currency'}</span>
            <select
              className="select"
              value={filters.currency}
              onChange={(event) => patch({ currency: event.target.value })}
            >
              {supportedCurrencyCodes.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'المرافق' : 'Facilities'}</h3>
        <div className="props-check-list">
          {visibleAmenities.map((item) => (
            <FilterCheckbox
              key={item.code}
              checked={
                filters.amenities.includes(item.code) ||
                (item.code === 'pool' && filters.hasPool) ||
                (item.code === 'parking' && filters.hasParking)
              }
              label={ar ? item.ar : item.en}
              count={countStayAmenity(amenityUniverse, item.code)}
              onChange={() => toggleAmenity(item.code)}
              disabled={countStayAmenity(amenityUniverse, item.code) === 0}
            />
          ))}
        </div>
        {BROWSE_AMENITIES.length > 6 ? (
          <button
            type="button"
            className="props-show-all"
            onClick={() => setAmenitiesExpanded((value) => !value)}
          >
            {amenitiesExpanded
              ? ar
                ? 'إخفاء'
                : 'Show less'
              : ar
                ? `اعرض الـ ${BROWSE_AMENITIES.length} جميعها`
                : `Show all ${BROWSE_AMENITIES.length}`}
          </button>
        ) : null}
      </div>

      <button type="button" className="button button--secondary props-clear" onClick={clearFilters}>
        {ar ? 'مسح التصفية' : 'Clear filters'}
      </button>
    </aside>
  );

  return (
    <div className="props-browse stays-public stays-public--search">
      <header className="props-browse__hero stays-hero">
        <div className="container">
          <span className="section-kicker">BHD R</span>
          <h1>{heading}</h1>
          <p className="stays-hero__lede">{hint}</p>
          {searchBar ? <div className="stays-hero__search">{searchBar}</div> : null}
        </div>
      </header>

      <div className="props-searchbar sticky-search">
        <div className="container props-searchbar__inner">
          <div className="purpose-tabs" role="tablist" aria-label={ar ? 'نوع العرض' : 'Listing purpose'}>
            <Link className="purpose-tabs__item purpose-tabs__item--link" href="/properties" prefetch>
              {ar ? 'الكل' : 'All'}
            </Link>
            <Link className="purpose-tabs__item purpose-tabs__item--link" href="/properties?purpose=rent" prefetch>
              {ar ? 'عقار للإيجار' : 'For rent'}
            </Link>
            <Link className="purpose-tabs__item purpose-tabs__item--link" href="/properties?purpose=sale" prefetch>
              {ar ? 'عقار للبيع' : 'For sale'}
            </Link>
            <span className="purpose-tabs__item is-active" aria-current="page">
              {ar ? 'إقامة يومية' : 'Daily stay'}
            </span>
          </div>
          <div className="props-searchbar__fields">
            <label className="props-searchbar__q">
              <span className="sr-only">{ar ? 'البحث' : 'Search'}</span>
              <input
                className="input"
                value={filters.q}
                onChange={(event) => patch({ q: event.target.value })}
                placeholder={ar ? 'ابحث بالمنطقة أو اسم العقار…' : 'Search by area or property name…'}
              />
            </label>
            <select
              className="select props-searchbar__gov"
              value={filters.governorate}
              onChange={(event) =>
                patch({ governorate: event.target.value, wilayat: '', village: '' })
              }
              aria-label={ar ? 'المحافظة' : 'Governorate'}
            >
              <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
              {omanLocations.map((item) => (
                <option key={item.en} value={item.en}>
                  {ar ? item.ar : item.en}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button button--secondary props-filter-toggle"
              onClick={() => setDrawerOpen(true)}
            >
              {ar
                ? `تصفية${activeFilterCount ? ` (${activeFilterCount})` : ''}`
                : `Filter${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>

      <section className="section props-browse__section">
        <div className="container props-browse__layout">
          <div className="props-sidebar-desktop">{sidebar}</div>

          <div className="props-results">
            <div className="props-results__toolbar">
              <p>
                {ar
                  ? `وجدنا ${results.length} مكان إقامة`
                  : `${results.length} place${results.length === 1 ? '' : 's'} found`}
                {loadingUniverse ? (
                  <span className="props-results__sync">
                    {ar ? ' · جاري التحديث…' : ' · Updating…'}
                  </span>
                ) : null}
              </p>
              <div className="props-results__tools">
                <div
                  className="props-view-toggle"
                  role="group"
                  aria-label={ar ? 'طريقة العرض' : 'View mode'}
                >
                  <button
                    type="button"
                    className={viewMode === 'list' ? 'is-active' : undefined}
                    aria-pressed={viewMode === 'list'}
                    onClick={() => changeViewMode('list')}
                  >
                    {ar ? 'قائمة' : 'List'}
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'grid' ? 'is-active' : undefined}
                    aria-pressed={viewMode === 'grid'}
                    onClick={() => changeViewMode('grid')}
                  >
                    {ar ? 'شبكة' : 'Grid'}
                  </button>
                  <button
                    type="button"
                    className={viewMode === 'table' ? 'is-active' : undefined}
                    aria-pressed={viewMode === 'table'}
                    onClick={() => changeViewMode('table')}
                  >
                    {ar ? 'جدول' : 'Table'}
                  </button>
                </div>
                <label className="props-sort">
                  <span>{ar ? 'ترتيب' : 'Sort'}</span>
                  <select
                    className="select"
                    value={filters.sort}
                    onChange={(event) => patch({ sort: event.target.value as BrowseSort })}
                  >
                    <option value="newest">{ar ? 'الأحدث' : 'Newest'}</option>
                    <option value="price_asc">{ar ? 'السعر: من الأقل' : 'Price: low to high'}</option>
                    <option value="price_desc">{ar ? 'السعر: من الأعلى' : 'Price: high to low'}</option>
                    <option value="beds_desc">{ar ? 'غرف النوم' : 'Most bedrooms'}</option>
                  </select>
                </label>
              </div>
            </div>

            {results.length ? (
              viewMode === 'table' ? (
                <StaysListingsTable
                  listings={results}
                  locale={locale}
                  selectedId={selectedListingId}
                  onHover={setSelectedListingId}
                  {...(stayDates ? { stayDates } : {})}
                />
              ) : viewMode === 'grid' ? (
                <div className="listing-grid props-results__grid">
                  {results.map((listing) => (
                    <div
                      key={listing.id}
                      id={`stay-${listing.id}`}
                      className={
                        selectedListingId === listing.id
                          ? 'props-results__item is-selected'
                          : 'props-results__item'
                      }
                      onMouseEnter={() => setSelectedListingId(listing.id)}
                    >
                      <StayCatalogueCard
                        listing={listing}
                        locale={locale}
                        {...(stayDates ? { stayDates } : {})}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="props-results__list">
                  {results.map((listing) => (
                    <div
                      key={listing.id}
                      id={`stay-${listing.id}`}
                      className={
                        selectedListingId === listing.id
                          ? 'props-results__item is-selected'
                          : 'props-results__item'
                      }
                      onMouseEnter={() => setSelectedListingId(listing.id)}
                    >
                      <StayResultRow
                        listing={listing}
                        locale={locale}
                        {...(stayDates ? { stayDates } : {})}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <EmptyState title={ar ? 'لا توجد نتائج' : 'No results'} />
            )}
          </div>
        </div>
      </section>

      <PropertiesMapPanel
        open={mapOpen}
        locale={locale}
        listings={mapListings}
        selectedId={selectedListingId}
        onSelect={(listing) => {
          setSelectedListingId(listing.id);
          document.getElementById(`stay-${listing.id}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        }}
        onClose={() => setMapOpen(false)}
      />

      {drawerOpen ? (
        <div className="props-drawer" role="dialog" aria-modal="true" aria-label={ar ? 'التصفية' : 'Filters'}>
          <button
            type="button"
            className="props-drawer__backdrop"
            aria-label={ar ? 'إغلاق' : 'Close'}
            onClick={() => setDrawerOpen(false)}
          />
          <div className="props-drawer__panel">
            <div className="props-drawer__head">
              <h2>{ar ? 'التصفية حسب' : 'Filter by'}</h2>
              <button type="button" className="button button--secondary" onClick={() => setDrawerOpen(false)}>
                {ar ? 'تم' : 'Done'}
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="props-mobile-bar">
        <button type="button" className="button button--secondary" onClick={() => setDrawerOpen(true)}>
          {ar ? `تصفية (${activeFilterCount})` : `Filters (${activeFilterCount})`}
        </button>
        <button type="button" className="button button--primary" onClick={() => setMapOpen(true)}>
          {ar ? 'الخريطة' : 'Map'}
        </button>
      </div>
    </div>
  );
}
