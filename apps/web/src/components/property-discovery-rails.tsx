import { Link } from '@/i18n/navigation';
import { formatMoney, localizedName } from '@/lib/format';
import type { CatalogueListing } from '@/lib/listing-market-status';
import type { AiTag } from '@/lib/property-discovery';

function RailCard({ listing, locale }: { listing: CatalogueListing; locale: string }) {
  const ar = locale === 'ar';
  const title = localizedName(locale, listing.propertyNameAr, listing.propertyNameEn);
  const href = listing.propertyId ? `/properties/${listing.propertyId}` : `/units/${listing.unitId}`;
  const price =
    listing.listingPurpose === 'sale' && listing.salePrice
      ? formatMoney(listing.salePrice.amountMinor, listing.salePrice.currency, locale)
      : formatMoney(listing.rent.amountMinor, listing.rent.currency, locale);

  return (
    <Link href={href} className="discovery-card" prefetch>
      <div
        className="discovery-card__img"
        style={
          listing.coverImageUrl
            ? { backgroundImage: `url(${listing.coverImageUrl})` }
            : undefined
        }
      />
      <div className="discovery-card__body">
        <strong>{title}</strong>
        <span>
          {listing.governorate}
          {listing.wilayat ? ` · ${listing.wilayat}` : ''}
        </span>
        <span className="discovery-card__meta">
          {listing.bedrooms} {ar ? 'غرف' : 'beds'} · {listing.bathrooms}{' '}
          {ar ? 'حمّامات' : 'baths'}
          {listing.avgRating ? ` · ★ ${listing.avgRating}` : ''}
        </span>
        <em>{price}</em>
      </div>
    </Link>
  );
}

function Rail({
  title,
  items,
  locale,
}: {
  title: string;
  items: CatalogueListing[];
  locale: string;
}) {
  if (!items.length) return null;
  return (
    <section className="discovery-rail">
      <h2>{title}</h2>
      <div className="discovery-rail__track">
        {items.map((item) => (
          <RailCard key={item.id} listing={item} locale={locale} />
        ))}
      </div>
    </section>
  );
}

export function PropertyDiscoveryRails({
  locale,
  aiTags,
  similar,
  recommended,
  topRated,
}: {
  locale: string;
  aiTags: AiTag[];
  similar: CatalogueListing[];
  recommended: CatalogueListing[];
  topRated: CatalogueListing[];
}) {
  const ar = locale === 'ar';
  return (
    <div className="property-discovery">
      {aiTags.length ? (
        <section className="discovery-rail">
          <h2>{ar ? 'علامات ذكية' : 'Smart tags'}</h2>
          <div className="discovery-tags">
            {aiTags.map((tag) => (
              <span key={`${tag.ar}-${tag.en}`} className="discovery-tag">
                {ar ? tag.ar : tag.en}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <Rail title={ar ? 'عقارات مشابهة' : 'Similar properties'} items={similar} locale={locale} />
      <Rail title={ar ? 'عقارات مقترحة' : 'Recommended'} items={recommended} locale={locale} />
      <Rail title={ar ? 'الأعلى تقييماً' : 'Top rated'} items={topRated} locale={locale} />
    </div>
  );
}
