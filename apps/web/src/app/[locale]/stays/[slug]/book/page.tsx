import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { StayCheckout } from '@/components/stays/stay-checkout';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { localizedName } from '@/lib/format';
import { loadPublicStayBySlugOnNeon } from '@/lib/load-public-stays-neon';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';
import type { StayPublicDetail } from '@bhd-r/contracts';

type StayType = 'overnight_stay' | 'day_use' | 'overnight_only';

function pickQuery(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = query[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  return undefined;
}

function parseStayType(value: string | undefined): StayType | undefined {
  if (value === 'day_use' || value === 'overnight_only' || value === 'overnight_stay') return value;
  return undefined;
}

async function loadStayDetail(
  slug: string,
  unitId?: string,
): Promise<StayPublicDetail | null> {
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
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const detail = await loadStayDetail(slug).catch(() => null);
  const title = detail
    ? localizedName(locale, detail.titleAr, detail.titleEn)
    : locale === 'ar'
      ? 'إكمال الحجز'
      : 'Complete booking';
  return {
    title: locale === 'ar' ? `حجز — ${title}` : `Book — ${title}`,
    robots: { index: false, follow: false },
  };
}

/** Dedicated Booking.com-style checkout page (not embedded in the property page). */
export default async function StayBookPage({
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
  const ar = locale === 'ar';
  const unitId = pickQuery(query, 'unit') ?? pickQuery(query, 'unitId');

  const detail = await loadStayDetail(slug, unitId);
  if (!detail) notFound();

  const title = localizedName(locale, detail.titleAr, detail.titleEn);
  const cover = toPublicMediaSrc(detail.coverImageUrl) ?? detail.coverImageUrl ?? null;
  const stayType = parseStayType(pickQuery(query, 'stayType'));

  return (
    <div className="container section stays-book-page">
      <div className="stays-book-page__layout">
        <aside className="stays-book-page__aside">
          <Link
            className="stays-book-page__back"
            href={`/stays/${encodeURIComponent(slug)}${unitId ? `?unit=${encodeURIComponent(unitId)}` : ''}`}
          >
            {ar ? '← العودة للإقامة' : '← Back to stay'}
          </Link>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="stays-book-page__cover" src={cover} alt="" />
          ) : null}
          <h1 className="stays-book-page__title">{title}</h1>
          <p className="muted">
            {ar
              ? 'راجع التواريخ ونوع الإقامة ثم أكمل بياناتك في صفحة مستقلة — كما في مواقع الحجز العالمية.'
              : 'Review dates and stay type, then complete guest details on a dedicated page — like global booking sites.'}
          </p>
        </aside>
        <div className="stays-book-page__main">
          <StayCheckout
            locale={locale}
            slug={slug}
            title={title}
            {...((detail.unitId ?? unitId) ? { unitId: (detail.unitId ?? unitId)! } : {})}
            defaults={{
              ...(pickQuery(query, 'checkInOn')
                ? { checkInOn: pickQuery(query, 'checkInOn')! }
                : {}),
              ...(pickQuery(query, 'checkOutOn')
                ? { checkOutOn: pickQuery(query, 'checkOutOn')! }
                : {}),
              ...(pickQuery(query, 'adults') ? { adults: pickQuery(query, 'adults')! } : {}),
              ...(pickQuery(query, 'children')
                ? { children: pickQuery(query, 'children')! }
                : {}),
              ...(stayType ? { stayType } : {}),
            }}
          />
        </div>
      </div>
    </div>
  );
}
