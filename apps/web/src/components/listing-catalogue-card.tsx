'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
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
  const propertyTitle = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
  const unitTitle = localizedName(locale, listing.unitNameAr, listing.unitNameEn);
  const isMulti = listing.propertyKind === 'multi_unit';
  const title =
    isMulti && unitTitle
      ? `${propertyTitle} — ${unitTitle}`
      : !unitTitle || unitTitle === propertyTitle || propertyTitle.includes(unitTitle)
        ? propertyTitle
        : `${propertyTitle} — ${unitTitle}`;
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
      <Link href={href} aria-label={title} prefetch>
        <div className="listing-card__image">
          {coverSrc ? (
            <Image
              src={coverSrc}
              alt={title}
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
          <h3>{title}</h3>
          {listing.unitSerial ? (
            <p className="listing-card__serial" dir="ltr">
              {listing.unitSerial}
            </p>
          ) : null}
          <p className="listing-card__location">
            {listing.governorate}
            {listing.wilayat ? ` · ${listing.wilayat}` : ''}
          </p>
          <p className="listing-card__purpose">{listingPurposeCaption(purpose, ar ? 'ar' : 'en')}</p>
          <div className="listing-card__facts">
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
            <div className="listing-card__price listing-card__price--dual">
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
            <div className="listing-card__price">
              <span>{purpose === 'sale' && saleLabel ? saleLabel : rentLabel}</span>
              <small>
                {purpose === 'sale' ? (ar ? 'للبيع' : 'For sale') : ar ? 'شهرياً' : 'Monthly'}
              </small>
            </div>
          )}
        </div>
      </Link>
      {isMulti && buildingHref ? (
        <p className="listing-card__building">
          <span>{ar ? 'وحدة مرتبطة بالمبنى' : 'Unit linked to the building'}</span>
          <Link href={buildingHref} prefetch>
            {ar ? `عرض «${propertyTitle}» وكل وحداته` : `View “${propertyTitle}” and all units`}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
