'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import {
  BOOKING_TERMS_MODES,
  bookingTermsModeLabel,
  type BookingTermsMode,
} from '@/lib/booking-terms';

export type BookingTermsPropertyRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  serialNumber: string | null;
  ownerName: string | null;
  governorate: string | null;
  wilayat: string | null;
  location: string;
  versions: Partial<Record<BookingTermsMode, { version: number; updatedAt: string }>>;
};

type TermsFilter = 'all' | 'custom' | 'standard';

const INITIAL_VISIBLE = 2;
const SHOW_MORE_STEP = 10;

/** Arabic-insensitive matching: strips diacritics/tatweel and folds alef, taa marbuta and alef maqsura. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}|\u0640/gu, '')
    .replace(/\u0671/g, '\u0627')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSorted(values: (string | null)[], locale: string): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort(
    (left, right) => left.localeCompare(right, locale),
  );
}

export function BookingTermsPropertyList({
  locale,
  portal,
  rows,
  templateSaved,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  rows: BookingTermsPropertyRow[];
  templateSaved: Record<BookingTermsMode, boolean>;
}) {
  const ar = locale === 'ar';
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [place, setPlace] = useState('');
  const [termsFilter, setTermsFilter] = useState<TermsFilter>('all');
  const [mode, setMode] = useState<BookingTermsMode | ''>('');
  const [visible, setVisible] = useState(INITIAL_VISIBLE);

  const owners = useMemo(
    () =>
      uniqueSorted(
        rows.map((row) => row.ownerName),
        locale,
      ),
    [rows, locale],
  );
  const places = useMemo(
    () =>
      uniqueSorted(
        rows.flatMap((row) => [row.governorate, row.wilayat]),
        locale,
      ),
    [rows, locale],
  );

  const indexed = useMemo(
    () =>
      rows.map((row) => ({
        row,
        haystack: normalize(
          [row.nameAr, row.nameEn, row.serialNumber, row.ownerName, row.location]
            .filter(Boolean)
            .join(' '),
        ),
      })),
    [rows],
  );

  const filtered = useMemo(() => {
    const terms = normalize(query).split(' ').filter(Boolean);
    const modes = mode ? [mode] : BOOKING_TERMS_MODES;
    return indexed
      .filter(({ row, haystack }) => {
        if (terms.some((term) => !haystack.includes(term))) return false;
        if (owner && row.ownerName !== owner) return false;
        if (place && row.governorate !== place && row.wilayat !== place) return false;
        const customCount = modes.filter((key) => row.versions[key]).length;
        if (termsFilter === 'custom' && customCount === 0) return false;
        if (termsFilter === 'standard' && customCount > 0) return false;
        return true;
      })
      .map(({ row }) => row);
  }, [indexed, query, owner, place, termsFilter, mode]);

  const filtersActive = Boolean(query.trim() || owner || place || termsFilter !== 'all' || mode);
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  function resetFilters() {
    setQuery('');
    setOwner('');
    setPlace('');
    setTermsFilter('all');
    setMode('');
    setVisible(INITIAL_VISIBLE);
  }

  function badgeLabel(row: BookingTermsPropertyRow, key: BookingTermsMode) {
    const custom = row.versions[key];
    if (custom) return ar ? `مخصّصة (إصدار ${custom.version})` : `custom (v${custom.version})`;
    if (templateSaved[key]) return ar ? 'الصيغة الموحدة' : 'standard';
    return ar ? 'افتراضية' : 'default';
  }

  return (
    <div className="booking-terms-list">
      <div className="booking-terms-list__filters" role="search">
        <div className="field booking-terms-list__search">
          <label htmlFor="terms-list-query">{ar ? 'بحث' : 'Search'}</label>
          <input
            id="terms-list-query"
            className="input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              ar
                ? 'اسم العقار، الرقم المتسلسل، المالك، المكان…'
                : 'Property name, serial, owner, location…'
            }
            autoComplete="off"
          />
        </div>
        {owners.length > 1 ? (
          <div className="field">
            <label htmlFor="terms-list-owner">{ar ? 'المالك' : 'Owner'}</label>
            <select
              id="terms-list-owner"
              className="select"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            >
              <option value="">{ar ? 'كل الملاك' : 'All owners'}</option>
              {owners.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {places.length > 1 ? (
          <div className="field">
            <label htmlFor="terms-list-place">{ar ? 'المكان' : 'Location'}</label>
            <select
              id="terms-list-place"
              className="select"
              value={place}
              onChange={(event) => setPlace(event.target.value)}
            >
              <option value="">{ar ? 'كل الأماكن' : 'All locations'}</option>
              {places.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="terms-list-mode">{ar ? 'نوع العقد' : 'Contract type'}</label>
          <select
            id="terms-list-mode"
            className="select"
            value={mode}
            onChange={(event) => setMode(event.target.value as BookingTermsMode | '')}
          >
            <option value="">{ar ? 'كل الأنواع' : 'All types'}</option>
            {BOOKING_TERMS_MODES.map((key) => (
              <option key={key} value={key}>
                {bookingTermsModeLabel(key, ar)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="terms-list-status">{ar ? 'حالة الشروط' : 'Terms status'}</label>
          <select
            id="terms-list-status"
            className="select"
            value={termsFilter}
            onChange={(event) => setTermsFilter(event.target.value as TermsFilter)}
          >
            <option value="all">{ar ? 'الكل' : 'All'}</option>
            <option value="custom">{ar ? 'مخصّصة' : 'Custom'}</option>
            <option value="standard">{ar ? 'تستخدم الصيغة الموحدة' : 'Uses standard terms'}</option>
          </select>
        </div>
      </div>

      <div className="booking-terms-list__summary">
        <span className="muted" aria-live="polite">
          {ar
            ? `عرض ${shown.length} من ${filtered.length}${filtersActive ? ` (من أصل ${rows.length} عقاراً)` : ' عقاراً'}`
            : `Showing ${shown.length} of ${filtered.length}${filtersActive ? ` (of ${rows.length} properties)` : ' properties'}`}
        </span>
        {filtersActive ? (
          <button type="button" className="button button--quiet" onClick={resetFilters}>
            {ar ? 'مسح التصفية' : 'Clear filters'}
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="notice">
          {ar ? 'لا توجد عقارات مطابقة للبحث.' : 'No properties match your search.'}
        </p>
      ) : (
        <ul className="booking-terms-overview__list">
          {shown.map((row) => (
            <li key={row.id} className="booking-terms-overview__item">
              <div className="booking-terms-overview__info">
                <strong>{ar ? row.nameAr : row.nameEn}</strong>
                <div className="booking-terms-list__meta muted">
                  {row.serialNumber ? <span dir="ltr">{row.serialNumber}</span> : null}
                  {row.ownerName ? (
                    <span>
                      {ar ? 'المالك: ' : 'Owner: '}
                      {row.ownerName}
                    </span>
                  ) : null}
                  {row.location ? <span>{row.location}</span> : null}
                </div>
                <div className="booking-terms-overview__modes">
                  {BOOKING_TERMS_MODES.map((key) => (
                    <span
                      key={key}
                      className={
                        row.versions[key]
                          ? 'booking-terms-editor__badge'
                          : 'booking-terms-editor__badge booking-terms-overview__badge--default'
                      }
                    >
                      {bookingTermsModeLabel(key, ar)}: {badgeLabel(row, key)}
                    </span>
                  ))}
                </div>
              </div>
              <Link
                className="button button--quiet"
                href={`/${portal}/properties/${row.id}/terms`}
                prefetch={false}
              >
                {ar ? 'تخصيص الشروط' : 'Customize terms'}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 || visible > INITIAL_VISIBLE ? (
        <div className="booking-terms-list__more">
          {remaining > 0 ? (
            <>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setVisible((current) => current + SHOW_MORE_STEP)}
              >
                {ar
                  ? `عرض المزيد (${Math.min(SHOW_MORE_STEP, remaining)})`
                  : `Show more (${Math.min(SHOW_MORE_STEP, remaining)})`}
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setVisible(filtered.length)}
              >
                {ar ? `عرض القائمة كاملة (${filtered.length})` : `Show all (${filtered.length})`}
              </button>
            </>
          ) : null}
          {visible > INITIAL_VISIBLE && filtered.length > INITIAL_VISIBLE ? (
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setVisible(INITIAL_VISIBLE)}
            >
              {ar ? 'طيّ القائمة' : 'Collapse'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
