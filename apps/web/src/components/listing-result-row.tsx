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
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { categoryLabel } from '@/lib/properties-browse-filters';

function statusCopy(listing: CatalogueListing, locale: string): string {
  const status =
    listing.marketStatus ?? marketStatusFromPurpose(listing.listingPurpose);
  const t = (key: string) => {
    const ar = locale === 'ar';
    const map: Record<string, [string, string]> = {
      'Property.availableForRent': ['متاح للإيجار', 'Available for rent'],
      'Property.availableForSale': ['متاح للبيع', 'Available for sale'],
      'Property.reserved': ['محجوز', 'Reserved'],
      'Property.leased': ['مؤجّر', 'Leased'],
      'Property.sold': ['مباع', 'Sold'],
      'Property.available': ['متاح', 'Available'],
    };
    const hit = map[key];
    return hit ? (ar ? hit[0] : hit[1]) : key;
  };
  return marketStatusLabel(status, t);
}

export function ListingResultRow({
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
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const isSale = listing.listingPurpose === 'sale' && listing.salePrice;
  const price = isSale
    ? formatMoney(listing.salePrice!.amountMinor, listing.salePrice!.currency, locale)
    : formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);
  const period = isSale ? (ar ? 'للبيع' : 'For sale') : ar ? 'شهرياً' : 'Monthly';
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
      <Link href={href} className="listing-row__media" aria-label={title} prefetch>
        {coverSrc ? (
          <Image
            src={coverSrc}
            alt={title}
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
          <p className="listing-row__type">{categoryLabel(listing.category, ar)}</p>
          <Link href={href} className="listing-row__title" prefetch>
            {title}
          </Link>
          {listing.unitSerial ? (
            <p className="listing-row__serial" dir="ltr">
              {listing.unitSerial}
            </p>
          ) : null}
          <p className="listing-row__location">
            {listing.governorate}
            {listing.wilayat ? ` · ${listing.wilayat}` : ''}
          </p>
          <div className="listing-row__facts">
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
          <div className="listing-row__price">
            <strong>{price}</strong>
            <small>{period}</small>
          </div>
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
