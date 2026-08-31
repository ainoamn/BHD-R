'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  formatListingCardTitle,
  formatListingLocation,
} from '@/lib/listing-card-copy';
import {
  marketStatusFromPurpose,
  marketStatusLabel,
  type CatalogueListing,
} from '@/lib/listing-market-status';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { categoryLabel } from '@/lib/properties-browse-filters';
import { listingPurposeCaption } from '@/lib/listing-purpose-display';

function statusCopy(listing: CatalogueListing, locale: string): string {
  const status =
    listing.marketStatus ?? marketStatusFromPurpose(listing.listingPurpose);
  const t = (key: string) => {
    const ar = locale === 'ar';
    const map: Record<string, [string, string]> = {
      'Property.availableForRent': ['متاح للإيجار', 'Available for rent'],
      'Property.availableForSale': ['متاح للبيع', 'Available for sale'],
      'Property.availableForRentOrSale': ['متاح للإيجار أو البيع', 'Available for rent or sale'],
      'Property.reserved': ['محجوز', 'Reserved'],
      'Property.leased': ['مؤجّر', 'Leased'],
      'Property.sold': ['مباع', 'Sold'],
      'Property.available': ['متاح', 'Available'],
    };
    const hit = map[key];
    return hit ? (ar ? hit[0] : hit[1]) : key;
  };
  return marketStatusLabel(status, t, listing.listingPurpose);
}

export function ListingResultRow({
  listing,
  locale,
}: {
  listing: CatalogueListing;
  locale: string;
}) {
  const ar = locale === 'ar';
  const loc = ar ? 'ar' : 'en';
  const { headline, buildingLine, isMulti } = formatListingCardTitle(listing, loc);
  const locationLine = formatListingLocation(listing);
  const href = listing.unitId
    ? `/units/${listing.unitId}`
    : listing.propertyId
      ? `/properties/${listing.propertyId}`
      : `/units/${listing.unitId}`;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const purpose = listing.listingPurpose;
  const rentLabel = formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);
  const saleLabel =
    listing.salePrice != null
      ? formatMoney(listing.salePrice.amountMinor, listing.salePrice.currency, locale)
      : null;
  const buildingHref =
    isMulti && listing.propertyId ? `/properties/${listing.propertyId}` : null;
  const highlights: string[] = [];
  if (listing.hasPool || listing.amenities?.includes('pool')) {
    highlights.push(ar ? 'مسبح' : 'Pool');
  }
  if ((listing.parkingSpaces ?? 0) > 0 || listing.amenities?.includes('parking')) {
    highlights.push(ar ? 'موقف سيارات' : 'Parking');
  }
  if (listing.amenities?.includes('wifi')) highlights.push(ar ? 'واي فاي' : 'Wi‑Fi');
  if (listing.amenities?.includes('balcony')) highlights.push(ar ? 'شرفة' : 'Balcony');
  if (listing.amenities?.includes('central_ac')) {
    highlights.push(ar ? 'مكيف هواء' : 'Air conditioning');
  }
  const rating =
    typeof listing.avgRating === 'number' && listing.avgRating > 0 ? listing.avgRating : null;

  return (
    <article className="listing-row">
      <Link href={href} className="listing-row__media" aria-label={headline} prefetch>
        {coverSrc ? (
          <Image
            src={coverSrc}
            alt={headline}
            fill
            sizes="(max-width: 760px) 100vw, 280px"
          />
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
          {!isMulti ? (
            <p className="listing-row__type">{categoryLabel(listing.category, ar)}</p>
          ) : null}
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
          {!isMulti ? (
            <p className="listing-row__purpose">
              {listingPurposeCaption(purpose, loc)}
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
          {rating ? (
            <span className="listing-row__rating" title={`${listing.reviewCount ?? 0}`}>
              <strong>{rating.toFixed(1)}</strong>
              <small>
                {listing.reviewCount ?? 0} {ar ? 'تقييم' : 'reviews'}
              </small>
            </span>
          ) : null}
          <span className="listing-row__status">{statusCopy(listing, locale)}</span>
          {purpose === 'both' ? (
            <div className="listing-row__price listing-row__price--dual">
              <div>
                <strong>{rentLabel}</strong>
                <small>{ar ? 'شهرياً' : 'Monthly'}</small>
              </div>
              {saleLabel ? (
                <div>
                  <strong>{saleLabel}</strong>
                  <small>{ar ? 'للبيع' : 'For sale'}</small>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="listing-row__price">
              <strong>{purpose === 'sale' && saleLabel ? saleLabel : rentLabel}</strong>
              <small>
                {purpose === 'sale' ? (ar ? 'للبيع' : 'For sale') : ar ? 'شهرياً' : 'Monthly'}
              </small>
            </div>
          )}
          <Link href={href} className="button button--primary listing-row__cta" prefetch>
            {ar ? 'عرض التوافر' : 'See availability'}
          </Link>
          {listing.latitude == null || listing.longitude == null ? (
            <small className="listing-row__no-pin">
              {ar ? 'بدون موقع على الخريطة' : 'No map pin'}
            </small>
          ) : null}
        </div>
      </div>
    </article>
  );
}
