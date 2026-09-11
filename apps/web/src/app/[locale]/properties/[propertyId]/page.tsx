import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { PropertyDiscoveryRails } from '@/components/property-discovery-rails';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { buildAiTags, loadPropertyDiscoveryRails } from '@/lib/property-discovery';
import { bilingualAlternates } from '@/lib/seo';
import { localizedName } from '@/lib/format';
import { getViewer } from '@/lib/viewer';
import { withTimedResult } from '@/lib/with-timeout';

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
  const result = await withTimedResult(
    loadPublicPropertyShowcaseFromNeon(propertyId),
    7_000,
    'property-meta-neon',
  );
  const property = result.status === 'ok' ? result.value : null;
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
  const ar = locale === 'ar';

  if (!hasDatabaseUrl()) notFound();

  const [showcaseResult, viewerResult] = await Promise.all([
    withTimedResult(
      loadPublicPropertyShowcaseFromNeon(propertyId),
      7_000,
      'property-showcase-neon',
    ),
    withTimedResult(getViewer(), 2_000, 'property-viewer'),
  ]);

  if (showcaseResult.status === 'ok' && showcaseResult.value === null) notFound();
  if (showcaseResult.status !== 'ok' || !showcaseResult.value) {
    return (
      <main className="section">
        <div className="container legal-content">
          <span className="eyebrow">{ar ? 'جاري التحميل' : 'Loading'}</span>
          <h1>{ar ? 'تعذّر تحميل العقار مؤقتاً' : 'Property temporarily unavailable'}</h1>
          <p>
            {ar
              ? 'الاتصال استغرق وقتاً أطول من المعتاد. هذه ليست صفحة 404 — أعد المحاولة.'
              : 'The connection took longer than usual. This is not a 404 — please retry.'}
          </p>
          <div className="ops-inline-actions">
            <a className="button button--primary" href={`/${locale}/properties/${propertyId}`}>
              {ar ? 'إعادة المحاولة' : 'Retry'}
            </a>
            <Link className="button button--quiet" href="/properties">
              {ar ? 'العقارات المتاحة' : 'Available properties'}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const property = showcaseResult.value;
  const viewer = viewerResult.status === 'ok' ? viewerResult.value : null;

  const focusUnitId =
    typeof query.unit === 'string' &&
    property.units.some((unit) => unit.id === query.unit || unit.code === query.unit)
      ? property.units.find((unit) => unit.id === query.unit || unit.code === query.unit)?.id
      : undefined;

  const discovery = await withTimedResult(
    loadPropertyDiscoveryRails(property),
    4_000,
    'property-discovery',
  );
  const rails =
    discovery.status === 'ok'
      ? discovery.value
      : { similar: [], recommended: [], topRated: [] };
  const aiTags = buildAiTags(property);

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
        <PropertyDiscoveryRails
          locale={locale}
          aiTags={aiTags}
          similar={rails.similar}
          recommended={rails.recommended}
          topRated={rails.topRated}
        />
      </div>
    </main>
  );
}
