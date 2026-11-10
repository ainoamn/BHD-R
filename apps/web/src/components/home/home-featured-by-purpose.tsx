import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { ListingCard } from '@/components/listing-card';
import { StayCatalogueCard } from '@/components/stays/stay-catalogue-card';
import type { CatalogueListing } from '@/lib/listing-market-status';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';

type Strip = {
  key: 'rent' | 'sale' | 'stay';
  titleAr: string;
  titleEn: string;
  hintAr: string;
  hintEn: string;
  href: string;
  listings?: CatalogueListing[];
  stays?: StayCatalogueListing[];
};

/**
 * Home featured inventory split by market purpose so rent / sale / daily stay
 * do not compete in one mixed grid.
 */
export function HomeFeaturedByPurpose({
  locale,
  rent,
  sale,
  stays,
  showStays,
}: {
  locale: string;
  rent: CatalogueListing[];
  sale: CatalogueListing[];
  stays: StayCatalogueListing[];
  showStays: boolean;
}) {
  const ar = locale !== 'en';
  const strips: Strip[] = [
    {
      key: 'rent',
      titleAr: 'للإيجار',
      titleEn: 'For rent',
      hintAr: 'عقود شهرية وسنوية من الوحدات المتاحة الآن.',
      hintEn: 'Monthly and yearly leases from units available now.',
      href: '/properties?purpose=rent',
      listings: rent,
    },
    {
      key: 'sale',
      titleAr: 'للبيع',
      titleEn: 'For sale',
      hintAr: 'عقارات معروضة للتملك مباشرة.',
      hintEn: 'Properties listed for purchase.',
      href: '/properties?purpose=sale',
      listings: sale,
    },
  ];
  if (showStays) {
    strips.push({
      key: 'stay',
      titleAr: 'إقامة يومية',
      titleEn: 'Daily stays',
      hintAr: 'وحدات جاهزة للحجز بالليلة.',
      hintEn: 'Units ready for nightly booking.',
      href: '/stays',
      stays,
    });
  }

  const anyRows = strips.some(
    (strip) => (strip.listings?.length ?? 0) > 0 || (strip.stays?.length ?? 0) > 0,
  );

  return (
    <section className="home-section home-featured" aria-labelledby="featured-title">
      <div className="container">
        <header className="home-head">
          <div>
            <span className="home-head__kicker">{ar ? 'متاح الآن' : 'Available now'}</span>
            <h2 id="featured-title">{ar ? 'وحدات مختارة' : 'Featured units'}</h2>
            <p>
              {ar
                ? 'نعرض الإيجار والبيع والإقامة اليومية كلٌّ في مساره.'
                : 'Rent, sale and daily stays each get their own lane.'}
            </p>
          </div>
          <Link className="home-head__link" href="/properties">
            {ar ? 'عرض الكل' : 'View all'}
          </Link>
        </header>

        {!anyRows ? (
          <EmptyState
            title={ar ? 'لا توجد وحدات منشورة حالياً' : 'No published units yet'}
            description={
              ar
                ? 'نظهر هنا فقط الوحدات المنشورة والمتاحة فعلياً.'
                : 'Only published, actually available units appear here.'
            }
          />
        ) : (
          <div className="home-featured__strips">
            {strips.map((strip) => {
              const rows = strip.listings?.length
                ? strip.listings
                : strip.stays?.length
                  ? strip.stays
                  : [];
              if (!rows.length) return null;
              return (
                <div key={strip.key} className="home-featured__strip">
                  <header className="home-featured__strip-head">
                    <div>
                      <h3>{ar ? strip.titleAr : strip.titleEn}</h3>
                      <p>{ar ? strip.hintAr : strip.hintEn}</p>
                    </div>
                    <Link className="home-head__link" href={strip.href} prefetch={false}>
                      {ar ? 'المزيد' : 'More'}
                    </Link>
                  </header>
                  <div className="listing-grid home-listings">
                    {strip.listings?.map((listing) => (
                      <ListingCard key={listing.id} listing={listing} locale={locale} />
                    ))}
                    {strip.stays?.map((listing) => (
                      <StayCatalogueCard
                        key={listing.id}
                        listing={listing}
                        locale={locale}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
