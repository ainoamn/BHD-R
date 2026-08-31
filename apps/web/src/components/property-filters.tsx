'use client';

import { useMemo, useState } from 'react';
import { supportedCurrencyCodes } from '@bhd-r/contracts';
import { countryPacks } from '@bhd-r/country-packs';
import { Link } from '@/i18n/navigation';
import { omanLocations } from '@/lib/oman-locations';

const categories = ['apartment', 'villa', 'building', 'office', 'shop', 'warehouse', 'land'];

export type PropertyFilterDefaults = {
  purpose?: string;
  countryCode?: string;
  governorate?: string;
  wilayat?: string;
  village?: string;
  category?: string;
  bedrooms?: string;
  currency?: string;
  priceMin?: string;
  priceMax?: string;
};

export function PropertyFilters({
  locale,
  compact = false,
  defaults = {},
}: {
  locale: string;
  compact?: boolean;
  defaults?: PropertyFilterDefaults;
}) {
  const ar = locale === 'ar';
  const [governorate, setGovernorate] = useState(defaults.governorate ?? '');
  const [wilayat, setWilayat] = useState(defaults.wilayat ?? '');
  const [village, setVillage] = useState(defaults.village ?? '');
  const purpose = defaults.purpose === 'sale' || defaults.purpose === 'rent' ? defaults.purpose : '';

  const selectedGov = useMemo(
    () =>
      omanLocations.find(
        (item) => item.en === governorate || item.ar === governorate || item.en === defaults.governorate,
      ) ?? null,
    [governorate, defaults.governorate],
  );

  const selectedState = useMemo(() => {
    if (!selectedGov) return null;
    return (
      selectedGov.states.find(
        (state) => state.en === wilayat || state.ar === wilayat || state.en === defaults.wilayat,
      ) ?? null
    );
  }, [selectedGov, wilayat, defaults.wilayat]);

  const purposeHref = (next: '' | 'rent' | 'sale') => {
    const params = new URLSearchParams();
    if (next) params.set('purpose', next);
    for (const [key, value] of Object.entries(defaults)) {
      if (!value || key === 'purpose') continue;
      params.set(key, value);
    }
    const query = params.toString();
    return query ? `/properties?${query}` : '/properties';
  };

  return (
    <div className={compact ? 'property-filters property-filters--compact' : 'property-filters'}>
      <div className="purpose-tabs" role="tablist" aria-label={ar ? 'نوع العرض' : 'Listing purpose'}>
        <Link
          href={purposeHref('')}
          scroll={false}
          className={!purpose ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
          aria-current={!purpose ? 'page' : undefined}
        >
          {ar ? 'الكل' : 'All'}
        </Link>
        <Link
          href={purposeHref('rent')}
          scroll={false}
          className={purpose === 'rent' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
          aria-current={purpose === 'rent' ? 'page' : undefined}
        >
          {ar ? 'عقار للإيجار' : 'For rent'}
        </Link>
        <Link
          href={purposeHref('sale')}
          scroll={false}
          className={purpose === 'sale' ? 'purpose-tabs__item is-active' : 'purpose-tabs__item'}
          aria-current={purpose === 'sale' ? 'page' : undefined}
        >
          {ar ? 'عقار للبيع' : 'For sale'}
        </Link>
      </div>

      <form
        action={`/${locale}/properties`}
        method="get"
        className={compact ? 'filters-bar' : 'search-card'}
        role="search"
      >
        {purpose ? <input type="hidden" name="purpose" value={purpose} /> : null}
        {compact ? null : <h2>{ar ? 'ابحث عن وحدتك القادمة' : 'Find your next unit'}</h2>}
        <div className={compact ? 'filters-bar__grid filters-bar__grid--rich' : 'search-grid search-grid--rich'}>
          <div className="field">
            <label htmlFor="filter-country">{ar ? 'الدولة' : 'Country'}</label>
            <select
              className="select"
              id="filter-country"
              name="countryCode"
              defaultValue={defaults.countryCode ?? 'OM'}
            >
              <option value="">{ar ? 'كل الدول' : 'All countries'}</option>
              {Object.values(countryPacks).map((pack) => (
                <option key={pack.countryCode} value={pack.countryCode}>
                  {ar ? pack.name.ar : pack.name.en}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-governorate">{ar ? 'المحافظة' : 'Governorate'}</label>
            <select
              className="select"
              id="filter-governorate"
              name="governorate"
              value={governorate}
              onChange={(event) => {
                setGovernorate(event.target.value);
                setWilayat('');
                setVillage('');
              }}
            >
              <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
              {omanLocations.map((item) => (
                <option key={item.en} value={item.en}>
                  {ar ? item.ar : item.en}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-wilayat">{ar ? 'الولاية' : 'Wilayat'}</label>
            <select
              className="select"
              id="filter-wilayat"
              name="wilayat"
              value={wilayat}
              disabled={!selectedGov}
              onChange={(event) => {
                setWilayat(event.target.value);
                setVillage('');
              }}
            >
              <option value="">{ar ? 'كل الولايات' : 'All wilayats'}</option>
              {(selectedGov?.states ?? []).map((state) => (
                <option key={state.en} value={state.en}>
                  {ar ? state.ar : state.en}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-village">{ar ? 'القرية / المنطقة' : 'Village / area'}</label>
            <select
              className="select"
              id="filter-village"
              name="village"
              value={village}
              disabled={!selectedState}
              onChange={(event) => setVillage(event.target.value)}
            >
              <option value="">{ar ? 'كل القرى' : 'All villages'}</option>
              {(selectedState?.villages ?? []).map((item) => (
                <option key={item.ar} value={item.ar}>
                  {item.ar}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-category">{ar ? 'نوع العقار' : 'Property type'}</label>
            <select
              className="select"
              id="filter-category"
              name="category"
              defaultValue={defaults.category ?? ''}
            >
              <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-bedrooms">{ar ? 'غرف النوم' : 'Bedrooms'}</label>
            <select
              className="select"
              id="filter-bedrooms"
              name="bedrooms"
              defaultValue={defaults.bedrooms ?? ''}
            >
              <option value="">{ar ? 'أي عدد' : 'Any'}</option>
              {[0, 1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {count === 5 ? '5+' : count}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-price-min">
              {ar
                ? purpose === 'sale'
                  ? 'السعر من'
                  : 'الإيجار من'
                : purpose === 'sale'
                  ? 'Price from'
                  : 'Rent from'}
            </label>
            <input
              className="input"
              id="filter-price-min"
              name="priceMin"
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              placeholder={ar ? 'مثلاً 200' : 'e.g. 200'}
              defaultValue={defaults.priceMin ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="filter-price-max">{ar ? 'إلى' : 'To'}</label>
            <input
              className="input"
              id="filter-price-max"
              name="priceMax"
              type="number"
              min={0}
              step="1"
              inputMode="decimal"
              placeholder={ar ? 'مثلاً 800' : 'e.g. 800'}
              defaultValue={defaults.priceMax ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="filter-currency">{ar ? 'العملة' : 'Currency'}</label>
            <select
              className="select"
              id="filter-currency"
              name="currency"
              defaultValue={defaults.currency ?? 'OMR'}
            >
              <option value="">—</option>
              {supportedCurrencyCodes.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="button button--primary">
            {ar ? 'بحث' : 'Search'}
          </button>
        </div>
      </form>
    </div>
  );
}
