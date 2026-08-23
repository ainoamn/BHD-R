import Image from 'next/image';
import { StatusBadge } from '@bhd-r/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
import type { PublicListing } from '@/lib/types';

export async function ListingCard({ listing, locale }: { listing: PublicListing; locale: string }) {
  const t = await getTranslations();
  const title = `${localizedName(locale, listing.propertyNameAr, listing.propertyNameEn)} — ${localizedName(locale, listing.unitNameAr, listing.unitNameEn)}`;
  return (
    <article className="listing-card">
      <Link href={`/units/${listing.unitId}`} aria-label={title}>
        <div className="listing-card__image">
          {listing.coverImageUrl ? (
            <Image
              src={listing.coverImageUrl}
              alt={title}
              fill
              sizes="(max-width: 760px) 100vw, (max-width: 960px) 50vw, 33vw"
            />
          ) : (
            <div className="listing-card__placeholder" aria-hidden="true">
              R
            </div>
          )}
          <span className="listing-card__status">
            <StatusBadge status="positive" label={t('Property.available')} />
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
            <span>{formatMoney(listing.rent.amountMinor, listing.rent.currency, locale)}</span>
            <small>{t('Common.monthly')}</small>
          </div>
        </div>
      </Link>
    </article>
  );
}
