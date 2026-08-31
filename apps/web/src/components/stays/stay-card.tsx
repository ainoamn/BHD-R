import { BrandMark } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

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
}: {
  listing: StayCardListing;
  locale: string;
}) {
  const t = await getTranslations('Stays');
  const ar = locale === 'ar';
  const title = ar ? listing.titleAr : listing.titleEn;
  const href = `/stays/${encodeURIComponent(listing.slug)}`;

  return (
    <article className="listing-card stay-card">
      <Link href={href} aria-label={title} prefetch>
        <div className="listing-card__image">
          <div className="listing-card__placeholder" aria-hidden="true">
            <BrandMark tone="onDark" />
          </div>
        </div>
        <div className="listing-card__body">
          <h3>{title}</h3>
          {listing.destination ? (
            <p className="listing-card__location">{listing.destination}</p>
          ) : null}
          <div className="listing-card__facts">
            {listing.maxGuests != null ? (
              <span>
                {listing.maxGuests} {t('guests')}
              </span>
            ) : null}
            {listing.nightlyMinor && listing.currency ? (
              <span>
                {t('nightlyFrom')}{' '}
                <strong dir="ltr">
                  {listing.currency} {listing.nightlyMinor}
                </strong>{' '}
                {t('perNight')}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
