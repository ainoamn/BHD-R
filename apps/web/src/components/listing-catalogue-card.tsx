'use client';

import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatListingCardTitle, formatListingLocation } from '@/lib/listing-card-copy';
import {
  marketStatusFromPurpose,
  reservedUntilNote,
  type CatalogueListing,
} from '@/lib/listing-market-status';
import {
  listingPurposeChipLabel,
  listingPurposeChipTone,
  occupancyWatermarkLabel,
  occupancyWatermarkModifier,
} from '@/lib/listing-purpose-display';
import { toPublicMediaSrc } from '@/lib/public-media-url';

/** Compact catalogue card — same layout as the home listing card. */
export function ListingCatalogueCard({
  listing,
  locale,
}: {
  listing: CatalogueListing;
  locale: string;
}) {
  const ar = locale === 'ar';
  const loc = ar ? 'ar' : 'en';
  const { headline } = formatListingCardTitle(listing, loc);
  const locationLine = formatListingLocation(listing);
  const address = locationLine || headline;
  const href = listing.unitId
    ? `/units/${listing.unitId}`
    : listing.propertyId
      ? `/properties/${listing.propertyId}`
      : `/units/${listing.unitId}`;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const purpose = listing.listingPurpose;
  const reservedNote = reservedUntilNote(listing, locale);
  const marketStatus = listing.marketStatus ?? marketStatusFromPurpose(purpose);
  const watermark = occupancyWatermarkLabel(marketStatus, loc);
  const watermarkMod = occupancyWatermarkModifier(marketStatus);
  const purposeChip = listingPurposeChipLabel(purpose, loc);
  const purposeTone = listingPurposeChipTone(purpose);
  const serial = listing.unitSerial || listing.propertySerial || null;

  return (
    <article
      className={`listing-card listing-card--compact${reservedNote ? ' listing-card--reserved' : ''}${
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
              sizes="(max-width: 720px) 50vw, (max-width: 1280px) 25vw, 20vw"
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
          {serial ? (
            <span className="listing-card__serial-overlay" dir="ltr">
              {serial}
            </span>
          ) : null}
        </div>
        <div className="listing-card__body">
          {reservedNote ? (
            <p className="listing-reserved-note" role="note">
              {reservedNote}
            </p>
          ) : null}
          <h3>{address}</h3>
          <span className={`listing-card__purpose-chip listing-card__purpose-chip--${purposeTone}`}>
            {purposeChip}
          </span>
        </div>
      </Link>
    </article>
  );
}
