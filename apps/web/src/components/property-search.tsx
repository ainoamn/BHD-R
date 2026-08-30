import { getTranslations } from 'next-intl/server';
import { supportedCurrencyCodes } from '@bhd-r/contracts';
import { countryPacks } from '@bhd-r/country-packs';

const governorates = [
  'Muscat',
  'Dhofar',
  'Musandam',
  'Al Buraimi',
  'Ad Dakhiliyah',
  'North Al Batinah',
  'South Al Batinah',
  'North Ash Sharqiyah',
  'South Ash Sharqiyah',
  'Al Dhahirah',
  'Al Wusta',
];
const categories = ['apartment', 'villa', 'building', 'office', 'shop', 'warehouse', 'land'];

export async function PropertySearch({
  locale,
  compact = false,
  defaults = {},
}: {
  locale: string;
  compact?: boolean;
  defaults?: Record<string, string | undefined>;
}) {
  const t = await getTranslations();
  return (
    <form
      action={`/${locale}/properties`}
      method="get"
      className={compact ? 'filters-bar' : 'search-card'}
      role="search"
    >
      {compact ? null : <h2>{t('Home.searchTitle')}</h2>}
      <div className={compact ? 'filters-bar__grid' : 'search-grid'}>
        <div className="field">
          <label htmlFor={compact ? 'filter-country' : 'home-country'}>
            {locale === 'ar' ? 'الدولة' : 'Country'}
          </label>
          <select
            className="select"
            id={compact ? 'filter-country' : 'home-country'}
            name="countryCode"
            defaultValue={defaults.countryCode ?? ''}
          >
            <option value="">{locale === 'ar' ? 'كل الدول' : 'All countries'}</option>
            {Object.values(countryPacks).map((pack) => (
              <option key={pack.countryCode} value={pack.countryCode}>
                {locale === 'ar' ? pack.name.ar : pack.name.en}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={compact ? 'filter-governorate' : 'home-governorate'}>
            {t('Home.governorate')}
          </label>
          <select
            className="select"
            id={compact ? 'filter-governorate' : 'home-governorate'}
            name="governorate"
            defaultValue={defaults.governorate ?? ''}
          >
            <option value="">{t('Home.allGovernorates')}</option>
            {governorates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={compact ? 'filter-category' : 'home-category'}>
            {t('Home.propertyType')}
          </label>
          <select
            className="select"
            id={compact ? 'filter-category' : 'home-category'}
            name="category"
            defaultValue={defaults.category ?? ''}
          >
            <option value="">{t('Home.allTypes')}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={compact ? 'filter-bedrooms' : 'home-bedrooms'}>
            {t('Home.bedrooms')}
          </label>
          <select
            className="select"
            id={compact ? 'filter-bedrooms' : 'home-bedrooms'}
            name="bedrooms"
            defaultValue={defaults.bedrooms ?? ''}
          >
            <option value="">{t('Home.anyBedrooms')}</option>
            {[0, 1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count === 5 ? '5+' : count}
              </option>
            ))}
          </select>
        </div>
        {compact ? (
          <div className="field">
            <label htmlFor="filter-currency">{t('Common.currency')}</label>
            <select
              className="select"
              id="filter-currency"
              name="currency"
              defaultValue={defaults.currency ?? ''}
            >
              <option value="">—</option>
              {supportedCurrencyCodes.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </div>
        ) : null}
        <button type="submit" className="button button--primary">
          {t('Common.search')}
        </button>
      </div>
    </form>
  );
}
