'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { formatListingCardTitle, formatListingLocation } from '@/lib/listing-card-copy';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { stayAsCardListing, stayDetailHref } from '@/lib/stays-browse-filters';

export function StayCatalogueCard({
  listing,
  locale,
  stayDates,
}: {
  listing: StayCatalogueListing;
  locale: string;
  stayDates?: Record<string, string | undefined>;
}) {
  const ar = locale === 'ar';
  const loc = ar ? 'ar' : 'en';
  const cardShape = stayAsCardListing(listing);
  const { headline, buildingLine } = formatListingCardTitle(
    cardShape as Parameters<typeof formatListingCardTitle>[0],
    loc,
  );
  const locationLine = formatListingLocation(cardShape);
  const href = stayDetailHref(listing, stayDates);
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const priceLabel =
    listing.nightlyMinor && listing.currency
      ? formatMoney(listing.nightlyMinor, listing.currency, locale)
      : null;

  return (
    <article className="listing-card stay-card">
      <Link href={href} className="stay-card__link" aria-label={headline} prefetch>
        <div className="listing-card__image">
          {coverSrc ? (
            <Image
              src={coverSrc}
              alt={headline}
              fill
              sizes="(max-width: 760px) 100vw, (max-width: 960px) 50vw, 33vw"
            />
          ) : (
            <div className="listing-card__placeholder" aria-hidden="true">
              <BrandMark tone="onDark" />
            </div>
          )}
          {coverSrc ? (
            <span className="media-watermark" aria-hidden="true">
              <BrandMark tone="onDark" />
            </span>
          ) : null}
          <span className="listing-card__status-mark">
            {ar ? 'إقامة يومية' : 'Daily stay'}
          </span>
        </div>
        <div className="listing-card__body">
          <h3>{headline}</h3>
          {buildingLine ? <p className="listing-card__building-name">{buildingLine}</p> : null}
          {locationLine ? <p className="listing-card__location">{locationLine}</p> : null}
          {listing.unitSerial ? (
            <p className="listing-card__serial" dir="ltr">
              {listing.unitSerial}
            </p>
          ) : null}
          <div className="listing-card__facts">
            {listing.bedrooms > 0 ? (
              <span>
                {listing.bedrooms} {ar ? 'غرف' : 'beds'}
              </span>
            ) : null}
            {listing.bathrooms > 0 ? (
              <span>
                {listing.bathrooms} {ar ? 'حمامات' : 'baths'}
              </span>
            ) : null}
            {listing.maxGuests ? (
              <span>
                {listing.maxGuests} {ar ? 'ضيوف' : 'guests'}
              </span>
            ) : null}
          </div>
          {priceLabel ? (
            <p className="stay-card__price">
              {ar ? 'من' : 'From'}{' '}
              <strong dir="ltr">{priceLabel}</strong> {ar ? 'لليلة' : '/ night'}
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
