'use client';

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Icon } from '@/components/pmh-icon';
import { UnitStaySettings } from '@/components/property-stay-settings-panel';
import { formatMoney } from '@/lib/format';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';

function publishBadge(status: string, ar: boolean): { text: string; tone: string } {
  if (status === 'published') return { text: ar ? 'منشور' : 'Published', tone: 'ready' };
  if (status === 'unpublished') return { text: ar ? 'غير منشور' : 'Unpublished', tone: 'muted' };
  return { text: ar ? 'مسودة' : 'Draft', tone: 'warn' };
}

type PropertyGroup = {
  propertyId: string;
  name: string;
  units: PropertyStaySettingsUnit[];
};

/** Base prices of every daily-rental unit, grouped by property, each editable in place. */
export function StayRatesBoard({
  locale,
  portal,
  units: initialUnits,
}: {
  locale: string;
  portal: 'owner' | 'developer';
  units: PropertyStaySettingsUnit[];
}) {
  const ar = locale === 'ar';
  const [units, setUnits] = useState(initialUnits);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const match = /^#unit-(.+)$/.exec(window.location.hash);
    const target = match ? units.find((unit) => unit.unitId === match[1]) : undefined;
    if (!target) return;
    setOpenId(target.profileId);
    document
      .getElementById(`unit-${target.unitId}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    // Only on first load: the hash comes from the dashboard's "Prices" link.
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, PropertyGroup>();
    for (const unit of units) {
      if (
        needle &&
        ![unit.propertyNameAr, unit.propertyNameEn, unit.unitNameAr, unit.unitNameEn, unit.unitCode]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(needle))
      ) {
        continue;
      }
      const group = map.get(unit.propertyId) ?? {
        propertyId: unit.propertyId,
        name:
          (ar
            ? unit.propertyNameAr || unit.propertyNameEn
            : unit.propertyNameEn || unit.propertyNameAr) || (ar ? 'عقار' : 'Property'),
        units: [],
      };
      group.units.push(unit);
      map.set(unit.propertyId, group);
    }
    return [...map.values()];
  }, [ar, query, units]);

  if (!units.length) {
    return (
      <div className="pmh-empty stays-dash__empty">
        <p>
          {ar
            ? 'لا وحدات للإيجار اليومي بعد. أضف إقامة يومية ثم حدّد أسعارها هنا.'
            : 'No daily-rental units yet. Add a daily stay, then set its prices here.'}
        </p>
        <Link className="button button--primary" href={`/${portal}/stays/setup`} prefetch>
          {ar ? 'إضافة إقامة يومية' : 'Add a daily stay'}
        </Link>
      </div>
    );
  }

  const money = (unit: PropertyStaySettingsUnit, minor: string | null, fallback = '—') =>
    minor ? formatMoney(minor, unit.currency, locale) : fallback;

  return (
    <div className="stays-rates">
      <div className="stays-rates__toolbar">
        <p className="stays-rates__tip">
          <Icon name="tag" />
          {ar
            ? 'لعرض خاص أو سعر مختلف في يوم معيّن، أو لإغلاق يوم أمام الحجز، اضغط «أسعار أيام معيّنة» بجانب الوحدة.'
            : 'For an offer, a different price on a specific day, or to close a day, use “Specific-day prices” next to the unit.'}
        </p>
        {units.length > 3 ? (
          <label className="stays-bookings-board__search">
            <span className="sr-only">{ar ? 'بحث' : 'Search'}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ar ? 'ابحث باسم العقار أو الوحدة…' : 'Search property or unit…'}
            />
          </label>
        ) : null}
      </div>

      {!groups.length ? (
        <p className="pmh-empty">{ar ? 'لا نتائج مطابقة.' : 'No matching units.'}</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.propertyId} className="pmh-card stays-rates__group">
          <header className="pmh-card__head">
            <h2>
              <span className="pmh-card__icon">
                <Icon name="home" />
              </span>
              {group.name}
            </h2>
            <Link
              className="pmh-card__link"
              href={`/${portal}/properties/${group.propertyId}/edit`}
              prefetch
            >
              {ar ? 'تعديل العقار' : 'Edit property'}
            </Link>
          </header>

          <ul className="stays-rates__list">
            {group.units.map((unit) => {
              const open = openId === unit.profileId;
              const badge = publishBadge(unit.publishStatus, ar);
              const unitName =
                (ar ? unit.unitNameAr || unit.unitNameEn : unit.unitNameEn || unit.unitNameAr) ||
                unit.unitCode;
              const sameAsNightly = ar ? 'مثل سعر الليلة' : 'Same as nightly';
              return (
                <li
                  key={unit.profileId}
                  id={`unit-${unit.unitId}`}
                  className={open ? 'stays-rates__unit is-open' : 'stays-rates__unit'}
                >
                  <div className="stays-rates__row">
                    <div className="stays-rates__name">
                      <strong>{unitName}</strong>
                      <span>
                        <span dir="ltr">{unit.unitCode}</span>
                        <span className={`pmh-badge pmh-badge--${badge.tone}`}>{badge.text}</span>
                      </span>
                    </div>

                    <dl className="stays-rates__prices">
                      <div className="is-main">
                        <dt>{ar ? 'سعر الليلة' : 'Nightly'}</dt>
                        <dd dir="ltr">{money(unit, unit.baseNightlyMinor)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'نهاية الأسبوع' : 'Weekend'}</dt>
                        <dd dir="ltr">{money(unit, unit.weekendNightlyMinor, sameAsNightly)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'بدون مبيت' : 'Day use'}</dt>
                        <dd dir="ltr">{money(unit, unit.dayUseMinor)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'مبيت فقط' : 'Overnight only'}</dt>
                        <dd dir="ltr">{money(unit, unit.overnightOnlyMinor)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'التأمين' : 'Deposit'}</dt>
                        <dd dir="ltr">{money(unit, unit.depositMinor)}</dd>
                      </div>
                    </dl>

                    <div className="stays-rates__actions">
                      <button
                        type="button"
                        className={open ? 'button button--quiet' : 'button button--primary'}
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : unit.profileId)}
                      >
                        {open ? (ar ? 'إغلاق' : 'Close') : ar ? 'تعديل الأسعار' : 'Edit prices'}
                      </button>
                      <Link
                        className="button button--quiet"
                        href={`/${portal}/stays/calendar?unitId=${unit.unitId}&view=prices`}
                        prefetch
                      >
                        {ar ? 'أسعار أيام معيّنة' : 'Specific-day prices'}
                      </Link>
                      {unit.listingSlug ? (
                        <Link
                          className="stays-rates__public"
                          href={`/stays/${unit.listingSlug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {ar ? 'صفحة الإقامة ↗' : 'Stay page ↗'}
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  {open ? (
                    <UnitStaySettings
                      unit={unit}
                      ar={ar}
                      showUnitName={false}
                      sections="prices"
                      onSaved={(saved) =>
                        setUnits((current) =>
                          current.map((item) =>
                            item.profileId === saved.profileId ? saved : item,
                          ),
                        )
                      }
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
