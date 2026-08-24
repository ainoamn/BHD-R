import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listing-card';
import { ApiError, publicApiFetch } from '@/lib/server-api';
import { localizedName } from '@/lib/format';
import type { PublicPropertyDetail } from '@bhd-r/contracts';

async function getProperty(id: string): Promise<PublicPropertyDetail | null> {
  try {
    return await publicApiFetch<PublicPropertyDetail>(
      `/v1/public/properties/${encodeURIComponent(id)}`,
      30,
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}): Promise<Metadata> {
  const { locale, propertyId } = await params;
  const property = await getProperty(propertyId).catch(() => null);
  if (!property)
    return {
      title: locale === 'ar' ? 'العقار غير متاح' : 'Property unavailable',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  const title = localizedName(locale, property.nameAr, property.nameEn);
  const description =
    localizedName(locale, property.descriptionAr ?? '', property.descriptionEn ?? '') ||
    `${property.governorate}, ${property.wilayat}`;
  const image = property.units.find((unit) => unit.coverImageUrl)?.coverImageUrl;
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/properties/${property.id}`,
      languages: {
        ar: `/ar/properties/${property.id}`,
        en: `/en/properties/${property.id}`,
      },
    },
    openGraph: {
      title,
      description,
      url: `/${locale}/properties/${property.id}`,
      type: 'website',
      images: image ? [{ url: image }] : [],
    },
    twitter: { title, description, images: image ? [image] : [] },
  };
}

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const property = await getProperty(propertyId);
  if (!property) notFound();
  return (
    <>
      <header className="page-hero">
        <div className="container">
          <h1>{localizedName(locale, property.nameAr, property.nameEn)}</h1>
          <p>
            {property.governorate} · {property.wilayat}
          </p>
        </div>
      </header>
      <section className="section">
        <div className="container">
          {property.units.length ? (
            <div className="listing-grid">
              {property.units.map((unit) => (
                <ListingCard key={unit.id} listing={unit} locale={locale} />
              ))}
            </div>
          ) : (
            <EmptyState title={t('Common.noResults')} description={t('Home.featuredHint')} />
          )}
        </div>
      </section>
    </>
  );
}
