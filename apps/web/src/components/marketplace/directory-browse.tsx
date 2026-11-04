'use client';

import { useMemo, useState } from 'react';
import {
  MARKETPLACE_CITY_LABELS,
  citiesForKind,
  listMarketplace,
  type MarketplaceCity,
  type MarketplaceEntry,
  type MarketplaceKind,
} from '@/lib/marketplace-directory';

function initial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function EntryCard({ entry, ar }: { entry: MarketplaceEntry; ar: boolean }) {
  const city = MARKETPLACE_CITY_LABELS[entry.city];
  const tags = ar ? entry.specialtiesAr : entry.specialtiesEn;
  const phoneHref = entry.phone ? `tel:${entry.phone.replace(/\s+/g, '')}` : null;
  const mailHref =
    entry.email && !entry.email.endsWith('@example.bhd-om.local')
      ? `mailto:${entry.email}`
      : null;

  return (
    <article className="mkt-card">
      <div className="mkt-card__top">
        <span className="mkt-card__mark" aria-hidden="true">
          {initial(ar ? entry.nameAr : entry.nameEn)}
        </span>
        <div className="mkt-card__badges">
          {entry.featured ? (
            <span className="mkt-pill mkt-pill--featured">{ar ? 'مميّز' : 'Featured'}</span>
          ) : null}
          {entry.verified ? (
            <span className="mkt-pill mkt-pill--verified">{ar ? 'موثّق' : 'Verified'}</span>
          ) : null}
        </div>
      </div>
      <div>
        <h2>{ar ? entry.nameAr : entry.nameEn}</h2>
        <p className="mkt-card__city">{ar ? city.ar : city.en}</p>
      </div>
      <p className="mkt-card__tagline">{ar ? entry.taglineAr : entry.taglineEn}</p>
      {tags.length ? (
        <ul className="mkt-card__tags">
          {tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      <div className="mkt-card__actions">
        {phoneHref ? (
          <a className="mkt-card__primary" href={phoneHref}>
            {ar ? 'اتصل' : 'Call'}
          </a>
        ) : null}
        {mailHref ? <a href={mailHref}>{ar ? 'بريد' : 'Email'}</a> : null}
        {entry.website ? (
          <a href={entry.website} target="_blank" rel="noopener noreferrer">
            {ar ? 'الموقع' : 'Website'}
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function DirectoryBrowse({
  kind,
  locale,
  joinHref,
}: {
  kind: MarketplaceKind;
  locale: string;
  joinHref?: string;
}) {
  const ar = locale !== 'en';
  const [q, setQ] = useState('');
  const [city, setCity] = useState<MarketplaceCity | 'all'>('all');
  const cities = useMemo(() => citiesForKind(kind), [kind]);
  const rows = useMemo(() => listMarketplace(kind, { q, city }), [kind, q, city]);

  return (
    <div>
      <div className="mkt-filters">
        <label>
          {ar ? 'بحث' : 'Search'}
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={ar ? 'اسم المكتب أو التخصص…' : 'Name or specialty…'}
            autoComplete="off"
          />
        </label>
        <label>
          {ar ? 'المدينة' : 'City'}
          <select
            value={city}
            onChange={(event) => setCity(event.target.value as MarketplaceCity | 'all')}
          >
            <option value="all">{ar ? 'كل المدن' : 'All cities'}</option>
            {cities.map((id) => (
              <option key={id} value={id}>
                {ar ? MARKETPLACE_CITY_LABELS[id].ar : MARKETPLACE_CITY_LABELS[id].en}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mkt-count">
        {ar ? `${rows.length} نتيجة` : `${rows.length} result${rows.length === 1 ? '' : 's'}`}
      </p>

      {rows.length ? (
        <div className="mkt-grid">
          {rows.map((entry) => (
            <EntryCard key={entry.id} entry={entry} ar={ar} />
          ))}
        </div>
      ) : (
        <div className="mkt-empty">
          <strong>{ar ? 'لا توجد نتائج' : 'No matches'}</strong>
          <p>
            {ar
              ? 'جرّب مدينة أخرى أو امسح البحث. يمكنك أيضاً الانضمام إلى الدليل.'
              : 'Try another city or clear the search. You can also join the directory.'}
          </p>
          {joinHref ? (
            <p style={{ marginTop: '0.75rem' }}>
              <a className="button button--gold button--small" href={joinHref}>
                {ar ? 'سجّل اهتمامك' : 'Register interest'}
              </a>
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
