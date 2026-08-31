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
import { categoryLabel } from '@/lib/properties-browse-filters';
import { toPublicMediaSrc } from '@/lib/public-media-url';

function statusCopy(listing: CatalogueListing, locale: string): string {
  const status = listing.marketStatus ?? marketStatusFromPurpose(listing.listingPurpose);
  const ar = locale === 'ar';
  const map: Record<string, [string, string]> = {
    'Property.availableForRent': ['متاح للإيجار', 'Available for rent'],
    'Property.availableForSale': ['متاح للبيع', 'Available for sale'],
    'Property.reserved': ['محجوز', 'Reserved'],
    'Property.leased': ['مؤجّر', 'Leased'],
    'Property.sold': ['مباع', 'Sold'],
    'Property.available': ['متاح', 'Available'],
  };
  return marketStatusLabel(status, (key) => {
    const hit = map[key];
    return hit ? (ar ? hit[0] : hit[1]) : key;
  });
}

function listingTitle(listing: CatalogueListing, locale: string): string {
  const propertyTitle = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
  const unitTitle = localizedName(locale, listing.unitNameAr, listing.unitNameEn);
  if (!unitTitle || unitTitle === propertyTitle || propertyTitle.includes(unitTitle)) {
    return propertyTitle;
  }
  return `${propertyTitle} — ${unitTitle}`;
}

function priceBits(listing: CatalogueListing, locale: string, ar: boolean) {
  const isSale = listing.listingPurpose === 'sale' && listing.salePrice;
  const price = isSale
    ? formatMoney(listing.salePrice!.amountMinor, listing.salePrice!.currency, locale)
    : formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);
  const period = isSale ? (ar ? 'للبيع' : 'sale') : ar ? '/شهر' : '/mo';
  return {
    price,
    period,
    href: listing.propertyId ? `/properties/${listing.propertyId}` : `/units/${listing.unitId}`,
  };
}

export function ListingsTable({
  listings,
  locale,
  selectedId,
  onHover,
}: {
  listings: CatalogueListing[];
  locale: string;
  selectedId?: string | null;
  onHover?: (id: string) => void;
}) {
  const ar = locale === 'ar';

  return (
    <div className="props-table-shell">
      <ul className="props-table-mobile" aria-label={ar ? 'نتائج جدولية' : 'Table results'}>
        {listings.map((listing) => {
          const title = listingTitle(listing, locale);
          const { price, period, href } = priceBits(listing, locale, ar);
          const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
          return (
            <li
              key={`m-${listing.id}`}
              id={`listing-m-${listing.id}`}
              className={
                selectedId === listing.id
                  ? 'props-table-mobile__card is-selected'
                  : 'props-table-mobile__card'
              }
              onMouseEnter={() => onHover?.(listing.id)}
            >
              <Link href={href} className="props-table-mobile__thumb" aria-label={title} prefetch>
                <span className="props-table__thumb-frame">
                  {coverSrc ? (
                    <Image src={coverSrc} alt="" fill sizes="88px" />
                  ) : (
                    <span className="props-table__thumb-empty" aria-hidden="true">
                      <BrandMark tone="onDark" />
                    </span>
                  )}
                </span>
              </Link>
              <div className="props-table-mobile__body">
                <p className="props-table-mobile__type">{categoryLabel(listing.category, ar)}</p>
                <Link href={href} className="props-table__title" prefetch>
                  {title}
                </Link>
                <p className="props-table-mobile__meta">
                  {listing.governorate}
                  {listing.wilayat ? ` · ${listing.wilayat}` : ''}
                </p>
                <p className="props-table-mobile__facts">
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
                </p>
                <div className="props-table-mobile__foot">
                  <span className="props-table-mobile__status">{statusCopy(listing, locale)}</span>
                  <div className="props-table__price">
                    <strong>{price}</strong>
                    <small>{period}</small>
                  </div>
                </div>
                <Link href={href} className="button button--quiet props-table__cta" prefetch>
                  {ar ? 'عرض' : 'View'}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="props-table-wrap props-table-desktop">
        <table className="props-table">
          <thead>
            <tr>
              <th scope="col">{ar ? 'الصورة' : 'Photo'}</th>
              <th scope="col">{ar ? 'العقار' : 'Property'}</th>
              <th scope="col">{ar ? 'النوع' : 'Type'}</th>
              <th scope="col">{ar ? 'الموقع' : 'Location'}</th>
              <th scope="col">{ar ? 'الغرف' : 'Beds'}</th>
              <th scope="col">{ar ? 'الحمامات' : 'Baths'}</th>
              <th scope="col">{ar ? 'المساحة' : 'Area'}</th>
              <th scope="col">{ar ? 'الحالة' : 'Status'}</th>
              <th scope="col">{ar ? 'السعر' : 'Price'}</th>
              <th scope="col">
                <span className="sr-only">{ar ? 'عرض' : 'View'}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => {
              const title = listingTitle(listing, locale);
              const { price, period, href } = priceBits(listing, locale, ar);
              const coverSrc = toPublicMediaSrc(listing.coverImageUrl);

              return (
                <tr
                  key={listing.id}
                  id={`listing-${listing.id}`}
                  className={selectedId === listing.id ? 'is-selected' : undefined}
                  onMouseEnter={() => onHover?.(listing.id)}
                >
                  <td className="props-table__thumb">
                    <Link href={href} aria-label={title} prefetch>
                      <span className="props-table__thumb-frame">
                        {coverSrc ? (
                          <Image src={coverSrc} alt="" fill sizes="72px" />
                        ) : (
                          <span className="props-table__thumb-empty" aria-hidden="true">
                            <BrandMark tone="onDark" />
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td>
                    <Link href={href} className="props-table__title" prefetch>
                      {title}
                    </Link>
                  </td>
                  <td>{categoryLabel(listing.category, ar)}</td>
                  <td>
                    {listing.governorate}
                    {listing.wilayat ? ` · ${listing.wilayat}` : ''}
                  </td>
                  <td>{listing.bedrooms}</td>
                  <td>{listing.bathrooms}</td>
                  <td>
                    {listing.areaSquareMeters
                      ? `${listing.areaSquareMeters} ${ar ? 'م²' : 'm²'}`
                      : '—'}
                  </td>
                  <td>{statusCopy(listing, locale)}</td>
                  <td className="props-table__price">
                    <strong>{price}</strong>
                    <small>{period}</small>
                  </td>
                  <td>
                    <Link href={href} className="button button--quiet props-table__cta" prefetch>
                      {ar ? 'عرض' : 'View'}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
