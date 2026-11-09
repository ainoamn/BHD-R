import { getTranslations } from 'next-intl/server';
import { supportedCurrencyCodes } from '@bhd-r/contracts';
import { countryPacks } from '@bhd-r/country-packs';
import { omanLocations } from '@/lib/oman-locations';
import { categoryLabel } from '@/lib/properties-browse-filters';

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
  const ar = locale === 'ar';
  const purpose =
    defaults.purpose === 'rent' || defaults.purpose === 'sale' ? defaults.purpose : '';
  const idPrefix = compact
    ? 'filter'
    : purpose
      ? `home-${purpose}`
      : 'home';

  return (
    <form
      action={`/${locale}/properties`}
      method="get"
      className={compact ? 'filters-bar' : 'search-card'}
      role="search"
      aria-label={
        purpose === 'sale'
          ? ar
            ? 'بحث عن عقار للبيع'
            : 'Search properties for sale'
          : purpose === 'rent'
            ? ar
              ? 'بحث عن عقار للتأجير'
              : 'Search properties for rent'
            : ar
              ? 'بحث عن عقار'
              : 'Property search'
      }
    >
      {purpose ? <input type="hidden" name="purpose" value={purpose} /> : null}
      {compact ? null : (
        <h2>
          {purpose === 'sale'
            ? ar
              ? 'ابحث عن عقار للبيع'
              : 'Find a property for sale'
            : purpose === 'rent'
              ? ar
                ? 'ابحث عن عقار للتأجير'
                : 'Find a property for rent'
              : t('Home.searchTitle')}
        </h2>
      )}
      <div className={compact ? 'filters-bar__grid' : 'search-grid'}>
        <div className="field">
          <label htmlFor={`${idPrefix}-country`}>
            {ar ? 'الدولة' : 'Country'}
          </label>
          <select
            className="select"
            id={`${idPrefix}-country`}
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
          <label htmlFor={`${idPrefix}-governorate`}>{t('Home.governorate')}</label>
          <select
            className="select"
            id={`${idPrefix}-governorate`}
            name="governorate"
            defaultValue={defaults.governorate ?? ''}
          >
            <option value="">{t('Home.allGovernorates')}</option>
            {omanLocations.map((gov) => (
              <option key={gov.en} value={gov.en}>
                {ar ? gov.ar : gov.en}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-category`}>{t('Home.propertyType')}</label>
          <select
            className="select"
            id={`${idPrefix}-category`}
            name="category"
            defaultValue={defaults.category ?? ''}
          >
            <option value="">{t('Home.allTypes')}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category, ar)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-bedrooms`}>{t('Home.bedrooms')}</label>
          <select
            className="select"
            id={`${idPrefix}-bedrooms`}
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
            <label htmlFor={`${idPrefix}-currency`}>{t('Common.currency')}</label>
            <select
              className="select"
              id={`${idPrefix}-currency`}
              name="currency"
              defaultValue={defaults.currency ?? ''}
            >
              <option value="">—</option>
              {supportedCurrencyCodes.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
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
