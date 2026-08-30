import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { loadPublicUnitFromNeon } from '@/lib/load-public-unit-neon';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { ApiError, publicApiFetch } from '@/lib/server-api';
import { bilingualAlternates, unitListingJsonLd } from '@/lib/seo';
import { getViewer } from '@/lib/viewer';
import type { PublicUnitDetail } from '@bhd-r/contracts';

async function getUnit(id: string): Promise<PublicUnitDetail | null> {
  if (hasDatabaseUrl()) {
    try {
      const neon = await loadPublicUnitFromNeon(id);
      if (neon) return neon;
    } catch (error) {
      console.error('Neon public unit load failed', error);
    }
  }
  try {
    const nest = await publicApiFetch<PublicUnitDetail>(
      `/v1/public/units/${encodeURIComponent(id)}`,
      30,
      [`public-listings`, `unit:${id}`],
    );
    return {
      ...nest,
      images: nest.images.map((image) => ({
        ...image,
        url: toPublicMediaSrc(image.url) ?? image.url,
      })),
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return null;
    console.error('Nest public unit load failed', error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}): Promise<Metadata> {
  const { locale, unitId } = await params;
  const unit = await getUnit(unitId).catch(() => null);
  if (!unit)
    return {
      title: locale === 'ar' ? 'الوحدة غير متاحة' : 'Unit unavailable',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`;
  const description =
    localizedName(locale, unit.descriptionAr ?? '', unit.descriptionEn ?? '') ||
    `${unit.governorate}, ${unit.wilayat}`;
  const image = toPublicMediaSrc(unit.images[0]?.url) ?? unit.images[0]?.url;
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/units/${unit.unitId}`),
    openGraph: {
      title,
      description,
      url: `/${locale}/units/${unit.unitId}`,
      type: 'website',
      images: image ? [{ url: image }] : [],
    },
    twitter: { title, description, images: image ? [image] : [] },
  };
}

/** Public unit URL — same Property 360 marketing layout as owner/admin preview. */
export default async function UnitPage({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}) {
  const { locale: rawLocale, unitId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);

  const unit = await getUnit(unitId);
  if (!unit) notFound();

  if (!hasDatabaseUrl()) notFound();
  const [property, viewer] = await Promise.all([
    loadPublicPropertyShowcaseFromNeon(unit.propertyId).catch(() => null),
    getViewer().catch(() => null),
  ]);
  if (!property) notFound();

  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`;
  const description = localizedName(locale, unit.descriptionAr ?? '', unit.descriptionEn ?? '');
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const structuredData = unitListingJsonLd({ locale, unit, title, description });

  return (
    <>
      <main className="section">
        <div className="container">
          <PropertyDetailManager
            property={property}
            locale={locale}
            portal="owner"
            variant="public"
            focusUnitId={unit.unitId}
            signedIn={Boolean(viewer)}
          />
        </div>
      </main>
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(structuredData).replaceAll('<', '\\u003c')}
      </script>
    </>
  );
}
