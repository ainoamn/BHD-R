import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import { toPublicMediaSrc } from '@/lib/public-media-url';

export type StayCardListing = {
  slug: string;
  titleAr: string;
  titleEn: string;
  destination?: string | null;
  nightlyMinor?: string | null;
  currency?: string | null;
  coverImageUrl?: string | null;
  maxGuests?: number | null;
};

export async function StayCard({
  listing,
  locale,
  query,
}: {
  listing: StayCardListing;
  locale: string;
  query?: {
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
  };
}) {
  const t = await getTranslations('Stays');
  const ar = locale === 'ar';
  const title = ar ? listing.titleAr : listing.titleEn;
  const coverSrc = toPublicMediaSrc(listing.coverImageUrl);
  const priceLabel =
    listing.nightlyMinor && listing.currency
      ? formatMoney(listing.nightlyMinor, listing.currency, locale)
      : null;
  const qs = new URLSearchParams();
  if (query?.checkInOn) qs.set('checkInOn', query.checkInOn);
  if (query?.checkOutOn) qs.set('checkOutOn', query.checkOutOn);
  if (query?.adults) qs.set('adults', query.adults);
  if (query?.children) qs.set('children', query.children);
  const suffix = qs.toString();
  const href = `/stays/${encodeURIComponent(listing.slug)}${suffix ? `?${suffix}` : ''}`;

  return (
    <article className="listing-card stay-card">
      <Link href={href} className="stay-card__link" aria-label={title} prefetch>
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
        </div>
        <div className="listing-card__body">
          <h3>{title}</h3>
          {listing.destination ? (
            <p className="listing-card__location">{listing.destination}</p>
          ) : null}
          <div className="listing-card__facts">
            {priceLabel ? (
              <span className="stay-card__price">
                {t('nightlyFrom')} <strong dir="ltr">{priceLabel}</strong> {t('perNight')}
              </span>
            ) : null}
            {listing.maxGuests != null ? (
              <span>
                {listing.maxGuests} {t('guests')}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
