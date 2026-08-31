import Image from 'next/image';
import { BrandMark, StatusBadge } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  formatListingCardTitle,
  formatListingLocation,
} from '@/lib/listing-card-copy';
import {
  marketStatusFromPurpose,
  marketStatusLabel,
  marketStatusTone,
  type CatalogueListing,
} from '@/lib/listing-market-status';
import { listingPurposeCaption } from '@/lib/listing-purpose-display';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { PublicListing } from '@/lib/types';

export async function ListingCard({
  listing,
  locale,
}: {
  listing: PublicListing | CatalogueListing;
  locale: string;
}) {
  const t = await getTranslations();
  const ar = locale === 'ar';
  const loc = ar ? 'ar' : 'en';
  const catalogue = listing as CatalogueListing;
  const { headline, buildingLine, isMulti } = formatListingCardTitle(catalogue, loc);
  const locationLine = formatListingLocation(catalogue);
  const href = listing.unitId
    ? `/units/${listing.unitId}`
    : 'propertyId' in listing && listing.propertyId
      ? `/properties/${listing.propertyId}`
      : `/units/${listing.unitId}`;
  const buildingHref =
    isMulti && 'propertyId' in listing && listing.propertyId
      ? `/properties/${listing.propertyId}`
      : null;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const marketStatus =
    'marketStatus' in listing && listing.marketStatus
      ? listing.marketStatus
      : marketStatusFromPurpose(listing.listingPurpose);
  const statusLabel = marketStatusLabel(marketStatus, t, listing.listingPurpose);
  const tone = marketStatusTone(marketStatus);
  const serial =
    'unitSerial' in listing && listing.unitSerial
      ? listing.unitSerial
      : 'propertySerial' in listing
        ? listing.propertySerial
        : null;
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
          <span className={`listing-card__status listing-card__status--${marketStatus}`}>
            <StatusBadge
              status={tone === 'warning' ? 'warning' : tone === 'neutral' ? 'neutral' : 'positive'}
              label={statusLabel}
            />
          </span>
        </div>
        <div className="listing-card__body">
          <h3>{headline}</h3>
          {buildingLine ? <p className="listing-card__building-name">{buildingLine}</p> : null}
          {locationLine ? <p className="listing-card__location">{locationLine}</p> : null}
          {serial ? (
            <p className="listing-card__serial" dir="ltr">
              {serial}
            </p>
          ) : null}
          {!isMulti ? (
            <p className="listing-card__purpose">
              {listingPurposeCaption(purpose, loc)}
            </p>
          ) : null}
          <div className={`listing-card__facts${isMulti ? ' listing-card__facts--stack' : ''}`}>
            <span>
              {listing.bedrooms} {t('Property.beds')}
            </span>
            <span>
              {listing.bathrooms} {t('Property.baths')}
            </span>
            {listing.areaSquareMeters ? (
              <span>
                {listing.areaSquareMeters} {t('Property.area')}
              </span>
            ) : null}
          </div>
          {purpose === 'both' ? (
            <div className="listing-card__price listing-card__price--dual listing-card__price--stack">
              <span>
                {rentLabel}
                <small>{t('Common.monthly')}</small>
              </span>
              {saleLabel ? (
                <span>
                  {saleLabel}
                  <small>{t('Property.forSale')}</small>
                </span>
              ) : null}
            </div>
          ) : (
            <div className="listing-card__price listing-card__price--stack">
              <span>{purpose === 'sale' && saleLabel ? saleLabel : rentLabel}</span>
              <small>
                {purpose === 'sale' ? t('Property.forSale') : t('Common.monthly')}
              </small>
            </div>
          )}
        </div>
      </Link>
      {buildingHref ? (
        <div className="listing-card__building-cta">
          <p className="listing-card__building-cta-label">
            {t('Property.linkedToBuilding')}
          </p>
          <Link
            href={buildingHref}
            className="button button--quiet listing-card__building-cta-btn"
            prefetch
          >
            {t('Property.viewBuilding')}
          </Link>
        </div>
      ) : null}
    </article>
  );
}
