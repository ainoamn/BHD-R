'use client';

import { BrandMark } from '@bhd-r/ui';

export function ListingCardPreview({
  locale,
  title,
  location,
  bedrooms,
  bathrooms,
  area,
  priceLabel,
  coverUrl,
  availableLabel,
  bedsLabel,
  bathsLabel,
  areaLabel,
  monthlyLabel,
}: {
  locale: 'ar' | 'en';
  title: string;
  location: string;
  bedrooms: number;
  bathrooms: number;
  area?: string | undefined;
  priceLabel: string;
  coverUrl?: string | null | undefined;
  availableLabel: string;
  bedsLabel: string;
  bathsLabel: string;
  areaLabel: string;
  monthlyLabel: string;
}) {
  return (
    <article className="listing-card listing-card--preview" lang={locale}>
      <div className="listing-card__image">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: preview URLs
          <img src={coverUrl} alt="" className="listing-card__preview-img" />
        ) : (
          <div className="listing-card__placeholder" aria-hidden="true">
            <BrandMark tone="onDark" />
          </div>
        )}
        <span className="listing-card__status">
          <span className="ops-status ops-status--ok">{availableLabel}</span>
        </span>
      </div>
      <div className="listing-card__body">
        <h3>{title}</h3>
        <p className="listing-card__location">{location}</p>
        <div className="listing-card__facts">
          <span>
            {bedrooms} {bedsLabel}
          </span>
          <span>
            {bathrooms} {bathsLabel}
          </span>
          {area ? (
            <span>
              {area} {areaLabel}
            </span>
          ) : null}
        </div>
        <div className="listing-card__price">
          <span>{priceLabel}</span>
          <small>{monthlyLabel}</small>
        </div>
      </div>
    </article>
  );
}
