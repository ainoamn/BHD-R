import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { loadPublicUnitFromNeon } from '@/lib/load-public-unit-neon';
import { managedPropertyFromPublicUnit } from '@/lib/managed-property-from-unit';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { ApiError, publicApiFetch } from '@/lib/server-api';
import { bilingualAlternates, unitListingJsonLd } from '@/lib/seo';
import { getViewer } from '@/lib/viewer';
import { withTimedResult } from '@/lib/with-timeout';
import type { PublicUnitDetail } from '@bhd-r/contracts';

export const dynamic = 'force-dynamic';

type UnitLookup =
  | { kind: 'found'; unit: PublicUnitDetail }
  | { kind: 'missing' }
  | { kind: 'transient' };

const getUnit = cache(async (id: string): Promise<UnitLookup> => {
  let neonConfirmedMissing = false;

  if (hasDatabaseUrl()) {
    const neon = await withTimedResult(loadPublicUnitFromNeon(id), 5_000, 'unit-neon');
    if (neon.status === 'ok' && neon.value) return { kind: 'found', unit: neon.value };
    if (neon.status === 'ok' && neon.value === null) neonConfirmedMissing = true;
  }

  try {
    const nest = await publicApiFetch<PublicUnitDetail>(
      `/v1/public/units/${encodeURIComponent(id)}`,
      30,
      [`public-listings`, `unit:${id}`],
    );
    return {
      kind: 'found',
      unit: {
        ...nest,
        images: nest.images.map((image) => ({
          ...image,
          url: toPublicMediaSrc(image.url) ?? image.url,
        })),
      },
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
      // Only treat Nest 404 as real removal when Neon also confirmed empty (or no DB).
      if (neonConfirmedMissing || !hasDatabaseUrl()) return { kind: 'missing' };
      return { kind: 'transient' };
    }
    console.error('Nest public unit load failed', error);
    return neonConfirmedMissing ? { kind: 'missing' } : { kind: 'transient' };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}): Promise<Metadata> {
  const { locale, unitId } = await params;
  const lookup = await getUnit(unitId).catch(() => ({ kind: 'transient' as const }));
  if (lookup.kind !== 'found')
    return {
      title: locale === 'ar' ? 'الوحدة غير متاحة' : 'Unit unavailable',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  const unit = lookup.unit;
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

function TransientUnitNotice({ locale, unitId }: { locale: 'ar' | 'en'; unitId: string }) {
  const ar = locale === 'ar';
  return (
    <main className="section">
      <div className="container legal-content">
        <span className="eyebrow">{ar ? 'جاري التحميل' : 'Loading'}</span>
        <h1>{ar ? 'تعذّر تحميل الوحدة مؤقتاً' : 'Unit temporarily unavailable'}</h1>
        <p>
          {ar
            ? 'الاتصال بقاعدة البيانات استغرق وقتاً أطول من المعتاد. هذه ليست صفحة 404 — أعد المحاولة خلال لحظات.'
            : 'The database took longer than usual. This is not a 404 — please retry in a moment.'}
        </p>
        <div className="ops-inline-actions">
          <a className="button button--primary" href={`/${locale}/units/${unitId}`}>
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

/** Public unit URL — same Property 360 marketing layout as owner/admin preview. */
export default async function UnitPage({
  params,
}: {
  params: Promise<{ locale: string; unitId: string }>;
}) {
  const { locale: rawLocale, unitId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);

  const lookup = await getUnit(unitId);
  if (lookup.kind === 'missing') notFound();
  if (lookup.kind === 'transient') return <TransientUnitNotice locale={locale} unitId={unitId} />;

  const unit = lookup.unit;
  if (!hasDatabaseUrl()) {
    // Still show Nest-backed unit without showcase when DB URL is absent.
    const property = managedPropertyFromPublicUnit(unit);
    return (
      <main className="section">
        <div className="container">
          <PropertyDetailManager
            property={property}
            locale={locale}
            portal="owner"
            variant="public"
            focusUnitId={unit.unitId}
            signedIn={false}
          />
        </div>
      </main>
    );
  }

  const [showcaseResult, viewer] = await Promise.all([
    withTimedResult(
      loadPublicPropertyShowcaseFromNeon(unit.propertyId),
      7_000,
      'property-showcase-neon',
    ),
    withTimedResult(getViewer(), 2_000, 'unit-viewer'),
  ]);

  const property =
    showcaseResult.status === 'ok' && showcaseResult.value
      ? showcaseResult.value
      : managedPropertyFromPublicUnit(unit);
  const showcaseDegraded = !(showcaseResult.status === 'ok' && showcaseResult.value);

  const title = `${localizedName(locale, unit.propertyNameAr, unit.propertyNameEn)} — ${localizedName(locale, unit.unitNameAr, unit.unitNameEn)}`;
  const description = localizedName(locale, unit.descriptionAr ?? '', unit.descriptionEn ?? '');
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const structuredData = unitListingJsonLd({ locale, unit, title, description });

  const heroImage =
    toPublicMediaSrc(property.gallery?.[0]?.url) ??
    property.gallery?.[0]?.url ??
    toPublicMediaSrc(unit.images[0]?.url) ??
    unit.images[0]?.url ??
    null;

  return (
    <>
      {heroImage ? (
        <link rel="preload" as="image" href={heroImage} fetchPriority="high" />
      ) : null}
      <main className="section">
        <div className="container">
          {showcaseDegraded ? (
            <p className="notice" role="status">
              {locale === 'ar'
                ? 'عُرضت تفاصيل الوحدة بسرعة. بعض بيانات المبنى قد تكتمل عند إعادة التحميل.'
                : 'Showing unit details quickly. Full building data may complete on refresh.'}
            </p>
          ) : null}
          <PropertyDetailManager
            property={property}
            locale={locale}
            portal="owner"
            variant="public"
            focusUnitId={unit.unitId}
            signedIn={viewer.status === 'ok' ? Boolean(viewer.value) : false}
          />
        </div>
      </main>
      <script type="application/ld+json" nonce={nonce}>
        {JSON.stringify(structuredData).replaceAll('<', '\\u003c')}
      </script>
    </>
  );
}
