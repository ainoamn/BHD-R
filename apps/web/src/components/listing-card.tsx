import Image from 'next/image';
import { BrandMark, StatusBadge } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
import {
  marketStatusFromPurpose,
  marketStatusLabel,
  marketStatusTone,
  type CatalogueListing,
} from '@/lib/listing-market-status';
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
  const title = `${localizedName(locale, listing.propertyNameAr, listing.propertyNameEn)} — ${localizedName(locale, listing.unitNameAr, listing.unitNameEn)}`;
  const href =
    'propertyId' in listing && listing.propertyId
      ? `/properties/${listing.propertyId}`
      : `/units/${listing.unitId}`;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const marketStatus =
    'marketStatus' in listing && listing.marketStatus
      ? listing.marketStatus
      : marketStatusFromPurpose(listing.listingPurpose);
  const statusLabel = marketStatusLabel(marketStatus, t);
  const tone = marketStatusTone(marketStatus);
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
          <span className={`listing-card__status listing-card__status--${marketStatus}`}>
            <StatusBadge status={tone === 'warning' ? 'warning' : tone === 'neutral' ? 'neutral' : 'positive'} label={statusLabel} />
          </span>
          <span className="listing-card__status-mark" aria-hidden="true">
            {statusLabel}
          </span>
        </div>
        <div className="listing-card__body">
          <h3>{title}</h3>
          <p className="listing-card__location">
            {listing.governorate} · {listing.wilayat}
          </p>
          <div className="listing-card__facts">
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
          <div className="listing-card__price">
            <span>
              {listing.listingPurpose === 'sale' && listing.salePrice
                ? formatMoney(listing.salePrice.amountMinor, listing.salePrice.currency, locale)
                : formatMoney(listing.rent.amountMinor, listing.rent.currency, locale)}
            </span>
            <small>
              {listing.listingPurpose === 'sale' ? t('Property.forSale') : t('Common.monthly')}
            </small>
          </div>
        </div>
      </Link>
    </article>
  );
}
