'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { formatListingCardTitle, formatListingLocation } from '@/lib/listing-card-copy';
import {
  catalogueRating,
  marketStatusFromPurpose,
  reservedUntilNote,
  type CatalogueListing,
} from '@/lib/listing-market-status';
import { BadgeChips } from '@/components/badges/badge-chips';
import { StayRatingBadge } from '@/components/stays/stay-rating-badge';
import {
  listingPurposeCaption,
  listingPurposeChipLabel,
  listingPurposeChipTone,
  occupancyWatermarkLabel,
  occupancyWatermarkModifier,
} from '@/lib/listing-purpose-display';
import { toPublicMediaSrc } from '@/lib/public-media-url';

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
  const reservedNote = reservedUntilNote(listing, locale);
  const rating = catalogueRating(listing);
  const marketStatus = listing.marketStatus ?? marketStatusFromPurpose(purpose);
  const watermark = occupancyWatermarkLabel(marketStatus, loc);
  const watermarkMod = occupancyWatermarkModifier(marketStatus);
  const purposeChip = listingPurposeChipLabel(purpose, loc);
  const purposeTone = listingPurposeChipTone(purpose);

  return (
    <article
      className={`listing-card${reservedNote ? ' listing-card--reserved' : ''}${
        watermarkMod === 'taken' ? ' listing-card--taken' : ''
      }`}
    >
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
          <span
            className={`listing-card__status-mark listing-card__status-mark--${watermarkMod}`}
            aria-label={watermark}
          >
            <span className="listing-card__status-mark-brand" aria-hidden="true">
              <BrandMark tone="onDark" />
            </span>
            <span className="listing-card__status-mark-label">{watermark}</span>
          </span>
        </div>
        <div className="listing-card__body">
          {reservedNote ? (
            <p className="listing-reserved-note" role="note">
              {reservedNote}
            </p>
          ) : null}
          <h3 className={listing.badges?.length ? 'name-with-mark' : undefined}>
            {headline}
            <BadgeChips badges={listing.badges} locale={locale} linked={false} />
          </h3>
          {buildingLine ? <p className="listing-card__building-name">{buildingLine}</p> : null}
          {locationLine ? <p className="listing-card__location">{locationLine}</p> : null}
          {listing.unitSerial ? (
            <p className="listing-card__serial" dir="ltr">
              {listing.unitSerial}
            </p>
          ) : null}
          {rating ? <StayRatingBadge rating={rating} ar={ar} /> : null}
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
                  <small>{ar ? 'سعر البيع' : 'Sale price'}</small>
                </span>
              ) : null}
              <span className={`listing-card__purpose-chip listing-card__purpose-chip--${purposeTone}`}>
                {purposeChip}
              </span>
            </div>
          ) : (
            <div className="listing-card__price listing-card__price--stack">
              <span>
                {purpose === 'sale' && saleLabel ? saleLabel : rentLabel}
                {purpose !== 'sale' ? <small>{ar ? 'شهرياً' : 'Monthly'}</small> : null}
              </span>
              <span className={`listing-card__purpose-chip listing-card__purpose-chip--${purposeTone}`}>
                {purposeChip}
              </span>
            </div>
          )}
        </div>
      </Link>
    </article>
  );
}
