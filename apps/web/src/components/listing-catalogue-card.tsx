'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
import {
  formatListingCardTitle,
  formatListingLocation,
} from '@/lib/listing-card-copy';
import {
  marketStatusFromPurpose,
  marketStatusLabel,
  type CatalogueListing,
} from '@/lib/listing-market-status';
import { listingPurposeCaption } from '@/lib/listing-purpose-display';
import { toPublicMediaSrc } from '@/lib/public-media-url';

function statusCopy(listing: CatalogueListing, locale: string): string {
  const status = listing.marketStatus ?? marketStatusFromPurpose(listing.listingPurpose);
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
  return marketStatusLabel(
    status,
    (key) => {
      const hit = map[key];
      return hit ? (ar ? hit[0] : hit[1]) : key;
    },
    listing.listingPurpose,
  );
}

export function ListingCatalogueCard({
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
  const propertyTitle = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
  const href = listing.unitId
    ? `/units/${listing.unitId}`
    : listing.propertyId
      ? `/properties/${listing.propertyId}`
      : `/units/${listing.unitId}`;
  const buildingHref = listing.propertyId ? `/properties/${listing.propertyId}` : null;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const purpose = listing.listingPurpose;
  const rentLabel = formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);
  const saleLabel =
    listing.salePrice != null
      ? formatMoney(listing.salePrice.amountMinor, listing.salePrice.currency, locale)
      : null;

  return (
    <article className="listing-card">
      <Link href={href} aria-label={headline} prefetch>
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
          <span className="listing-card__status-mark">{statusCopy(listing, locale)}</span>
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
          {!isMulti ? (
            <p className="listing-card__purpose">{listingPurposeCaption(purpose, loc)}</p>
          ) : null}
          <div className={`listing-card__facts${isMulti ? ' listing-card__facts--stack' : ''}`}>
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
          {purpose === 'both' ? (
            <div className="listing-card__price listing-card__price--dual listing-card__price--stack">
              <span>
                {rentLabel}
                <small>{ar ? 'شهرياً' : 'Monthly'}</small>
              </span>
              {saleLabel ? (
                <span>
                  {saleLabel}
                  <small>{ar ? 'للبيع' : 'For sale'}</small>
                </span>
              ) : null}
            </div>
          ) : (
            <div className="listing-card__price listing-card__price--stack">
              <span>{purpose === 'sale' && saleLabel ? saleLabel : rentLabel}</span>
              <small>
                {purpose === 'sale' ? (ar ? 'للبيع' : 'For sale') : ar ? 'شهرياً' : 'Monthly'}
              </small>
            </div>
          )}
        </div>
      </Link>
      {isMulti && buildingHref ? (
        <div className="listing-card__building-cta">
          <p className="listing-card__building-cta-label">
            {ar ? 'وحدة مرتبطة بالمبنى' : 'Unit linked to the building'}
          </p>
          <Link href={buildingHref} className="button button--quiet listing-card__building-cta-btn" prefetch>
            {ar ? `عرض «${propertyTitle}» وكل وحداته` : `View “${propertyTitle}” and all units`}
          </Link>
        </div>
      ) : null}
    </article>
  );
}
