import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { PropertyDiscoveryRails } from '@/components/property-discovery-rails';
import { ReviewsPanel } from '@/components/reviews-panel';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { buildAiTags, loadPropertyDiscoveryRails } from '@/lib/property-discovery';
import { bilingualAlternates } from '@/lib/seo';
import { localizedName } from '@/lib/format';
import { getViewer } from '@/lib/viewer';
import type { ReviewTargetType } from '@/lib/reviews-types';

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
  searchParams,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
  searchParams?: Promise<{ unit?: string }>;
}) {
  const { locale: rawLocale, propertyId } = await params;
  const query = searchParams ? await searchParams : {};
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);

  if (!hasDatabaseUrl()) notFound();
  const [property, viewer] = await Promise.all([
    loadPublicPropertyShowcaseFromNeon(propertyId).catch(() => null),
    getViewer().catch(() => null),
  ]);
  if (!property) notFound();

  const focusUnitId =
    typeof query.unit === 'string' &&
    property.units.some((unit) => unit.id === query.unit || unit.code === query.unit)
      ? property.units.find((unit) => unit.id === query.unit || unit.code === query.unit)?.id
      : undefined;

  const discovery = await loadPropertyDiscoveryRails(property).catch(() => ({
    similar: [],
    recommended: [],
    topRated: [],
  }));
  const aiTags = buildAiTags(property);

  const reviewTargets: Array<{
    type: ReviewTargetType;
    id: string;
    titleAr: string;
    titleEn: string;
  }> = [
    { type: 'property', id: property.id, titleAr: 'العقار', titleEn: 'Property' },
  ];
  if (property.ownerPartyId) {
    reviewTargets.push({
      type: 'party',
      id: property.ownerPartyId,
      titleAr: property.ownerPartyName ? `المالك · ${property.ownerPartyName}` : 'المالك',
      titleEn: property.ownerPartyName ? `Owner · ${property.ownerPartyName}` : 'Owner',
    });
  }
  if (property.organizationId) {
    reviewTargets.push({
      type: 'organization',
      id: property.organizationId,
      titleAr: 'المؤسسة',
      titleEn: 'Organization',
    });
  }

  return (
    <main className="section">
      <div className="container">
        <PropertyDetailManager
          property={property}
          locale={locale}
          portal="owner"
          variant="public"
          signedIn={Boolean(viewer)}
          {...(focusUnitId ? { focusUnitId } : {})}
        />
        <ReviewsPanel locale={locale} signedIn={Boolean(viewer)} targets={reviewTargets} />
        <PropertyDiscoveryRails
          locale={locale}
          aiTags={aiTags}
          similar={discovery.similar}
          recommended={discovery.recommended}
          topRated={discovery.topRated}
        />
      </div>
    </main>
  );
}
