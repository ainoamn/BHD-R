import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { bilingualAlternates } from '@/lib/seo';
import { localizedName } from '@/lib/format';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}): Promise<Metadata> {
  const { locale, propertyId } = await params;
  if (!hasDatabaseUrl()) {
    return {
      title: locale === 'ar' ? 'العقار غير متاح' : 'Property unavailable',
      robots: { index: false, follow: false },
    };
  }
  const property = await loadPublicPropertyShowcaseFromNeon(propertyId).catch(() => null);
  if (!property) {
    return {
      title: locale === 'ar' ? 'العقار غير متاح' : 'Property unavailable',
      robots: { index: false, follow: false },
    };
  }
  const title = localizedName(locale, property.nameAr, property.nameEn);
  const description =
    localizedName(locale, property.descriptionAr ?? '', property.descriptionEn ?? '') ||
    [property.address?.governorate, property.address?.wilayat].filter(Boolean).join(' · ');
  const image = property.gallery?.[0]?.url;
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/properties/${property.id}`),
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

/** Public marketing page for a property (QR + «عرض العقار»). Read-only. */
export default async function PropertyPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);

  if (!hasDatabaseUrl()) notFound();
  const property = await loadPublicPropertyShowcaseFromNeon(propertyId).catch(() => null);
  if (!property) notFound();

  return (
    <main className="section">
      <div className="container">
        <PropertyDetailManager
          property={property}
          locale={locale}
          portal="owner"
          variant="public"
        />
      </div>
    </main>
  );
}
