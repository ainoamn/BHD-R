'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { formatListingCardTitle, formatListingLocation } from '@/lib/listing-card-copy';
import { categoryLabel } from '@/lib/properties-browse-filters';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { stayAsCardListing, stayDetailHref } from '@/lib/stays-browse-filters';

export function StaysListingsTable({
  listings,
  locale,
  selectedId,
  onHover,
  stayDates,
}: {
  listings: StayCatalogueListing[];
  locale: string;
  selectedId?: string | null;
  onHover?: (id: string) => void;
  stayDates?: Record<string, string | undefined>;
}) {
  const ar = locale === 'ar';

  return (
    <div className="props-table-shell">
      <ul className="props-table-mobile" aria-label={ar ? 'نتائج جدولية' : 'Table results'}>
        {listings.map((listing) => {
          const { headline, buildingLine } = formatListingCardTitle(
            stayAsCardListing(listing) as Parameters<typeof formatListingCardTitle>[0],
            ar ? 'ar' : 'en',
          );
          const locationLine =
            formatListingLocation(stayAsCardListing(listing)) ||
            `${listing.governorate}${listing.wilayat ? ` · ${listing.wilayat}` : ''}`;
          const href = stayDetailHref(listing, stayDates);
          const price =
            listing.nightlyMinor && listing.currency
              ? formatMoney(listing.nightlyMinor, listing.currency, locale)
              : '—';
          const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
          return (
            <li
              key={`m-${listing.id}`}
              id={`stay-m-${listing.id}`}
              className={
                selectedId === listing.id
                  ? 'props-table-mobile__card is-selected'
                  : 'props-table-mobile__card'
              }
              onMouseEnter={() => onHover?.(listing.id)}
            >
              <Link href={href} className="props-table-mobile__thumb" aria-label={headline} prefetch>
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
                  {headline}
                </Link>
                {buildingLine ? <p className="props-table-mobile__building">{buildingLine}</p> : null}
                <p className="props-table-mobile__loc">{locationLine}</p>
                <p className="props-table-mobile__facts">
                  {listing.bedrooms} {ar ? 'غرف' : 'beds'} · {listing.bathrooms}{' '}
                  {ar ? 'حمامات' : 'baths'}
                  {listing.areaSquareMeters ? ` · ${listing.areaSquareMeters} m²` : ''}
                </p>
                <p className="props-table-mobile__price">
                  <strong dir="ltr">{price}</strong> {ar ? 'لليلة' : '/ night'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <table className="props-table" aria-label={ar ? 'جدول الإقامات' : 'Stays table'}>
        <thead>
          <tr>
            <th scope="col">{ar ? 'الصورة' : 'Image'}</th>
            <th scope="col">{ar ? 'الوحدة' : 'Unit'}</th>
            <th scope="col">{ar ? 'النوع' : 'Type'}</th>
            <th scope="col">{ar ? 'الموقع' : 'Location'}</th>
            <th scope="col">{ar ? 'الغرف' : 'Beds'}</th>
            <th scope="col">{ar ? 'الحمامات' : 'Baths'}</th>
            <th scope="col">{ar ? 'المساحة' : 'Area'}</th>
            <th scope="col">{ar ? 'الضيوف' : 'Guests'}</th>
            <th scope="col">{ar ? 'السعر' : 'Price'}</th>
            <th scope="col">{ar ? 'إجراء' : 'Action'}</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((listing) => {
            const { headline, buildingLine } = formatListingCardTitle(
              stayAsCardListing(listing) as Parameters<typeof formatListingCardTitle>[0],
              ar ? 'ar' : 'en',
            );
            const locationLine = formatListingLocation(stayAsCardListing(listing));
            const href = stayDetailHref(listing, stayDates);
            const price =
              listing.nightlyMinor && listing.currency
                ? formatMoney(listing.nightlyMinor, listing.currency, locale)
                : '—';
            const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
            return (
              <tr
                key={listing.id}
                id={`stay-${listing.id}`}
                className={selectedId === listing.id ? 'is-selected' : undefined}
                onMouseEnter={() => onHover?.(listing.id)}
              >
                <td>
                  <Link href={href} className="props-table__thumb" aria-label={headline} prefetch>
                    <span className="props-table__thumb-frame">
                      {coverSrc ? (
                        <Image src={coverSrc} alt="" fill sizes="64px" />
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
                    {headline}
                  </Link>
                  {buildingLine ? <p className="props-table__building">{buildingLine}</p> : null}
                </td>
                <td>{categoryLabel(listing.category, ar)}</td>
                <td>{locationLine || listing.governorate}</td>
                <td>{listing.bedrooms}</td>
                <td>{listing.bathrooms}</td>
                <td>{listing.areaSquareMeters ?? '—'}</td>
                <td>{listing.maxGuests}</td>
                <td>
                  <strong dir="ltr">{price}</strong>
                  <small>{ar ? ' / ليلة' : ' / night'}</small>
                </td>
                <td>
                  <Link href={href} className="button button--secondary button--sm" prefetch>
                    {ar ? 'عرض' : 'View'}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
