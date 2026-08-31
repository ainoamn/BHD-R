'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { supportedCurrencyCodes } from '@bhd-r/contracts';
import { countryPacks } from '@bhd-r/country-packs';
import { EmptyState } from '@bhd-r/ui';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { CatalogueListing } from '@/lib/listing-market-status';
import { omanLocations } from '@/lib/oman-locations';
import {
  BROWSE_AMENITIES,
  BROWSE_CATEGORIES,
  type BrowseFilterState,
  type BrowseSort,
  applyBrowseFilters,
  categoryLabel,
  countAmenity,
  countCategory,
  facetUniverse,
  filtersToSearchParams,
  loadRecentFilters,
  mapSearchUrl,
  parseSmartFilterQuery,
  priceHistogram,
  pushRecentFilter,
  type RecentFilterChip,
} from '@/lib/properties-browse-filters';
import { ListingResultRow } from '@/components/listing-result-row';

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

export function PropertiesBrowse({
  locale,
  heading,
  hint,
  initialFilters,
  initialListings,
}: {
  locale: string;
  heading: string;
  hint: string;
  initialFilters: BrowseFilterState;
  initialListings: CatalogueListing[];
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<BrowseFilterState>(initialFilters);
  const [universe, setUniverse] = useState<CatalogueListing[]>(initialListings);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false);
  const [smartDraft, setSmartDraft] = useState('');
  const [recent, setRecent] = useState<RecentFilterChip[]>([]);
  const [loadingUniverse, setLoadingUniverse] = useState(false);
  const [, startTransition] = useTransition();
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecent(loadRecentFilters());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoadingUniverse(true);
    const params = new URLSearchParams({ limit: '100' });
    if (filters.countryCode) params.set('countryCode', filters.countryCode);
    fetch(`/api/public/catalogue?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { data?: CatalogueListing[] };
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
    // Refresh universe when country changes only — other filters are client-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.countryCode]);

  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const qs = filtersToSearchParams(filters).toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    }, 220);
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, [filters, pathname, router]);

  const results = useMemo(() => applyBrowseFilters(universe, filters), [universe, filters]);
  const typeUniverse = useMemo(
    () => facetUniverse(universe, filters, { categories: true }),
    [universe, filters],
  );
  const amenityUniverse = useMemo(
    () => facetUniverse(universe, filters, { amenities: true, hasPool: true, hasParking: true }),
    [universe, filters],
  );
  const priceUniverse = useMemo(
    () => facetUniverse(universe, filters, { price: true }),
    [universe, filters],
  );
  const hist = useMemo(
    () => priceHistogram(priceUniverse, filters.purpose),
    [priceUniverse, filters.purpose],
  );

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

  const patch = (partial: Partial<BrowseFilterState>) => {
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
          pushRecentFilter({
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
    const next = parseSmartFilterQuery(smartDraft);
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
      <a
        className="props-map-btn"
        href={mapSearchUrl(filters, locale)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {ar ? 'اعرض على الخريطة' : 'Show on map'}
      </a>

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
        <h3>
          {ar
            ? filters.purpose === 'sale'
              ? 'ميزانيتك (سعر البيع)'
              : 'ميزانيتك (شهرياً)'
            : filters.purpose === 'sale'
              ? 'Your budget (sale price)'
              : 'Your budget (per month)'}
        </h3>
        <div className="props-hist" aria-hidden="true">
          {hist.buckets.map((count, index) => (
            <span
              key={index}
              style={{ height: `${Math.max(8, (count / maxHist) * 100)}%` }}
            />
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
            count={countCategory(typeUniverse, 'villa')}
            onChange={() => toggleCategory('villa')}
          />
          <FilterCheckbox
            checked={filters.categories.includes('apartment')}
            label={categoryLabel('apartment', ar)}
            count={countCategory(typeUniverse, 'apartment')}
            onChange={() => toggleCategory('apartment')}
          />
          <FilterCheckbox
            checked={filters.hasPool || filters.amenities.includes('pool')}
            label={ar ? 'مسبح' : 'Pool'}
            count={countAmenity(amenityUniverse, 'pool')}
            onChange={() => toggleAmenity('pool')}
          />
          <FilterCheckbox
            checked={filters.hasParking || filters.amenities.includes('parking')}
            label={ar ? 'موقف سيارات' : 'Parking'}
            count={countAmenity(amenityUniverse, 'parking')}
            onChange={() => toggleAmenity('parking')}
          />
          <FilterCheckbox
            checked={filters.amenities.includes('wifi')}
            label={ar ? 'واي فاي' : 'Wi‑Fi'}
            count={countAmenity(amenityUniverse, 'wifi')}
            onChange={() => toggleAmenity('wifi')}
          />
          <FilterCheckbox
            checked={filters.bedroomsMin >= 3}
            label={ar ? '3 غرف فأكثر' : '3+ bedrooms'}
            count={facetUniverse(universe, filters, { bedrooms: true }).filter(
              (item) => item.bedrooms >= 3,
            ).length}
            onChange={() =>
              patch({ bedroomsMin: filters.bedroomsMin >= 3 ? 0 : 3 })
            }
          />
        </div>
      </div>

      <div className="props-sidebar__block">
        <h3>{ar ? 'المصفيات الذكية' : 'Smart filters'}</h3>
        <p className="props-smart-hint">
          {ar ? 'ما الذي تبحث عنه؟' : 'What are you looking for?'}
        </p>
        <textarea
          className="props-smart-input"
          rows={3}
          value={smartDraft}
          onChange={(event) => setSmartDraft(event.target.value)}
          placeholder={
            ar
              ? 'مثال: أريد فيلا بمسبح وموقف سيارات في مسقط'
              : 'e.g. I want a villa with a pool and parking in Muscat'
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
              count={countCategory(typeUniverse, category)}
              onChange={() => toggleCategory(category)}
              disabled={countCategory(typeUniverse, category) === 0}
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
                patch({
                  countryCode: event.target.value,
                  governorate: '',
                  wilayat: '',
                  village: '',
                })
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
              count={countAmenity(amenityUniverse, item.code)}
              onChange={() => toggleAmenity(item.code)}
              disabled={countAmenity(amenityUniverse, item.code) === 0}
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
    <div className="props-browse">
      <header className="props-browse__hero">
        <div className="container">
          <h1>{heading}</h1>
          <p>{hint}</p>
        </div>
      </header>

      <div className="props-searchbar sticky-search">
        <div className="container props-searchbar__inner">
          <div className="purpose-tabs" role="tablist" aria-label={ar ? 'نوع العرض' : 'Listing purpose'}>
            {(['', 'rent', 'sale'] as const).map((purpose) => (
              <button
                key={purpose || 'all'}
                type="button"
                className={
                  filters.purpose === purpose
                    ? 'purpose-tabs__item is-active'
                    : 'purpose-tabs__item'
                }
                onClick={() => patch({ purpose })}
              >
                {purpose === ''
                  ? ar
                    ? 'الكل'
                    : 'All'
                  : purpose === 'rent'
                    ? ar
                      ? 'عقار للإيجار'
                      : 'For rent'
                    : ar
                      ? 'عقار للبيع'
                      : 'For sale'}
              </button>
            ))}
          </div>
          <div className="props-searchbar__fields">
            <label className="props-searchbar__q">
              <span className="sr-only">{ar ? 'البحث' : 'Search'}</span>
              <input
                ref={searchInputRef}
                className="input"
                value={filters.q}
                onChange={(event) => patch({ q: event.target.value })}
                placeholder={
                  ar ? 'ابحث بالمنطقة أو اسم العقار…' : 'Search by area or property name…'
                }
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
              className="button button--primary"
              onClick={() => searchInputRef.current?.focus()}
            >
              {ar ? 'بحث' : 'Search'}
            </button>
            <button
              type="button"
              className="button button--secondary props-filter-toggle"
              onClick={() => setDrawerOpen(true)}
            >
              {ar ? `تصفية${activeFilterCount ? ` (${activeFilterCount})` : ''}` : `Filter${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
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

            {results.length ? (
              <div className="props-results__list">
                {results.map((listing) => (
                  <ListingResultRow key={listing.id} listing={listing} locale={locale} />
                ))}
              </div>
            ) : (
              <EmptyState title={ar ? 'لا توجد نتائج' : 'No results'} />
            )}
          </div>
        </div>
      </section>

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
        <a
          className="button button--primary"
          href={mapSearchUrl(filters, locale)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {ar ? 'الخريطة' : 'Map'}
        </a>
      </div>
    </div>
  );
}
