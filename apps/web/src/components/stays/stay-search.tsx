import { getTranslations } from 'next-intl/server';

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

export async function StaySearch({
  locale,
  defaults = {},
  compact = false,
}: {
  locale: string;
  compact?: boolean;
  defaults?: {
    destination?: string;
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
  };
}) {
  const t = await getTranslations('Stays');
  const ar = locale === 'ar';

  return (
    <form
      action={`/${locale}/stays`}
      method="get"
      className={compact ? 'filters-bar stays-search' : 'search-card stays-search'}
      role="search"
    >
      {compact ? null : <h2>{t('searchTitle')}</h2>}
      <div className={compact ? 'filters-bar__grid' : 'search-grid stays-search__grid'}>
        <div className="field">
          <label htmlFor={compact ? 'stay-filter-dest' : 'stay-home-dest'}>{t('destination')}</label>
          <select
            className="select"
            id={compact ? 'stay-filter-dest' : 'stay-home-dest'}
            name="destination"
            defaultValue={defaults.destination ?? ''}
          >
            <option value="">{ar ? 'كل المحافظات' : 'All governorates'}</option>
            {governorates.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={compact ? 'stay-filter-in' : 'stay-home-in'}>{t('checkIn')}</label>
          <input
            className="input"
            type="date"
            id={compact ? 'stay-filter-in' : 'stay-home-in'}
            name="checkInOn"
            defaultValue={defaults.checkInOn ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={compact ? 'stay-filter-out' : 'stay-home-out'}>{t('checkOut')}</label>
          <input
            className="input"
            type="date"
            id={compact ? 'stay-filter-out' : 'stay-home-out'}
            name="checkOutOn"
            defaultValue={defaults.checkOutOn ?? ''}
          />
        </div>
        <div className="field">
          <label htmlFor={compact ? 'stay-filter-adults' : 'stay-home-adults'}>{t('adults')}</label>
          <select
            className="select"
            id={compact ? 'stay-filter-adults' : 'stay-home-adults'}
            name="adults"
            defaultValue={defaults.adults ?? '2'}
          >
            {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={compact ? 'stay-filter-children' : 'stay-home-children'}>
            {t('children')}
          </label>
          <select
            className="select"
            id={compact ? 'stay-filter-children' : 'stay-home-children'}
            name="children"
            defaultValue={defaults.children ?? '0'}
          >
            {[0, 1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button button--primary">
          {ar ? 'بحث' : 'Search'}
        </button>
      </div>
    </form>
  );
}
