import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PropertyDetailManager } from '@/components/property-detail-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { loadPublicPropertyShowcaseFromNeon } from '@/lib/load-public-property-neon';
import { loadPublicStayBySlugOnNeon } from '@/lib/load-public-stays-neon';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { bilingualAlternates } from '@/lib/seo';
import { publicApiFetch } from '@/lib/server-api';
import { getViewer } from '@/lib/viewer';
import type { StayPublicDetail } from '@bhd-r/contracts';

async function loadStayDetail(slug: string, unitId?: string): Promise<StayPublicDetail | null> {
  if (hasDatabaseUrl()) {
    try {
      const neon = await loadPublicStayBySlugOnNeon(slug, unitId ?? null);
      if (neon) return neon;
    } catch (error) {
      console.error('Neon public stay load failed', error);
    }
  }
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  return publicApiFetch<StayPublicDetail>(
    `/v1/public/stays/${encodeURIComponent(slug)}${qs}`,
    8,
  ).catch(() => null);
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
  const unitId = one(query.unit) ?? one(query.unitId);
  const detail = await loadStayDetail(slug, unitId).catch(() => null);
  if (!detail) {
    return {
      title: locale === 'ar' ? 'إقامة يومية' : 'Daily stay',
      robots: { index: false, follow: false },
      openGraph: { images: [] },
      twitter: { images: [] },
    };
  }
  const title = localizedName(locale, detail.titleAr, detail.titleEn);
  const description =
    localizedName(locale, detail.descriptionAr ?? '', detail.descriptionEn ?? '') ||
    detail.destination ||
    title;
  const image = toPublicMediaSrc(detail.coverImageUrl) ?? detail.coverImageUrl ?? undefined;
  const unitQs = unitId ? `?unit=${encodeURIComponent(unitId)}` : '';
  return {
    title,
    description,
    alternates: bilingualAlternates(locale, `/stays/${slug}${unitQs}`),
    openGraph: {
      title,
      description,
      url: `/${locale}/stays/${slug}${unitQs}`,
      type: 'website',
      images: image ? [{ url: image }] : [],
    },
    twitter: { title, description, images: image ? [image] : [] },
  };
}

/** Public stay — same Property 360 layout as unit listings, with daily-stay booking sidebar. */
export default async function StayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale: rawLocale, slug } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('Stays');

  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;

  const checkInOn = one(query.checkInOn);
  const checkOutOn = one(query.checkOutOn);
  const adults = one(query.adults);
  const children = one(query.children);
  const unitQuery = one(query.unit) ?? one(query.unitId);

  const dateDefaults = {
    ...(checkInOn ? { checkInOn } : {}),
    ...(checkOutOn ? { checkOutOn } : {}),
    ...(adults ? { adults } : {}),
    ...(children ? { children } : {}),
  };

  const detail = await loadStayDetail(slug, unitQuery);
  if (!detail?.propertyId || !hasDatabaseUrl()) {
    if (!detail) {
      return (
        <main className="section">
          <div className="container">
            <p className="notice notice--info" role="status">
              {t('comingOnline')}
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }

  const [property, viewer] = await Promise.all([
    loadPublicPropertyShowcaseFromNeon(detail.propertyId).catch(() => null),
    getViewer().catch(() => null),
  ]);
  if (!property) notFound();

  const title = localizedName(locale, detail.titleAr, detail.titleEn);
  const focusUnitId = (() => {
    if (unitQuery && property.units.some((unit) => unit.id === unitQuery)) {
      return unitQuery;
    }
    if (detail.unitId) {
      const linked = property.units.find((unit) => unit.id === detail.unitId);
      if (linked) return detail.unitId;
    }
    const residential = [...property.units]
      .filter((unit) => (unit.bedrooms ?? 0) > 0)
      .sort((a, b) => a.code.localeCompare(b.code))[0];
    return residential?.id ?? detail.unitId;
  })();

  const propertyForDisplay = {
    ...property,
    descriptionAr: detail.descriptionAr || property.descriptionAr,
    descriptionEn: detail.descriptionEn || property.descriptionEn,
  };

  return (
    <main className="section">
      <div className="container">
        <PropertyDetailManager
          property={propertyForDisplay}
          locale={locale}
          portal="owner"
          variant="public"
          {...(focusUnitId ? { focusUnitId } : {})}
          signedIn={Boolean(viewer)}
          stayBooking={{
            slug,
            title,
            ...(detail.unitId ? { unitId: detail.unitId } : {}),
            ...(detail.nightlyMinor != null ? { nightlyMinor: detail.nightlyMinor } : {}),
            ...(detail.currency != null ? { currency: detail.currency } : {}),
            ...(detail.maxGuests != null ? { maxGuests: detail.maxGuests } : {}),
            ...dateDefaults,
          }}
          stayDetail={detail}
        />
      </div>
    </main>
  );
}
