'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { formatListingCardTitle, formatListingLocation } from '@/lib/listing-card-copy';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { categoryLabel } from '@/lib/properties-browse-filters';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { stayAsCardListing, stayDetailHref } from '@/lib/stays-browse-filters';

export function StayResultRow({
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
  const { headline, buildingLine, isMulti } = formatListingCardTitle(
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
  const buildingHref = isMulti && listing.propertyId ? `/properties/${listing.propertyId}` : null;
  const highlights: string[] = [];
  if (listing.hasPool || listing.amenities?.includes('pool')) {
    highlights.push(ar ? 'مسبح' : 'Pool');
  }
  if ((listing.parkingSpaces ?? 0) > 0 || listing.amenities?.includes('parking')) {
    highlights.push(ar ? 'موقف سيارات' : 'Parking');
  }
  if (listing.amenities?.includes('wifi')) highlights.push(ar ? 'واي فاي' : 'Wi‑Fi');
  if (listing.amenities?.includes('balcony')) highlights.push(ar ? 'شرفة' : 'Balcony');

  return (
    <article className="listing-row">
      <Link href={href} className="listing-row__media" aria-label={headline} prefetch>
        {coverSrc ? (
          <Image src={coverSrc} alt={headline} fill sizes="(max-width: 760px) 100vw, 280px" />
        ) : (
          <div className="listing-row__placeholder" aria-hidden="true">
            <BrandMark tone="onDark" />
          </div>
        )}
        {coverSrc ? (
          <span className="media-watermark" aria-hidden="true">
            <BrandMark tone="onDark" />
          </span>
        ) : null}
      </Link>

      <div className="listing-row__body">
        <div className="listing-row__meta">
          <p className="listing-row__type">{categoryLabel(listing.category, ar)}</p>
          <Link href={href} className="listing-row__title" prefetch>
            {headline}
          </Link>
          {buildingLine ? <p className="listing-row__building-name">{buildingLine}</p> : null}
          {locationLine ? <p className="listing-row__location">{locationLine}</p> : null}
          {listing.unitSerial ? (
            <p className="listing-row__serial" dir="ltr">
              {listing.unitSerial}
            </p>
          ) : null}
          {buildingHref ? (
            <div className="listing-card__building-cta listing-row__building-cta">
              <p className="listing-card__building-cta-label">
                {ar ? 'وحدة مرتبطة بالمبنى' : 'Unit linked to the building'}
              </p>
              <Link
                href={buildingHref}
                className="button button--quiet listing-card__building-cta-btn"
                prefetch
              >
                {ar ? 'عرض المبنى وكل وحداته' : 'View building and all units'}
              </Link>
            </div>
          ) : null}
          <div className={`listing-row__facts${isMulti ? ' listing-row__facts--stack' : ''}`}>
            <span>
              {listing.bedrooms} {ar ? 'غرف' : 'beds'}
            </span>
            <span>
              {listing.bathrooms} {ar ? 'حمامات' : 'baths'}
            </span>
            {listing.areaSquareMeters ? (
              <span>
                {listing.areaSquareMeters} {ar ? 'م²' : 'm²'}
              </span>
            ) : null}
            {listing.maxGuests ? (
              <span>
                {listing.maxGuests} {ar ? 'ضيوف' : 'guests'}
              </span>
            ) : null}
          </div>
          {highlights.length ? (
            <ul className="listing-row__perks">
              {highlights.slice(0, 4).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="listing-row__aside">
          <span className="listing-row__status">{ar ? 'إقامة يومية' : 'Daily stay'}</span>
          {priceLabel ? (
            <div className="listing-row__price">
              <strong>{priceLabel}</strong>
              <small>{ar ? 'لليلة' : 'Per night'}</small>
            </div>
          ) : null}
          <Link href={href} className="button button--primary listing-row__cta" prefetch>
            {ar ? 'عرض التوافر' : 'See availability'}
          </Link>
        </div>
      </div>
    </article>
  );
}
